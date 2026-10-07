-- ANZ04/ANZ05: fundația de date. Tenanți, branduri, acces, surse, sincronizare, importuri, audit.
-- Reguli: tenant_id pe toate entitățile, brand_id pe cele de brand, FK compuse (tenant_id, brand_id),
-- ID-urile furnizorilor ca text, indecșii încep cu tenant_id și brand_id.

create schema if not exists private;
revoke all on schema private from public;

create type public.membership_role as enum ('agency_admin', 'strategist', 'account', 'client_viewer');
create type public.record_status as enum ('active', 'archived');
create type public.sync_status as enum ('queued', 'running', 'partial', 'succeeded', 'failed');
create type public.import_status as enum ('uploaded', 'validating', 'validated', 'imported', 'rejected', 'rolled_back');

create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- tenants ------------------------------------------------------------------

create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       text not null check (length(trim(name)) > 0),
  status     public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- brands -------------------------------------------------------------------

create table public.brands (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  slug       text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       text not null check (length(trim(name)) > 0),
  domain     text,
  status     public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  -- Ținta tuturor FK-urilor compuse: un rând copil nu poate referi un brand din alt tenant.
  unique (tenant_id, id)
);

-- memberships --------------------------------------------------------------
-- Acces activ = revoked_at is null. Revocarea se citește la fiecare query (nu din JWT).

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.membership_role not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- Lookup-ul de autorizare pornește de la utilizatorul curent.
create index memberships_user_idx on public.memberships (user_id, tenant_id) where revoked_at is null;

-- brand_access -------------------------------------------------------------
-- Acces explicit user → brand. Obligatoriu pentru strategist, account și client_viewer.

create table public.brand_access (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  brand_id   uuid not null,
  user_id    uuid not null,
  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, brand_id, user_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  -- Accesul la un brand cere membership în același tenant.
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete cascade
);

create index brand_access_user_idx on public.brand_access (user_id, brand_id) where revoked_at is null;

-- competitor_sets ----------------------------------------------------------
-- Versiuni imutabile. Versiunea efectivă la data D = cea mai mare effective_from <= D.

create table public.competitor_sets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  brand_id       uuid not null,
  version        integer not null check (version > 0),
  effective_from date not null,
  note           text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (tenant_id, brand_id, version),
  unique (tenant_id, brand_id, effective_from),
  unique (tenant_id, brand_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);

create table public.competitor_set_members (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  brand_id          uuid not null,
  competitor_set_id uuid not null,
  name              text not null check (length(trim(name)) > 0),
  domain            text,
  color             text check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (tenant_id, brand_id, competitor_set_id, name),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, competitor_set_id)
    references public.competitor_sets (tenant_id, brand_id, id) on delete restrict
);

-- source_connections -------------------------------------------------------
-- secret_ref = numele secretului din Vault / mediul workerului. Secretul în clar nu intră niciodată aici.
-- brand_id poate lipsi: un cont de furnizor poate acoperi mai multe branduri (maparea vine în source_mappings).

create table public.source_connections (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  brand_id            uuid,
  provider            text not null check (provider ~ '^[a-z0-9_]+$'),
  external_account_id text not null,
  display_name        text,
  secret_ref          text check (secret_ref ~ '^[A-Za-z0-9_./:-]{1,200}$'),
  timezone            text not null default 'Europe/Bucharest',
  currency            char(3) check (currency ~ '^[A-Z]{3}$'),
  status              public.record_status not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, provider, external_account_id),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);

create index source_connections_brand_idx on public.source_connections (tenant_id, brand_id);

create function private.validate_timezone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Timezone necunoscut: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger source_connections_timezone
  before insert or update of timezone on public.source_connections
  for each row execute function private.validate_timezone();

-- sync_runs ----------------------------------------------------------------
-- Scris doar de worker (service role).

create table public.sync_runs (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  brand_id             uuid not null,
  source_connection_id uuid,
  source               text not null check (source ~ '^[a-z0-9_]+$'),
  period_start         date not null,
  period_end           date not null,
  status               public.sync_status not null default 'queued',
  rows_written         integer not null default 0 check (rows_written >= 0),
  attempt_count        integer not null default 0 check (attempt_count >= 0),
  errors               jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  started_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  check (period_end >= period_start),
  check (finished_at is null or started_at is null or finished_at >= started_at),
  -- Un job terminat are finished_at; unul în curs nu.
  check ((status in ('queued', 'running')) = (finished_at is null)),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_connection_id) references public.source_connections (tenant_id, id) on delete restrict
);

create index sync_runs_brand_idx on public.sync_runs (tenant_id, brand_id, source, created_at desc);

-- import_batches -----------------------------------------------------------
-- Scris doar prin service role; funcția server verifică rolul și brand_access (private.user_can_import).

create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  brand_id      uuid not null,
  source        text not null check (source ~ '^[a-z0-9_]+$'),
  file_name     text,
  file_sha256   text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status        public.import_status not null default 'uploaded',
  rows_accepted integer not null default 0 check (rows_accepted >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  uploaded_by   uuid not null references auth.users (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, brand_id, source, file_sha256),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);

create index import_batches_brand_idx on public.import_batches (tenant_id, brand_id, created_at desc);

-- audit_events -------------------------------------------------------------
-- Append-only. actor_user_id fără FK, ca auditul să supraviețuiască ștergerii utilizatorului.

create table public.audit_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  brand_id      uuid,
  actor_user_id uuid,
  actor_type    text not null check (actor_type in ('user', 'worker', 'system')),
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  occurred_at   timestamptz not null default now(),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);

create index audit_events_brand_idx on public.audit_events (tenant_id, brand_id, occurred_at desc);

create function private.prevent_audit_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events este append-only' using errcode = '42501';
end;
$$;

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function private.prevent_audit_change();

-- updated_at ---------------------------------------------------------------

create trigger tenants_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger brands_updated_at before update on public.brands
  for each row execute function private.set_updated_at();
create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger brand_access_updated_at before update on public.brand_access
  for each row execute function private.set_updated_at();
create trigger source_connections_updated_at before update on public.source_connections
  for each row execute function private.set_updated_at();
create trigger import_batches_updated_at before update on public.import_batches
  for each row execute function private.set_updated_at();
