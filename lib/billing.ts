import { confirmSelectedInvoice, pendingInfo } from "./billing-plan";
import type { Data } from "./domain";
import { multiplyNet, sumDecimal } from "./local-flow";
import { additionalEligible, isInBillingMonth } from "./billing-accounts";
import { validDate } from "./order-import";
export type BillingParty = {
  id: string;
  internal_name: string;
  formal_name: string;
  address: string;
  active: boolean;
  contact?: string;
  conditions?: string;
  terms?: {
    closing_day: number;
    invoice_day: number;
    payment_month_offset: number;
    payment_day: number;
  };
};
export type BillingAccount = BillingParty;
export type TransactionCategory =
  "normal" | "internal" | "purchase" | "excluded";
export type BillingItem = {
  pending_billing?: import("./billing-plan").PendingBilling;
  id: string;
  billing_party_id: string | null;
  customer_id: string | null;
  day: string;
  invoice_on?: string;
  kind: "goods" | "loan" | "adblue";
  product: string;
  destination: string;
  quantity: string;
  unit: string;
  price: string;
  liters: string;
  liters_per_unit?: string;
  amount: string;
  category: TransactionCategory;
  status: "unbilled" | "billed" | "additional";
  notes: string;
  created_by: string;
  created_at: string;
  review_note?: string;
};
export type TaxRule = {
  month: string;
  rate: string;
  rounding: "floor" | "nearest" | "ceil";
  basis: "invoice";
  confirmed_by: string;
  confirmed_at: string;
};
export type BillingLine = {
  source_id: string;
  source_kind: "sale" | "item";
  actual_day: string;
  day: string;
  customer_id: string | null;
  destination: string;
  product: string;
  kind: "adblue" | "goods" | "loan";
  quantity: string;
  unit: string;
  price: string;
  liters: string;
  amount: string | null;
  notes: string;
};
export type BillingInvoice = {
  selection_mode?: "unified" | "destination";
  delivery_scope?: string;
  id: string;
  billing_party_id: string;
  month: string;
  kind: "regular" | "additional" | "reference";
  status: "draft" | "issued" | "cancelled";
  party_name: string;
  party_address: string;
  internal_name: string;
  subject: string;
  issued_on: string;
  due_on: string;
  bank: string;
  registration: string;
  lines: BillingLine[];
  net: string;
  tax: string;
  gross: string;
  quantity: string;
  tax_rule: TaxRule;
  created_by: string;
  created_at: string;
  confirmed_by?: string;
  confirmed_at?: string;
  source?: string;
  source_page?: number;
  cancel_note?: string;
  released_by?: string;
  released_at?: string;
};
export type InvoiceIssuer = { bank: string; registration: string };
export const defaultIssuer: InvoiceIssuer = {
  bank: "かながわ信用金庫 湘南ライフタウン支店 普通 2116121",
  registration: "T1021001000853",
};
export function taxAmounts(net: string, rule: TaxRule) {
  const normalized = sumDecimal([net]),
    [whole, frac = ""] = normalized.split("."),
    n = BigInt(whole) * 100000000n + BigInt(frac.padEnd(8, "0")),
    m = rule.rate.match(/^(\d{1,2}|100)(?:\.(\d{1,4}))?$/);
  if (!m || Number(rule.rate) > 100)
    throw new Error("税率は0〜100%・小数4桁までです");
  const rate = BigInt(m[1]) * 10000n + BigInt((m[2] || "").padEnd(4, "0"));
  if (rate > 1000000n) throw new Error("税率は100%以下です");
  if (
    rule.basis !== "invoice" ||
    !["floor", "nearest", "ceil"].includes(rule.rounding)
  )
    throw new Error("税計算の設定を確認してください");
  const denominator = 100000000000000n,
    p = n * rate;
  let tax = p / denominator,
    remainder = p % denominator;
  if (
    (rule.rounding === "ceil" && remainder) ||
    (rule.rounding === "nearest" && remainder * 2n >= denominator)
  )
    tax++;
  return {
    tax: tax.toString(),
    gross: sumDecimal([normalized, tax.toString()]),
  };
}
export function monthRule(data: Data, month: string) {
  return (data.taxRules || []).find((r) => r.month === month);
}
export function ledger(data: Data, month?: string): BillingLine[] {
  const result: BillingLine[] = [];
  for (const s of data.sales || []) {
    if (
      (month &&
        !isInBillingMonth(data, s.delivered_on, s.billing_party_id, month)) ||
      (s.transaction_category && s.transaction_category !== "normal")
    )
      continue;
    const o = data.orders.find((o) => o.id === s.order_id);
    result.push({
      source_id: s.id,
      source_kind: "sale",
      actual_day: s.delivered_on,
      day: s.invoice_on || s.delivered_on,
      customer_id: s.customer_id,
      destination:
        o?.location ||
        data.customers.find((c) => c.id === s.customer_id)?.name ||
        "",
      product:
        s.invoice_unit && s.invoice_unit !== "L"
          ? "AdBlue " + s.invoice_unit
          : "AdBlue",
      kind: "adblue",
      quantity: s.invoice_quantity || s.quantity_l,
      unit: s.invoice_unit || "L",
      price: s.invoice_unit_price || s.unit_price_excl_tax,
      liters: s.quantity_l,
      amount: s.net_amount,
      notes: o?.notes || "",
    });
  }
  for (const i of data.billingItems || []) {
    if (
      (month && !isInBillingMonth(data, i.day, i.billing_party_id, month)) ||
      i.category !== "normal"
    )
      continue;
    result.push({
      source_id: i.id,
      source_kind: "item",
      actual_day: i.day,
      day: i.invoice_on || i.day,
      customer_id: i.customer_id,
      destination: i.destination,
      product: i.product,
      kind: i.kind,
      quantity: i.quantity,
      unit: i.unit,
      price: i.price,
      liters: i.liters,
      amount: i.kind === "loan" ? "0" : i.amount,
      notes: i.notes,
    });
  }
  return result;
}
export function lineParty(data: Data, line: BillingLine) {
  return line.source_kind === "sale"
    ? (data.sales || []).find((s) => s.id === line.source_id)?.billing_party_id
    : (data.billingItems || []).find((i) => i.id === line.source_id)
        ?.billing_party_id;
}
export function issuedCoverage(data: Data, id: string) {
  return (data.billingInvoices || [])
    .filter((i) => i.status === "issued")
    .flatMap((i) =>
      i.lines
        .filter(
          (l) =>
            l.source_id === id &&
            l.amount !== null &&
            (l.amount !== "0" || l.kind === "loan"),
        )
        .map((l) => ({ invoice: i, line: l })),
    );
}
export type CheckIssue = {
  code: string;
  message: string;
  source_id?: string;
  blocking: boolean;
};
export function billingCheck(data: Data, month: string, partyId?: string) {
  const all = ledger(data, month),
    lines = all.filter(
      (l) => partyId === undefined || lineParty(data, l) === partyId,
    ),
    issues: CheckIssue[] = [];
  const net = sumDecimal(lines.map((l) => l.amount || "0")),
    quantity = sumDecimal(lines.map((l) => l.liters)),
    adblue = sumDecimal(
      lines.filter((l) => l.kind === "adblue").map((l) => l.amount || "0"),
    ),
    goods = sumDecimal(
      lines.filter((l) => l.kind === "goods").map((l) => l.amount || "0"),
    );
  for (const l of lines) {
    const party = lineParty(data, l),
      s =
        l.source_kind === "sale"
          ? (data.sales || []).find((s) => s.id === l.source_id)
          : undefined,
      item =
        l.source_kind === "item"
          ? (data.billingItems || []).find((i) => i.id === l.source_id)
          : undefined;
    const review = s?.billing_review_note || item?.review_note;
    if (
      !party ||
      !(data.billingParties || []).some((p) => p.id === party && p.active)
    )
      issues.push({
        code: "payer",
        message: "請求先未設定・停止中",
        source_id: l.source_id,
        blocking: true,
      });
    if (l.kind !== "loan" && (!l.price || Number(l.price) <= 0))
      issues.push({
        code: "price",
        message: "単価未設定・0円売上の扱いを確認",
        source_id: l.source_id,
        blocking: true,
      });
    try {
      if (l.kind !== "loan" && multiplyNet(l.quantity, l.price) !== l.amount)
        issues.push({
          code: "amount",
          message: "数量×固定単価と売上金額に差異",
          source_id: l.source_id,
          blocking: !review,
        });
    } catch {
      issues.push({
        code: "amount",
        message: "数量・単価の形式が不正",
        source_id: l.source_id,
        blocking: true,
      });
    }
    if (s?.invoice_quantity) {
      try {
        if (
          multiplyNet(s.invoice_quantity, s.liters_per_unit || "1") !==
          sumDecimal([s.quantity_l])
        )
          issues.push({
            code: "conversion",
            message: "請求数量とAdBlue換算数量が不一致",
            source_id: l.source_id,
            blocking: true,
          });
      } catch {
        issues.push({
          code: "conversion",
          message: "換算係数を確認",
          source_id: l.source_id,
          blocking: true,
        });
      }
    }
    if (l.actual_day !== l.day)
      issues.push({
        code: "date",
        message: "実給液日と請求書記載日が異なります",
        source_id: l.source_id,
        blocking: !review,
      });
    if (!validDate(l.day) || !isInBillingMonth(data, l.day, party, month))
      issues.push({
        code: "date",
        message: "請求書記載日が対象月外・不正",
        source_id: l.source_id,
        blocking: true,
      });
    const coverage = issuedCoverage(data, l.source_id);
    if (coverage.length > 1)
      issues.push({
        code: "duplicate_invoice",
        message: "重複請求候補（複数の発行済み請求書に算入）",
        source_id: l.source_id,
        blocking: true,
      });
    const refs = (data.billingInvoices || [])
      .filter((i) => i.kind === "reference" && i.month === month)
      .flatMap((i) => i.lines.filter((x) => x.source_id === l.source_id));
    if (
      l.amount &&
      Number(l.amount) > 0 &&
      refs.some((r) => r.amount === null) &&
      !coverage.length
    )
      issues.push({
        code: "omission",
        message:
          "請求内容再計算が必要：原本に通常請求の数量・単価は掲載されていますが、金額欄と計算売上が一致しません",
        source_id: l.source_id,
        blocking: true,
      });
    if (
      Number(l.amount || "0") > 0 &&
      !coverage.length &&
      !refs.some((r) => r.amount === null)
    )
      issues.push({
        code: "unbilled",
        message: "未請求の売上があります。請求書への算入を確認してください",
        source_id: l.source_id,
        blocking: true,
      });
    if (
      (data.billingInvoices || []).some(
        (i) =>
          i.status === "issued" &&
          i.month === month &&
          i.billing_party_id !== party &&
          i.lines.some((r) => r.source_id === l.source_id),
      )
    )
      issues.push({
        code: "payer_mismatch",
        message:
          "原本・既発行請求の請求先と現在の売上請求先が異なります。請求内容再計算が必要です",
        source_id: l.source_id,
        blocking: true,
      });
    if (refs.some((r) => r.amount !== null && r.amount !== l.amount))
      issues.push({
        code: "reference_amount",
        message: "既発行明細と実績金額の差異",
        source_id: l.source_id,
        blocking: !review,
      });
    const same = lines.filter(
      (x) =>
        x.source_id !== l.source_id &&
        x.actual_day === l.actual_day &&
        x.customer_id === l.customer_id &&
        x.destination === l.destination &&
        x.quantity === l.quantity &&
        x.price === l.price &&
        x.kind === l.kind &&
        x.product === l.product &&
        x.unit === l.unit,
    );
    if (same.length)
      issues.push({
        code: "duplicate",
        message: "同日・給液先・場所・数量・単価の重複候補",
        source_id: l.source_id,
        blocking: !review,
      });
  }
  const rule = monthRule(data, month);
  if (!rule)
    issues.push({
      code: "tax",
      message: "対象月の税計算ルール未確認",
      blocking: true,
    });
  const refs = (data.billingInvoices || []).filter(
    (i) =>
      i.month === month &&
      i.status === "issued" &&
      (partyId === undefined || i.billing_party_id === partyId),
  );
  const billedQty = sumDecimal([
      ...new Map(
        refs.flatMap((i) => i.lines).map((l) => [l.source_id, l.liters]),
      ).values(),
    ]),
    billedNet = sumDecimal(refs.map((i) => i.net));
  const tax = !rule
    ? null
    : partyId !== undefined
      ? taxAmounts(net, rule).tax
      : sumDecimal(
          [...new Set(lines.map((l) => lineParty(data, l)))].map(
            (id) =>
              taxAmounts(
                sumDecimal(
                  lines
                    .filter((l) => lineParty(data, l) === id)
                    .map((l) => l.amount || "0"),
                ),
                rule,
              ).tax,
          ),
        );
  return {
    lines,
    issues,
    net,
    quantity,
    adblue,
    goods,
    loans: lines.filter((l) => l.kind === "loan"),
    billedQty,
    billedNet,
    quantityDifference: Number(quantity) - Number(billedQty),
    amountDifference: Number(net) - Number(billedNet),
    tax,
    gross: tax === null ? null : sumDecimal([net, tax]),
  };
}
export function makeBillingInvoice(
  data: Data,
  month: string,
  partyId: string,
  kind: "regular" | "additional",
  actor: string,
  fields: { issued_on: string; due_on: string; subject: string },
): Data {
  const p = (data.billingParties || []).find(
      (p) => p.id === partyId && p.active,
    ),
    rule = monthRule(data, month);
  if (!p || !rule) throw new Error("請求先・税設定を確認してください");
  if (
    !validDate(fields.issued_on) ||
    !validDate(fields.due_on) ||
    fields.due_on < fields.issued_on ||
    !fields.subject.trim()
  )
    throw new Error("請求日・支払期限・件名を確認してください");
  const lines = ledger(data, month).filter(
    (l) =>
      lineParty(data, l) === partyId &&
      !issuedCoverage(data, l.source_id).length &&
      (kind !== "additional" || additionalEligible(data, l.source_id, partyId)),
  );
  if (!lines.length) throw new Error("未請求の売上がありません");
  if (
    lines.some(
      (l) =>
        pendingInfo(data, l).assigned_month &&
        pendingInfo(data, l).assigned_month !== month,
    )
  )
    throw new Error("別の請求月へ追加済みの明細があります");
  if (
    lines.some((l) =>
      data.billingInvoices?.some(
        (i) =>
          i.status === "draft" &&
          i.lines.some((x) => x.source_id === l.source_id),
      ),
    )
  )
    throw new Error("別の未確定請求書で選択済みです");
  if (
    (data.billingInvoices || []).some(
      (i) =>
        i.status === "draft" &&
        i.month === month &&
        i.billing_party_id === partyId,
    )
  )
    throw new Error("作成済みの未確定請求書を先に確認してください");
  if (
    kind === "regular" &&
    (data.billingInvoices || []).some(
      (i) =>
        i.status === "issued" &&
        i.month === month &&
        i.billing_party_id === partyId,
    )
  )
    throw new Error(
      "既発行分があります。紐付け・原本差異は請求内容再計算が必要です。追加請求は正式確定後に追加された明細だけが対象です",
    );
  const net = sumDecimal(lines.map((l) => l.amount || "0")),
    tax = taxAmounts(net, rule),
    issuer = data.invoiceIssuer || defaultIssuer,
    invoice: BillingInvoice = {
      id: crypto.randomUUID(),
      billing_party_id: partyId,
      month,
      kind,
      status: "draft",
      party_name: p.formal_name,
      party_address: p.address,
      internal_name: p.internal_name,
      ...fields,
      bank: issuer.bank,
      registration: issuer.registration,
      lines,
      net,
      ...tax,
      quantity: sumDecimal(lines.map((l) => l.liters)),
      tax_rule: { ...rule },
      created_by: actor,
      created_at: new Date().toISOString(),
    };
  return {
    ...data,
    billingInvoices: [...(data.billingInvoices || []), invoice],
  };
}
export function confirmBillingInvoice(
  data: Data,
  id: string,
  actor: string,
): Data {
  const invoice = (data.billingInvoices || []).find((i) => i.id === id);
  if (invoice?.selection_mode) return confirmSelectedInvoice(data, id, actor);
  if (!invoice || invoice.status !== "draft")
    throw new Error("未確定の請求書を選択してください");
  if (ledger(data, invoice.month).some((l) => !lineParty(data, l)))
    throw new Error(
      "請求先未設定の売上があります。月全体の請求前チェックを確認してください",
    );
  const currentRule = monthRule(data, invoice.month);
  if (
    !currentRule ||
    currentRule.rate !== invoice.tax_rule.rate ||
    currentRule.rounding !== invoice.tax_rule.rounding ||
    currentRule.basis !== invoice.tax_rule.basis
  )
    throw new Error(
      "税設定が変更されています。未確定請求書を取り消して作り直してください",
    );
  const check = billingCheck(data, invoice.month, invoice.billing_party_id),
    included = new Set(invoice.lines.map((l) => l.source_id));
  const missing = check.lines.filter(
    (l) =>
      Number(l.amount || "0") > 0 &&
      !issuedCoverage(data, l.source_id).length &&
      !included.has(l.source_id),
  );
  if (missing.length)
    throw new Error("未請求の売上があります。請求漏れ候補を確認してください");
  const issues = check.issues.filter(
    (i) =>
      i.blocking &&
      (!i.source_id || included.has(i.source_id)) &&
      !(
        (i.code === "unbilled" ||
          (i.code === "omission" &&
            invoice.kind === "additional" &&
            additionalEligible(
              data,
              i.source_id || "",
              invoice.billing_party_id,
            ))) &&
        included.has(i.source_id || "")
      ),
  );
  if (issues.length)
    throw new Error(
      issues.some((i) => i.code === "omission")
        ? "未請求の売上があります。追加請求で内容を確認してください"
        : issues.map((i) => i.message).join(" / "),
    );
  for (const l of invoice.lines) {
    if (
      pendingInfo(data, l).assigned_month &&
      pendingInfo(data, l).assigned_month !== invoice.month
    )
      throw new Error("別の請求月へ追加済みの明細です");
    if (issuedCoverage(data, l.source_id).length)
      throw new Error("この明細は請求済みです");
    const current = check.lines.find((x) => x.source_id === l.source_id);
    if (!current || JSON.stringify(current) !== JSON.stringify(l))
      throw new Error("請求書作成後に明細が変更されました");
  }
  const net = sumDecimal(invoice.lines.map((l) => l.amount || "0")),
    computed = taxAmounts(net, invoice.tax_rule);
  if (
    net !== invoice.net ||
    computed.tax !== invoice.tax ||
    computed.gross !== invoice.gross
  )
    throw new Error("請求金額の整合性を確認してください");
  const now = new Date().toISOString();
  return {
    ...data,
    billingInvoices: (data.billingInvoices || []).map((i) =>
      i.id === id
        ? { ...i, status: "issued", confirmed_by: actor, confirmed_at: now }
        : i,
    ),
    sales: (data.sales || []).map((s) =>
      included.has(s.id)
        ? {
            ...s,
            billing_status: "billed",
            billed_by: actor,
            billed_at: now,
            billing_note: invoice.subject,
          }
        : s,
    ),
    billingItems: (data.billingItems || []).map((i) =>
      included.has(i.id) ? { ...i, status: "billed" } : i,
    ),
  };
}
export function markAdditional(data: Data, ids: string[], actor: string): Data {
  if (!ids.length) throw new Error("追加請求の明細を選択してください");
  for (const id of ids)
    if (
      !(data.sales || []).some(
        (s) =>
          s.id === id &&
          (!s.transaction_category || s.transaction_category === "normal"),
      ) ||
      !additionalEligible(data, id)
    )
      throw new Error(
        "追加請求は、その月の請求を正式確定した後に追加された明細だけです。既存明細は請求内容再計算が必要です",
      );
  return {
    ...data,
    sales: (data.sales || []).map((s) =>
      ids.includes(s.id)
        ? {
            ...s,
            billing_status: "additional",
            billing_note: "追加請求対象を確認：" + actor,
          }
        : s,
    ),
  };
}
export function validateBillingData(data: Data) {
  const parties = data.billingParties || [],
    items = data.billingItems || [],
    invoices = data.billingInvoices || [];
  for (const list of [parties, items, invoices])
    if (
      !Array.isArray(list) ||
      new Set(list.map((v) => v?.id)).size !== list.length ||
      list.some((v) => !v || typeof v.id !== "string")
    )
      throw new Error("請求データのIDが不正です");
  if (
    !Array.isArray(data.billingAliases || []) ||
    new Set((data.billingAliases || []).map((a) => a.id)).size !==
      (data.billingAliases || []).length ||
    (data.billingAliases || []).some(
      (a) =>
        typeof a.id !== "string" ||
        typeof a.customer_name !== "string" ||
        typeof a.site_name !== "string" ||
        !data.customers.some((c) => c.id === a.customer_id) ||
        !parties.some((p) => p.id === a.billing_party_id) ||
        (a.site_id &&
          !data.sites?.some(
            (s) => s.id === a.site_id && s.customer_id === a.customer_id,
          )),
    )
  )
    throw new Error("給液先と請求先の対応データが不正です");
  for (const p of parties)
    if (
      typeof p.internal_name !== "string" ||
      typeof p.formal_name !== "string" ||
      typeof p.address !== "string" ||
      typeof p.active !== "boolean"
    )
      throw new Error("請求先の形式が不正です");
  if (!Array.isArray(data.taxRules || []))
    throw new Error("税設定の形式が不正です");
  for (const value of [...data.customers, ...(data.sites || []), ...items])
    if (
      value.billing_party_id &&
      !parties.some((p) => p.id === value.billing_party_id)
    )
      throw new Error("マスター・商品明細の請求先が不正です");
  if (
    data.invoiceIssuer &&
    (typeof data.invoiceIssuer.bank !== "string" ||
      typeof data.invoiceIssuer.registration !== "string")
  )
    throw new Error("請求元の形式が不正です");
  for (const rule of data.taxRules || [])
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(rule.month) ||
      typeof rule.confirmed_by !== "string" ||
      typeof rule.confirmed_at !== "string"
    )
      throw new Error("税設定が不正です");
    else taxAmounts("1", rule);
  for (const p of parties)
    if (
      p.terms &&
      (![p.terms.closing_day, p.terms.invoice_day, p.terms.payment_day].every(
        (d) => Number.isInteger(d) && d >= 1 && d <= 31,
      ) ||
        !Number.isInteger(p.terms.payment_month_offset) ||
        p.terms.payment_month_offset < 1 ||
        p.terms.payment_month_offset > 12)
    )
      throw new Error("請求条件が不正です");
  for (const i of items) {
    if (
      !validDate(i.day) ||
      (i.invoice_on !== undefined && !validDate(i.invoice_on)) ||
      (i.customer_id !== null &&
        !data.customers.some((c) => c.id === i.customer_id)) ||
      !["unbilled", "billed", "additional", "recalculate"].includes(i.status) ||
      !["adblue", "goods", "loan"].includes(i.kind) ||
      !["normal", "internal", "purchase", "excluded"].includes(i.category) ||
      typeof i.product !== "string" ||
      typeof i.notes !== "string" ||
      typeof i.destination !== "string"
    )
      throw new Error("商品明細が不正です");
    sumDecimal([i.liters, i.amount, i.price]);
    if (
      i.category === "normal" &&
      (multiplyNet(i.quantity, i.kind === "loan" ? "0" : i.price) !==
        i.amount ||
        (i.kind === "loan" && i.amount !== "0"))
    )
      throw new Error("商品明細の金額が不正です");
  }
  for (const s of data.sales || []) {
    if (s.billing_party_id && !parties.some((p) => p.id === s.billing_party_id))
      throw new Error("売上の請求先が不正です");
    if (
      s.transaction_category &&
      !["normal", "internal", "purchase", "excluded"].includes(
        s.transaction_category,
      )
    )
      throw new Error("売上の取引区分が不正です");
    if (s.invoice_on && !validDate(s.invoice_on))
      throw new Error("請求記載日が不正です");
    if (s.invoice_quantity) {
      if (
        multiplyNet(s.invoice_quantity, s.liters_per_unit || "1") !==
          sumDecimal([s.quantity_l]) ||
        multiplyNet(s.liters_per_unit || "1", s.unit_price_excl_tax) !==
          sumDecimal([s.invoice_unit_price || s.unit_price_excl_tax])
      )
        throw new Error("売上の単位換算が不正です");
    }
  }
  for (const source of [...(data.sales || []), ...items]) {
    const p = source.pending_billing;
    if (
      p &&
      ((p.original_month !== undefined &&
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.original_month)) ||
        (p.assigned_month !== undefined &&
          p.assigned_month !== null &&
          (!p.original_month ||
            !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.assigned_month) ||
            p.assigned_month <= p.original_month ||
            typeof p.assigned_by !== "string" ||
            !p.assigned_at ||
            !Number.isFinite(Date.parse(p.assigned_at)) ||
            p.planned_month !== p.assigned_month)) ||
        (p.assignment_history !== undefined &&
          (!Array.isArray(p.assignment_history) ||
            p.assignment_history.some(
              (h) =>
                !["assign", "cancel"].includes(h.action) ||
                !/^\d{4}-(0[1-9]|1[0-2])$/.test(h.month) ||
                !Number.isFinite(Date.parse(h.at)) ||
                typeof h.by !== "string" ||
                typeof h.reason !== "string",
            ))) ||
        (p.assigned_month &&
          p.invoice_id &&
          !invoices.some(
            (i) => i.id === p.invoice_id && i.month === p.assigned_month,
          )))
    )
      throw new Error("請求月への追加情報が不正です");
    if (
      p &&
      (typeof p.reason !== "string" ||
        !p.reason.trim() ||
        (p.discovered_on !== null && !validDate(p.discovered_on)) ||
        (p.planned_month !== null &&
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.planned_month)) ||
        (p.invoice_id !== null &&
          !invoices.some(
            (i) =>
              i.id === p.invoice_id &&
              i.status === "issued" &&
              i.lines.some((l) => l.source_id === source.id),
          )))
    )
      throw new Error("未請求管理情報が不正です");
  }
  for (const i of invoices) {
    if (
      i.selection_mode &&
      (!["unified", "destination"].includes(i.selection_mode) ||
        typeof i.delivery_scope !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month) ||
        i.kind === "reference")
    )
      throw new Error("選択式請求書の範囲が不正です");
    if (
      !parties.some((p) => p.id === i.billing_party_id) ||
      !["regular", "additional", "reference"].includes(i.kind) ||
      !["draft", "issued", "cancelled"].includes(i.status) ||
      !Array.isArray(i.lines) ||
      new Set(i.lines.map((l) => l.source_id)).size !== i.lines.length ||
      typeof i.party_name !== "string" ||
      typeof i.subject !== "string" ||
      !validDate(i.issued_on) ||
      !validDate(i.due_on)
    )
      throw new Error("請求書の形式が不正です");
    for (const l of i.lines) {
      if (
        !validDate(l.day) ||
        typeof l.destination !== "string" ||
        typeof l.product !== "string" ||
        typeof l.notes !== "string" ||
        !["sale", "item"].includes(l.source_kind) ||
        !["adblue", "goods", "loan"].includes(l.kind)
      )
        throw new Error("請求明細が不正です");
      if (
        l.source_kind === "sale"
          ? !data.sales?.some((s) => s.id === l.source_id)
          : !items.some((x) => x.id === l.source_id)
      )
        throw new Error("請求明細の関連が不正です");
      sumDecimal([
        l.quantity,
        l.price,
        l.liters,
        ...(l.amount === null ? [] : [l.amount]),
      ]);
    }
    if (
      sumDecimal(i.lines.map((l) => l.amount || "0")) !== i.net ||
      sumDecimal(i.lines.map((l) => l.liters)) !== i.quantity
    )
      throw new Error("請求書合計が不正です");
    const computed = taxAmounts(i.net, i.tax_rule);
    if (computed.tax !== i.tax || computed.gross !== i.gross)
      throw new Error("請求書税額が不正です");
  }
}

