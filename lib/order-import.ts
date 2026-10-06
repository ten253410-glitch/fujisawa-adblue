import { type Customer, type Order, validateQuantity } from "./domain";
export type ReadFields = {
  customer_name: string | null;
  location: string | null;
  address: string | null;
  quantity_l: number | null;
  requested_on: string | null;
  received_on: string | null;
  contact: string | null;
  notes: string | null;
};
export type ReadResult = {
  fields: ReadFields;
  warnings: string[];
  model: string | null;
  method: "openai" | "manual" | "sample";
};
export type SourceImage = {
  id: string;
  order_id: string;
  path: string;
  filename: string;
  extracted: ReadResult;
  reviewed: ReadFields;
  reviewed_by?: string;
  reviewed_at: string;
};
export const blankRead = (): ReadFields => ({
  customer_name: null,
  location: null,
  address: null,
  quantity_l: null,
  requested_on: null,
  received_on: null,
  contact: null,
  notes: null,
});
export function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const date = new Date(v + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
  );
}
export function sanitizeRead(input: unknown): {
  fields: ReadFields;
  warnings: string[];
} {
  if (!input || typeof input !== "object")
    throw new Error("読み取り結果の形式が不正です。手入力で確認してください。");
  const raw = input as Record<string, unknown>,
    fields = blankRead(),
    warnings: string[] = [];
  for (const key of [
    "customer_name",
    "location",
    "address",
    "contact",
    "notes",
  ] as const) {
    if (typeof raw[key] === "string")
      fields[key] = raw[key].trim().slice(0, 2000) || null;
  }
  for (const key of ["requested_on", "received_on"] as const) {
    if (validDate(raw[key])) fields[key] = raw[key];
    else if (raw[key] != null)
      warnings.push(
        `${key === "requested_on" ? "希望給液日" : "受注日"}の形式が不明です。原画像で確認してください。`,
      );
  }
  if (
    typeof raw.quantity_l === "number" &&
    Number.isFinite(raw.quantity_l) &&
    raw.quantity_l > 0
  )
    fields.quantity_l = raw.quantity_l;
  else if (raw.quantity_l != null)
    warnings.push("依頼数量をL単位で確認してください。");
  if (Array.isArray(raw.warnings))
    warnings.push(
      ...raw.warnings
        .filter((w): w is string => typeof w === "string")
        .slice(0, 20)
        .map((w) => w.slice(0, 500)),
    );
  return { fields, warnings };
}
export function validateReviewed(fields: ReadFields) {
  if (!fields.customer_name?.trim())
    throw new Error("顧客名を確認してください");
  if (!validDate(fields.received_on))
    throw new Error("受注日を確認して入力してください");
  if (fields.requested_on && !validDate(fields.requested_on))
    throw new Error("希望給液日を確認してください");
  validateQuantity(fields.quantity_l === null ? "" : String(fields.quantity_l));
}
function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /株式会社|有限会社|合同会社|\(株\)|\(有\)|\(サンプル\)|[\s・‐―ー-]/g,
      "",
    );
}
export function customerCandidates(customers: Customer[], fields: ReadFields) {
  const name = normalized(fields.customer_name || "");
  const phone = (fields.contact || "").replace(/\D/g, "");
  return customers
    .filter((c) => c.active)
    .map((customer) => {
      let score = 0;
      const reasons: string[] = [];
      const n = normalized(customer.name);
      if (name && n && name === n) {
        score += 5;
        reasons.push("顧客名が一致");
      } else if (
        name.length >= 2 &&
        n.length >= 2 &&
        (n.includes(name) || name.includes(n))
      ) {
        score += 2;
        reasons.push("顧客名が類似");
      }
      const p = customer.phone.replace(/\D/g, "");
      if (p.length >= 8 && phone.includes(p)) {
        score += 4;
        reasons.push("電話番号が一致");
      }
      const address = normalized(customer.address);
      if (
        address.length >= 4 &&
        [fields.location, fields.address].some(
          (v) => v && normalized(v).includes(address),
        )
      ) {
        score++;
        reasons.push("登録場所と一致");
      }
      return { customer, score, reasons };
    })
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.customer.name.localeCompare(b.customer.name, "ja"),
    )
    .slice(0, 5);
}
export function importedOrder(
  fields: ReadFields,
  customerId: string,
  channel: Order["channel"],
  scheduledOn: string | null,
): Order {
  validateReviewed(fields);
  if (scheduledOn && !validDate(scheduledOn))
    throw new Error("確定した給液予定日の形式が不正です");
  const id = crypto.randomUUID();
  return {
    id,
    case_no: `FA-${fields.received_on!.replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`,
    customer_id: customerId,
    channel,
    received_at: fields.received_on!,
    requested_quantity: fields.quantity_l,
    quantity_unit: "L",
    source_text: "",
    location: fields.location || "",
    address: fields.address || "",
    contact: fields.contact || "",
    requested_on: fields.requested_on,
    notes: fields.notes || "",
    scheduled_on: scheduledOn,
    status: scheduledOn ? "scheduled" : "new",
    created_at: new Date().toISOString(),
  };
}
export const readSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    customer_name: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    quantity_l: { type: ["number", "null"] },
    requested_on: { type: ["string", "null"] },
    received_on: { type: ["string", "null"] },
    contact: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "customer_name",
    "location",
    "address",
    "quantity_l",
    "requested_on",
    "received_on",
    "contact",
    "notes",
    "warnings",
  ],
} as const;
