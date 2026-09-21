-- =====================================================================
-- Documents & billing
-- =====================================================================
-- Everything a load or a carrier carries on paper: the company profile
-- that brands outbound documents; generated documents (rate confirmation,
-- BOL, load sheet, invoice) and uploaded ones (POD, carrier invoice...);
-- invoices with their lines; a tokenised link a carrier can upload
-- through without a login; the carrier's own paperwork (agreement,
-- certificates); and their insurance policies with expiry dates.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Company profile - what goes on the letterhead
-- ---------------------------------------------------------------------
alter table public.org_settings
  add column if not exists company jsonb not null default '{}'::jsonb;

comment on column public.org_settings.company is
  'Letterhead: name, address, MC/DOT, phone, email, remit-to, payment terms,
   invoice footer, logo_path (an object in the public branding bucket) and
   the broker-carrier agreement text. Read by the document generators.';

-- ---------------------------------------------------------------------
-- 2. A billing permission. Dispatchers get it by default, viewers do not;
--    admins always have everything.
-- ---------------------------------------------------------------------
update public.org_settings
   set role_permissions = jsonb_set(role_permissions, '{dispatcher,manage_billing}', 'true'::jsonb, true)
 where id = 1
   and role_permissions ? 'dispatcher'
   and role_permissions #> '{dispatcher,manage_billing}' is null;

update public.org_settings
   set role_permissions = jsonb_set(role_permissions, '{viewer,manage_billing}', 'false'::jsonb, true)
 where id = 1
   and role_permissions ? 'viewer'
   and role_permissions #> '{viewer,manage_billing}' is null;

-- ---------------------------------------------------------------------
-- 3. Storage buckets (guarded like tender-uploads so the file still runs
--    on a plain Postgres with no storage schema)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  -- The logo. Public on purpose: it is printed on every document we send
  -- out, and a public URL is what lets the PDF generator and an <img> load it.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg'])
  on conflict (id) do nothing;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'load-documents', 'load-documents', false, 26214400,
    array[
      'application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/heic', 'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream'
    ]
  )
  on conflict (id) do nothing;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'carrier-documents', 'carrier-documents', false, 26214400,
    array[
      'application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/heic', 'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream'
    ]
  )
  on conflict (id) do nothing;
end
$$;

-- ---------------------------------------------------------------------
-- 4. load_documents - every file on a load, generated here or uploaded
-- ---------------------------------------------------------------------
create table if not exists public.load_documents (
  id            uuid primary key default gen_random_uuid(),
  load_id       uuid not null references public.loads(id) on delete cascade,
  kind          text not null check (kind in (
                  'rate_confirmation', 'bol', 'load_sheet', 'invoice',
                  'pod', 'carrier_invoice', 'lumper_receipt', 'scale_ticket', 'other')),
  origin        text not null default 'uploaded' check (origin in ('generated', 'uploaded')),
  file_name     text not null,
  storage_path  text not null unique,
  content_type  text,
  size_bytes    bigint,
  version       integer not null default 1,
  notes         text,
  -- 'carrier_link' rows came in through a tokenised upload link with no login.
  uploaded_via  text not null default 'app' check (uploaded_via in ('app', 'carrier_link')),
  uploaded_by   uuid references public.profiles(id) on delete set null
                  default public.current_profile_id(),
  created_at    timestamptz not null default now()
);

comment on table public.load_documents is
  'The paper on a load. storage_path is an object in the private load-documents
   bucket; the app opens it through a short-lived signed URL.';

create index if not exists load_documents_load_idx
  on public.load_documents (load_id, created_at desc);

-- ---------------------------------------------------------------------
-- 5. Invoices
-- ---------------------------------------------------------------------
create sequence if not exists public.invoice_number_seq as bigint start with 1 increment by 1;

create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,         -- assigned by trigger when null
  load_id        uuid not null references public.loads(id) on delete restrict,
  customer_id    uuid references public.customers(id) on delete restrict,
  status         text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  issued_at      date not null default current_date,
  due_at         date,
  subtotal       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  currency       text not null default 'USD',
  notes          text,
  -- The generated PDF, once it has been produced.
  document_id    uuid references public.load_documents(id) on delete set null,
  sent_at        timestamptz,
  paid_at        timestamptz,
  created_by     uuid references public.profiles(id) on delete set null
                   default public.current_profile_id(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- INV-000001, INV-000002 ... Global like load numbers: short and unique
-- matters more than restarting in January.
create or replace function public.tg_invoices_assign_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.invoice_number is null or btrim(new.invoice_number) = '' then
    new.invoice_number := 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_assign_number on public.invoices;
create trigger invoices_assign_number
  before insert on public.invoices
  for each row execute function public.tg_invoices_assign_number();

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create index if not exists invoices_load_idx     on public.invoices (load_id);
create index if not exists invoices_customer_idx on public.invoices (customer_id);
create index if not exists invoices_status_idx   on public.invoices (status, issued_at desc);

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity    numeric(12,2) not null default 1,
  rate        numeric(12,2),
  amount      numeric(12,2) not null,
  sort_order  integer not null default 0
);

