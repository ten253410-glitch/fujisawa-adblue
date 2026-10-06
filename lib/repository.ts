import { supabase } from "./supabase";
import { Data, emptyData } from "./domain";
export async function loadRemote(): Promise<Data> {
  if (!supabase) throw new Error("Supabase未設定");
  const client = supabase;
  const tables = [
    "customers",
    "customer_prices",
    "orders",
    "delivery_documents",
    "audit_logs",
  ];
  const results = await Promise.all(
    tables.map(async (t) => {
      const rows = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const result = await client
          .from(t)
          .select("*")
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        rows.push(...result.data);
        if (result.data.length < pageSize) break;
      }
      return { data: rows };
    }),
  );
  const d = emptyData();
  d.customers = results[0].data!;
  d.prices = results[1].data!;
  d.orders = results[2].data!;
  d.documents = results[3].data!;
  d.audit = results[4].data!.map((a) => ({
    id: a.id,
    actor_name: a.actor_name,
    action: a.action,
    entity: a.entity,
    entity_id: a.entity_id,
    created_at: a.created_at,
    detail: JSON.stringify(a.changes),
  }));
  d.orderImages = [];
  for (let offset = 0; ; offset += 500) {
    const images = await client
      .from("order_source_images")
      .select("*")
      .order("id")
      .range(offset, offset + 499);
    if (images.error) {
      if (["42P01", "PGRST205"].includes(images.error.code)) break;
      throw images.error;
    }
    d.orderImages.push(...images.data);
    if (images.data.length < 500) break;
  }
  return d;
}
export async function writeRemote(
  table: string,
  values: object,
  updateId?: string,
) {
  if (!supabase) throw new Error("Supabase未設定");
  let query;
  if (updateId) {
    const version = (values as { version?: number }).version;
    if (version === undefined)
      throw new Error("データの版が不明です。最新データを取得してください。");
    query = supabase
      .from(table)
      .update(values)
      .eq("id", updateId)
      .eq("version", version);
  } else query = supabase.from(table).insert(values);
  const result = await query.select().maybeSingle();
  if (result.error) throw result.error;
  if (!result.data)
    throw new Error(
      "他の管理者が更新しました。最新データを取得し、変更内容を確認して再保存してください。",
    );
  return result.data;
}
