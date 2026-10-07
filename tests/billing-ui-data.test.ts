import { test } from "node:test";
import assert from "node:assert/strict";
import { augustWithSeptember } from "./billing-test-fixture";
import {
  sourceBillingMonth,
  unpaidLines,
  consolidateDestinations,
  createSelectedInvoices,
  confirmSelectedInvoice,
  updatePending,
  pendingInfo,
} from "../lib/billing-plan";
import { backupText, parseBackup } from "../lib/local-flow";
import { originalComparison } from "../lib/billing-accounts";
test("backup preserves unbilled reasons, persistent integration, invoice IDs and complete August originals", () => {
  let { data, destinations } = augustWithSeptember();
  const refs = data.billingInvoices!.filter((i) => i.kind === "reference"),
    prices = data.prices;
  const schatz = data.billingParties!.find(
      (p) => p.internal_name === "Schatz",
    )!,
    old = unpaidLines(data, schatz.id),
    eg = old.find((l) => l.amount === "48100")!;
  data = updatePending(data, eg.source_id, {
    reason: "発行後に請求漏れを確認",
    discovered_on: "2026-09-05",
    planned_month: "2026-09",
    invoice_id: null,
  });
  data = consolidateDestinations(
    data,
    "tws-parent",
    destinations.map((c) => c.id),
    "9月から統合",
  );
  data = createSelectedInvoices(
    data,
    "2026-09",
    "tws-parent",
    unpaidLines(data, "tws-parent").map((l) => l.source_id),
    "unified",
    "土屋",
  );
  const tws = data.billingInvoices!.at(-1)!;
  data = confirmSelectedInvoice(data, tws.id, "佐藤");
  data = createSelectedInvoices(
    data,
    "2026-09",
    schatz.id,
    [eg.source_id],
    "unified",
    "土屋",
  );
  const invoice = data.billingInvoices!.at(-1)!;
  data = confirmSelectedInvoice(data, invoice.id, "佐藤");
  const restored = parseBackup(backupText(data));
  assert.deepEqual(restored, data);
  assert.deepEqual(
    restored.billingInvoices!.filter((i) => i.kind === "reference"),
    refs,
  );
  assert.deepEqual(restored.prices, prices);
  assert.ok(
    destinations.every(
      (c) =>
        restored.customers.find((x) => x.id === c.id)!.billing_party_id ===
        "tws-parent",
    ),
  );
  assert.equal(pendingInfo(restored, eg).invoice_id, invoice.id);
  assert.equal(pendingInfo(restored, eg).discovered_on, "2026-09-05");
  assert.equal(unpaidLines(restored, schatz.id)[0].amount, "13000");
  assert.equal(
    originalComparison(restored, "2026-08", schatz.id).net,
    "570290",
  );
  assert.equal(originalComparison(restored, "2026-08").net, "2823058");
  // Unlink one destination by explicitly selecting its individual billing account; no paid history changes.
  const before = restored.sales!.filter((s) => s.billing_status === "billed");
  const changed = consolidateDestinations(
    restored,
    destinations[0].billing_party_id!,
    [destinations[0].id],
    "本牧を個別請求へ戻す",
  );
  assert.deepEqual(
    changed.sales!.filter((s) => s.billing_status === "billed"),
    before,
  );
  assert.equal(
    changed.customers.find((c) => c.id === destinations[0].id)!
      .billing_party_id,
    destinations[0].billing_party_id,
  );
  assert.equal(
    changed.customers.find((c) => c.id === destinations[1].id)!
      .billing_party_id,
    "tws-parent",
  );
});
test("unbilled original target month respects original references and closing day without changing delivery date", () => {
  const { data } = augustWithSeptember(),
    schatz = data.billingParties!.find((p) => p.internal_name === "Schatz")!,
    eg = unpaidLines(data, schatz.id)[0];
  assert.equal(sourceBillingMonth(data, eg), "2026-08");
  const l = unpaidLines(data).find((l) => l.actual_day === "2026-09-10")!,
    p = data.billingParties!.find(
      (p) =>
        p.id ===
        data.sales!.find((s) => s.id === l.source_id)!.billing_party_id,
    )!;
  assert.equal(sourceBillingMonth(data, l), "2026-09");
  p.terms = {
    closing_day: 5,
    invoice_day: 1,
    payment_month_offset: 1,
    payment_day: 31,
  };
  assert.equal(sourceBillingMonth(data, l), "2026-10");
  assert.equal(l.actual_day, "2026-09-10");
});

test("different free loan products are separate invoice lines while duplicate same products remain blocked", () => {
  let { data } = augustWithSeptember();
  const payer = data.billingParties!.find(
    (p) => p.internal_name === "石田電設",
  )!;
  data.billingInvoices = data.billingInvoices!.filter(
    (i) => i.billing_party_id !== payer.id,
  );
  data.sales = data.sales!.map((s) =>
    s.billing_party_id === payer.id
      ? { ...s, billing_status: "unbilled", billed_at: null, billed_by: null }
      : s,
  );
  data.billingItems = data.billingItems!.map((i) =>
    i.billing_party_id === payer.id ? { ...i, status: "unbilled" } : i,
  );
  const ids = unpaidLines(data, payer.id).map((l) => l.source_id),
    next = createSelectedInvoices(
      data,
      "2026-08",
      payer.id,
      ids,
      "unified",
      "土屋",
    ),
    invoice = next.billingInvoices!.at(-1)!;
  assert.equal(invoice.lines.filter((l) => l.kind === "loan").length, 5);
  assert.equal(invoice.net, "90000");
  const issued = confirmSelectedInvoice(next, invoice.id, "佐藤");
  assert.deepEqual(parseBackup(backupText(issued)), issued);
  const loan = data.billingItems!.find(
    (i) => i.billing_party_id === payer.id && i.kind === "loan",
  )!;
  data.billingItems!.push({ ...loan, id: "duplicate-loan" });
  assert.throws(
    () =>
      createSelectedInvoices(
        data,
        "2026-08",
        payer.id,
        [...ids, "duplicate-loan"],
        "unified",
        "土屋",
      ),
    /重複候補/,
  );
});
