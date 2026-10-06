export type Customer = {
  id: string;
  name: string;
  company_name?: string;
  contact: string;
  phone: string;
  address: string;
  notes: string;
  active: boolean;
  version?: number;
};
export type Price = {
  id: string;
  customer_id: string;
  amount: number;
  unit: string;
  tax_basis: "unknown" | "exclusive" | "inclusive";
  effective_from: string;
  note: string;
  created_at: string;
  revision?: number;
};
export type Order = {
  id: string;
  case_no: string;
  customer_id: string;
  channel: "line" | "phone" | "fax" | "paper" | "image" | "email";
  received_at: string;
  requested_quantity: number | null;
  quantity_unit: string;
  source_text: string;
  location: string;
  site_id?: string | null;
  given_on?: string | null;
  address?: string;
  contact?: string;
  requested_on?: string | null;
  notes: string;
  scheduled_on: string | null;
  status:
    | "new"
    | "scheduled"
    | "document_pending"
    | "awaiting_document"
    | "completed"
    | "cancelled";
  version?: number;
  created_at: string;
};
export type Document = {
  id: string;
  order_id: string;
  path: string;
  filename: string;
  review_status: "pending" | "confirmed";
  created_at: string;
};
export type Audit = {
  id: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string;
  created_at: string;
  detail: string;
};
export type Data = {
  customers: Customer[];
  prices: Price[];
  orders: Order[];
  documents: Document[];
  audit: Audit[];
  schema_version?: number;
  local_revision?: number;
  sites?: import("./local-flow").DeliverySite[];
  actuals?: import("./local-flow").LocalActual[];
  sales?: import("./local-flow").LocalSale[];
  invoiceDrafts?: import("./history-import").DraftInvoice[];
  orderImages?: import("./order-import").SourceImage[];
};
export const emptyData = (): Data => ({
  customers: [],
  prices: [],
  orders: [],
  documents: [],
  audit: [],
});
export function japanDate(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function addDays(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekEnd(day: string) {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  return addDays(day, (7 - weekday) % 7);
}
export function currentPrice(prices: Price[], customer: string, date: string) {
  return prices
    .filter((p) => p.customer_id === customer && p.effective_from <= date)
    .sort(
      (a, b) =>
        b.effective_from.localeCompare(a.effective_from) ||
        (b.revision ?? 0) - (a.revision ?? 0) ||
        b.created_at.localeCompare(a.created_at),
    )[0];
}
export function lineReply(customer: string, day: string, location: string) {
  return `${customer} 様\nいつもお世話になっております。藤沢営業所です。\nAdBlueの給液は${day.replaceAll("-", "/")}を予定しております。${location ? `\n給液場所：${location}` : ""}\n時間帯は別途ご相談させてください。\nよろしくお願いいたします。`;
}
// Extraction is a suggestion only: never selects a customer or commits an order.
export function suggestFromLine(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(L|ℓ|リットル|本|缶|個)/i);
  return {
    quantity: match ? Number(match[1]) : null,
    unit: match ? (/^(l|ℓ|リットル)$/i.test(match[2]) ? "L" : match[2]) : "",
  };
}
export function validateQuantity(value: string) {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(
      "数量は0より大きい数値を入力してください。未定の場合は空欄にしてください。",
    );
  return n;
}
export const statusNames: Record<Order["status"], string> = {
  new: "新規受注",
  scheduled: "給液予定",
  document_pending: "納品書確認待ち",
  awaiting_document: "給液済・納品書待ち",
  completed: "実績・売上登録済",
  cancelled: "取消",
};
export function demoSeed(): Data {
  const today = japanDate();
  const now = new Date().toISOString();
  const c1 = "demo-c1",
    c2 = "demo-c2",
    c3 = "demo-c3";
  return {
    customers: [
      {
        id: c1,
        name: "湘南運送（サンプル）",
        contact: "配送担当",
        phone: "0466-00-0001",
        address: "藤沢市・車庫",
        notes: "サンプルデータです",
        active: true,
      },
      {
        id: c2,
        name: "藤沢建設（サンプル）",
        contact: "現場担当",
        phone: "0466-00-0002",
        address: "藤沢市・資材置場",
        notes: "",
        active: true,
      },
      {
        id: c3,
        name: "辻堂物流（サンプル）",
        contact: "",
        phone: "",
        address: "辻堂・車庫",
        notes: "",
        active: true,
      },
    ],
    prices: [],
    orders: [
      {
        id: "demo-o1",
        case_no: "DEMO-001",
        customer_id: c1,
        channel: "line",
        received_at: today,
        requested_quantity: 200,
        quantity_unit: "L",
        source_text: "AdBlue 200Lをお願いします。",
        location: "藤沢市・車庫",
        notes: "数量は依頼値。実績は未確定",
        scheduled_on: today,
        status: "scheduled",
        created_at: now,
      },
      {
        id: "demo-o2",
        case_no: "DEMO-002",
        customer_id: c2,
        channel: "phone",
        received_at: today,
        requested_quantity: null,
        quantity_unit: "L",
        source_text: "",
        location: "藤沢市・資材置場",
        notes: "日程を調整してください",
        scheduled_on: null,
        status: "new",
        created_at: now,
      },
      {
        id: "demo-o3",
        case_no: "DEMO-003",
        customer_id: c3,
        channel: "line",
        received_at: today,
        requested_quantity: 100,
        quantity_unit: "L",
        source_text: "",
        location: "辻堂・車庫",
        notes: "",
        scheduled_on: addDays(today, 1),
        status: "scheduled",
        created_at: now,
      },
    ],
    documents: [],
    audit: [],
  };
}
