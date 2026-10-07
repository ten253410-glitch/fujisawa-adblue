import type { Data } from "./domain";
import {
  issuedCoverage,
  ledger,
  lineParty,
  taxAmounts,
  type BillingParty,
} from "./billing";
import { sumDecimal } from "./local-flow";
export const defaultTerms = {
  closing_day: 31,
  invoice_day: 1,
  payment_month_offset: 1,
  payment_day: 31,
};
const normalized = (v: string) =>
  v
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .toLowerCase();
export function accountTerms(p: BillingParty) {
  return { ...defaultTerms, ...p.terms };
}
function day(y: number, m: number, d: number) {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
export function billingDates(month: string, p: BillingParty) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("対象月を確認してください");
  const [y, m] = month.split("-").map(Number),
    t = accountTerms(p);
  return {
    issued_on: day(y, m, t.invoice_day),
    due_on: day(y, m - 1 + t.payment_month_offset, t.payment_day),
  };
}
export function additionalEligible(data: Data, id: string, payer?: string) {
  if (issuedCoverage(data, id).length) return false;
  const sale = data.sales?.find((s) => s.id === id),
    item = data.billingItems?.find((i) => i.id === id),
    pid = payer || sale?.billing_party_id || item?.billing_party_id;
  const actual = sale && data.actuals?.find((a) => a.id === sale.actual_id),
    created = actual?.confirmed_at || item?.created_at;
  const month = (sale?.delivered_on || item?.day || "").slice(0, 7);
  const invoices = (data.billingInvoices || []).filter(
    (i) =>
      i.status === "issued" &&
      i.kind !== "reference" &&
      i.month === month &&
      i.billing_party_id === pid,
  );
  if (!invoices.length || !created) return false;
  if (invoices.some((i) => i.lines.some((l) => l.source_id === id)))
    return false;
  const last = invoices
    .map((i) => i.confirmed_at || "")
    .sort()
    .at(-1)!;
  return !!last && created > last;
}
export function accountCandidates(data: Data, customer: string, site: string) {
  const matched = data.customers.filter(
      (c) => normalized(c.name) === normalized(customer),
    ),
    locs = (data.sites || []).filter(
      (s) =>
        normalized(s.name) === normalized(site) &&
        matched.some((c) => c.id === s.customer_id),
    );
  const ids = new Set([
    ...matched.map((c) => c.billing_party_id),
    ...locs.map((s) => s.billing_party_id),
  ]);
  for (const a of data.billingAliases || [])
    if (
      normalized(a.customer_name) === normalized(customer) &&
      (!a.site_name || normalized(a.site_name) === normalized(site))
    )
      ids.add(a.billing_party_id);
  return (data.billingParties || []).filter((p) => ids.has(p.id) && p.active);
}
export function migrateBillingAccounts(data: Data): Data {
  if ((data.schema_version || 0) >= 5) return data;
  const now = new Date().toISOString(),
    changes: unknown[] = [];
  const next: Data = {
    ...data,
    schema_version: 5,
    billingAliases: data.billingAliases || [],
    billingParties: (data.billingParties || []).map((p) => ({
      ...p,
      contact: p.contact || "",
      conditions: p.conditions || "",
      terms: accountTerms(p),
    })),
  };
  next.billingItems = (data.billingItems || []).map((item) => {
    if (item.customer_id || item.kind !== "loan") return item;
    const ids = [
      ...new Set(
        (data.billingInvoices || [])
          .filter((i) => i.billing_party_id === item.billing_party_id)
          .flatMap((i) => i.lines)
          .filter(
            (l) =>
              l.source_kind === "sale" &&
              normalized(l.destination) === normalized(item.destination),
          )
          .map((l) => l.customer_id)
          .filter((id): id is string => !!id),
      ),
    ];
    return ids.length === 1 ? { ...item, customer_id: ids[0] } : item;
  });
  next.sales = (data.sales || []).map((s) => {
    if (s.billing_status !== "additional" || additionalEligible(data, s.id))
      return s;
    changes.push({ id: s.id, before: s.billing_status, after: "recalculate" });
    return {
      ...s,
      billing_status: "recalculate",
      billing_note:
        "旧版の追加請求区分を再確認。数量・単価・売上・発行済み請求書は維持",
    };
  });
  next.billingInvoices = (data.billingInvoices || []).map((i) => {
    if (
      i.status !== "draft" ||
      i.kind !== "additional" ||
      i.lines.every((l) =>
        additionalEligible(data, l.source_id, i.billing_party_id),
      )
    )
      return i;
    changes.push({ id: i.id, before: "draft", after: "cancelled" });
    return {
      ...i,
      status: "cancelled" as const,
      cancel_note: "旧版の追加請求判定を見直し。未確定版を保管し再計算が必要",
    };
  });
  next.audit = [
    {
      id: crypto.randomUUID(),
      actor_name: "ローカルデータ移行",
      entity: "billing_accounts",
      entity_id: "schema-5",
      action: "MIGRATE",
      created_at: now,
      detail: JSON.stringify({
        from: data.schema_version || 1,
        to: 5,
        changes,
        financial_values_unchanged: true,
      }),
    },
    ...data.audit,
  ];
  return next;
}
export function relinkAccount(
  data: Data,
  customerId: string,
  siteId: string,
  payer: string,
  month: string,
  reason: string,
  applyPast: boolean,
) {
  const customer = data.customers.find((c) => c.id === customerId),
    site =
      siteId &&
      data.sites?.find((s) => s.id === siteId && s.customer_id === customerId);
  if (
    !customer ||
    (siteId && !site) ||
    !(data.billingParties || []).some((p) => p.id === payer && p.active) ||
    !reason.trim()
  )
    throw new Error("給液先・場所・請求先・変更理由を確認してください");
  const ids = (data.sales || [])
    .filter(
      (s) =>
        s.customer_id === customerId &&
        s.delivered_on.startsWith(month) &&
        (!siteId ||
          data.orders.find((o) => o.id === s.order_id)?.site_id === siteId),
    )
    .map((s) => s.id);
  const blocked: string[] = [],
    changed: string[] = [];
  let next: Data = {
    ...data,
    customers: data.customers.map((c) =>
      c.id === customerId && !siteId ? { ...c, billing_party_id: payer } : c,
    ),
    sites: data.sites?.map((s) =>
      s.id === siteId ? { ...s, billing_party_id: payer } : s,
    ),
  };
  next.sales = (data.sales || []).map((s) => {
    if (!applyPast || !ids.includes(s.id) || s.billing_party_id === payer)
      return s;
    if (issuedCoverage(data, s.id).length) {
      blocked.push(s.id);
      return s;
    }
    changed.push(s.id);
    return {
      ...s,
      billing_party_id: payer,
      billing_status: "unbilled",
      billing_note: "請求先変更・再集約確認：" + reason,
      billing_review_note: reason,
    };
  });
  // Cancelling unconfirmed versions retains all original snapshots; regeneration includes every current line.
  next.billingInvoices = (data.billingInvoices || []).map((i) =>
    i.status === "draft" && i.lines.some((l) => changed.includes(l.source_id))
      ? {
          ...i,
          status: "cancelled" as const,
          cancel_note: "請求先変更により再計算：" + reason,
        }
      : i,
  );
  const alias = {
    id: crypto.randomUUID(),
    customer_name: customer.name,
    site_name: site ? site.name : "",
    customer_id: customerId,
    site_id: siteId || null,
    billing_party_id: payer,
  };
  next.billingAliases = [
    ...(data.billingAliases || []).filter(
      (a) => !(a.customer_id === customerId && a.site_id === alias.site_id),
    ),
    alias,
  ];
  return {
    data: next,
    changed,
    blocked,
    before: ids.map((id) => data.sales!.find((s) => s.id === id)),
    after: changed.map((id) => next.sales!.find((s) => s.id === id)),
  };
}
export function recalculateDraft(data: Data, id: string, actor: string): Data {
  if (data.billingInvoices?.find((i) => i.id === id)?.selection_mode)
    throw new Error(
      "選択式の下書きは取り消して明細を選択し直してください。自動追加はしません",
    );
  const invoice = data.billingInvoices?.find((i) => i.id === id);
  if (!invoice || invoice.status !== "draft")
    throw new Error("未確定請求書だけを再計算できます");
  const lines = ledger(data, invoice.month).filter(
    (l) =>
      lineParty(data, l) === invoice.billing_party_id &&
      !issuedCoverage(data, l.source_id).length &&
      (invoice.kind !== "additional" ||
        additionalEligible(data, l.source_id, invoice.billing_party_id)),
  );
  const rule = data.taxRules?.find((r) => r.month === invoice.month);
  if (!lines.length || !rule)
    throw new Error("対象明細・税設定を確認してください");
  const net = sumDecimal(lines.map((l) => l.amount || "0")),
    amounts = taxAmounts(net, rule),
    now = new Date().toISOString(),
    party = data.billingParties!.find(
      (p) => p.id === invoice.billing_party_id,
    )!;
  const revision = {
    ...invoice,
    id: crypto.randomUUID(),
    lines,
    net,
    ...amounts,
    quantity: sumDecimal(lines.map((l) => l.liters)),
    tax_rule: { ...rule },
    party_name: party.formal_name,
    party_address: party.address,
    created_at: now,
    created_by: actor,
  };
  return {
    ...data,
    billingInvoices: data
      .billingInvoices!.map((i) =>
        i.id === id
          ? {
              ...i,
              status: "cancelled" as const,
              cancel_note: "再計算前の版を保存",
            }
          : i,
      )
      .concat(revision),
  };
}
export function releaseInvoice(
  data: Data,
  id: string,
  actor: string,
  reason: string,
): Data {
  const invoice = data.billingInvoices?.find((i) => i.id === id);
  if (
    !invoice ||
    invoice.status !== "issued" ||
    invoice.kind === "reference" ||
    !reason.trim()
  )
    throw new Error(
      "アプリで確定した請求書と解除理由を確認してください。原本照合記録は解除できません",
    );
  const next: Data = {
    ...data,
    billingInvoices: data.billingInvoices!.map((i) =>
      i.id === id
        ? {
            ...i,
            status: "cancelled" as const,
            released_by: actor,
            released_at: new Date().toISOString(),
            cancel_note: reason,
          }
        : i,
    ),
  };
  const ids = new Set(invoice.lines.map((l) => l.source_id));
  next.sales = data.sales?.map((s) =>
    ids.has(s.id) && !issuedCoverage(next, s.id).length
      ? {
          ...s,
          billing_status: "unbilled",
          billed_at: null,
          billed_by: null,
          billing_note: "請求確定解除：" + reason,
          ...(s.pending_billing
            ? { pending_billing: { ...s.pending_billing, invoice_id: null } }
            : {}),
        }
      : s,
  );
  next.billingItems = data.billingItems?.map((i) =>
    ids.has(i.id) && !issuedCoverage(next, i.id).length
      ? {
          ...i,
          status: "unbilled",
          ...(i.pending_billing
            ? { pending_billing: { ...i.pending_billing, invoice_id: null } }
            : {}),
        }
      : i,
  );
  return next;
}
export function originalComparison(data: Data, month: string, payer?: string) {
  const original = (data.billingInvoices || []).filter(
    (i) =>
      i.kind === "reference" &&
      i.status === "issued" &&
      i.month === month &&
      (!payer || i.billing_party_id === payer),
  );
  return {
    quantity: sumDecimal(original.map((i) => i.quantity)),
    net: sumDecimal(original.map((i) => i.net)),
    tax: sumDecimal(original.map((i) => i.tax)),
    gross: sumDecimal(original.map((i) => i.gross)),
    count: original.length,
  };
}
export function billingPeriod(month: string, p: BillingParty) {
  const [y, m] = month.split("-").map(Number),
    t = accountTerms(p),
    end = day(y, m - 1, t.closing_day),
    prior = day(y, m - 2, t.closing_day),
    start = new Date(Date.parse(prior) + 86400000).toISOString().slice(0, 10);
  return { start, end };
}
export function isInBillingMonth(
  data: Data,
  date: string,
  payer: string | null | undefined,
  month: string,
) {
  const p = data.billingParties?.find((p) => p.id === payer);
  if (!p) return date.startsWith(month);
  const { start, end } = billingPeriod(month, p);
  return date >= start && date <= end;
}
