import { test } from "node:test";
import assert from "node:assert/strict";
import { augustWithSeptember } from "./billing-test-fixture";
import {
  assignUnpaidToMonth,
  cancelMonthAssignment,
  unassignedLines,
  monthlyInvoiceLines,
  normalIssued,
  createMonthlyInvoices,
  confirmSelectedInvoice,
  pendingInfo,
  sourceBillingMonth,
  createSelectedInvoices,
} from "../lib/billing-plan";
import { localData, backupText, parseBackup } from "../lib/local-flow";
import { registerHistory } from "../lib/history-import";
import { cancelBillingDraft, issuedCoverage } from "../lib/billing";
import { releaseInvoice, originalComparison } from "../lib/billing-accounts";
function fixture() {
  const { data } = augustWithSeptember(),
    payer = data.billingParties!.find((p) => p.internal_name === "Schatz")!.id,
    old = unassignedLines(data, payer);
  return { data, payer, old, ids: old.map((l) => l.source_id) };
}
test("Schatz omissions are absent from issued August normal candidates; assigning to September freezes original month/date/price and reserves once", () => {
  let { data, payer, old, ids } = fixture();
  const originals = structuredClone(data.billingInvoices),
    financial = data.sales!.map(({ pending_billing, ...s }) => s);
  assert.equal(normalIssued(data, "2026-08", payer).length, 1);
  assert.equal(monthlyInvoiceLines(data, "2026-08", payer).length, 0);
  assert.equal(monthlyInvoiceLines(data, "2026-09", payer).length, 0);
  assert.equal(
    old.reduce((n, l) => n + Number(l.liters), 0),
    940,
  );
  assert.equal(
    old.reduce((n, l) => n + Number(l.amount), 0),
    61100,
  );
  assert.throws(
    () => createMonthlyInvoices(data, "2026-08", payer, ids, "unified", "土屋"),
    /②/,
  );
  assert.throws(() => assignUnpaidToMonth(data, ids, "2026-08", "土屋"), /後/);
  data = assignUnpaidToMonth(
    data,
    ids,
    "2026-09",
    "土屋",
    "8月請求漏れ",
    new Date("2026-09-03T16:00:00Z"),
  );
  assert.deepEqual(data.billingInvoices, originals);
  assert.deepEqual(
    data.sales!.map(({ pending_billing, ...s }) => s),
    financial,
  );
  assert.equal(unassignedLines(data, payer).length, 0);
  assert.equal(monthlyInvoiceLines(data, "2026-08", payer).length, 0);
  assert.equal(monthlyInvoiceLines(data, "2026-09", payer).length, 2);
  assert.equal(monthlyInvoiceLines(data, "2026-10", payer).length, 0);
  for (const l of old) {
    const info = pendingInfo(data, l);
    assert.equal(info.assigned_month, "2026-09");
    assert.equal(info.original_month, "2026-08");
    assert.equal(info.discovered_on, "2026-09-04");
    assert.equal(info.assigned_by, "土屋");
    assert.equal(info.reason, "8月請求漏れ");
    assert.equal(info.invoice_id, null);
    assert.equal(sourceBillingMonth(data, l), "2026-08");
  }
  assert.throws(
    () => assignUnpaidToMonth(data, ids, "2026-10", "佐藤"),
    /再追加/,
  );
  assert.throws(
    () =>
      createSelectedInvoices(data, "2026-10", payer, ids, "unified", "佐藤"),
    /別の請求月/,
  );
  assert.deepEqual(parseBackup(backupText(data)), data);
});
test("assigned August lines join September normal deliveries in one invoice; draft and issued duplicates are blocked and originals survive backup", () => {
  let { data, payer, old, ids } = fixture();
  const customer = data.customers.find((c) => c.id === old[0].customer_id)!,
    site = data.sites!.find((s) => s.customer_id === customer.id)!;
  data = registerHistory(
    data,
    [
      {
        row: 1,
        day: "2026-09-15",
        customer: customer.name,
        site: site.name,
        address: "",
        quantity: "100",
        price: "65",
        amount: "",
        operator: "土屋",
        slip: "SEP-NORMAL",
        notes: "9月通常",
        customerId: customer.id,
        siteId: site.id,
        newCustomer: false,
        newSite: false,
        include: true,
        useSourceAmount: false,
        duplicateApproved: false,
        approved: true,
      },
    ],
    "9月通常.csv",
    "CSV",
    "土屋",
  );
  data = assignUnpaidToMonth(data, ids, "2026-09", "土屋");
  const rows = monthlyInvoiceLines(data, "2026-09", payer);
  assert.equal(rows.length, 3);
  data = createMonthlyInvoices(
    data,
    "2026-09",
    payer,
    rows.map((l) => l.source_id),
    "unified",
    "土屋",
  );
  const invoice = data.billingInvoices!.at(-1)!;
  assert.equal(invoice.net, "67600");
  assert.equal(invoice.quantity, "1040");
  assert.equal(
    invoice.lines.filter((l) => l.actual_day === "2026-08-04").length,
    2,
  );
  assert.ok(
    invoice.lines
      .filter((l) => l.actual_day === "2026-08-04")
      .every((l) => l.notes.includes("2026年8月未請求分")),
  );
  assert.throws(
    () => cancelMonthAssignment(data, ids[0], "土屋", "変更"),
    /下書き/,
  );
  assert.throws(
    () => assignUnpaidToMonth(data, ids, "2026-10", "土屋"),
    /再追加/,
  );
  data = confirmSelectedInvoice(data, invoice.id, "佐藤");
  for (const id of ids) {
    assert.equal(issuedCoverage(data, id).length, 1);
    assert.equal(
      pendingInfo(
        data,
        old.find((l) => l.source_id === id)!,
      ).invoice_id,
      invoice.id,
    );
  }
  assert.throws(
    () => cancelMonthAssignment(data, ids[0], "土屋", "変更"),
    /未確定/,
  );
  assert.equal(originalComparison(data, "2026-08", payer).net, "570290");
  assert.equal(originalComparison(data, "2026-08").net, "2823058");
  assert.deepEqual(parseBackup(backupText(data)), data);
  const released = releaseInvoice(data, invoice.id, "佐藤", "管理画面から解除");
  assert.equal(
    monthlyInvoiceLines(released, "2026-09", payer).filter((l) =>
      ids.includes(l.source_id),
    ).length,
    2,
  );
  assert.throws(
    () => assignUnpaidToMonth(released, ids, "2026-10", "土屋"),
    /再追加/,
  );
});
test("cancel assignment before issue retains history and restores unassigned; optional legacy backups are readable and tax configuration is not needed for assignment", () => {
  let { data, payer, old, ids } = fixture();
  data.taxRules = data.taxRules!.filter((r) => r.month === "2026-08");
  data = assignUnpaidToMonth(data, ids, "2026-10", "土屋");
  assert.throws(
    () => createMonthlyInvoices(data, "2026-10", payer, ids, "unified", "土屋"),
    /税/,
  );
  data = cancelMonthAssignment(data, ids[0], "佐藤", "9月へ変更");
  assert.equal(unassignedLines(data, payer).length, 1);
  assert.equal(pendingInfo(data, old[0]).assignment_history!.length, 2);
  data = assignUnpaidToMonth(data, [ids[0]], "2026-09", "佐藤");
  assert.equal(pendingInfo(data, old[0]).original_month, "2026-08");
  assert.deepEqual(parseBackup(backupText(data)), data);
  const invalid = structuredClone(data);
  invalid.sales!.find((s) => s.id === ids[0])!.pending_billing!.assigned_month =
    "2026-08";
  assert.throws(() => localData(invalid), /追加情報/);
});
test("cancel a draft then cancel assignment, with original fixed values and original invoices retained", () => {
  let { data, payer, old, ids } = fixture();
  data = assignUnpaidToMonth(data, ids, "2026-09", "土屋");
  data = createMonthlyInvoices(data, "2026-09", payer, ids, "unified", "土屋");
  const draft = data.billingInvoices!.at(-1)!;
  data = cancelBillingDraft(data, draft.id);
  data = cancelMonthAssignment(data, ids[0], "土屋", "誤操作");
  assert.equal(unassignedLines(data, payer).length, 1);
  assert.equal(data.billingInvoices!.at(-1)!.status, "cancelled");
  assert.equal(sourceBillingMonth(data, old[0]), "2026-08");
  assert.equal(originalComparison(data, "2026-08", payer).net, "570290");
});
