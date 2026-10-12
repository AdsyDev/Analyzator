-- Conturi la nivel de client (brand_id NULL): cheia Google și SEOmonitor, create din aplicație (Surse → Conturile clientului).
-- admin T1 = 3000…0001 · strategist T1 = 3000…0002 · admin T2 = 3000…0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- I1. Doar agency_admin al tenantului creează contul clientului ---------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.source_connections (tenant_id, brand_id, provider, external_account_id) values ('10000000-0000-0000-0000-000000000001', null, 'google_service_account', 'sa@p.iam.gserviceaccount.com') $$,
  '42501', null, 'I1: strategistul nu creează contul Google al clientului');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ insert into public.source_connections (tenant_id, brand_id, provider, external_account_id) values ('10000000-0000-0000-0000-000000000001', null, 'seomonitor', '4821') $$,
  '42501', null, 'I1: adminul altui client nu creează conturi în T1');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.source_connections (tenant_id, brand_id, provider, external_account_id) values ('10000000-0000-0000-0000-000000000001', null, 'google_service_account', 'sa@p.iam.gserviceaccount.com') $$,
  'I1: adminul T1 creează contul Google al clientului');
reset role;
create temporary table ids on commit drop as
  select id from public.source_connections where provider = 'google_service_account' and brand_id is null and tenant_id = '10000000-0000-0000-0000-000000000001';
grant select on ids to public;
select is((select count(*) from ids), 1::bigint, 'I1: un singur cont Google creat');
select is((select credential_status from public.source_connections where id = (select id from ids)), 'missing',
  'I1: contul nou nu are încă cheie');

-- I2. Cheia (JSON) se scrie prin set_source_token, doar pentru adminul tenantului ---------------
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000011', (select id from ids), '{"type":"service_account"}') $$,
  '42501', null, 'I2: adminul altui client nu setează cheia');
select lives_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000001', (select id from ids), '{"type":"service_account","client_email":"sa@p.iam.gserviceaccount.com"}') $$,
  'I2: adminul T1 setează cheia contului fără brand');
select is((select credential_status from public.source_connections where id = (select id from ids)), 'unverified',
  'I2: cheia salvată e netestată');
select is(public.get_source_token((select id from ids)), '{"type":"service_account","client_email":"sa@p.iam.gserviceaccount.com"}',
  'I2: workerul citește cheia contului fără brand');
reset role;

-- I3. Vizibilitate: agenția T1 vede contul, adminul T2 nu ------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select isnt_empty($$ select 1 from public.source_connections where id = (select id from ids) $$,
  'I3: strategistul T1 vede contul clientului (fără cheie)');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.source_connections where id = (select id from ids) $$,
  'I3: adminul T2 nu vede contul clientului T1');
reset role;

select * from finish();
rollback;