export function reviewBillingLine(
  data: Data,
  id: string,
  fields: {
    payer: string;
    category: TransactionCategory;
    invoice_on: string;
    note: string;
    quantity: string;
    unit: string;
    price: string;
    factor: string;
  },
): Data {
  const sale = (data.sales || []).find((s) => s.id === id),
    item = (data.billingItems || []).find((i) => i.id === id);
  if (!sale && !item) throw new Error("対象明細がありません");
  if (
    fields.payer &&
    !(data.billingParties || []).some((p) => p.id === fields.payer && p.active)
  )
    throw new Error("請求先を確認してください");
  if (
    !validDate(fields.invoice_on) ||
    !["normal", "internal", "purchase", "excluded"].includes(fields.category)
  )
    throw new Error("日付・取引区分を確認してください");
  const month = (sale?.delivered_on || item!.day).slice(0, 7),
    line = ledger(
      {
        ...data,
        sales: data.sales?.map((s) =>
          s.id === id ? { ...s, transaction_category: "normal" } : s,
        ),
        billingItems: data.billingItems?.map((i) =>
          i.id === id ? { ...i, category: "normal" } : i,
        ),
      },
      month,
    ).find((l) => l.source_id === id)!;
  if (issuedCoverage(data, id).length) {
    if (
      fields.payer !== (lineParty(data, line) || "") ||
      fields.category !==
        (sale?.transaction_category || item?.category || "normal") ||
      fields.invoice_on !== line.day ||
      fields.quantity !== line.quantity ||
      fields.unit !== line.unit ||
      fields.price !== line.price ||
      fields.factor !== (sale?.liters_per_unit || "1")
    )
      throw new Error("請求済み明細は変更できません。確認記録のみ追加できます");
  } else if (sale) {
    if (
      multiplyNet(fields.quantity, fields.factor) !==
      sumDecimal([sale.quantity_l])
    )
      throw new Error("請求数量×換算係数が実績Lと一致しません");
    if (
      multiplyNet(fields.factor, sale.unit_price_excl_tax) !==
      sumDecimal([fields.price])
    )
      throw new Error("請求単位の単価が固定済み実績単価と一致しません");
  }
  if (
    (fields.category !== "normal" || fields.invoice_on !== line.actual_day) &&
    !fields.note.trim()
  )
    throw new Error("対象外・内部・仕入・日付差異の確認理由を残してください");
  return {
    ...data,
    sales: data.sales?.map((s) =>
      s.id === id
        ? {
            ...s,
            billing_party_id: fields.payer || null,
            transaction_category: fields.category,
            invoice_on: fields.invoice_on,
            billing_review_note: fields.note.trim(),
            invoice_quantity: fields.quantity,
            invoice_unit: fields.unit,
            invoice_unit_price: fields.price,
            liters_per_unit: fields.factor,
          }
        : s,
    ),
    billingItems: data.billingItems?.map((i) =>
      i.id === id
        ? {
            ...i,
            billing_party_id: fields.payer || null,
            category: fields.category,
            invoice_on: fields.invoice_on,
            review_note: fields.note.trim(),
          }
        : i,
    ),
  };
}

export function cancelBillingDraft(data: Data, id: string): Data {
  const invoice = data.billingInvoices?.find((i) => i.id === id);
  if (!invoice || invoice.status !== "draft")
    throw new Error("未確定請求書だけを取り消せます。既発行分は保持します");
  return {
    ...data,
    billingInvoices: data.billingInvoices!.map((i) =>
      i.id === id ? { ...i, status: "cancelled" } : i,
    ),
  };
}
