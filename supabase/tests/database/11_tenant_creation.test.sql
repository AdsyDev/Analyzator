-- Crearea unui client de către agency_admin (docs/security-tests.md, E5) și administrarea brandurilor.
-- admin T1 = 3000…0001 · strategist T1 = 3000…0002 · account T1 = 3000…0003 · client T1 = 3000…0004 · admin T2 = 3000…0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- H1. Respinși: roluri fără drept, anon, statusul impus ------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000a1', 'h1-strategist', 'H1') $$,
  '42501', null, 'H1: strategist nu poate crea un client');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000a2', 'h1-account', 'H1') $$,
  '42501', null, 'H1: account nu poate crea un client');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000a3', 'h1-client', 'H1') $$,
  '42501', null, 'H1: client_viewer nu poate crea un client');
select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000a4', 'h1-anon', 'H1') $$,
  '42501', null, 'H1: anon nu poate crea un client');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.tenants (id, slug, name, status) values ('10000000-0000-0000-0000-0000000000a5', 'h1-status', 'H1', 'archived') $$,
  '42501', null, 'H1: statusul nu se alege la creare (coloană fără grant)');
reset role;
select is((select count(*) from public.tenants where slug like 'h1-%'), 0::bigint, 'H1: niciun client creat de apelanții respinși');

-- H2. agency_admin creează un client și devine agency_admin în el -------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000b1', 'client-nou', 'Client nou') $$,
  'H2: agency_admin creează un client');
select is((select name from public.tenants where id = '10000000-0000-0000-0000-0000000000b1'), 'Client nou',
  'H2: creatorul vede clientul nou');
select is(
  (select role::text from public.memberships where tenant_id = '10000000-0000-0000-0000-0000000000b1' and user_id = '30000000-0000-0000-0000-000000000001'),
  'agency_admin', 'H2: creatorul e agency_admin în clientul nou');
select lives_ok(
  $$ insert into public.brands (tenant_id, slug, name, domain) values ('10000000-0000-0000-0000-0000000000b1', 'site-nou', 'Site nou', 'site-nou.ro') $$,
  'H2: creatorul adaugă un brand în clientul nou');
select lives_ok(
  $$ update public.tenants set name = 'Client nou SRL' where id = '10000000-0000-0000-0000-0000000000b1' $$,
  'H2: creatorul redenumește clientul');
select throws_ok(
  $$ insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000b2', 'client-nou', 'Duplicat') $$,
  '23505', null, 'H2: slug-ul clientului e unic');

-- H3. Izolare: ceilalți nu văd clientul nou ---------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.tenants where id = '10000000-0000-0000-0000-0000000000b1' $$,
  'H3: adminul altui client nu vede clientul nou');
select is_empty($$ select 1 from public.brands where tenant_id = '10000000-0000-0000-0000-0000000000b1' $$,
  'H3: adminul altui client nu vede brandurile clientului nou');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.tenants where id = '10000000-0000-0000-0000-0000000000b1' $$,
  'H3: strategistul T1 nu vede clientul nou');
-- Adminul T2 nu se poate adăuga singur în clientul creat de adminul T1.
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ insert into public.memberships (tenant_id, user_id, role) values ('10000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000011', 'agency_admin') $$,
  '42501', null, 'H3: nimeni nu se poate adăuga într-un client străin');
reset role;

-- H4. Un admin revocat nu mai poate crea clienți --------------------------------------------
update public.memberships set revoked_at = now()
  where tenant_id = '10000000-0000-0000-0000-000000000002' and user_id = '30000000-0000-0000-0000-000000000011';
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000c1', 'h4-revocat', 'H4') $$,
  '42501', null, 'H4: agency_admin revocat nu poate crea un client');
reset role;

-- H5. Fără membership creat de service role; auditul există ----------------------------------
select tests.authenticate_as_service_role();
insert into public.tenants (id, slug, name) values ('10000000-0000-0000-0000-0000000000d1', 'h5-service', 'H5');
reset role;
select is((select count(*) from public.memberships where tenant_id = '10000000-0000-0000-0000-0000000000d1'), 0::bigint,
  'H5: inserția fără utilizator nu creează membership');
select ok(exists (select 1 from public.audit_events where entity_type = 'tenants' and entity_id = '10000000-0000-0000-0000-0000000000b1' and actor_user_id = '30000000-0000-0000-0000-000000000001'),
  'H5: crearea clientului e auditată cu actorul');

-- H6. Brandurile: arhivare și restaurare de către agency_admin, nu de alte roluri -------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
update public.brands set status = 'archived' where id = '20000000-0000-0000-0000-000000000011';
reset role;
select is((select status::text from public.brands where id = '20000000-0000-0000-0000-000000000011'), 'active',
  'H6: strategistul nu poate arhiva un brand');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.brands set status = 'archived' where id = '20000000-0000-0000-0000-000000000011' $$,
  'H6: agency_admin arhivează un brand');
select is((select status::text from public.brands where id = '20000000-0000-0000-0000-000000000011'), 'archived',
  'H6: brandul arhivat rămâne vizibil pentru agency_admin');
select lives_ok($$ update public.brands set status = 'active' where id = '20000000-0000-0000-0000-000000000011' $$,
  'H6: agency_admin restaurează brandul');
reset role;

select * from finish();
rollback;
