import { test } from "node:test";
import assert from "node:assert/strict";
import { demoSeed } from "../lib/domain";
import {
  localData,
  confirmActual,
  multiplyNet,
  sumDecimal,
  markBilling,
  backupText,
  parseBackup,
} from "../lib/local-flow";
function fixture() {
  const data = localData(demoSeed()),
    order = data.orders[0];
  data.prices.push({
    id: "test-price",
    customer_id: order.customer_id,
    amount: 100,
    unit: "L",
    tax_basis: "exclusive",
    effective_from: "2020-01-01",
    note: "",
    created_at: "2020-01-01",
    revision: 999,
  });
  data.documents.push({
    id: "doc-test",
    order_id: order.id,
    path: "data:image/jpeg;base64,AA==",
    filename: "納品書.jpg",
    review_status: "pending",
    created_at: new Date().toISOString(),
  });
  return { data, order };
}
test("exact decimal calculation never introduces rounding or floating point error", () => {
  assert.equal(multiplyNet("0.1", "0.2"), "0.02");
  assert.equal(sumDecimal(["0.1", "0.2"]), "0.3");
  assert.throws(() => multiplyNet("1.00001", "100"), /丸めません/);
});
test("actual delivery creates one sale and keeps requested quantity and fixed historical price", () => {
  const { data, order } = fixture();
  const next = confirmActual(
    data,
    order.id,
    {
      delivered_on: "2020-10-06",
      quantity_l: "175",
      performed_by: "土屋",
      document_id: "doc-test",
      notes: "",
    },
    "佐藤",
  );
  assert.equal(next.sales![0].net_amount, "17500");
  assert.equal(next.orders[0].requested_quantity, order.requested_quantity);
  next.prices.push({
    ...data.prices.at(-1)!,
    id: "revised",
    amount: 120,
    revision: 1000,
  });
  assert.equal(next.actuals![0].unit_price_excl_tax, "100");
  assert.equal(next.sales![0].net_amount, "17500");
  assert.throws(
    () =>
      confirmActual(
        next,
        order.id,
        {
          delivered_on: "2020-10-06",
          quantity_l: "175",
          performed_by: "土屋",
          document_id: "doc-test",
          notes: "",
        },
        "土屋",
      ),
    /登録済み/,
  );
  const billed = markBilling(
    next,
    [next.sales![0].id],
    "billed",
    "佐藤",
    "業務検証",
  );
  assert.equal(billed.sales![0].billed_by, "佐藤");
  assert.equal(billed.sales![0].net_amount, "17500");
  assert.equal(
    markBilling(billed, [billed.sales![0].id], "unbilled", "土屋", "戻す")
      .sales![0].billing_status,
    "unbilled",
  );
  assert.deepEqual(parseBackup(backupText(billed)), billed);
  const broken = structuredClone(billed);
  broken.sales![0].net_amount = "1";
  assert.throws(() => parseBackup(backupText(broken)), /金額/);
});
test("legacy data remains readable and invalid restore never creates missing references", () => {
  const legacy = demoSeed(),
    migrated = localData(legacy);
  assert.deepEqual(migrated.customers, legacy.customers);
  assert.deepEqual(migrated.actuals, []);
  const invalid = structuredClone(migrated);
  invalid.orders[0].customer_id = "missing";
  assert.throws(() => localData(invalid), /受注/);
});