create index if not exists invoice_lines_invoice_idx
  on public.invoice_lines (invoice_id, sort_order);

-- ---------------------------------------------------------------------
-- 6. Carrier upload links - "send them a link, they drop the POD"
-- ---------------------------------------------------------------------
-- The token is the whole authorisation for the upload-document Edge
-- Function, so it is long and random, expires, and can be revoked.
create table if not exists public.load_upload_links (
  id          uuid primary key default gen_random_uuid(),
  load_id     uuid not null references public.loads(id) on delete cascade,
  token       text not null unique
                default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expires_at  timestamptz not null default now() + interval '14 days',
  revoked_at  timestamptz,
  uses        integer not null default 0,
  created_by  uuid references public.profiles(id) on delete set null
                default public.current_profile_id(),
  created_at  timestamptz not null default now()
);

create index if not exists load_upload_links_load_idx on public.load_upload_links (load_id);

-- ---------------------------------------------------------------------
-- 7. Carrier documents and insurance
-- ---------------------------------------------------------------------
create table if not exists public.carrier_documents (
  id           uuid primary key default gen_random_uuid(),
  carrier_id   uuid not null references public.carriers(id) on delete cascade,
  kind         text not null check (kind in (
                 'broker_carrier_agreement', 'insurance_certificate', 'w9', 'authority', 'other')),
  file_name    text not null,
  storage_path text not null unique,
  content_type text,
  size_bytes   bigint,
  signed_at    date,
  expires_at   date,
  notes        text,
  uploaded_by  uuid references public.profiles(id) on delete set null
                 default public.current_profile_id(),
  created_at   timestamptz not null default now()
);

create index if not exists carrier_documents_carrier_idx
  on public.carrier_documents (carrier_id, created_at desc);

