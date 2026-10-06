import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankRead,
  customerCandidates,
  importedOrder,
  sanitizeRead,
  validDate,
  validateReviewed,
} from "../lib/order-import";
import { demoSeed } from "../lib/domain";
import {
  boundedJson,
  extractOrder,
  MAX_OCR_BODY,
  validateImageData,
} from "../lib/ocr-server";
import { POST } from "../app/api/order-ocr/route";
test("unreadable quantity and incomplete dates are never invented", () => {
  const { fields, warnings } = sanitizeRead({
    customer_name: " 顧客 ",
    quantity_l: "200",
    received_on: "10/6",
    requested_on: "2026-02-30",
    notes: "<script>alert(1)</script>",
  });
  assert.equal(fields.customer_name, "顧客");
  assert.equal(fields.quantity_l, null);
  assert.equal(fields.received_on, null);
  assert.equal(fields.requested_on, null);
  assert.equal(warnings.length, 3);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
});
test("customer matching produces candidates and never assigns a customer", () => {
  const fields = {
    ...blankRead(),
    customer_name: "湘南運送",
    contact: "担当 0466-00-0001",
  };
  const results = customerCandidates(demoSeed().customers, fields);
  assert.equal(results[0].customer.id, "demo-c1");
  assert.ok(results[0].reasons.includes("電話番号が一致"));
  assert.equal(customerCandidates(demoSeed().customers, blankRead()).length, 0);
});
test("hope date is distinct from schedule, quantity is only requested", () => {
  const f = {
    ...blankRead(),
    customer_name: "顧客",
    received_on: "2026-10-06",
    requested_on: "2026-10-08",
    quantity_l: 200,
  };
  const order = importedOrder(f, "customer", "fax", null);
  assert.equal(order.scheduled_on, null);
  assert.equal(order.status, "new");
  assert.equal(order.requested_on, "2026-10-08");
  assert.equal(order.requested_quantity, 200);
  assert.throws(() => validateReviewed({ ...f, quantity_l: 0 }));
  assert.throws(() => validateReviewed({ ...f, received_on: null }));
});
test("OCR rejects remote URLs, unsupported images, wrong bytes and oversized bodies", async () => {
  assert.throws(() => validateImageData("https://example.com/image.png"));
  assert.throws(() =>
    validateImageData(
      "data:image/jpeg;base64," + Buffer.alloc(30).toString("base64"),
    ),
  );
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "x".repeat(MAX_OCR_BODY + 1),
  });
  await assert.rejects(boundedJson(request));
});
test("OpenAI adapter requests strict candidates without response persistence and parses SDK response", async () => {
  let sent: any;
  const transport: typeof fetch = async (_url, init) => {
    sent = JSON.parse(init?.body as string);
    return Response.json({
      id: "resp_test",
      object: "response",
      status: "completed",
      model: "configured-test-model",
      output: [
        {
          id: "msg_test",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                ...blankRead(),
                customer_name: "顧客",
                quantity_l: 123,
                warnings: ["要確認"],
              }),
              annotations: [],
            },
          ],
        },
      ],
    });
  };
  const result = await extractOrder(
    "data:image/png;base64,AAAA",
    "test-key",
    "configured-test-model",
    transport,
  );
  assert.equal(result.fields.quantity_l, 123);
  assert.equal(sent.model, "configured-test-model");
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.match(sent.input[0].content[0].text, /推測せず/);
  assert.equal(result.method, "openai");
});
test("endpoint rejects cross-origin requests and clearly reports missing configuration", async () => {
  const key = process.env.ADBLUE_OPENAI_API_KEY,
    model = process.env.OPENAI_OCR_MODEL;
  delete process.env.ADBLUE_OPENAI_API_KEY;
  delete process.env.OPENAI_OCR_MODEL;
  try {
    const cross = await POST(
      new Request("http://localhost:3000/api/order-ocr", {
        method: "POST",
        headers: { origin: "http://evil.test" },
      }),
    );
    assert.equal(cross.status, 403);
    const missing = await POST(
      new Request("http://localhost:3000/api/order-ocr", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /停止|未設定/);
  } finally {
    if (key !== undefined) process.env.ADBLUE_OPENAI_API_KEY = key;
    if (model !== undefined) process.env.OPENAI_OCR_MODEL = model;
  }
});
