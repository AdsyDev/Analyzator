-- DOAR PENTRU TESTE AUTOMATE (supabase db reset local). Nu se aplică pe staging sau production.
-- Doi tenanți de test, câte două branduri, utilizatori cu roluri diferite.

-- Utilizatori -------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '',
       now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('30000000-0000-0000-0000-000000000001'::uuid, 'admin.t1@test.local'),
  ('30000000-0000-0000-0000-000000000002'::uuid, 'strategist.t1@test.local'),
  ('30000000-0000-0000-0000-000000000003'::uuid, 'account.t1@test.local'),
  ('30000000-0000-0000-0000-000000000004'::uuid, 'client.t1@test.local'),
  ('30000000-0000-0000-0000-000000000005'::uuid, 'client.noaccess.t1@test.local'),
  ('30000000-0000-0000-0000-000000000011'::uuid, 'admin.t2@test.local'),
  ('30000000-0000-0000-0000-000000000012'::uuid, 'strategist.t2@test.local')
) as u (id, email);

-- Tenanți și branduri -----------------------------------------------------------
insert into public.tenants (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'test-tenant-1', 'Tenant de test 1'),
  ('10000000-0000-0000-0000-000000000002', 'test-tenant-2', 'Tenant de test 2');

insert into public.brands (id, tenant_id, slug, name, domain) values
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'brand-1a', 'Brand 1A', 'brand1a.test'),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'brand-1b', 'Brand 1B', 'brand1b.test'),
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', 'brand-2a', 'Brand 2A', 'brand2a.test'),
  ('20000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000002', 'brand-2b', 'Brand 2B', 'brand2b.test');

-- Membership și acces -----------------------------------------------------------
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'agency_admin'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'strategist'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'account'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 'client_viewer'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', 'client_viewer'),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000011', 'agency_admin'),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000012', 'strategist');

insert into public.brand_access (tenant_id, brand_id, user_id, granted_by) values
  -- strategist T1 → doar 1A
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001'),
  -- account T1 → doar 1B
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001'),
  -- client T1 → doar 1A
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001'),
  -- strategist T2 → doar 2A
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000011');
-- client.noaccess.t1 nu are niciun brand_access.

-- Date de configurare și sincronizare pe fiecare brand ----------------------------
insert into public.competitor_sets (id, tenant_id, brand_id, version, effective_from) values
  ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 1, '2026-10-01'),
  ('40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 1, '2026-10-01'),
  ('40000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 1, '2026-10-01'),
  ('40000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000022', 1, '2026-10-01');

insert into public.competitor_set_members (tenant_id, brand_id, competitor_set_id, name, domain)
select tenant_id, brand_id, id, 'Competitor ' || n, 'competitor' || n || '.test'
from public.competitor_sets, generate_series(1, 3) as n;

insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id) values
  ('50000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', null,                                   'seomonitor', 'acc-t1'),
  ('50000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'ga4',        'prop-1a'),
  ('50000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'ga4',        'prop-1b'),
  ('50000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 'ga4',        'prop-2a'),
  ('50000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'clarity',    'clarity-1a'),
  ('50000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 'clarity',    'clarity-2a');

insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000011', 'ga4', '2026-09-28', '2026-10-04', 'succeeded', 70, now(), now()),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', '50000000-0000-0000-0000-000000000012', 'ga4', '2026-09-28', '2026-10-04', 'succeeded', 70, now(), now()),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', '50000000-0000-0000-0000-000000000021', 'ga4', '2026-09-28', '2026-10-04', 'succeeded', 70, now(), now());

insert into public.import_batches (tenant_id, brand_id, source, file_name, file_sha256, status, rows_accepted, uploaded_by) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'meta_ads', 'meta-1b.csv', repeat('a', 64), 'imported', 10, '30000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 'meta_ads', 'meta-2a.csv', repeat('b', 64), 'imported', 10, '30000000-0000-0000-0000-000000000011');

-- Helperi pentru pgTAP ------------------------------------------------------------
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.authenticate_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_as_anon() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function tests.authenticate_as_service_role() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

grant usage on schema tests to service_role;
grant execute on all functions in schema tests to authenticated, anon, service_role;
