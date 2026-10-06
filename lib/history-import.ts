import type { Data, Customer, Order } from "./domain";
import { validDate } from "./order-import";
import {
  multiplyNet,
  sumDecimal,
  type LocalActual,
  type LocalSale,
} from "./local-flow";
export const columns = {
  day: "給液日",
  customer: "顧客",
  site: "給液場所",
  address: "住所",
  quantity: "給液量",
  price: "単価",
  amount: "金額",
  operator: "担当者",
  slip: "伝票番号",
  notes: "備考",
} as const;
export type HistoryRow = {
  row: number;
  day: string;
  customer: string;
  site: string;
  address: string;
  quantity: string;
  price: string;
  amount: string;
  operator: string;
  slip: string;
  notes: string;
};
export type ReviewRow = HistoryRow & {
  original?: HistoryRow;
  customerId: string;
  siteId: string;
  newCustomer: boolean;
  newSite: boolean;
  include: boolean;
  useSourceAmount: boolean;
  duplicateApproved: boolean;
  approved: boolean;
};
export type ImportMeta = {
  batch_id: string;
  filename: string;
  sheet: string;
  row: number;
  slip: string;
  raw: HistoryRow;
  reviewed: HistoryRow;
  amount_basis: "product" | "source";
  calculated_amount: string;
  duplicate_approved: boolean;
};
export function normalize(v: string) {
  return v.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export function numberText(v: string) {
  return v
    .trim()
    .replace(/[,，]/g, "")
    .replace(/^¥|^￥/, "");
}
export function dayText(v: string) {
  const t = v
    .trim()
    .replace(/[年月/.]/g, "-")
    .replace(/日$/, "");
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : t;
}
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else throw new Error("CSVの引用符が不正です");
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
    if (rows.length > 2001 || row.length > 100)
      throw new Error("1回2000行・100列までのファイルに分けてください");
  }
  if (quoted) throw new Error("CSVの引用符が閉じていません");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function mappedRows(
  table: string[][],
  header: number,
  mapping: Record<keyof typeof columns, number>,
): ReviewRow[] {
  if (table.length - header - 1 > 2000) throw new Error("1回2000行までです");
  return table
    .slice(header + 1)
    .map((cells, i) => {
      const values = Object.fromEntries(
        Object.keys(columns).map((k) => [
          k,
          cells[mapping[k as keyof typeof columns]]?.trim() || "",
        ]),
      ) as Omit<HistoryRow, "row">;
      return {
        ...values,
        row: header + i + 2,
        day: dayText(values.day),
        quantity: numberText(values.quantity),
        price: numberText(values.price),
        amount: numberText(values.amount),
        original: { ...values, row: header + i + 2 },
        customerId: "",
        siteId: "",
        newCustomer: false,
        newSite: false,
        include: true,
        useSourceAmount: false,
        duplicateApproved: false,
        approved: false,
      };
    })
    .filter((r) =>
      Object.keys(columns).some((k) => r[k as keyof typeof columns]),
    );
}
export function customerMatches(data: Data, name: string): Customer[] {
  const n = normalize(name);
  return n
    ? data.customers.filter(
        (c) =>
          c.active &&
          [c.name, c.company_name || ""].some(
            (v) =>
              normalize(v) === n ||
              normalize(v).includes(n) ||
              (n.includes(normalize(v)) && !!v),
          ),
      )
    : [];
}
export function duplicateReasons(
  data: Data,
  r: ReviewRow,
  others: ReviewRow[],
): string[] {
  const result: string[] = [];
  for (const a of data.actuals || []) {
    const o = data.orders.find((o) => o.id === a.order_id);
    if (!o) continue;
    const c = data.customers.find((c) => c.id === o.customer_id);
    if (
      r.customerId
        ? o.customer_id !== r.customerId
        : ![c?.name || "", c?.company_name || ""].some(
            (n) => !!n && normalize(n) === normalize(r.customer),
          )
    )
      continue;
    const sameDay = a.delivered_on === r.day,
      sameSlip =
        !!r.slip && normalize(a.import_meta?.slip || "") === normalize(r.slip);
    const sameSite = r.siteId
      ? o.site_id === r.siteId
      : normalize(o.location) === normalize(r.site);
    if (
      sameSlip ||
      (sameDay && sameSite && Number(a.quantity_l) === Number(r.quantity))
    )
      result.push(`登録済み ${o.case_no}`);
  }
  for (const other of others) {
    if (other === r || !other.include) continue;
    const sameCustomer =
      r.customerId && other.customerId
        ? r.customerId === other.customerId
        : normalize(r.customer) === normalize(other.customer);
    if (
      sameCustomer &&
      ((!!r.slip && normalize(r.slip) === normalize(other.slip)) ||
        (r.day === other.day &&
          normalize(r.site) === normalize(other.site) &&
          Number(r.quantity) === Number(other.quantity)))
    )
      result.push(`ファイル内 ${other.row}行`);
  }
  return [...new Set(result)];
}
export function rowProblems(
  data: Data,
  r: ReviewRow,
  others: ReviewRow[],
): string[] {
  const errors: string[] = [];
  if (!validDate(r.day)) errors.push("給液日を確認");
  if (
    !r.customer.trim() ||
    (!r.newCustomer &&
      !data.customers.some((c) => c.id === r.customerId && c.active))
  )
    errors.push("顧客の紐付けを確認");
  if (
    !r.site.trim() ||
    (!r.newSite &&
      !(data.sites || []).some(
        (s) => s.id === r.siteId && s.customer_id === r.customerId && s.active,
      ))
  )
    errors.push("給液場所の紐付けを確認");
  if (!r.operator.trim())
    errors.push("担当者を確認（資料にない場合は確認未了と入力）");
  try {
    const computed = multiplyNet(r.quantity, r.price);
    if (r.amount) {
      sumDecimal([r.amount]);
      if (
        sumDecimal([computed]) !== sumDecimal([r.amount]) &&
        !r.useSourceAmount
      )
        errors.push(
          "記載金額と数量×単価が不一致。確認または記載金額採用の選択が必要",
        );
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "数値を確認");
  }
  if (duplicateReasons(data, r, others).length && !r.duplicateApproved)
    errors.push("重複候補の確認が必要");
  if (!r.approved) errors.push("行ごとの確認が必要");
  return errors;
}
export function registerHistory(
  data: Data,
  rows: ReviewRow[],
  filename: string,
  sheet: string,
  actor: string,
): Data {
  const selected = rows.filter((r) => r.include);
  if (!selected.length) throw new Error("取込対象がありません");
  for (const r of selected) {
    const errors = rowProblems(data, r, rows);
    if (errors.length) throw new Error(`${r.row}行：${errors.join(" / ")}`);
  }
  const next: Data = {
    ...data,
    customers: [...data.customers],
    sites: [...(data.sites || [])],
    orders: [...data.orders],
    actuals: [...(data.actuals || [])],
    sales: [...(data.sales || [])],
  };
  const now = new Date().toISOString(),
    batch = crypto.randomUUID(),
    createdCustomers = new Map<string, string>(),
    createdSites = new Map<string, string>();
  for (const r of selected) {
    let customerId = r.customerId;
    if (r.newCustomer) {
      const key = normalize(r.customer);
      customerId = createdCustomers.get(key) || crypto.randomUUID();
      if (!createdCustomers.has(key)) {
        next.customers.push({
          id: customerId,
          name: r.customer,
          company_name: "",
          contact: "",
          phone: "",
          address: "",
          notes: `過去実績取込：${filename}`,
          active: true,
        });
        createdCustomers.set(key, customerId);
      }
    }
    let siteId = r.siteId;
    if (r.newSite) {
      const key =
        customerId + "|" + normalize(r.site) + "|" + normalize(r.address);
      siteId = createdSites.get(key) || crypto.randomUUID();
      if (!createdSites.has(key)) {
        next.sites!.push({
          id: siteId,
          customer_id: customerId,
          name: r.site,
          address: r.address,
          contact: "",
          notes: `過去実績取込：${filename}`,
          active: true,
        });
        createdSites.set(key, siteId);
      }
    }
    const id = crypto.randomUUID(),
      product = multiplyNet(r.quantity, r.price),
      amount = r.useSourceAmount && r.amount ? sumDecimal([r.amount]) : product;
    const order: Order = {
      id,
      case_no: `HIST-${r.day.replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`,
      customer_id: customerId,
      site_id: siteId,
      channel: "paper",
      received_at: r.day,
      requested_quantity: null,
      quantity_unit: "L",
      source_text:
        "過去給液履歴から直接取込（受注日は資料にないため管理用日付）",
      location: r.site,
      address: r.address,
      notes: r.notes,
      scheduled_on: null,
      status: "completed",
      created_at: now,
    };
    const meta: ImportMeta = {
      batch_id: batch,
      filename,
      sheet,
      row: r.row,
      slip: r.slip,
      raw:
        r.original ||
        (Object.fromEntries(
          ["row", ...Object.keys(columns)].map((k) => [
            k,
            r[k as keyof HistoryRow],
          ]),
        ) as HistoryRow),
      reviewed: (({
        original,
        customerId,
        siteId,
        newCustomer,
        newSite,
        include,
        useSourceAmount,
        duplicateApproved,
        approved,
        ...raw
      }) => raw)(r),
      amount_basis: r.useSourceAmount && r.amount ? "source" : "product",
      calculated_amount: product,
      duplicate_approved: r.duplicateApproved,
    };
    const actual: LocalActual = {
      id: crypto.randomUUID(),
      order_id: id,
      document_id: "",
      price_id: "",
      source_type: "history",
      import_meta: meta,
      delivered_on: r.day,
      quantity_l: r.quantity,
      unit_price_excl_tax: r.price,
      net_amount: amount,
      performed_by: r.operator,
      notes: r.notes,
      confirmed_by: actor,
      confirmed_at: now,
    };
    const sale: LocalSale = {
      id: crypto.randomUUID(),
      order_id: id,
      actual_id: actual.id,
      customer_id: customerId,
      delivered_on: r.day,
      quantity_l: r.quantity,
      unit_price_excl_tax: r.price,
      net_amount: amount,
      billing_status: "unbilled",
      billed_at: null,
      billed_by: null,
      billing_note: "",
    };
    next.orders.push(order);
    next.actuals!.push(actual);
    next.sales!.push(sale);
  }
  return next;
}
export type InvoiceLine = {
  sale_id: string;
  day: string;
  site: string;
  quantity: string;
  price: string;
  amount: string;
  slip: string;
};
export type DraftInvoice = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_address: string;
  month: string;
  created_at: string;
  created_by: string;
  lines: InvoiceLine[];
  quantity: string;
  net: string;
  tax: null;
  gross: null;
  rules_status: "pending";
  superseded_at?: string;
  reference?: {
    quantity: string;
    net: string;
    tax: string;
    gross: string;
    notes: string;
  };
};
export function createDrafts(
  data: Data,
  month: string,
  ids: string[],
  actor: string,
  replace = false,
): Data {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("対象月を確認してください");
  const drafts: DraftInvoice[] = [];
  let previous = [...(data.invoiceDrafts || [])];
  for (const id of [...new Set(ids)]) {
    const c = data.customers.find((c) => c.id === id);
    if (!c) throw new Error("請求先を確認してください");
    const sales = (data.sales || [])
      .filter((s) => s.customer_id === id && s.delivered_on.startsWith(month))
      .sort((a, b) => a.delivered_on.localeCompare(b.delivered_on));
    if (!sales.length) continue;
    if (
      !replace &&
      (data.invoiceDrafts || []).some(
        (d) => d.customer_id === id && d.month === month && !d.superseded_at,
      )
    )
      throw new Error(
        `${c.name}の${month}検証請求書は作成済みです。既存の検証請求書を確認してください。`,
      );
    if (replace)
      previous = previous.map((d) =>
        d.customer_id === id && d.month === month && !d.superseded_at
          ? { ...d, superseded_at: new Date().toISOString() }
          : d,
      );
    const lines = sales.map((s) => {
      const o = data.orders.find((o) => o.id === s.order_id),
        a = (data.actuals || []).find((a) => a.id === s.actual_id);
      return {
        sale_id: s.id,
        day: s.delivered_on,
        site: o?.location || "",
        quantity: s.quantity_l,
        price: s.unit_price_excl_tax,
        amount: s.net_amount,
        slip: a?.import_meta?.slip || "",
      };
    });
    drafts.push({
      id: crypto.randomUUID(),
      customer_id: id,
      customer_name: c.company_name || c.name,
      customer_address: c.address,
      month,
      created_at: new Date().toISOString(),
      created_by: actor,
      lines,
      quantity: sumDecimal(lines.map((l) => l.quantity)),
      net: sumDecimal(lines.map((l) => l.amount)),
      tax: null,
      gross: null,
      rules_status: "pending",
    });
  }
  if (!drafts.length) throw new Error("対象の売上がありません");
  return { ...data, invoiceDrafts: [...previous, ...drafts] };
}
