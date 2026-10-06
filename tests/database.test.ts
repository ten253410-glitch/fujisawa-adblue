import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("migration, admin RLS, audit, private document registration and immutable delivery price", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
    await db.exec(readFileSync("supabase/001_initial.sql", "utf8"));
    await db.exec(readFileSync("supabase/002_order_images.sql", "utf8"));
    const tsuchiya = "00000000-0000-0000-0000-000000000001",
      sato = "00000000-0000-0000-0000-000000000002",
      outsider = "00000000-0000-0000-0000-000000000003";
    const customer = "10000000-0000-0000-0000-000000000001",
      order = "20000000-0000-0000-0000-000000000001",
      doc = "30000000-0000-0000-0000-000000000001";
    await db.exec(
      `insert into auth.users values('${tsuchiya}'),('${sato}'),('${outsider}'); insert into public.memberships(user_id,display_name) values('${tsuchiya}','土屋'),('${sato}','佐藤'); set role authenticated; set request.jwt.claim.sub='${tsuchiya}';`,
    );
    await db.exec(
      `insert into public.customers(id,name) values('${customer}','検証顧客'); insert into public.customer_prices(customer_id,amount,effective_from) values('${customer}',100,'2026-01-01'),('${customer}',110,'2026-10-01'),('${customer}',120,'2026-10-01'); insert into public.orders(id,case_no,customer_id,channel,received_at,quantity_unit) values('${order}','TEST-1','${customer}','phone','2026-10-06','L');`,
    );
    const logs = await db.query<{ actor_name: string }>(
      `select actor_name from public.audit_logs where entity='customer_prices'`,
    );
    assert.equal(logs.rows.length, 3);
    assert.ok(logs.rows.every((r) => r.actor_name === "土屋"));
    await assert.rejects(db.exec(`update public.customer_prices set amount=1`));
    await assert.rejects(
      db.exec(
        `insert into public.audit_logs(actor_name,action,entity,entity_id,changes) values('偽造','INSERT','customers','fake','{}')`,
      ),
    );
    await assert.rejects(
      db.exec(
        `update public.orders set status='completed' where id='${order}'`,
      ),
    );
    await assert.rejects(
      db.exec(
        `insert into public.memberships(user_id,display_name) values('${outsider}','土屋')`,
      ),
    );
    await assert.rejects(
      db.exec(
        `select public.register_document('${doc}','${order}','${order}/test.jpg','test.jpg')`,
      ),
    );
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('delivery-documents','${order}/test.jpg'); select public.register_document('${doc}','${order}','${order}/test.jpg','test.jpg');`,
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          `select status from public.orders where id='${order}'`,
        )
      ).rows[0].status,
      "document_pending",
    );
    await assert.rejects(
      db
        .exec(
          `delete from storage.objects where name='${order}/test.jpg' returning *`,
        )
        .then((r) => {
          if ((r as any)[0]?.rows?.length === 0) throw new Error("RLS blocked");
        }),
    );
    await db.exec(
      `set request.jwt.claim.sub='${sato}'; update public.customers set notes='佐藤変更' where id='${customer}';`,
    );
    const stale = await db.query(
      `update public.customers set notes='古い版' where id='${customer}' and version=1 returning id`,
    );
    assert.equal(stale.rows.length, 0);
    assert.equal(
      (
        await db.query<{ actor_name: string }>(
          `select actor_name from public.audit_logs where action='UPDATE' and entity='customers'`,
        )
      ).rows[0].actor_name,
      "佐藤",
    );
    await db.exec(`set request.jwt.claim.sub='${tsuchiya}';`);
    const imageId = "40000000-0000-0000-0000-000000000001",
      importedId = "50000000-0000-0000-0000-000000000001";
    const imagePath = `${tsuchiya}/${imageId}.jpg`;
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('order-images','${imagePath}');`,
    );
    const imageOrder = {
      id: importedId,
      case_no: "IMAGE-1",
      customer_id: customer,
      channel: "fax",
      received_at: "2026-10-06",
      requested_quantity: 250,
      location: "現場",
      address: "藤沢市",
      contact: "担当 0466-00-0001",
      requested_on: "2026-10-08",
      scheduled_on: null,
      notes: "確認済み",
    };
    await assert.rejects(
      db.query(
        `select public.register_image_order($1,$2,$3,'fax.jpg','{}','{}',false,null)`,
        [JSON.stringify(imageOrder), imageId, imagePath],
      ),
    );
    assert.equal(
      (
        await db.query(
          `select status,scheduled_on,requested_on::text,requested_quantity from public.orders where id='${importedId}'`,
        )
      ).rows.length,
      0,
    );
    await db.query(
      `select public.register_image_order($1,$2,$3,'fax.jpg',$4,$5,true,null)`,
      [
        JSON.stringify(imageOrder),
        imageId,
        imagePath,
        JSON.stringify({ fields: { quantity_l: 200 }, method: "openai" }),
        JSON.stringify({ quantity_l: 250 }),
      ],
    );
    const imported = (
      await db.query<{
        status: string;
        scheduled_on: null;
        requested_on: string;
        requested_quantity: string;
      }>(
        `select status,scheduled_on,requested_on::text,requested_quantity from public.orders where id='${importedId}'`,
      )
    ).rows[0];
    assert.equal(imported.status, "new");
    assert.equal(imported.scheduled_on, null);
    assert.equal(imported.requested_on, "2026-10-08");
    assert.equal(Number(imported.requested_quantity), 250);
    assert.equal(
      (
        await db.query<{ reviewed_by: string }>(
          `select reviewed_by from public.order_source_images`,
        )
      ).rows[0].reviewed_by,
      tsuchiya,
    );
    await assert.rejects(
      db.exec(`update public.order_source_images set filename='fake'`),
    );
    await db.exec(
      `select public.consume_order_ocr_quota();select public.consume_order_ocr_quota();select public.consume_order_ocr_quota();select public.consume_order_ocr_quota();select public.consume_order_ocr_quota();`,
    );
    await assert.rejects(db.exec(`select public.consume_order_ocr_quota()`));
    await db.exec(`set request.jwt.claim.sub='${outsider}';`);
    assert.equal(
      (await db.query(`select * from public.customers`)).rows.length,
      0,
    );
    assert.equal(
      (await db.query(`select * from storage.objects`)).rows.length,
      0,
    );
    assert.equal(
      (await db.query(`select * from public.order_source_images`)).rows.length,
      0,
    );
    await assert.rejects(db.exec(`select public.consume_order_ocr_quota()`));
    await assert.rejects(
      db.exec(`insert into public.customers(name) values('不正')`),
    );
    await db.exec(`reset role; set request.jwt.claim.sub='${tsuchiya}'; update public.delivery_documents set review_status='confirmed' where id='${doc}';
 insert into public.delivery_actuals(order_id,document_id,delivered_on,quantity_l) values('${order}','${doc}','2026-10-06',123.45);`);
    const actual = (
      await db.query<{ unit_price_excl_tax: string; net_amount: string }>(
        `select unit_price_excl_tax,net_amount from public.delivery_actuals`,
      )
    ).rows[0];
    assert.equal(Number(actual.unit_price_excl_tax), 120);
    assert.equal(Number(actual.net_amount), 14814);
    await db.exec(
      `insert into public.customer_prices(customer_id,amount,effective_from) values('${customer}',200,'2026-01-01');`,
    );
    assert.equal(
      Number(
        (
          await db.query<{ unit_price_excl_tax: string }>(
            `select unit_price_excl_tax from public.delivery_actuals`,
          )
        ).rows[0].unit_price_excl_tax,
      ),
      120,
    );
    await assert.rejects(
      db.exec(`update public.delivery_actuals set quantity_l=999`),
    );
    await db.exec(
      `update public.orders set status='completed' where id='${order}'`,
    );
    await assert.rejects(
      db.exec(
        `update public.orders set customer_id=gen_random_uuid() where id='${order}'`,
      ),
    );
    await assert.rejects(
      db.exec(
        `insert into public.invoices(customer_id,billing_month,status) values('${customer}','2026-10-01','issued')`,
      ),
    );
  } finally {
    await db.close();
  }
});