create table if not exists public.carrier_insurance (
  id                      uuid primary key default gen_random_uuid(),
  carrier_id              uuid not null references public.carriers(id) on delete cascade,
  coverage                text not null check (coverage in (
                            'auto_liability', 'cargo', 'general_liability', 'workers_comp', 'other')),
  insurer                 text,
  policy_number           text,
  coverage_amount         numeric(14,2),
  deductible              numeric(12,2),
  effective_at            date,
  expires_at              date,
  certificate_document_id uuid references public.carrier_documents(id) on delete set null,
  agent_name              text,
  agent_phone             text,
  agent_email             text,
  notes                   text,
  created_by              uuid references public.profiles(id) on delete set null
                            default public.current_profile_id(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists carrier_insurance_carrier_idx on public.carrier_insurance (carrier_id);
create index if not exists carrier_insurance_expires_idx on public.carrier_insurance (expires_at);

drop trigger if exists carrier_insurance_set_updated_at on public.carrier_insurance;
create trigger carrier_insurance_set_updated_at
  before update on public.carrier_insurance
  for each row execute function public.set_updated_at();

-- One row per carrier for the list and the profile header: is their
-- paperwork current? A policy with no expiry date counts as current.
create or replace view public.v_carrier_insurance_status
with (security_invoker = true) as
select
  c.id as carrier_id,
  count(i.id)                                                   as policies,
  count(i.id) filter (where i.expires_at < current_date)        as expired,
  count(i.id) filter (where i.expires_at >= current_date
                        and i.expires_at < current_date + 30)   as expiring_30d,
  min(i.expires_at) filter (where i.expires_at >= current_date) as next_expiry,
  coalesce(bool_or(i.coverage = 'auto_liability'
                     and (i.expires_at is null or i.expires_at >= current_date)), false)
                                                                as has_auto_liability,
  coalesce(bool_or(i.coverage = 'cargo'
                     and (i.expires_at is null or i.expires_at >= current_date)), false)
                                                                as has_cargo
from public.carriers c
left join public.carrier_insurance i on i.carrier_id = c.id
group by c.id;

grant select on public.v_carrier_insurance_status to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Row level security
-- ---------------------------------------------------------------------
alter table public.load_documents    enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_lines     enable row level security;
alter table public.load_upload_links enable row level security;
alter table public.carrier_documents enable row level security;
alter table public.carrier_insurance enable row level security;

do $$
declare
  t text;
begin
  -- Any active member can read all of it.
  foreach t in array array[
    'load_documents', 'invoices', 'invoice_lines', 'load_upload_links',
    'carrier_documents', 'carrier_insurance'
  ] loop
    execute format('drop policy if exists %1$I on public.%2$I', t || '_select', t);
    execute format(
      'create policy %1$I on public.%2$I for select to authenticated
         using (public.is_active_member())', t || '_select', t);
  end loop;

  -- Documents, links and insurance: anyone who can edit loads may add and change.
  foreach t in array array[
    'load_documents', 'load_upload_links', 'carrier_documents', 'carrier_insurance'
  ] loop
    execute format('drop policy if exists %1$I on public.%2$I', t || '_insert', t);
    execute format(
      'create policy %1$I on public.%2$I for insert to authenticated
         with check (public.has_permission(''edit_loads''))', t || '_insert', t);
    execute format('drop policy if exists %1$I on public.%2$I', t || '_update', t);
    execute format(
      'create policy %1$I on public.%2$I for update to authenticated
         using (public.has_permission(''edit_loads''))
         with check (public.has_permission(''edit_loads''))', t || '_update', t);
  end loop;

  -- Removing a file or a link is an admin action; an insurance row is data
  -- and an editor may correct it.
  foreach t in array array['load_documents', 'load_upload_links', 'carrier_documents'] loop
    execute format('drop policy if exists %1$I on public.%2$I', t || '_delete', t);
    execute format(
      'create policy %1$I on public.%2$I for delete to authenticated
         using (public.is_admin())', t || '_delete', t);
  end loop;
  execute 'drop policy if exists carrier_insurance_delete on public.carrier_insurance';
  execute 'create policy carrier_insurance_delete on public.carrier_insurance
             for delete to authenticated using (public.has_permission(''edit_loads''))';

  -- Invoices: the billing permission.
  foreach t in array array['invoices', 'invoice_lines'] loop
    execute format('drop policy if exists %1$I on public.%2$I', t || '_insert', t);
    execute format(
      'create policy %1$I on public.%2$I for insert to authenticated
         with check (public.has_permission(''manage_billing''))', t || '_insert', t);
    execute format('drop policy if exists %1$I on public.%2$I', t || '_update', t);
    execute format(
      'create policy %1$I on public.%2$I for update to authenticated
         using (public.has_permission(''manage_billing''))
         with check (public.has_permission(''manage_billing''))', t || '_update', t);
    execute format('drop policy if exists %1$I on public.%2$I', t || '_delete', t);
    execute format(
      'create policy %1$I on public.%2$I for delete to authenticated
         using (public.is_admin())', t || '_delete', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 9. Storage policies for the new buckets (same shape as tender-uploads)
-- ---------------------------------------------------------------------
do $$
declare
  b text;
  p text;
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  foreach b in array array['load-documents', 'carrier-documents'] loop
    p := replace(b, '-', '_');
    execute format('drop policy if exists %I on storage.objects', p || '_select');
    execute format(
      'create policy %I on storage.objects for select to authenticated
         using (bucket_id = %L and public.is_active_member())', p || '_select', b);
    execute format('drop policy if exists %I on storage.objects', p || '_insert');
    execute format(
      'create policy %I on storage.objects for insert to authenticated
         with check (bucket_id = %L and public.has_permission(''edit_loads''))', p || '_insert', b);
    execute format('drop policy if exists %I on storage.objects', p || '_update_admin');
    execute format(
      'create policy %I on storage.objects for update to authenticated
         using (bucket_id = %L and public.is_admin())
         with check (bucket_id = %L and public.is_admin())', p || '_update_admin', b, b);
    execute format('drop policy if exists %I on storage.objects', p || '_delete_admin');
    execute format(
      'create policy %I on storage.objects for delete to authenticated
         using (bucket_id = %L and public.is_admin())', p || '_delete_admin', b);
  end loop;

  -- The logo: anyone may read it, settings managers replace it.
  execute 'drop policy if exists branding_select on storage.objects';
  execute 'create policy branding_select on storage.objects for select to anon, authenticated
             using (bucket_id = ''branding'')';
  execute 'drop policy if exists branding_insert on storage.objects';
  execute 'create policy branding_insert on storage.objects for insert to authenticated
             with check (bucket_id = ''branding'' and public.has_permission(''manage_settings''))';
  execute 'drop policy if exists branding_update on storage.objects';
  execute 'create policy branding_update on storage.objects for update to authenticated
             using (bucket_id = ''branding'' and public.has_permission(''manage_settings''))
             with check (bucket_id = ''branding'' and public.has_permission(''manage_settings''))';
  execute 'drop policy if exists branding_delete on storage.objects';
  execute 'create policy branding_delete on storage.objects for delete to authenticated
             using (bucket_id = ''branding'' and public.has_permission(''manage_settings''))';
exception
  when insufficient_privilege then
    raise notice 'skipping storage.objects policies: insufficient privilege';
end
$$;
