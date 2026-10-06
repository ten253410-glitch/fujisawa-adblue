import fixture from "./august-fixture.json";
import type { Data } from "./domain";
import { registerHistory, type ReviewRow } from "./history-import";
import {
  issuedCoverage,
  defaultIssuer,
  taxAmounts,
  type TaxRule,
  type BillingParty,
  type BillingInvoice,
  type BillingLine,
  type BillingItem,
} from "./billing";
import { sumDecimal } from "./local-flow";
export { fixture as augustFixture };
const exactName = (v: string) =>
  v
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .toLowerCase();
export function augustExistingMatches(data: Data) {
  return fixture.rows.map((r) => ({
    row: r.row,
    ids: (data.sales || [])
      .filter(
        (s) =>
          s.delivered_on === r.day &&
          sumDecimal([s.quantity_l]) === sumDecimal([r.quantity]) &&
          sumDecimal([s.unit_price_excl_tax]) === sumDecimal([r.price]) &&
          exactName(
            data.orders.find((o) => o.id === s.order_id)?.location || "",
          ) === exactName(r.destination),
      )
      .map((s) => s.id),
  }));
}
export function importVerifiedAugust(
  data: Data,
  actor: string,
  useExisting = false,
): Data {
  if ((data.billingInvoices || []).some((i) => i.source === fixture.source.pdf))
    throw new Error("8月照合資料は取込済みです。二重登録しません");
  if (!useExisting)
    for (const r of fixture.rows)
      if (
        (data.actuals || []).some(
          (a) =>
            a.delivered_on === r.day &&
            a.quantity_l === r.quantity &&
            data.orders.find((o) => o.id === a.order_id)?.location ===
              r.destination,
        )
      )
        throw new Error(
          "同じ8月実績が登録済みです。既存データをバックアップし、重複を確認してください",
        );
  const matches = useExisting ? augustExistingMatches(data) : [];
  if (
    useExisting &&
    (matches.some((m) => m.ids.length !== 1) ||
      new Set(matches.flatMap((m) => m.ids)).size !== 69)
  )
    throw new Error(
      "既存8月実績と原本の完全一致候補が69件揃っていません。給液先・日付・数量・単価の未一致／重複を確認してください。自動補正しません",
    );
  if (useExisting && matches.some((m) => issuedCoverage(data, m.ids[0]).length))
    throw new Error(
      "アプリで確定済みの明細があります。既発行分は上書きしません。先に請求内容を確認してください",
    );
  if (
    useExisting &&
    (data.billingItems || []).some(
      (i) => i.day.startsWith("2026-08") && i.category === "normal",
    )
  )
    throw new Error(
      "8月の商品・貸与明細が既にあります。二重取込を避けるため、既存明細との照合が必要です",
    );
  const partyMap = new Map<string, string>(),
    parties: BillingParty[] = [...(data.billingParties || [])];
  for (const b of fixture.bills.filter((b) => b.id !== "内部")) {
    let p = parties.find((p) => p.formal_name === b.formal);
    if (!p) {
      p = {
        id: crypto.randomUUID(),
        internal_name: b.id,
        formal_name: b.formal,
        address: b.address,
        active: true,
      };
      parties.push(p);
    }
    partyMap.set(b.id, p.id);
  }
  const rule: TaxRule = {
    month: "2026-08",
    rate: "10",
    rounding: "floor",
    basis: "invoice",
    confirmed_by: actor,
    confirmed_at: new Date().toISOString(),
  };
  const rows: ReviewRow[] = fixture.rows.map((r) => ({
    row: Number(r.row),
    day: r.day,
    customer: r.destination,
    site: r.destination,
    address: "",
    quantity: r.quantity,
    price: r.price,
    amount: r.cached_amount || "",
    operator: "資料未記載（確認：" + actor + "）",
    slip: "",
    notes: [r.notes, "バッチ " + r.batch].filter(Boolean).join(" / "),
    customerId: data.customers.find((c) => c.name === r.destination)?.id || "",
    siteId: "",
    newCustomer: !data.customers.some((c) => c.name === r.destination),
    newSite: true,
    include: true,
    useSourceAmount: false,
    duplicateApproved: false,
    approved: true,
  }));
  const base: Data = {
    ...data,
    billingParties: parties,
    taxRules: [
      ...(data.taxRules || []).filter((r) => r.month !== "2026-08"),
      rule,
    ],
    invoiceIssuer: data.invoiceIssuer || defaultIssuer,
  };
  let next = useExisting
    ? { ...base }
    : registerHistory(base, rows, fixture.source.excel, "8月", actor);
  const appended = useExisting
      ? matches.map((m) => data.sales!.find((s) => s.id === m.ids[0])!)
      : next.sales!.slice((data.sales || []).length),
    lineMap = new Map<number, BillingLine>();
  next.sales = next.sales!.map((s) => {
    const index = appended.findIndex((x) => x.id === s.id);
    if (index < 0) return s;
    const r = fixture.rows[index],
      pdf = r.pdf,
      payer = partyMap.get(r.bill)!;
    const order = next.orders.find((o) => o.id === s.order_id)!;
    next.customers = next.customers.map((c) =>
      c.id === s.customer_id ? { ...c, billing_party_id: payer } : c,
    );
    next.sites = next.sites!.map((site) =>
      site.id === order.site_id ? { ...site, billing_party_id: payer } : site,
    );
    const bib = pdf.packing === "BIB(20L)";
    lineMap.set(Number(r.row), {
      source_id: s.id,
      source_kind: "sale",
      customer_id: s.customer_id,
      actual_day: r.day,
      day: pdf.day,
      destination: pdf.destination || r.destination,
      product: bib ? "AdBlue BIB（20L）" : "AdBlue",
      kind: "adblue",
      quantity: pdf.quantity,
      unit: bib ? "BIB" : "L",
      price: pdf.price,
      liters: r.quantity,
      amount: pdf.amount,
      notes: "元PDF " + r.batch,
    });
    return {
      ...s,
      billing_party_id: payer,
      transaction_category: "normal",
      invoice_on: pdf.day,
      ...(bib
        ? {
            invoice_quantity: pdf.quantity,
            invoice_unit: "BIB",
            invoice_unit_price: pdf.price,
            liters_per_unit: "20",
          }
        : {}),
      billing_status: pdf.amount === null ? "unbilled" : "billed",
      billed_by: pdf.amount === null ? null : actor,
      billed_at: pdf.amount === null ? null : new Date().toISOString(),
      billing_note: "既発行PDF照合（数量だけでなく明細金額を確認）",
    };
  });
  const items: BillingItem[] = [...(next.billingItems || [])],
    extraLines = new Map<string, BillingLine[]>();
  for (const e of fixture.extras) {
    const i: BillingItem = {
      id: crypto.randomUUID(),
      billing_party_id: partyMap.get(e.bill)!,
      customer_id: (() => {
        const ids = [
          ...new Set(
            fixture.rows
              .map((r, index) =>
                r.bill === e.bill && r.pdf.destination === e.destination
                  ? appended[index].customer_id
                  : null,
              )
              .filter((id): id is string => !!id),
          ),
        ];
        return ids.length === 1 ? ids[0] : null;
      })(),
      day: e.day,
      kind: e.kind as "goods" | "loan",
      product: e.product,
      destination: e.destination,
      quantity: e.quantity,
      unit: "個",
      price: e.price,
      liters: "0",
      amount: e.amount,
      category: "normal",
      status: "billed",
      notes: "既発行PDFから照合済み・" + e.page + "ページ",
      created_by: actor,
      created_at: new Date().toISOString(),
    };
    items.push(i);
    const ls = extraLines.get(e.bill) || [];
    ls.push({
      source_id: i.id,
      source_kind: "item",
      customer_id: i.customer_id,
      actual_day: i.day,
      day: i.day,
      destination: i.destination,
      product: i.product,
      kind: i.kind,
      quantity: i.quantity,
      unit: i.unit,
      price: i.price,
      liters: "0",
      amount: i.amount,
      notes: i.notes,
    });
    extraLines.set(e.bill, ls);
  }
  for (const e of fixture.internal)
    items.push({
      id: crypto.randomUUID(),
      billing_party_id: null,
      customer_id: null,
      day: e.day,
      kind: "goods",
      product: e.product,
      destination: "仕入・自等家",
      quantity: "0",
      unit: "記録",
      price: "0",
      liters: "0",
      amount: "0",
      category: "purchase",
      status: "unbilled",
      notes: "PDFの0円記録。給液量は記載なし。通常請求から除外",
      created_by: actor,
      created_at: new Date().toISOString(),
    });
  const invoices: BillingInvoice[] = [...(next.billingInvoices || [])];
  for (const b of fixture.bills.filter((b) => b.id !== "内部")) {
    const lines = [
      ...fixture.rows
        .filter((r) => r.bill === b.id)
        .map((r) => lineMap.get(Number(r.row))!),
      ...(extraLines.get(b.id) || []),
    ];
    const net = sumDecimal(lines.map((l) => l.amount || "0"));
    if (net !== b.net) throw new Error("PDF小計との検証不一致：" + b.id);
    const amounts = taxAmounts(net, rule);
    if (amounts.tax !== b.tax || amounts.gross !== b.gross)
      throw new Error("PDF税額との検証不一致：" + b.id);
    invoices.push({
      id: crypto.randomUUID(),
      billing_party_id: partyMap.get(b.id)!,
      month: "2026-08",
      kind: "reference",
      status: "issued",
      party_name: b.formal,
      party_address: b.address,
      internal_name: b.id,
      subject: "2026年8月納品分商品代（既発行原本）",
      issued_on: "2026-09-01",
      due_on: "2026-09-30",
      ...defaultIssuer,
      lines,
      net,
      tax: b.tax,
      gross: b.gross,
      quantity: sumDecimal(lines.map((l) => l.liters)),
      tax_rule: { ...rule },
      created_by: actor,
      created_at: new Date().toISOString(),
      source: fixture.source.pdf,
      source_page: b.page,
    });
  }
  return { ...next, billingItems: items, billingInvoices: invoices };
}
