-- client_viewer: fără brand_access nu vede nimic; cu acces vede doar brandul lui, fără date de agenție.
-- client T1 = 3000…0004 (acces 1A); client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Client fără brand_access -------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');

select is_empty($$ select 1 from public.tenants $$,                'fără acces: 0 tenants');
select is_empty($$ select 1 from public.brands $$,                 'fără acces: 0 brands');
select is_empty($$ select 1 from public.brand_access $$,           'fără acces: 0 brand_access');
select is_empty($$ select 1 from public.competitor_sets $$,        'fără acces: 0 competitor_sets');
select is_empty($$ select 1 from public.competitor_set_members $$, 'fără acces: 0 competitor_set_members');
select is_empty($$ select 1 from public.source_connections $$,     'fără acces: 0 source_connections');
select is_empty($$ select 1 from public.sync_runs $$,              'fără acces: 0 sync_runs');
select is_empty($$ select 1 from public.import_batches $$,         'fără acces: 0 import_batches');
select is_empty($$ select 1 from public.audit_events $$,           'fără acces: 0 audit_events');
select results_eq(
  $$ select user_id from public.memberships $$,
  $$ values ('30000000-0000-0000-0000-000000000005'::uuid) $$,
  'fără acces: vede doar propriul membership (fără date de business)'
);

-- Client cu acces la 1A ------------------------------------------------------------
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');

select results_eq(
  $$ select id from public.brands $$,
  $$ values ('20000000-0000-0000-0000-000000000011'::uuid) $$,
  'client vede doar brandul 1A'
);
select results_eq(
  $$ select count(*)::int from public.competitor_set_members $$,
  $$ values (3) $$,
  'client vede competitorii brandului 1A'
);
select is_empty($$ select 1 from public.source_connections $$, 'client nu vede conexiunile');
select is_empty($$ select 1 from public.sync_runs $$,          'client nu vede sync_runs (vede status prin view-uri dedicate)');
select is_empty($$ select 1 from public.import_batches $$,     'client nu vede importurile');

select throws_ok(
  $$ insert into public.competitor_sets (tenant_id, brand_id, version, effective_from, created_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 5, '2026-12-01',
             '30000000-0000-0000-0000-000000000004') $$,
  '42501', null,
  'client nu poate crea competitor sets'
);
select throws_ok(
  $$ insert into public.brand_access (tenant_id, brand_id, user_id, granted_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012',
             '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004') $$,
  '42501', null,
  'client nu își poate acorda singur acces la 1B'
);
update public.memberships set role = 'agency_admin' where user_id = '30000000-0000-0000-0000-000000000004';
reset role;
select is((select role from public.memberships where user_id = '30000000-0000-0000-0000-000000000004'),
  'client_viewer'::public.membership_role,
  'client nu își poate schimba rolul');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ insert into public.sync_runs (tenant_id, brand_id, source, period_start, period_end)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
             'ga4', '2026-10-01', '2026-10-07') $$,
  '42501', null,
  'client nu poate scrie în sync_runs'
);
select throws_ok(
  $$ insert into public.audit_events (tenant_id, actor_type, action, entity_type)
     values ('10000000-0000-0000-0000-000000000001', 'user', 'fake', 'x') $$,
  '42501', null,
  'client nu poate scrie în audit_events'
);

-- Account T1 (acces 1B): nici el nu scrie direct în import_batches ------------------
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');

select throws_ok(
  $$ insert into public.import_batches (tenant_id, brand_id, source, file_sha256, uploaded_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012',
             'meta_ads', repeat('c', 64), '30000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'account nu scrie direct în import_batches (doar prin funcția server)'
);

-- Verificarea folosită de funcția server de import ----------------------------------
reset role;
select ok(private.user_can_import('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000012'),
  'user_can_import: account cu acces la 1B');
select ok(not private.user_can_import('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000011'),
  'user_can_import: account fără acces la 1A');
select ok(not private.user_can_import('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000011'),
  'user_can_import: strategist nu importă');
select ok(private.user_can_import('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012'),
  'user_can_import: agency_admin pe orice brand din tenant');
select ok(not private.user_can_import('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000021'),
  'user_can_import: agency_admin T1 nu importă în T2');

-- anon ------------------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.brands $$,  '42501', null, 'anon nu are acces la brands');
select throws_ok($$ select 1 from public.tenants $$, '42501', null, 'anon nu are acces la tenants');

select * from finish();
rollback;
