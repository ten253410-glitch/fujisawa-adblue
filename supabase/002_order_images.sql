-- Additive migration: apply after 001_initial.sql. Existing orders remain unchanged.
begin;
alter table public.orders drop constraint orders_channel_check;
alter table public.orders add constraint orders_channel_check check(channel in ('line','phone','fax','paper','image'));
alter table public.orders add column address text not null default '';
alter table public.orders add column contact text not null default '';
alter table public.orders add column requested_on date;
create table public.order_source_images (
 id uuid primary key, order_id uuid not null references public.orders(id), path text not null unique, filename text not null,
 extracted jsonb not null check(jsonb_typeof(extracted)='object'), reviewed jsonb not null check(jsonb_typeof(reviewed)='object'),
 reviewed_by uuid not null references public.memberships(user_id), reviewed_at timestamptz not null default now()
);
create index order_source_case on public.order_source_images(order_id);
alter table public.order_source_images enable row level security;
revoke all on public.order_source_images from anon,authenticated;
grant select on public.order_source_images to authenticated;
create policy order_source_read on public.order_source_images for select to authenticated using(public.is_admin());
create trigger order_source_audit after insert on public.order_source_images for each row execute function public.record_audit();
create trigger order_source_immutable before update or delete on public.order_source_images for each row execute function public.reject_history_change();
create table public.order_ocr_usage (user_id uuid not null references public.memberships(user_id), minute timestamptz not null, requests integer not null check(requests between 1 and 5), primary key(user_id,minute));
alter table public.order_ocr_usage enable row level security;
revoke all on public.order_ocr_usage from public,anon,authenticated;
create function public.consume_order_ocr_quota() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Admin membership required'; end if;
 insert into public.order_ocr_usage(user_id,minute,requests) values(auth.uid(),date_trunc('minute',now()),1)
 on conflict(user_id,minute) do update set requests=public.order_ocr_usage.requests+1 where public.order_ocr_usage.requests<5;
 if not found then raise exception 'OCR rate limit reached'; end if;
end $$;
revoke all on function public.consume_order_ocr_quota() from public,anon;
grant execute on function public.consume_order_ocr_quota() to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('order-images','order-images',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy order_image_read on storage.objects for select to authenticated using(bucket_id='order-images' and public.is_admin());
create policy order_image_upload on storage.objects for insert to authenticated with check(bucket_id='order-images' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text);
create policy order_image_cleanup on storage.objects for delete to authenticated using(bucket_id='order-images' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.order_source_images where path=name));
create function public.register_image_order(p_order jsonb,p_image_id uuid,p_path text,p_filename text,p_extracted jsonb,p_reviewed jsonb,p_confirmed boolean,p_new_customer jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare case_id uuid; customer_id uuid; planned date;
begin
 if not public.is_admin() then raise exception 'Admin membership required'; end if;
 if p_confirmed is distinct from true then raise exception 'Human confirmation required'; end if;
 if jsonb_typeof(p_extracted) is distinct from 'object' or jsonb_typeof(p_reviewed) is distinct from 'object' then raise exception 'Read and reviewed data required'; end if;
 if p_path not like auth.uid()::text || '/' || p_image_id::text || '.%' then raise exception 'Invalid source image path'; end if;
 if not exists(select 1 from storage.objects where bucket_id='order-images' and name=p_path) then raise exception 'Uploaded source image required'; end if;
 case_id := (p_order->>'id')::uuid; customer_id := (p_order->>'customer_id')::uuid; planned := nullif(p_order->>'scheduled_on','')::date;
 if p_new_customer is not null then
  if (p_new_customer->>'id')::uuid is distinct from customer_id then raise exception 'New customer mismatch'; end if;
  insert into public.customers(id,name,contact,phone,address,notes) values(customer_id,p_new_customer->>'name',coalesce(p_new_customer->>'contact',''),coalesce(p_new_customer->>'phone',''),coalesce(p_new_customer->>'address',''),coalesce(p_new_customer->>'notes',''));
 end if;
 if not exists(select 1 from public.customers where id=customer_id and active) then raise exception 'Active customer required'; end if;
 insert into public.orders(id,case_no,customer_id,channel,received_at,requested_quantity,quantity_unit,location,address,contact,requested_on,notes,scheduled_on,status)
 values(case_id,p_order->>'case_no',customer_id,p_order->>'channel',(p_order->>'received_at')::date,(p_order->>'requested_quantity')::numeric,'L',coalesce(p_order->>'location',''),coalesce(p_order->>'address',''),coalesce(p_order->>'contact',''),nullif(p_order->>'requested_on','')::date,coalesce(p_order->>'notes',''),planned,case when planned is null then 'new' else 'scheduled' end);
 insert into public.order_source_images(id,order_id,path,filename,extracted,reviewed,reviewed_by) values(p_image_id,case_id,p_path,p_filename,p_extracted,p_reviewed,auth.uid());
 return case_id;
end $$;
revoke all on function public.register_image_order(jsonb,uuid,text,text,jsonb,jsonb,boolean,jsonb) from public,anon;
grant execute on function public.register_image_order(jsonb,uuid,text,text,jsonb,jsonb,boolean,jsonb) to authenticated;
commit;
