import type { Data } from "./domain";
import {
  ledger,
  lineParty,
  issuedCoverage,
  monthRule,
  taxAmounts,
  defaultIssuer,
  type BillingLine,
  type BillingInvoice,
} from "./billing";
import { billingPeriod, billingDates } from "./billing-accounts";
import { multiplyNet, sumDecimal } from "./local-flow";
import { validDate } from "./order-import";
export type PendingBilling = {
  reason: string;
  discovered_on: string | null;
  planned_month: string | null;
  invoice_id: string | null;
};
export function pendingInfo(data: Data, line: BillingLine) {
  const sale = data.sales?.find((s) => s.id === line.source_id),
    item = data.billingItems?.find((s) => s.id === line.source_id);
  const actual = data.actuals?.find((a) => a.id === sale?.actual_id);
  const omitted = data.billingInvoices?.some(
    (i) =>
      i.kind === "reference" &&
      i.lines.some((l) => l.source_id === line.source_id && l.amount === null),
  );
  return {
    registered_at: actual?.confirmed_at || item?.created_at || "",
    reason: omitted ? "8月発行済み原本の金額欄に未算入" : "未請求",
    discovered_on: null,
    planned_month: null,
    invoice_id: issuedCoverage(data, line.source_id)[0]?.invoice.id || null,
    ...(sale?.pending_billing || item?.pending_billing),
  };
}
export function unpaidLines(data: Data, payer?: string) {
  return ledger(data).filter(
    (l) =>
      (!payer || lineParty(data, l) === payer) &&
      !issuedCoverage(data, l.source_id).length &&
      (l.kind === "loan" || Number(l.amount) > 0) &&
      !(
        data.sales?.find((s) => s.id === l.source_id)?.billing_status ===
        "billed"
      ) &&
      !(
        data.billingItems?.find((s) => s.id === l.source_id)?.status ===
        "billed"
      ),
  );
}
export function deliveryKey(data: Data, l: BillingLine) {
  return l.customer_id || "unmatched|" + l.destination;
}
export function pastLabel(l: BillingLine) {
  const [y, m] = l.actual_day.slice(0, 7).split("-");
  return `${y}年${Number(m)}月未請求分`;
}
function setPending(
  data: Data,
  ids: Set<string>,
  fn: (info: PendingBilling) => PendingBilling,
): Data {
  const info = (id: string) =>
    pendingInfo(
      data,
      ledger(data).find((l) => l.source_id === id)!,
    );
  return {
    ...data,
    sales: data.sales?.map((s) =>
      ids.has(s.id) ? { ...s, pending_billing: fn(info(s.id)) } : s,
    ),
    billingItems: data.billingItems?.map((s) =>
      ids.has(s.id) ? { ...s, pending_billing: fn(info(s.id)) } : s,
    ),
  };
}
export function updatePending(
  data: Data,
  id: string,
  fields: PendingBilling,
): Data {
  if (!unpaidLines(data).some((l) => l.source_id === id))
    throw Error("未請求明細を選択してください");
  if (
    !fields.reason.trim() ||
    (fields.discovered_on && !validDate(fields.discovered_on)) ||
    (fields.planned_month &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(fields.planned_month)) ||
    fields.invoice_id
  )
    throw Error("未請求理由・発見日・請求予定月を確認してください");
  return setPending(data, new Set([id]), () => fields);
}
function eligible(
  data: Data,
  month: string,
  payer: string,
  ids: string[],
  ignoreDraft?: string,
) {
  const party = data.billingParties?.find((p) => p.id === payer && p.active);
  if (!party || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw Error("請求先・請求対象月を確認してください");
  const period = billingPeriod(month, party),
    all = unpaidLines(data, payer);
  if (!ids.length || new Set(ids).size !== ids.length)
    throw Error("今回請求する明細を選択してください");
  return ids.map((id) => {
    const l = all.find((l) => l.source_id === id);
    if (!l) throw Error("請求済み・対象外の明細が含まれています");
    if (l.actual_day > period.end)
      throw Error("未来の給液実績は追加できません");
    if (
      data.billingInvoices?.some(
        (i) =>
          i.status === "draft" &&
          i.id !== ignoreDraft &&
          i.lines.some((x) => x.source_id === id),
      )
    )
      throw Error("別の未確定請求書で選択済みです");
    if (
      data.billingInvoices?.some(
        (i) =>
          i.kind === "reference" &&
          i.status === "issued" &&
          i.month >= month &&
          i.lines.some((x) => x.source_id === id && x.amount === null),
      )
    )
      throw Error("発行済み原本は変更せず、後続月を選択してください");
    const sale = data.sales?.find((s) => s.id === id),
      item = data.billingItems?.find((s) => s.id === id),
      review = sale?.billing_review_note || item?.review_note;
    if (
      l.kind !== "loan" &&
      (Number(l.price) <= 0 || multiplyNet(l.quantity, l.price) !== l.amount)
    )
      throw Error("数量・固定単価・金額を確認してください");
    if (l.actual_day !== l.day && !review)
      throw Error("実給液日と請求記載日の差異を確認してください");
    if (
      all.some(
        (x) =>
          x.source_id !== id &&
          x.actual_day === l.actual_day &&
          x.customer_id === l.customer_id &&
          x.destination === l.destination &&
          x.quantity === l.quantity &&
          x.price === l.price &&
          x.kind === l.kind &&
          x.product === l.product &&
          x.unit === l.unit,
      ) &&
      !review
    )
      throw Error("重複候補を確認してください");
    return {
      ...l,
      notes: [l.notes, l.actual_day < period.start ? pastLabel(l) : ""]
        .filter(Boolean)
        .join(" / "),
    };
  });
}
export function createSelectedInvoices(
  data: Data,
  month: string,
  payer: string,
  ids: string[],
  mode: "unified" | "destination",
  actor: string,
): Data {
  const rule = monthRule(data, month);
  if (!rule) throw Error("対象月の税・端数設定を確認してください");
  const lines = eligible(data, month, payer, ids),
    p = data.billingParties!.find((p) => p.id === payer)!,
    dates = billingDates(month, p),
    issuer = data.invoiceIssuer || defaultIssuer;
  const groups = new Map<string, BillingLine[]>();
  for (const l of lines) {
    const key = mode === "unified" ? "" : deliveryKey(data, l);
    groups.set(key, [...(groups.get(key) || []), l]);
  }
  const invoices: BillingInvoice[] = [...groups].map(([scope, lines]) => {
    const net = sumDecimal(lines.map((l) => l.amount || "0"));
    return {
      id: crypto.randomUUID(),
      billing_party_id: payer,
      month,
      kind: "regular",
      status: "draft",
      selection_mode: mode,
      delivery_scope: scope,
      party_name: p.formal_name,
      party_address: p.address,
      internal_name: p.internal_name,
      subject: month + "分" + (scope ? " / " + lines[0].destination : ""),
      ...dates,
      bank: issuer.bank,
      registration: issuer.registration,
      lines,
      net,
      ...taxAmounts(net, rule),
      quantity: sumDecimal(lines.map((l) => l.liters)),
      tax_rule: { ...rule },
      created_by: actor,
      created_at: new Date().toISOString(),
    };
  });
  return {
    ...setPending(data, new Set(ids), (i) => ({
      ...i,
      planned_month: month,
      invoice_id: null,
    })),
    billingInvoices: [...(data.billingInvoices || []), ...invoices],
  };
}
export function confirmSelectedInvoice(
  data: Data,
  id: string,
  actor: string,
): Data {
  const i = data.billingInvoices?.find((i) => i.id === id);
  if (!i || i.status !== "draft" || !i.selection_mode)
    throw Error("確認対象の請求書がありません");
  const lines = eligible(
      data,
      i.month,
      i.billing_party_id,
      i.lines.map((l) => l.source_id),
      id,
    ),
    rule = monthRule(data, i.month);
  if (
    !rule ||
    rule.rate !== i.tax_rule.rate ||
    rule.rounding !== i.tax_rule.rounding ||
    rule.basis !== i.tax_rule.basis ||
    JSON.stringify(lines) !== JSON.stringify(i.lines)
  )
    throw Error(
      "作成後に明細・税設定が変更されています。取り消して選択し直してください",
    );
  if (
    i.selection_mode === "destination" &&
    lines.some((l) => deliveryKey(data, l) !== i.delivery_scope)
  )
    throw Error("給液先の範囲が変更されています");
  const net = sumDecimal(lines.map((l) => l.amount || "0")),
    t = taxAmounts(net, rule);
  if (
    net !== i.net ||
    t.tax !== i.tax ||
    t.gross !== i.gross ||
    sumDecimal(lines.map((l) => l.liters)) !== i.quantity
  )
    throw Error("請求金額の整合性を確認してください");
  const ids = new Set(lines.map((l) => l.source_id)),
    now = new Date().toISOString(),
    next = setPending(data, ids, (x) => ({
      ...x,
      planned_month: i.month,
      invoice_id: id,
    }));
  return {
    ...next,
    billingInvoices: next.billingInvoices?.map((x) =>
      x.id === id
        ? { ...x, status: "issued", confirmed_by: actor, confirmed_at: now }
        : x,
    ),
    sales: next.sales?.map((s) =>
      ids.has(s.id)
        ? {
            ...s,
            billing_status: "billed",
            billed_at: now,
            billed_by: actor,
            billing_note: i.subject,
          }
        : s,
    ),
    billingItems: next.billingItems?.map((s) =>
      ids.has(s.id) ? { ...s, status: "billed" } : s,
    ),
  };
}
export function consolidateDestinations(
  data: Data,
  payer: string,
  customerIds: string[],
  reason: string,
): Data {
  if (
    !reason.trim() ||
    !customerIds.length ||
    !data.billingParties?.some((p) => p.id === payer && p.active) ||
    customerIds.some((id) => !data.customers.some((c) => c.id === id))
  )
    throw Error("請求先・給液先・変更理由を確認してください");
  const ids = new Set(
    unpaidLines(data)
      .filter((l) => l.customer_id && customerIds.includes(l.customer_id))
      .map((l) => l.source_id),
  );
  return {
    ...data,
    customers: data.customers.map((c) =>
      customerIds.includes(c.id) ? { ...c, billing_party_id: payer } : c,
    ),
    sites: data.sites?.map((s) =>
      customerIds.includes(s.customer_id)
        ? { ...s, billing_party_id: payer }
        : s,
    ),
    billingAliases: data.billingAliases?.map((a) =>
      customerIds.includes(a.customer_id)
        ? { ...a, billing_party_id: payer }
        : a,
    ),
    sales: data.sales?.map((s) =>
      ids.has(s.id)
        ? { ...s, billing_party_id: payer, billing_review_note: reason }
        : s,
    ),
    billingItems: data.billingItems?.map((s) =>
      ids.has(s.id)
        ? { ...s, billing_party_id: payer, review_note: reason }
        : s,
    ),
    billingInvoices: data.billingInvoices?.map((i) =>
      i.status === "draft" && i.lines.some((l) => ids.has(l.source_id))
        ? { ...i, status: "cancelled", cancel_note: "請求先統合：" + reason }
        : i,
    ),
  };
}

/** Original invoice month takes precedence; otherwise use the payer's closing period. */
export function sourceBillingMonth(data: Data, line: BillingLine) {
  const original = data.billingInvoices?.find(
    (i) =>
      i.kind === "reference" &&
      i.lines.some((l) => l.source_id === line.source_id),
  );
  if (original) return original.month;
  const month = line.actual_day.slice(0, 7),
    party = data.billingParties?.find((p) => p.id === lineParty(data, line));
  if (!party || line.actual_day <= billingPeriod(month, party).end)
    return month;
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
