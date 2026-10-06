import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  japanDate,
  weekEnd,
  currentPrice,
  suggestFromLine,
  validateQuantity,
  lineReply,
  type Price,
} from "../lib/domain";
test("Japan calendar boundaries, tomorrow and Sunday week end", () => {
  assert.equal(japanDate(new Date("2026-10-05T16:00:00Z")), "2026-10-06");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(weekEnd("2026-10-06"), "2026-10-11");
  assert.equal(weekEnd("2026-10-11"), "2026-10-11");
});
test("price applies by delivery day with newest same-day revision", () => {
  const base: Price = {
    id: "1",
    customer_id: "c",
    amount: 100,
    unit: "L",
    tax_basis: "exclusive",
    effective_from: "2026-01-01",
    note: "",
    created_at: "2026-01-01",
    revision: 1,
  };
  const prices = [
    base,
    {
      ...base,
      id: "2",
      amount: 120,
      effective_from: "2026-10-01",
      revision: 2,
    },
    {
      ...base,
      id: "3",
      amount: 130,
      effective_from: "2026-10-01",
      revision: 3,
    },
    { ...base, customer_id: "other", amount: 999 },
  ];
  assert.equal(currentPrice(prices, "c", "2025-12-31"), undefined);
  assert.equal(currentPrice(prices, "c", "2026-09-30")?.amount, 100);
  assert.equal(currentPrice(prices, "c", "2026-10-01")?.amount, 130);
});
test("LINE extraction only suggests explicitly stated quantity", () => {
  assert.deepEqual(suggestFromLine("明日200Lお願いします"), {
    quantity: 200,
    unit: "L",
  });
  assert.deepEqual(suggestFromLine("10月6日に給液お願いします"), {
    quantity: null,
    unit: "",
  });
  assert.deepEqual(suggestFromLine("2缶お願いします"), {
    quantity: 2,
    unit: "缶",
  });
});
test("quantity rejects zero, negative, NaN and allows unknown", () => {
  assert.equal(validateQuantity(""), null);
  assert.equal(validateQuantity("0.5"), 0.5);
  for (const q of ["0", "-1", "abc", "Infinity"])
    assert.throws(() => validateQuantity(q));
});
test("reply includes confirmed planned date and does not invent time", () => {
  const reply = lineReply("藤沢運送", "2026-10-07", "車庫");
  assert.match(reply, /2026\/10\/07/);
  assert.match(reply, /車庫/);
  assert.match(reply, /時間帯は別途/);
});
