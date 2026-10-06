-- Apply once to a new Supabase project using the SQL editor or migrations.
begin;
create table public.memberships (
 user_id uuid primary key references auth.users(id), display_name text not null check (display_name in ('土屋','佐藤')),
 role text not null default 'admin' check (role = 'admin'), unique(display_name)
);
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.memberships where user_id = auth.uid() and role = 'admin');
$$;
create table public.customers (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) > 0), contact text not null default '', phone text not null default '',
 address text not null default '', notes text not null default '', active boolean not null default true, version integer not null default 1, created_at timestamptz not null default now()
);
create table public.customer_prices (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 amount numeric(14,4) not null check(amount >= 0), unit text not null default 'L' check(unit = 'L'),
 tax_basis text not null default 'exclusive' check(tax_basis = 'exclusive'), effective_from date not null, note text not null default '',
 revision bigint generated always as identity unique, created_at timestamptz not null default now()
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), case_no text not null unique, customer_id uuid not null references public.customers(id),
 channel text not null check(channel in ('line','phone')), received_at date not null,
 requested_quantity numeric(14,4) check(requested_quantity > 0), quantity_unit text not null default 'L' check(quantity_unit = 'L'),
 source_text text not null default '', location text not null default '', notes text not null default '', scheduled_on date,
 status text not null default 'new' check(status in ('new','scheduled','document_pending','completed','cancelled')),
 version integer not null default 1, created_at timestamptz not null default now(), check(status <> 'scheduled' or scheduled_on is not null)
);
create table public.delivery_documents (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), path text not null unique,
 filename text not null, review_status text not null default 'pending' check(review_status in ('pending','confirmed')),
 created_at timestamptz not null default now(), check(path like order_id::text || '/%')
);
-- Phase 2: OCR output is an untrusted suggestion, never an actual quantity.
create table public.extraction_candidates (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), document_id uuid references public.delivery_documents(id),
 source_kind text not null check(source_kind in ('line_screenshot','delivery_document')), proposed_fields jsonb not null default '{}',
 review_status text not null default 'pending' check(review_status in ('pending','accepted','rejected')), reviewed_by uuid references public.memberships(user_id),
 created_at timestamptz not null default now()
);
-- Phase 3: exactly one confirmed actual per case in this initial workflow.
-- The actual date (not the planned date) chooses the price. A DB trigger snapshots it.
create table public.delivery_actuals (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id), document_id uuid not null references public.delivery_documents(id),
 delivered_on date not null, quantity_l numeric(14,4) not null check(quantity_l > 0), price_id uuid not null references public.customer_prices(id),
 unit_price_excl_tax numeric(14,4) not null, net_amount numeric(28,8) not null, tax_rate numeric(4,3) not null default 0.10 check(tax_rate = 0.10),
 confirmed_by uuid not null references public.memberships(user_id), confirmed_at timestamptz not null default now()
);
create table public.billing_settings (
 id boolean primary key default true check(id), tax_rate numeric(4,3) not null default 0.10 check(tax_rate = 0.10),
 rounding_mode text check(rounding_mode in ('floor','round','ceil')), tax_scope text check(tax_scope in ('invoice','line')),
 net_rounding_mode text check(net_rounding_mode in ('floor','round','ceil')), verified_inout boolean not null default false
);
insert into public.billing_settings(id) values(true);
create table public.invoices (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id), billing_month date not null,
 status text not null default 'draft' check(status in ('draft','issued','void')), invoice_no text unique,
 calculation_policy_snapshot jsonb, issued_by uuid references public.memberships(user_id), issued_at timestamptz, created_at timestamptz not null default now()
);
create table public.sales (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id), actual_id uuid not null unique references public.delivery_actuals(id),
 invoice_id uuid references public.invoices(id), quantity_l numeric(14,4) not null, unit_price_excl_tax numeric(14,4) not null,
 net_amount numeric(28,8) not null, tax_rate numeric(4,3) not null check(tax_rate = 0.10), created_at timestamptz not null default now()
);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id), actor_name text not null,
 action text not null, entity text not null, entity_id text not null, changes jsonb not null, created_at timestamptz not null default now()
);
create function public.bump_version() returns trigger language plpgsql set search_path = '' as $$
begin new.version := old.version + 1; return new; end $$;
create trigger customer_version before update on public.customers for each row execute function public.bump_version();
create trigger order_version before update on public.orders for each row execute function public.bump_version();
create function public.guard_order_state() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'UPDATE' and exists(select 1 from public.delivery_actuals where order_id=old.id) and
 (new.status <> 'completed' or (to_jsonb(new)-'status'-'version') is distinct from (to_jsonb(old)-'status'-'version')) then
  raise exception 'Confirmed delivery case requires a reviewed correction workflow';
 end if;
 if new.status='completed' and not exists(select 1 from public.delivery_actuals where order_id=new.id) then
  raise exception 'Confirmed actual required before completing a case';
 end if;
 if new.status <> 'cancelled' and exists(select 1 from public.delivery_documents where order_id=new.id and review_status='pending') then
  new.status := 'document_pending';
 end if;
 return new;
