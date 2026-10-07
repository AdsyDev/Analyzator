-- Izolare între branduri și între tenanți.
-- T1 = 1000…0001 (branduri 1A = 2000…0011, 1B = 2000…0012); T2 = 1000…0002 (2A = 2000…0021, 2B = 2000…0022)
-- strategist T1 = 3000…0002 (acces doar 1A); strategist T2 = 3000…0012 (acces doar 2A)
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Strategist T1 ------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');

select results_eq(
  $$ select id from public.brands order by id $$,
  $$ values ('20000000-0000-0000-0000-000000000011'::uuid) $$,
  'strategist T1 vede doar brandul 1A'
);
select is_empty(
  $$ select 1 from public.brands where id in ('20000000-0000-0000-0000-000000000012',
                                              '20000000-0000-0000-0000-000000000021') $$,
  'strategist T1 nu vede 1B (același tenant) și nici 2A (alt tenant), nici cerând ID-ul direct'
);
select results_eq(
  $$ select id from public.tenants $$,
  $$ values ('10000000-0000-0000-0000-000000000001'::uuid) $$,
  'strategist T1 vede doar tenantul T1'
);
select is_empty(
  $$ select 1 from public.competitor_sets where brand_id <> '20000000-0000-0000-0000-000000000011' $$,
  'strategist T1 nu vede seturile de competitori ale altor branduri'
);
select is_empty(
  $$ select 1 from public.competitor_set_members where brand_id <> '20000000-0000-0000-0000-000000000011' $$,
  'strategist T1 nu vede competitorii altor branduri'
);
select is_empty(
  $$ select 1 from public.sync_runs where tenant_id = '10000000-0000-0000-0000-000000000002'
     or brand_id = '20000000-0000-0000-0000-000000000012' $$,
  'strategist T1 nu vede sync_runs pentru 1B sau T2'
);
select is_empty(
  $$ select 1 from public.import_batches where brand_id <> '20000000-0000-0000-0000-000000000011' $$,
  'strategist T1 nu vede importurile altor branduri'
);
select is_empty(
  $$ select 1 from public.source_connections where tenant_id = '10000000-0000-0000-0000-000000000002' $$,
  'strategist T1 nu vede conexiunile T2'
);
select is_empty(
  $$ select 1 from public.memberships where user_id <> '30000000-0000-0000-0000-000000000002' $$,
  'strategist T1 vede doar propriul membership'
);
select is_empty($$ select 1 from public.audit_events $$, 'strategist nu vede auditul');

-- Scriere pe brandul altcuiva
select throws_ok(
  $$ insert into public.competitor_sets (tenant_id, brand_id, version, effective_from, created_by)
     values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 2, '2026-11-01',
             '30000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'strategist T1 nu poate crea competitor set pe 2A (alt tenant)'
);
select throws_ok(
  $$ insert into public.competitor_sets (tenant_id, brand_id, version, effective_from, created_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 2, '2026-11-01',
             '30000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'strategist T1 nu poate crea competitor set pe 1B (fără brand_access)'
);
select lives_ok(
  $$ insert into public.competitor_sets (tenant_id, brand_id, version, effective_from, created_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 2, '2026-11-01',
             '30000000-0000-0000-0000-000000000002') $$,
  'strategist T1 poate crea o versiune nouă pe 1A'
);
select throws_ok(
  $$ insert into public.brands (tenant_id, slug, name)
     values ('10000000-0000-0000-0000-000000000002', 'intrus', 'Intrus') $$,
  '42501', null,
  'strategist T1 nu poate crea branduri în T2'
);
update public.brands set name = 'Modificat' where id = '20000000-0000-0000-0000-000000000021';
reset role;
select is((select name from public.brands where id = '20000000-0000-0000-0000-000000000021'), 'Brand 2A',
  'strategist T1 nu poate modifica brandul 2A (UPDATE filtrat de RLS)');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ update public.competitor_sets set effective_from = '2020-01-01'
     where brand_id = '20000000-0000-0000-0000-000000000011' $$,
  '42501', null,
  'versiunile competitor_sets nu se pot modifica'
);

-- Strategist T2 ------------------------------------------------------------------
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000012');

select is_empty(
  $$ select 1 from public.brands where tenant_id = '10000000-0000-0000-0000-000000000001' $$,
  'strategist T2 nu vede niciun brand din T1'
);
select is_empty(
  $$ select 1 from public.tenants where id = '10000000-0000-0000-0000-000000000001' $$,
  'strategist T2 nu vede tenantul T1'
);
select is_empty(
  $$ select 1 from public.sync_runs where tenant_id = '10000000-0000-0000-0000-000000000001' $$,
  'strategist T2 nu vede sync_runs din T1'
);

-- Admin T2 vede tot T2, nimic din T1 ---------------------------------------------
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');

select results_eq(
  $$ select count(*)::int from public.brands $$,
  $$ values (2) $$,
  'admin T2 vede ambele branduri T2'
);
select is_empty(
  $$ select 1 from public.audit_events where tenant_id = '10000000-0000-0000-0000-000000000001' $$,
  'admin T2 nu vede auditul T1'
);
update public.memberships set role = 'client_viewer' where tenant_id = '10000000-0000-0000-0000-000000000001';
reset role;
select is((select role from public.memberships where user_id = '30000000-0000-0000-0000-000000000001'),
  'agency_admin'::public.membership_role,
  'admin T2 nu poate modifica membership-uri din T1');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ insert into public.brand_access (tenant_id, brand_id, user_id, granted_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
             '30000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000011') $$,
  '42501', null,
  'admin T2 nu își poate acorda acces la un brand din T1'
);

-- Constrângeri de integritate (ca owner, fără RLS) --------------------------------
reset role;

select throws_ok(
  $$ insert into public.competitor_sets (tenant_id, brand_id, version, effective_from)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000021', 9, '2027-01-01') $$,
  '23503', null,
  'FK compus: un brand din T2 nu poate fi asociat cu T1'
);
select throws_ok(
  $$ insert into public.brand_access (tenant_id, brand_id, user_id)
     values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021',
             '30000000-0000-0000-0000-000000000002') $$,
  '23503', null,
  'brand_access cere membership în același tenant'
);
select throws_ok(
  $$ insert into public.source_connections (tenant_id, provider, external_account_id, timezone)
     values ('10000000-0000-0000-0000-000000000001', 'ga4', 'x', 'Europe/Nowhere') $$,
  '22023', null,
  'timezone invalid respins'
);

select * from finish();
rollback;
