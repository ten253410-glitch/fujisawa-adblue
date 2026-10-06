import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../lib/domain";
import {
  localData,
  parseBackup,
  backupText,
  markBilling,
} from "../lib/local-flow";
import { importVerifiedAugust, augustFixture } from "../lib/august-data";
import {
  billingCheck,
  cancelBillingDraft,
  taxAmounts,
  makeBillingInvoice,
  confirmBillingInvoice,
  markAdditional,
  ledger,
  reviewBillingLine,
  issuedCoverage,
  type TaxRule,
} from "../lib/billing";
function august() {
  return importVerifiedAugust(localData(emptyData()), "土屋");
}
test("real August: every payer reconciles quantities and monetary totals; Schatz is a known billing error", () => {
  const data = august();
  assert.equal(data.sales!.length, 69);
  assert.equal(data.billingItems!.length, 22);
  assert.equal(data.billingInvoices!.length, 11);
  const c = billingCheck(data, "2026-08");
  assert.equal(c.quantity, "40500");
  assert.equal(c.billedQty, "40500");
  assert.equal(c.net, "2884158");
  assert.equal(c.billedNet, "2823058");
  assert.equal(c.quantityDifference, 0);
  assert.equal(c.amountDifference, 61100);
  const schatz = data.billingParties!.find(
      (p) => p.internal_name === "Schatz",
    )!,
    gtres = data.billingParties!.find((p) => p.internal_name === "G.TRES")!;
  const sc = billingCheck(data, "2026-08", schatz.id);
  assert.equal(sc.net, "631390");
  assert.equal(sc.tax, "63139");
  assert.equal(sc.gross, "694529");
  assert.deepEqual(
    sc.issues
      .filter((i) => i.code === "omission")
      .map(
        (i) =>
          data.orders.find(
            (o) =>
              o.id === data.sales!.find((s) => s.id === i.source_id)!.order_id,
          )!.location,
      )
      .sort(),
    ["EG八王子", "デイライン西東京営業所"].sort(),
  );
  assert.equal(billingCheck(data, "2026-08", gtres.id).net, "1073218");
  assert.equal(billingCheck(data, "2026-08", gtres.id).goods, "4598");
  assert.equal(billingCheck(data, "2026-08", gtres.id).tax, "107321");
  for (const p of data.billingParties!) {
    const result = billingCheck(data, "2026-08", p.id),
      b = augustFixture.bills.find((b) => b.id === p.internal_name)!;
    assert.equal(result.billedNet, b.net);
    assert.equal(result.net, p.internal_name === "Schatz" ? "631390" : b.net);
  }
  assert.equal(c.issues.filter((i) => i.code === "date").length, 4);
  assert.equal(c.loans.length, 17);
  assert.deepEqual(parseBackup(backupText(data)), data);
  assert.throws(() => importVerifiedAugust(data, "佐藤"), /取込済み/);
});
test("additional invoice contains only omitted sales, immutable original, exact tax and no duplicate billing", () => {
  let data = august();
  const p = data.billingParties!.find((p) => p.internal_name === "Schatz")!,
    original = JSON.stringify(data.billingInvoices);
  const omissions = billingCheck(data, "2026-08", p.id)
    .issues.filter((i) => i.code === "omission")
    .map((i) => i.source_id!);
  data = markAdditional(data, omissions, "土屋");
  data = makeBillingInvoice(data, "2026-08", p.id, "additional", "土屋", {
    issued_on: "2026-10-07",
    due_on: "2026-10-31",
    subject: "2026年8月分 追加請求",
  });
  const draft = data.billingInvoices!.at(-1)!;
  assert.equal(draft.lines.length, 2);
  assert.equal(draft.net, "61100");
  assert.equal(draft.tax, "6110");
  assert.equal(draft.gross, "67210");
  data = confirmBillingInvoice(data, draft.id, "佐藤");
  assert.equal(data.billingInvoices!.at(-1)!.status, "issued");
  assert.equal(JSON.stringify(data.billingInvoices!.slice(0, -1)), original);
  assert.equal(billingCheck(data, "2026-08", p.id).amountDifference, 0);
  assert.equal(billingCheck(data, "2026-08", p.id).quantityDifference, 0);
  assert.equal(
    billingCheck(data, "2026-08", p.id).issues.filter(
      (i) => i.code === "omission",
    ).length,
    0,
  );
  assert.throws(() => confirmBillingInvoice(data, draft.id, "土屋"), /未確定/);
  assert.throws(
    () =>
      makeBillingInvoice(data, "2026-08", p.id, "additional", "土屋", {
        issued_on: "2026-10-07",
        due_on: "2026-10-31",
        subject: "追加",
      }),
    /未請求/,
  );
  assert.deepEqual(parseBackup(backupText(data)), data);
});
test("confirmation rejects omitted draft lines, changed amounts and unsettled review; BIB converts 10×20L", () => {
  let data = august();
  const p = data.billingParties!.find((p) => p.internal_name === "Schatz")!;
  data = makeBillingInvoice(data, "2026-08", p.id, "additional", "土屋", {
    issued_on: "2026-10-07",
    due_on: "2026-10-31",
    subject: "追加",
  });
  const bad = structuredClone(data),
    draft = bad.billingInvoices!.at(-1)!;
  draft.lines.pop();
  assert.throws(
    () => confirmBillingInvoice(bad, draft.id, "土屋"),
    /未請求の売上/,
  );
  const bib = ledger(data, "2026-08").find((l) => l.unit === "BIB")!;
  assert.equal(bib.quantity, "10");
  assert.equal(bib.price, "3500");
  assert.equal(bib.liters, "200");
  assert.equal(bib.amount, "35000");
  assert.throws(
    () =>
      reviewBillingLine(data, bib.source_id, {
        payer: data.sales!.find((s) => s.id === bib.source_id)!
          .billing_party_id!,
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
  const missing = data.sales!.find(
    (s) => s.id === data.billingInvoices!.at(-1)!.lines[0].source_id,
  )!;
  missing.billing_party_id = null;
  assert.throws(
    () => confirmBillingInvoice(data, data.billingInvoices!.at(-1)!.id, "土屋"),
    /請求先未設定/,
  );
});
test("tax uses exact invoice subtotal rather than line rounding and is configurable", () => {
  const rule: TaxRule = {
    month: "2026-08",
    rate: "10",
    rounding: "floor",
    basis: "invoice",
    confirmed_by: "土屋",
    confirmed_at: new Date().toISOString(),
  };
  assert.deepEqual(taxAmounts("1073218", rule), {
    tax: "107321",
    gross: "1180539",
  });
  assert.deepEqual(taxAmounts("19", rule), { tax: "1", gross: "20" });
  assert.equal(taxAmounts("19", { ...rule, rounding: "nearest" }).tax, "2");
  assert.equal(taxAmounts("10.01", { ...rule, rounding: "ceil" }).tax, "2");
  assert.equal(issuedCoverage(august(), "unknown").length, 0);
});
test("tax changes require cancelling drafts; past delivery prices and issued billing remain fixed after master changes", () => {
  let data = august();
  const p = data.billingParties!.find((p) => p.internal_name === "Schatz")!;
  data = makeBillingInvoice(data, "2026-08", p.id, "additional", "土屋", {
    issued_on: "2026-10-07",
    due_on: "2026-10-31",
    subject: "追加",
  });
  const draft = data.billingInvoices!.at(-1)!;
  const previous = structuredClone(data.sales);
  const changed = {
    ...data,
    taxRules: data.taxRules!.map((r) => ({ ...r, rounding: "ceil" as const })),
  };
  assert.throws(
    () => confirmBillingInvoice(changed, draft.id, "佐藤"),
    /税設定が変更/,
  );
  const cancelled = cancelBillingDraft(changed, draft.id);
  assert.equal(cancelled.billingInvoices!.at(-1)!.status, "cancelled");
  assert.equal(
    makeBillingInvoice(cancelled, "2026-08", p.id, "additional", "土屋", {
      issued_on: "2026-10-07",
      due_on: "2026-10-31",
      subject: "追加",
    }).billingInvoices!.at(-1)!.status,
    "draft",
  );
  data = {
    ...data,
    prices: data.prices.map((p) => ({ ...p, amount: 999 })),
    customers: data.customers.map((c) => ({ ...c, billing_party_id: null })),
  };
  assert.deepEqual(data.sales, previous);
  assert.equal(billingCheck(data, "2026-08", p.id).net, "631390");
  assert.throws(
    () =>
      markBilling(
        data,
        [data.sales!.find((s) => issuedCoverage(data, s.id).length)!.id],
        "unbilled",
        "土屋",
        "変更",
      ),
    /発行済み/,
  );
  for (const party of data.billingParties!) {
    const c = billingCheck(data, "2026-08", party.id),
      b = augustFixture.bills.find((b) => b.id === party.internal_name)!;
    assert.equal(
      c.quantity,
      String(
        b.lines.reduce(
          (n, l) =>
            n + Number(l.quantity) * (l.packing === "BIB(20L)" ? 20 : 1),
          0,
        ),
      ),
    );
    assert.equal(c.tax, party.internal_name === "Schatz" ? "63139" : b.tax);
    assert.equal(
      c.gross,
      party.internal_name === "Schatz" ? "694529" : b.gross,
    );
  }
});
test("ordinary unbilled sales are flagged and complete reviewed invoices can be confirmed", () => {
  let data = august();
  const party = data.billingParties!.find((p) => p.internal_name === "G.TRES")!;
  data = {
    ...data,
    billingInvoices: data.billingInvoices!.filter(
      (i) => i.billing_party_id !== party.id,
    ),
  };
  assert.ok(
    billingCheck(data, "2026-08", party.id).issues.some(
      (i) => i.code === "unbilled" && i.blocking,
    ),
  );
  data = makeBillingInvoice(data, "2026-08", party.id, "regular", "土屋", {
    issued_on: "2026-09-01",
    due_on: "2026-09-30",
    subject: "8月",
  });
  const id = data.billingInvoices!.at(-1)!.id;
  data = confirmBillingInvoice(data, id, "佐藤");
  assert.equal(data.billingInvoices!.at(-1)!.gross, "1180539");
  assert.equal(billingCheck(data, "2026-08", party.id).amountDifference, 0);
});
