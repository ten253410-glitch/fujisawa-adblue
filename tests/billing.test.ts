import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyData, type Data } from "../lib/domain";
import {
  localData,
  backupText,
  parseBackup,
  markBilling,
} from "../lib/local-flow";
import { importVerifiedAugust, augustFixture } from "../lib/august-data";
import { registerHistory, type ReviewRow } from "../lib/history-import";
import {
  billingCheck,
  makeBillingInvoice,
  confirmBillingInvoice,
  markAdditional,
  ledger,
  issuedCoverage,
  reviewBillingLine,
  taxAmounts,
} from "../lib/billing";
import {
  originalComparison,
  migrateBillingAccounts,
  accountCandidates,
  relinkAccount,
  additionalEligible,
  recalculateDraft,
  releaseInvoice,
  billingDates,
  billingPeriod,
} from "../lib/billing-accounts";
const august = () => importVerifiedAugust(localData(emptyData()), "土屋");
const fields = {
  issued_on: "2026-09-01",
  due_on: "2026-09-30",
  subject: "8月分",
};
function openGtres(): {
  data: Data;
  p: NonNullable<Data["billingParties"]>[number];
} {
  const data = august(),
    p = data.billingParties!.find((p) => p.internal_name === "G.TRES")!;
  return {
    data: {
      ...data,
      billingInvoices: data.billingInvoices!.filter(
        (i) => i.billing_party_id !== p.id,
      ),
    },
    p,
  };
}
function closedGtres() {
  let { data, p } = openGtres();
  data = makeBillingInvoice(data, "2026-08", p.id, "regular", "土屋", fields);
  data = confirmBillingInvoice(data, data.billingInvoices!.at(-1)!.id, "土屋");
  data.billingInvoices!.at(-1)!.confirmed_at = "2026-09-01T00:00:00.000Z";
  return { data, p };
}
function append(
  data: Data,
  payer: string,
  quantity = "15",
  date = "2026-08-31",
) {
  const customer = data.customers.find((c) => c.billing_party_id === payer)!;
  const site = data.sites!.find((s) => s.customer_id === customer.id)!;
  const row: ReviewRow = {
    row: 1,
    day: date,
    customer: customer.name,
    site: site.name,
    address: "",
    quantity,
    price: "100",
    amount: "",
    operator: "土屋",
    slip: "",
    notes: "後日取込",
    customerId: customer.id,
    siteId: site.id,
    newCustomer: false,
    newSite: false,
    include: true,
    useSourceAmount: false,
    duplicateApproved: false,
    approved: true,
  };
  return registerHistory(data, [row], "後日履歴.csv", "CSV", "佐藤");
}
test("August original invoice is the expected reference for all eleven accounts; computed sales are independent", () => {
  const data = august();
  assert.equal(data.sales!.length, 69);
  assert.equal(data.billingItems!.length, 22);
  assert.deepEqual(originalComparison(data, "2026-08"), {
    quantity: "40500",
    net: "2823058",
    tax: "282305",
    gross: "3105363",
    count: 11,
  });
  const check = billingCheck(data, "2026-08");
  assert.equal(check.quantity, "40500");
  assert.equal(check.billedQty, "40500");
  assert.equal(check.net, "2884158");
  assert.equal(check.amountDifference, 61100);
  assert.equal(check.quantityDifference, 0);
  for (const p of data.billingParties!) {
    const original = originalComparison(data, "2026-08", p.id),
      b = augustFixture.bills.find((b) => b.id === p.internal_name)!;
    assert.equal(original.net, b.net);
    assert.equal(original.tax, b.tax);
    assert.equal(original.gross, b.gross);
    assert.equal(
      original.quantity,
      String(
        b.lines.reduce(
          (n, l) =>
            n + Number(l.quantity) * (l.packing === "BIB(20L)" ? 20 : 1),
          0,
        ),
      ),
    );
    if (p.internal_name !== "Schatz")
      assert.equal(billingCheck(data, "2026-08", p.id).net, b.net);
  }
  const p = data.billingParties!.find((p) => p.internal_name === "Schatz")!,
    ref = originalComparison(data, "2026-08", p.id);
  assert.equal(ref.quantity, "9630");
  assert.equal(ref.net, "570290");
  const delta = billingCheck(data, "2026-08", p.id);
  assert.equal(delta.net, "631390");
  assert.equal(delta.issues.filter((i) => i.code === "omission").length, 2);
  for (const issue of delta.issues.filter((i) => i.code === "omission")) {
    const sale = data.sales!.find((s) => s.id === issue.source_id)!;
    assert.equal(sale.billing_party_id, p.id);
    assert.equal(sale.transaction_category, "normal");
    assert.ok(
      data
        .billingInvoices!.find((i) => i.billing_party_id === p.id)!
        .lines.some((l) => l.source_id === sale.id && l.amount === null),
    );
    assert.equal(additionalEligible(data, sale.id), false);
    assert.throws(
      () => markAdditional(data, [sale.id], "土屋"),
      /正式確定した後/,
    );
  }
  assert.throws(
    () =>
      makeBillingInvoice(data, "2026-08", p.id, "additional", "土屋", fields),
    /未請求/,
  );
  assert.deepEqual(parseBackup(backupText(data)), data);
});
test("BIB, paid cover, free loans and separate actual/invoice dates preserve original quantities and prices", () => {
  const data = august(),
    gtres = data.billingParties!.find((p) => p.internal_name === "G.TRES")!;
  const c = billingCheck(data, "2026-08", gtres.id);
  assert.equal(c.quantity, "15690");
  assert.equal(c.goods, "4598");
  assert.equal(c.net, "1073218");
  assert.equal(c.tax, "107321");
  assert.equal(c.gross, "1180539");
  const bib = ledger(data, "2026-08").find((l) => l.unit === "BIB")!;
  assert.equal(bib.quantity, "10");
  assert.equal(bib.liters, "200");
  assert.equal(bib.price, "3500");
  assert.equal(bib.amount, "35000");
  assert.equal(billingCheck(data, "2026-08").loans.length, 17);
  assert.equal(
    billingCheck(data, "2026-08").issues.filter((i) => i.code === "date")
      .length,
    4,
  );
  assert.throws(
    () =>
      reviewBillingLine(data, bib.source_id, {
        payer: gtres.id,
        category: "normal",
        invoice_on: bib.day,
        note: "",
        quantity: "11",
        unit: "BIB",
        price: "3500",
        factor: "20",
      }),
    /請求済み/,
  );
});
test("only newly registered lines after a formal monthly confirmation qualify for additional billing", () => {
  let { data, p } = closedGtres();
  data = append(data, p.id);
  data = append(data, p.id, "25", "2026-08-30");
  const sales = data.sales!.slice(-2);
  for (const sale of sales) assert.ok(additionalEligible(data, sale.id));
  const original = structuredClone(data.billingInvoices);
  data = markAdditional(
    data,
    sales.map((s) => s.id),
    "土屋",
  );
  data = makeBillingInvoice(
    data,
    "2026-08",
    p.id,
    "additional",
    "佐藤",
    fields,
  );
  const draft = data.billingInvoices!.at(-1)!;
  assert.equal(draft.lines.length, 2);
  assert.equal(draft.net, "4000");
  const bad = structuredClone(data);
  bad.billingInvoices!.at(-1)!.lines.pop();
  assert.throws(
    () => confirmBillingInvoice(bad, draft.id, "土屋"),
    /未請求の売上/,
  );
  data = confirmBillingInvoice(data, draft.id, "土屋");
  assert.deepEqual(data.billingInvoices!.slice(0, -1), original);
  assert.equal(data.billingInvoices!.at(-1)!.gross, "4400");
  assert.throws(() => confirmBillingInvoice(data, draft.id, "土屋"), /未確定/);
  assert.deepEqual(parseBackup(backupText(data)), data);
});
test("existing data migration preserves IDs, source prices, totals, original invoices and old backups", () => {
  const data = august(),
    old = structuredClone(data);
  old.schema_version = 4;
  const schatz = old.billingParties!.find((p) => p.internal_name === "Schatz")!,
    sale = old.sales!.find(
      (s) =>
        s.billing_party_id === schatz.id && !issuedCoverage(old, s.id).length,
    )!;
  sale.billing_status = "additional";
  const migrated = migrateBillingAccounts(old);
  assert.equal(migrated.schema_version, 5);
  assert.equal(
    migrated.sales!.find((s) => s.id === sale.id)!.billing_status,
    "recalculate",
  );
  assert.deepEqual(migrated.customers, old.customers);
  assert.deepEqual(migrated.actuals, old.actuals);
  assert.deepEqual(migrated.prices, old.prices);
  assert.deepEqual(migrated.billingInvoices, old.billingInvoices);
  assert.deepEqual(migrateBillingAccounts(migrated), migrated);
  assert.equal(originalComparison(migrated, "2026-08").net, "2823058");
  for (const version of [2, 3, 4]) {
    const restored = parseBackup(
      JSON.stringify({ format: "fujisawa-adblue-local", version, data: old }),
    );
    assert.equal(restored.schema_version, 5);
    assert.equal(restored.sales!.length, 69);
  }
});
test("confirmed master mapping re-links unconfirmed historical rows without financial changes and freezes issued rows", () => {
  let { data, p } = openGtres();
  const customer = data.customers.find((c) => c.billing_party_id === p.id)!,
    site = data.sites!.find((s) => s.customer_id === customer.id)!;
  const sale = data.sales!.find((s) => s.customer_id === customer.id)!;
  const other = data.billingParties!.find(
    (p) => p.internal_name === "Schatz inc",
  )!;
  data = makeBillingInvoice(data, "2026-08", p.id, "regular", "土屋", fields);
  const result = relinkAccount(
    data,
    customer.id,
    site.id,
    other.id,
    "2026-08",
    "資料で請求先確認",
    true,
  );
  assert.ok(result.changed.includes(sale.id));
  assert.equal(result.data.billingInvoices!.at(-1)!.status, "cancelled");
  assert.equal(
    result.data.sales!.find((s) => s.id === sale.id)!.net_amount,
    sale.net_amount,
  );
  assert.equal(
    result.data.sales!.find((s) => s.id === sale.id)!.unit_price_excl_tax,
    sale.unit_price_excl_tax,
  );
  assert.equal(
    result.data.sales!.find((s) => s.id === sale.id)!.billing_party_id,
    other.id,
  );
  assert.ok(
    accountCandidates(result.data, customer.name, site.name).some(
      (p) => p.id === other.id,
    ),
  );
  assert.deepEqual(parseBackup(backupText(result.data)), result.data);
  const paid = closedGtres(),
    pc = paid.data.customers.find((c) => c.billing_party_id === paid.p.id)!,
    ps = paid.data.sites!.find((s) => s.customer_id === pc.id)!;
  const locked = relinkAccount(
    paid.data,
    pc.id,
    ps.id,
    paid.data.billingParties!.find((p) => p.internal_name === "Schatz inc")!.id,
    "2026-08",
    "変更確認",
    true,
  );
  assert.ok(locked.blocked.length);
  assert.deepEqual(locked.data.sales, paid.data.sales);
  assert.deepEqual(locked.data.billingInvoices, paid.data.billingInvoices);
});
test("recalculation preserves draft snapshots and release requires reason while keeping original PDF records", () => {
  let { data, p } = openGtres();
  data = makeBillingInvoice(data, "2026-08", p.id, "regular", "土屋", fields);
  const draft = data.billingInvoices!.at(-1)!;
  data = append(data, p.id);
  assert.throws(() => confirmBillingInvoice(data, draft.id, "土屋"), /未請求/);
  const next = recalculateDraft(data, draft.id, "佐藤");
  assert.equal(
    next.billingInvoices!.find((i) => i.id === draft.id)!.status,
    "cancelled",
  );
  assert.deepEqual(
    next.billingInvoices!.find((i) => i.id === draft.id)!.lines,
    draft.lines,
  );
  assert.equal(
    next.billingInvoices!.at(-1)!.lines.length,
    draft.lines.length + 1,
  );
  data = confirmBillingInvoice(next, next.billingInvoices!.at(-1)!.id, "土屋");
  const id = data.billingInvoices!.at(-1)!.id;
  assert.throws(() => releaseInvoice(data, id, "土屋", ""), /解除理由/);
  const released = releaseInvoice(data, id, "土屋", "発行前の宛名確認");
  assert.equal(released.billingInvoices!.at(-1)!.status, "cancelled");
  assert.ok(
    released.sales!.some(
      (s) => s.billing_party_id === p.id && s.billing_status === "unbilled",
    ),
  );
  assert.deepEqual(parseBackup(backupText(released)), released);
  assert.throws(
    () =>
      releaseInvoice(
        data,
        data.billingInvoices!.find((i) => i.kind === "reference")!.id,
        "土屋",
        "確認",
      ),
    /原本照合/,
  );
});
test("account terms are configurable with month-end clipping, leap years and customer billing periods", () => {
  const p = august().billingParties![0];
  assert.deepEqual(billingDates("2026-08", p), {
    issued_on: "2026-09-01",
    due_on: "2026-09-30",
  });
  assert.deepEqual(billingPeriod("2026-08", p), {
    start: "2026-08-01",
    end: "2026-08-31",
  });
  assert.equal(billingDates("2028-01", p).due_on, "2028-02-29");
  const custom = {
    ...p,
    terms: {
      closing_day: 20,
      invoice_day: 5,
      payment_month_offset: 2,
      payment_day: 15,
    },
  };
  assert.deepEqual(billingPeriod("2026-08", custom), {
    start: "2026-07-21",
    end: "2026-08-20",
  });
  assert.equal(billingDates("2026-08", custom).due_on, "2026-10-15");
});
test("tax and fixed price remain independent of later master edits", () => {
  const data = august(),
    rule = data.taxRules![0];
  assert.deepEqual(taxAmounts("1073218", rule), {
    tax: "107321",
    gross: "1180539",
  });
  assert.equal(taxAmounts("19", { ...rule, rounding: "nearest" }).tax, "2");
  assert.throws(() => taxAmounts("100", { ...rule, rate: "100.1" }), /税率/);
  const changed = {
    ...data,
    prices: data.prices.map((p) => ({ ...p, amount: 999 })),
    customers: data.customers.map((c) => ({ ...c, billing_party_id: null })),
  };
  assert.deepEqual(ledger(changed, "2026-08"), ledger(data, "2026-08"));
  assert.throws(
    () =>
      markBilling(
        data,
        [data.sales!.find((s) => issuedCoverage(data, s.id).length)!.id],
        "unbilled",
        "土屋",
        "検証",
      ),
    /発行済み/,
  );
});
test("existing CSV/XLSX August actuals can be attached to original invoices without deletion or reimport", () => {
  const prior = august();
  const existing: Data = {
    ...prior,
    billingInvoices: [],
    billingItems: [],
    sales: prior.sales!.map((s) => ({
      ...s,
      billing_party_id: null,
      billing_status: "unbilled",
      invoice_on: undefined,
    })),
  };
  const next = importVerifiedAugust(existing, "佐藤", true);
  assert.equal(next.sales!.length, 69);
  assert.deepEqual(next.actuals, existing.actuals);
  assert.deepEqual(next.orders, existing.orders);
  assert.deepEqual(next.prices, existing.prices);
  assert.deepEqual(
    next.sales!.map((s) => ({
      id: s.id,
      quantity: s.quantity_l,
      price: s.unit_price_excl_tax,
      net: s.net_amount,
    })),
    existing.sales!.map((s) => ({
      id: s.id,
      quantity: s.quantity_l,
      price: s.unit_price_excl_tax,
      net: s.net_amount,
    })),
  );
  assert.equal(originalComparison(next, "2026-08").net, "2823058");
  const bad = { ...existing, sales: existing.sales!.slice(1) };
  assert.throws(() => importVerifiedAugust(bad, "土屋", true), /完全一致候補/);
});
