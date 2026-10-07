import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../lib/domain";
import { localData, backupText, parseBackup } from "../lib/local-flow";
import { importVerifiedAugust } from "../lib/august-data";
import {
  unpaidLines,
  createSelectedInvoices,
  confirmSelectedInvoice,
  consolidateDestinations,
  pendingInfo,
} from "../lib/billing-plan";
import { originalComparison, releaseInvoice } from "../lib/billing-accounts";
import { cancelBillingDraft } from "../lib/billing";
function fixture() {
  const d = importVerifiedAugust(localData(emptyData()), "土屋");
  d.taxRules!.push(
    ...["2026-09", "2026-10"].map((month) => ({ ...d.taxRules![0], month })),
  );
  return d;
}
test("Schatz explicit carry into any later month preserves original, date and IDs; coverage prevents repeat and release restores pending", () => {
  let d = fixture();
  const p = d.billingParties!.find((p) => p.internal_name === "Schatz")!,
    original = JSON.stringify(d.billingInvoices),
    lines = unpaidLines(d, p.id);
  assert.equal(lines.length, 2);
  assert.equal(
    lines.reduce((s, l) => s + Number(l.amount), 0),
    61100,
  );
  assert.throws(
    () =>
      createSelectedInvoices(
        d,
        "2026-08",
        p.id,
        lines.map((l) => l.source_id),
        "unified",
        "土屋",
      ),
    /後続月/,
  );
  d = createSelectedInvoices(
    d,
    "2026-10",
    p.id,
    lines.map((l) => l.source_id),
    "unified",
    "土屋",
  );
  let i = d.billingInvoices!.at(-1)!;
  assert.equal(i.net, "61100");
  assert.equal(i.tax, "6110");
  assert.equal(i.gross, "67210");
  assert.ok(
    i.lines.every(
      (l) =>
        l.actual_day === "2026-08-04" && l.notes.includes("2026年8月未請求分"),
    ),
  );
  assert.throws(
    () =>
      createSelectedInvoices(
        d,
        "2026-09",
        p.id,
        [lines[0].source_id],
        "unified",
        "佐藤",
      ),
    /別の未確定/,
  );
  d = confirmSelectedInvoice(d, i.id, "佐藤");
  assert.equal(unpaidLines(d, p.id).length, 0);
  assert.equal(pendingInfo(d, lines[0]).invoice_id, i.id);
  assert.equal(originalComparison(d, "2026-08", p.id).net, "570290");
  assert.equal(JSON.stringify(d.billingInvoices!.slice(0, 11)), original);
  assert.throws(
    () =>
      createSelectedInvoices(
        d,
        "2026-09",
        p.id,
        [lines[0].source_id],
        "unified",
        "土屋",
      ),
    /請求済み/,
  );
  const restored = parseBackup(backupText(d));
  assert.deepEqual(restored.sales, d.sales);
  d = releaseInvoice(d, i.id, "土屋", "検証取消");
  assert.equal(unpaidLines(d, p.id).length, 2);
  assert.equal(pendingInfo(d, lines[0]).invoice_id, null);
  assert.equal(originalComparison(d, "2026-08", p.id).net, "570290");
  d = createSelectedInvoices(
    d,
    "2026-09",
    p.id,
    [lines[0].source_id],
    "unified",
    "土屋",
  );
  i = d.billingInvoices!.at(-1)!;
  d = confirmSelectedInvoice(d, i.id, "土屋");
  assert.equal(unpaidLines(d, p.id).length, 1);
});
test("TWS multiple destinations: unified vs per destination; existing paid August references and price history remain immutable", () => {
  let d = fixture();
  const original = JSON.stringify(d.billingInvoices),
    prices = JSON.stringify(d.prices),
    cs = d.customers.filter((c) => c.name.includes("TWS"));
  assert.equal(cs.length, 2);
  d.billingParties!.push({
    id: "tws-parent",
    internal_name: "TWS",
    formal_name: "TWS",
    address: "",
    active: true,
  });
  d = consolidateDestinations(
    d,
    "tws-parent",
    cs.map((c) => c.id),
    "今後TWSへ統合",
  );
  assert.equal(JSON.stringify(d.billingInvoices), original);
  assert.equal(JSON.stringify(d.prices), prices);
  for (const [index, c] of cs.entries()) {
    const s = d.sales!.find((s) => s.customer_id === c.id)!;
    d.sales!.push({
      ...s,
      id: "new-tws-" + index,
      delivered_on: "2026-09-10",
      invoice_on: "2026-09-10",
      billing_party_id: "tws-parent",
      quantity_l: String(100 * (index + 1)),
      invoice_quantity: undefined,
      invoice_unit: undefined,
      invoice_unit_price: undefined,
      unit_price_excl_tax: "90",
      net_amount: String(9000 * (index + 1)),
      billing_status: "unbilled",
      billed_at: null,
      billed_by: null,
    });
  }
  const ids = unpaidLines(d, "tws-parent").map((l) => l.source_id);
  assert.equal(ids.length, 2);
  const unified = createSelectedInvoices(
    d,
    "2026-09",
    "tws-parent",
    ids,
    "unified",
    "土屋",
  );
  assert.equal(unified.billingInvoices!.length, 12);
  assert.equal(unified.billingInvoices!.at(-1)!.net, "27000");
  let split = createSelectedInvoices(
    d,
    "2026-09",
    "tws-parent",
    ids,
    "destination",
    "土屋",
  );
  assert.equal(split.billingInvoices!.length, 13);
  assert.deepEqual(
    split
      .billingInvoices!.slice(-2)
      .map((i) => i.net)
      .sort(),
    ["18000", "9000"],
  );
  for (const i of split.billingInvoices!.slice(-2))
    split = confirmSelectedInvoice(split, i.id, "佐藤");
  assert.equal(unpaidLines(split, "tws-parent").length, 0);
  assert.equal(JSON.stringify(split.billingInvoices!.slice(0, 11)), original);
  const cancelled = cancelBillingDraft(
    unified,
    unified.billingInvoices!.at(-1)!.id,
  );
  assert.equal(
    createSelectedInvoices(
      cancelled,
      "2026-10",
      "tws-parent",
      ids,
      "unified",
      "土屋",
    ).billingInvoices!.at(-1)!.net,
    "27000",
  );
});
test("tax confirmation and changed snapshot are required", () => {
  let d = fixture();
  const p = d.billingParties!.find((p) => p.internal_name === "Schatz")!,
    ids = unpaidLines(d, p.id).map((l) => l.source_id);
  assert.throws(
    () => createSelectedInvoices(d, "2026-11", p.id, ids, "unified", "土屋"),
    /税/,
  );
  d = createSelectedInvoices(d, "2026-10", p.id, ids, "unified", "土屋");
  d.sales!.find((s) => s.id === ids[0])!.invoice_on = "2026-08-05";
  assert.throws(
    () => confirmSelectedInvoice(d, d.billingInvoices!.at(-1)!.id, "土屋"),
    /差異|変更/,
  );
});
test("generic account supports four delivery destinations without ID or quantity consolidation", () => {
  let d = fixture();
  const p = d.billingParties!.find((p) => p.internal_name === "Schatz")!,
    source = d.sales!.find((s) => s.billing_party_id === p.id)!;
  const ids: string[] = [];
  for (let n = 0; n < 4; n++) {
    const id = "four-" + n,
      cid = "four-customer-" + n;
    d.customers.push({
      ...d.customers[0],
      id: cid,
      name: "給液先" + n,
      billing_party_id: p.id,
    });
    d.sales!.push({
      ...source,
      id,
      customer_id: cid,
      delivered_on: "2026-10-15",
      invoice_on: "2026-10-15",
      quantity_l: "10",
      invoice_quantity: undefined,
      invoice_unit_price: undefined,
      invoice_unit: undefined,
      unit_price_excl_tax: "65",
      net_amount: "650",
      billing_status: "unbilled",
      billed_at: null,
      billed_by: null,
    });
    ids.push(id);
  }
  const split = createSelectedInvoices(
    d,
    "2026-10",
    p.id,
    ids,
    "destination",
    "土屋",
  );
  assert.equal(split.billingInvoices!.slice(11).length, 4);
  const unified = createSelectedInvoices(
    d,
    "2026-10",
    p.id,
    ids,
    "unified",
    "土屋",
  );
  assert.equal(unified.billingInvoices!.at(-1)!.net, "2600");
  assert.equal(unified.billingInvoices!.at(-1)!.lines.length, 4);
});