end $$;
create trigger order_state_guard before insert or update on public.orders for each row execute function public.guard_order_state();
create index orders_schedule on public.orders(scheduled_on) where status not in ('cancelled','completed');
create index prices_effective on public.customer_prices(customer_id,effective_from desc,revision desc);
create index orders_customer on public.orders(customer_id);
create index documents_order on public.delivery_documents(order_id);
create index audit_created on public.audit_logs(created_at desc);
create function public.record_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare actor text;
begin
 select display_name into actor from public.memberships where user_id = auth.uid();
 insert into public.audit_logs(actor_id,actor_name,action,entity,entity_id,changes)
 values(auth.uid(),coalesce(actor,'システム / SQL管理者'),tg_op,tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'user_id',to_jsonb(old)->>'id',to_jsonb(old)->>'user_id'),
 jsonb_build_object('before',case when tg_op = 'INSERT' then null else to_jsonb(old) end,'after',case when tg_op = 'DELETE' then null else to_jsonb(new) end));
 return coalesce(new,old);
end $$;
create function public.reject_history_change() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Confirmed history is immutable; use a reviewed correction workflow'; end $$;
create trigger immutable_price before update or delete on public.customer_prices for each row execute function public.reject_history_change();
create trigger immutable_actual before update or delete on public.delivery_actuals for each row execute function public.reject_history_change();
create trigger immutable_sale before update of order_id,actual_id,quantity_l,unit_price_excl_tax,net_amount,tax_rate or delete on public.sales for each row execute function public.reject_history_change();
create function public.snapshot_actual() returns trigger language plpgsql set search_path = '' as $$
declare p public.customer_prices; c uuid; d uuid;
begin
 if not public.is_admin() then raise exception 'Admin membership required'; end if;
 select customer_id into c from public.orders where id=new.order_id and status not in ('cancelled','completed') for update;
 if c is null then raise exception 'Active case not found'; end if;
 select order_id into d from public.delivery_documents where id=new.document_id and review_status='confirmed';
 if d is distinct from new.order_id then raise exception 'A reviewed document belonging to this case is required'; end if;
 select * into p from public.customer_prices where customer_id=c and effective_from<=new.delivered_on order by effective_from desc,revision desc limit 1;
 if p.id is null then raise exception 'No price effective on actual delivery date'; end if;
 new.price_id := p.id; new.unit_price_excl_tax := p.amount; new.net_amount := new.quantity_l*p.amount; new.tax_rate := 0.10;
 new.confirmed_by := auth.uid(); new.confirmed_at := now(); return new;
end $$;
create trigger snapshot_actual before insert on public.delivery_actuals for each row execute function public.snapshot_actual();
-- Reserved future tables are read-only to browser clients until their full workflows exist.
create function public.prevent_unverified_invoice() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.status='issued' and not exists(select 1 from public.billing_settings where verified_inout and rounding_mode is not null and tax_scope is not null and net_rounding_mode is not null) then
 raise exception 'INOUT rounding and tax scope must be verified before issuing invoices'; end if; return new;
end $$;
create trigger invoice_guard before insert or update on public.invoices for each row execute function public.prevent_unverified_invoice();

do $$ declare t text; begin
 foreach t in array array['memberships','customers','customer_prices','orders','delivery_documents','extraction_candidates','delivery_actuals','sales','invoices','billing_settings','audit_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using (public.is_admin())',t);
 end loop;
 foreach t in array array['customers','orders'] loop
 execute format('grant insert, update on public.%I to authenticated',t);
 execute format('create policy admin_insert on public.%I for insert to authenticated with check (public.is_admin())',t);
 execute format('create policy admin_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',t);
 end loop;
 grant insert on public.customer_prices to authenticated;
 create policy admin_price_insert on public.customer_prices for insert to authenticated with check(public.is_admin());
 foreach t in array array['memberships','customers','customer_prices','orders','delivery_documents','extraction_candidates','delivery_actuals','sales','invoices','billing_settings'] loop
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.record_audit()',t);
 end loop;
end $$;
-- Atomic metadata registration + case state change. Browser cannot forge a confirmed document.
create function public.register_document(p_id uuid,p_order_id uuid,p_path text,p_filename text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_admin() then raise exception 'Admin membership required'; end if;
 perform 1 from public.orders where id=p_order_id and status not in ('cancelled','completed') for update;
 if not found then raise exception 'Active case not found'; end if;
 if p_path not like p_order_id::text || '/%' then raise exception 'Invalid document path'; end if;
 if not exists(select 1 from storage.objects where bucket_id='delivery-documents' and name=p_path) then raise exception 'Uploaded object not found'; end if;
 insert into public.delivery_documents(id,order_id,path,filename) values(p_id,p_order_id,p_path,p_filename);
 update public.orders set status='document_pending' where id=p_order_id;
end $$;
revoke all on function public.register_document(uuid,uuid,text,text) from public,anon;
grant execute on function public.register_document(uuid,uuid,text,text) to authenticated;
revoke all on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated;
-- Trigger-only functions must not be callable by ordinary clients.
revoke all on function public.record_audit(),public.reject_history_change(),public.snapshot_actual(),public.prevent_unverified_invoice(),public.bump_version(),public.guard_order_state() from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('delivery-documents','delivery-documents',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy document_read on storage.objects for select to authenticated using(bucket_id='delivery-documents' and public.is_admin());
create policy document_upload on storage.objects for insert to authenticated with check(bucket_id='delivery-documents' and public.is_admin() and exists(select 1 from public.orders where id::text=(storage.foldername(name))[1] and status not in ('cancelled','completed')));
-- Cleanup is allowed only for orphan uploads, never a registered delivery document.
create policy document_orphan_cleanup on storage.objects for delete to authenticated using(bucket_id='delivery-documents' and public.is_admin() and not exists(select 1 from public.delivery_documents where path=name));
commit;
