import { currentPrice, type Data, type Order } from "./domain";
import { validDate } from "./order-import";
export const LOCAL_KEY = "fujisawa-adblue-demo-v1";
import { validateBillingData, issuedCoverage } from "./billing";
export type DeliverySite = {
  billing_party_id?: string | null;
  id: string;
  customer_id: string;
  name: string;
  address: string;
  contact: string;
  notes: string;
  active: boolean;
};
export type LocalActual = {
  id: string;
  order_id: string;
  source_type?: "history";
  import_meta?: import("./history-import").ImportMeta;
  document_id: string;
  delivered_on: string;
  quantity_l: string;
  performed_by: string;
  notes: string;
  price_id: string;
  unit_price_excl_tax: string;
  net_amount: string;
  confirmed_by: string;
  confirmed_at: string;
};
export type LocalSale = {
  billing_party_id?: string | null;
  transaction_category?: import("./billing").TransactionCategory;
  invoice_on?: string;
  invoice_quantity?: string;
  invoice_unit?: string;
  invoice_unit_price?: string;
  liters_per_unit?: string;
  billing_review_note?: string;
  id: string;
  order_id: string;
  actual_id: string;
  customer_id: string;
  delivered_on: string;
  quantity_l: string;
  unit_price_excl_tax: string;
  net_amount: string;
  billing_status: "unbilled" | "billed" | "additional";
  billed_by: string | null;
  billed_at: string | null;
  billing_note: string;
};
// Exact decimal arithmetic: no tax calculation or rounding policy is assumed.
function scaled(value: string, digits: number, maxWhole = 10): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value))
    throw new Error("数量・単価は0以上の通常の数値で入力してください");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > digits)
    throw new Error(
      `小数点以下は${digits}桁まで入力できます。自動で丸めません。`,
    );
  if (whole.length > maxWhole) throw new Error("数値が大きすぎます");
  return (
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0")
  );
}
function decimal(n: bigint, digits: number) {
  const raw = n.toString().padStart(digits + 1, "0");
  const whole = raw.slice(0, -digits),
    fraction = raw.slice(-digits).replace(/0+$/, "");
  return whole + (fraction ? "." + fraction : "");
}
export function multiplyNet(quantity: string, price: string) {
  const q = scaled(quantity, 4),
    p = scaled(price, 4);
  if (q <= 0n) throw new Error("実給液量は0より大きい値が必要です");
  return decimal(q * p, 8);
}
export function sumDecimal(values: string[]) {
  return decimal(
    values.reduce((total, v) => total + scaled(v, 8, 28), 0n),
    8,
  );
}
export function formatDecimal(v: string) {
  const [whole, fraction] = v.split(".");
  return (
    BigInt(whole || "0").toLocaleString("ja-JP") +
    (fraction ? "." + fraction : "")
  );
}
export function confirmActual(
  data: Data,
  orderId: string,
  input: {
    delivered_on: string;
    quantity_l: string;
    performed_by: string;
    document_id: string;
    notes: string;
  },
  actor: string,
): Data {
  const order = data.orders.find((o) => o.id === orderId);
  if (!order || order.status === "cancelled")
    throw new Error("対象案件がありません");
  if ((data.actuals || []).some((a) => a.order_id === orderId))
    throw new Error("この案件の給液実績は登録済みです");
  if (!validDate(input.delivered_on))
    throw new Error("実際の給液日を入力してください");
  if (!input.performed_by.trim())
    throw new Error("給液担当者を入力してください");
  if (
    !data.documents.some(
      (d) => d.id === input.document_id && d.order_id === orderId,
    )
  )
    throw new Error("この案件の納品書画像を登録・選択してください");
  const price = currentPrice(
    data.prices,
    order.customer_id,
    input.delivered_on,
  );
  if (!price)
    throw new Error(
      "実際の給液日に有効な単価がありません。顧客の単価履歴を登録してください",
    );
  if (price.unit !== "L" || price.tax_basis !== "exclusive")
    throw new Error("税抜・円/Lの単価を登録してください");
  const unitPrice = String(price.amount),
    amount = multiplyNet(input.quantity_l, unitPrice),
    now = new Date().toISOString();
  const actual: LocalActual = {
    id: crypto.randomUUID(),
    order_id: orderId,
    ...input,
    performed_by: input.performed_by.trim(),
    price_id: price.id,
    unit_price_excl_tax: unitPrice,
    net_amount: amount,
    confirmed_by: actor,
    confirmed_at: now,
  };
  const sale: LocalSale = {
    id: crypto.randomUUID(),
    order_id: orderId,
    actual_id: actual.id,
    customer_id: order.customer_id,
    billing_party_id:
      (data.sites || []).find((s) => s.id === order.site_id)
        ?.billing_party_id ||
      data.customers.find((c) => c.id === order.customer_id)
        ?.billing_party_id ||
      null,
    transaction_category: "normal",
    delivered_on: input.delivered_on,
    quantity_l: input.quantity_l,
    unit_price_excl_tax: unitPrice,
    net_amount: amount,
    billing_status: "unbilled",
    billed_by: null,
    billed_at: null,
    billing_note: "",
  };
  return {
    ...data,
    actuals: [...(data.actuals || []), actual],
    sales: [...(data.sales || []), sale],
    documents: data.documents.map((d) =>
      d.id === input.document_id ? { ...d, review_status: "confirmed" } : d,
    ),
    orders: data.orders.map((o) =>
      o.id === orderId ? { ...o, status: "completed" } : o,
    ),
  };
}
export function markBilling(
  data: Data,
  ids: string[],
  status: LocalSale["billing_status"],
  actor: string,
  note: string,
): Data {
  if (!ids.length) throw new Error("売上を選択してください");
  if (!note.trim())
    throw new Error("請求状態を変更するメモを入力してください（例：業務検証）");
  const wanted = new Set(ids);
  if (
    wanted.size !== ids.length ||
    ids.some((id) => !(data.sales || []).some((s) => s.id === id))
  )
    throw new Error("対象売上を確認してください");
  if (ids.some((id) => issuedCoverage(data, id).length))
    throw new Error(
      "発行済み請求書の明細は、この画面で請求状態を変更できません",
    );
  if (ids.some((id) => data.sales?.find((s) => s.id === id)?.billing_party_id))
    throw new Error(
      "請求先を設定した売上は「請求前チェック・請求書」で請求確定してください",
    );
  const now = new Date().toISOString();
  return {
    ...data,
    sales: (data.sales || []).map((s) =>
      wanted.has(s.id)
        ? {
            ...s,
            billing_status: status,
            billed_by: status === "billed" ? actor : null,
            billed_at: status === "billed" ? now : null,
            billing_note: note.trim(),
          }
        : s,
    ),
  };
}
export function localData(raw: unknown): Data {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("保存データの形式が不正です");
  const v = raw as Data;
  if ((v.schema_version ?? 1) > 4)
    throw new Error("このアプリより新しい形式です。アプリを更新してください");
  for (const key of [
    "customers",
    "prices",
    "orders",
    "documents",
    "audit",
  ] as const)
    if (!Array.isArray(v[key])) throw new Error(`${key}の保存データが不正です`);
  const result: Data = {
    ...v,
    schema_version: 4,
    local_revision: v.local_revision ?? 0,
    sites: v.sites ?? [],
    actuals: v.actuals ?? [],
    sales: v.sales ?? [],
    orderImages: v.orderImages ?? [],
    invoiceDrafts: v.invoiceDrafts ?? [],
    billingParties: v.billingParties ?? [],
    billingItems: v.billingItems ?? [],
    billingInvoices: v.billingInvoices ?? [],
    taxRules: v.taxRules ?? [],
  };
  for (const key of [
    "customers",
    "prices",
    "orders",
    "documents",
    "audit",
    "sites",
    "actuals",
    "sales",
    "orderImages",
    "invoiceDrafts",
  ] as const) {
    const list = result[key]!;
    if (
      !Array.isArray(list) ||
      list.some(
        (r) => !r || typeof r !== "object" || typeof r.id !== "string",
      ) ||
      new Set(list.map((r) => r.id)).size !== list.length
    )
      throw new Error(`${key}の形式・IDが不正です`);
  }
  if (
    !Number.isSafeInteger(result.local_revision) ||
    result.local_revision! < 0
  )
    throw new Error("保存データの版が不正です");
  const strings = (record: unknown, keys: string[]) =>
    keys.every(
      (k) => typeof (record as Record<string, unknown>)[k] === "string",
    );
  if (
    result.customers.some(
      (c) =>
        !strings(c, ["name", "contact", "phone", "address", "notes"]) ||
        typeof c.active !== "boolean" ||
        (c.company_name !== undefined && typeof c.company_name !== "string"),
    ) ||
    result.orders.some(
      (o) =>
        !strings(o, [
          "case_no",
          "source_text",
          "location",
          "notes",
          "created_at",
        ]) ||
        !["line", "phone", "fax", "email", "paper", "image"].includes(
          o.channel,
        ) ||
        ![
          "new",
          "scheduled",
          "awaiting_document",
          "document_pending",
          "completed",
          "cancelled",
        ].includes(o.status),
    ) ||
    result.audit.some(
      (a) =>
        !strings(a, [
          "actor_name",
          "action",
          "entity",
          "entity_id",
          "created_at",
          "detail",
        ]),
    ) ||
    result.documents.some(
      (d) =>
        !strings(d, ["filename", "created_at"]) ||
        !["pending", "confirmed"].includes(d.review_status),
    ) ||
    result.sites!.some(
      (s) =>
        !strings(s, ["name", "address", "contact", "notes"]) ||
        typeof s.active !== "boolean",
    ) ||
    result.actuals!.some(
      (a) =>
        !strings(a, [
          "quantity_l",
          "unit_price_excl_tax",
          "net_amount",
          "performed_by",
          "notes",
          "confirmed_by",
          "confirmed_at",
        ]),
    ) ||
    result.sales!.some(
      (s) =>
        !strings(s, [
          "quantity_l",
          "unit_price_excl_tax",
          "net_amount",
          "billing_note",
        ]),
    )
  )
    throw new Error("バックアップの項目の形式が不正です");
  const customers = new Set(result.customers.map((c) => c.id)),
    orders = new Map(result.orders.map((o) => [o.id, o])),
    docs = new Map(result.documents.map((d) => [d.id, d]));
  if (
    result.customers.some(
      (c) =>
        typeof c.name !== "string" ||
        typeof c.address !== "string" ||
        typeof c.phone !== "string",
    ) ||
    result.prices.some(
      (p) =>
        !customers.has(p.customer_id) ||
        !Number.isFinite(p.amount) ||
        p.amount < 0 ||
        !validDate(p.effective_from),
    )
  )
    throw new Error("顧客・単価データが不正です");
  if (
    result.orders.some(
      (o) =>
        !customers.has(o.customer_id) ||
        !validDate(o.received_at) ||
        (o.scheduled_on !== null && !validDate(o.scheduled_on)) ||
        (o.requested_quantity !== null &&
          (!Number.isFinite(o.requested_quantity) ||
            o.requested_quantity <= 0)),
    )
  )
    throw new Error("受注データが不正です");
  if (
    result.documents.some(
      (d) => !orders.has(d.order_id) || typeof d.path !== "string",
    ) ||
    result.sites!.some(
      (s) =>
        !customers.has(s.customer_id) ||
        typeof s.name !== "string" ||
        typeof s.address !== "string",
    ) ||
    result.orderImages!.some(
      (i) => !orders.has(i.order_id) || typeof i.path !== "string",
    )
  )
    throw new Error("場所・画像の関連が不正です");
  if (
    result.orderImages!.some(
      (i) =>
        !strings(i, ["filename", "reviewed_at"]) ||
        !i.extracted ||
        !i.reviewed ||
        !Array.isArray(i.extracted.warnings) ||
        i.extracted.warnings.some((w) => typeof w !== "string") ||
        !["openai", "manual", "sample"].includes(i.extracted.method),
    )
  )
    throw new Error("受注画像の確認データが不正です");
  const actualIds = new Map(result.actuals!.map((a) => [a.id, a]));
  if (
    new Set(result.actuals!.map((a) => a.order_id)).size !==
    result.actuals!.length
  )
    throw new Error("給液実績が重複しています");
  for (const a of result.actuals!) {
    if (
      !orders.has(a.order_id) ||
      (a.source_type !== "history" &&
        docs.get(a.document_id)?.order_id !== a.order_id) ||
      !validDate(a.delivered_on) ||
      (a.source_type === "history"
        ? !a.import_meta ||
          a.import_meta.calculated_amount !==
            multiplyNet(a.quantity_l, a.unit_price_excl_tax) ||
          (a.import_meta.amount_basis === "source"
            ? sumDecimal([a.import_meta.reviewed.amount]) !== a.net_amount
            : multiplyNet(a.quantity_l, a.unit_price_excl_tax) !== a.net_amount)
        : multiplyNet(a.quantity_l, a.unit_price_excl_tax) !== a.net_amount) ||
      (a.source_type !== "history" &&
        !result.prices.some(
          (p) =>
            p.id === a.price_id &&
            p.customer_id === orders.get(a.order_id)?.customer_id,
        ))
    )
      throw new Error("給液実績の関連・金額が不正です");
  }
  if (
    new Set(result.sales!.map((s) => s.order_id)).size !== result.sales!.length
  )
    throw new Error("売上が重複しています");
  for (const s of result.sales!) {
    const a = actualIds.get(s.actual_id);
    if (
      !a ||
      a.order_id !== s.order_id ||
      orders.get(s.order_id)?.customer_id !== s.customer_id ||
      a.quantity_l !== s.quantity_l ||
      a.unit_price_excl_tax !== s.unit_price_excl_tax ||
      a.net_amount !== s.net_amount ||
      a.delivered_on !== s.delivered_on ||
      !["unbilled", "billed", "additional"].includes(s.billing_status)
    )
      throw new Error("売上の関連・金額が不正です");
  }
  if (result.actuals!.length !== result.sales!.length)
    throw new Error("実績と売上の件数が一致しません");
  for (const d of result.invoiceDrafts!) {
    if (
      !customers.has(d.customer_id) ||
      !strings(d, [
        "customer_name",
        "customer_address",
        "month",
        "created_at",
        "created_by",
        "quantity",
        "net",
      ]) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month) ||
      !Array.isArray(d.lines) ||
      !d.lines.length ||
      d.rules_status !== "pending" ||
      d.tax !== null ||
      d.gross !== null
    )
      throw new Error("検証請求書の形式が不正です");
    if (
      new Set(d.lines.map((l) => l.sale_id)).size !== d.lines.length ||
      d.lines.some(
        (l) =>
          !strings(l, [
            "sale_id",
            "day",
            "site",
            "quantity",
            "price",
            "amount",
            "slip",
          ]) ||
          !result.sales!.some(
            (s) =>
              s.id === l.sale_id &&
              s.customer_id === d.customer_id &&
              s.delivered_on === l.day &&
              s.delivered_on.startsWith(d.month) &&
              s.quantity_l === l.quantity &&
              s.unit_price_excl_tax === l.price &&
              s.net_amount === l.amount,
          ),
      ) ||
      sumDecimal(d.lines.map((l) => l.amount)) !== d.net ||
      sumDecimal(d.lines.map((l) => l.quantity)) !== d.quantity
    )
      throw new Error("検証請求書の明細・金額が不正です");
    if (d.reference) {
      if (!strings(d.reference, ["quantity", "net", "tax", "gross", "notes"]))
        throw new Error("照合値の形式が不正です");
      for (const key of ["quantity", "net", "tax", "gross"] as const)
        if (d.reference[key]) sumDecimal([d.reference[key]]);
    }
  }
  validateBillingData(result);
  return result;
}
export function backupText(data: Data) {
  return JSON.stringify(
    {
      format: "fujisawa-adblue-local",
      version: 4,
      exported_at: new Date().toISOString(),
      data,
    },
    null,
    2,
  );
}
export function parseBackup(text: string): Data {
  const parsed = JSON.parse(text);
  if (
    parsed?.format !== "fujisawa-adblue-local" ||
    ![2, 3, 4].includes(parsed.version)
  )
    throw new Error("藤沢AdBlueのJSONバックアップを選択してください");
  return localData(parsed.data);
}
