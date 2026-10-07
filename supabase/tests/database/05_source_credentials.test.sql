-- Credențiale în Vault: cine poate scrie, cine poate citi, audit, contorul de apeluri.
-- Conexiuni Clarity din seed: 5000…0031 (T1, brand 1A), 5000…0032 (T2, brand 2A).
-- admin T1 = 3000…0001 · strategist T1 = 3000…0002 (acces 1A) · client T1 = 3000…0004 (acces 1A) · admin T2 = 3000…0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- V1. Utilizatorii nu ating Vault și nu pot apela funcțiile de credențiale -------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');

select throws_ok($$ select * from vault.secrets $$, '42501', null, 'V1: admin nu citește vault.secrets');
select throws_ok($$ select * from vault.decrypted_secrets $$, '42501', null, 'V1: admin nu citește vault.decrypted_secrets');
select throws_ok(
  $$ select vault.create_secret('x', 'atac') $$, '42501', null, 'V1: admin nu poate crea secrete direct'
);
select throws_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000031', 'tok') $$,
  '42501', null, 'V1: authenticated nu execută set_source_token'
);
select throws_ok(
  $$ select public.get_source_token('50000000-0000-0000-0000-000000000031') $$,
  '42501', null, 'V1: authenticated nu execută get_source_token'
);
select throws_ok(
  $$ select public.record_source_validation('50000000-0000-0000-0000-000000000031', true) $$,
  '42501', null, 'V1: authenticated nu execută record_source_validation'
);

-- V2. Utilizatorii nu pot scrie referința Vault sau starea ---------------------------------
select throws_ok(
  $$ insert into public.source_connections (tenant_id, brand_id, provider, external_account_id, vault_secret_id, credential_status)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'clarity', 'x',
             gen_random_uuid(), 'valid') $$,
  '42501', null, 'V2: admin nu poate insera o conexiune cu vault_secret_id ales de el'
);
select throws_ok(
  $$ update public.source_connections set credential_status = 'valid'
     where id = '50000000-0000-0000-0000-000000000031' $$,
  '42501', null, 'V2: admin nu poate marca un credențial ca valid'
);
select throws_ok(
  $$ update public.source_connections set vault_secret_id = gen_random_uuid()
     where id = '50000000-0000-0000-0000-000000000031' $$,
  '42501', null, 'V2: admin nu poate muta referința Vault'
);
select lives_ok(
  $$ insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'clarity', 'clarity-1b') $$,
  'V2: admin poate crea o conexiune fără token (status missing)'
);
reset role;
select is(
  (select credential_status from public.source_connections where external_account_id = 'clarity-1b'),
  'missing', 'V2: conexiunea nouă pornește cu credential_status = missing'
);

-- V3. Corpul funcțiilor verifică service_role, nu doar GRANT-ul ------------------------------
-- Ca postgres (are EXECUTE prin ownership), dar fără rolul service_role.
select throws_ok(
  $$ select public.get_source_token('50000000-0000-0000-0000-000000000031') $$,
  '42501', 'Permis doar pentru service_role', 'V3: get_source_token refuză un apelant care nu e service_role'
);
select throws_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000031', 'tok') $$,
  '42501', 'Permis doar pentru service_role', 'V3: set_source_token refuză un apelant care nu e service_role'
);
-- Claim JWT service_role, dar rol de baze de date authenticated: tot refuzat.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('role', 'authenticated', true);
select throws_ok(
  $$ select public.get_source_token('50000000-0000-0000-0000-000000000031') $$,
  '42501', null, 'V3: claim service_role fără rolul service_role nu ajunge'
);
reset role;

-- V4. Setare de token: doar agency_admin al tenantului conexiunii ----------------------------
select tests.authenticate_as_service_role();

select throws_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000031', 'tok') $$,
  '42501', null, 'V4: strategist nu poate seta tokenul'
);
select throws_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000031', 'tok') $$,
  '42501', null, 'V4: admin T2 nu poate seta tokenul unei conexiuni din T1'
);
select throws_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000031', '   ') $$,
  '22023', null, 'V4: token gol respins'
);
select throws_ok(
  $$ select public.set_source_token('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000099', 'tok') $$,
  'P0002', null, 'V4: conexiune inexistentă'
);
select throws_ok(
  $$ select public.get_source_token('50000000-0000-0000-0000-000000000031') $$,
  'P0002', null, 'V4: get_source_token fără token setat'
);

select is(
  public.set_source_token('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000031', 'TOKEN-T1-INITIAL'),
  'unverified', 'V4: admin T1 setează tokenul conexiunii din T1'
);
select is(public.get_source_token('50000000-0000-0000-0000-000000000031'), 'TOKEN-T1-INITIAL',
  'V4: service_role citește tokenul setat');

select is(
  public.set_source_token('30000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000032', 'TOKEN-T2'),
  'unverified', 'V4: admin T2 setează tokenul conexiunii din T2'
);

-- Rotire: același secret Vault, valoare nouă.
select is(
  public.set_source_token('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000031', 'TOKEN-T1-ROTIT'),
  'unverified', 'V4: rotire'
);
select is(public.get_source_token('50000000-0000-0000-0000-000000000031'), 'TOKEN-T1-ROTIT', 'V4: după rotire, tokenul nou');
select is(public.get_source_token('50000000-0000-0000-0000-000000000032'), 'TOKEN-T2', 'V4: tokenul T2 neatins');
reset role;

select is(
  (select count(*)::int from vault.secrets where name = 'source_connection:50000000-0000-0000-0000-000000000031'),
  1, 'V4: rotirea nu creează un al doilea secret'
);

-- V5. Audit: cine a setat și cine a rotit; tokenul nu apare nicăieri în afara Vault ----------
select results_eq(
  $$ select action, actor_user_id, actor_type from public.audit_events
     where entity_type = 'source_connections' and entity_id = '50000000-0000-0000-0000-000000000031'
       and action like 'credential_%' order by id $$,
  $$ values ('credential_set', '30000000-0000-0000-0000-000000000001'::uuid, 'user'),
            ('credential_rotated', '30000000-0000-0000-0000-000000000001'::uuid, 'user') $$,
  'V5: audit credential_set, apoi credential_rotated, cu admin T1 ca actor'
);
select is_empty(
  $$ select id from public.audit_events where (coalesce(before, '{}') || coalesce(after, '{}'))::text like '%TOKEN-T%' $$,
  'V5: niciun token în audit_events'
);
select is_empty(
  $$ select id from public.source_connections where row_to_json(source_connections)::text like '%TOKEN-T%' $$,
  'V5: niciun token în source_connections'
);
select is_empty(
  $$ select 1 from vault.secrets where secret like '%TOKEN-T%' $$,
  'V5: în vault.secrets tokenul e criptat, nu în clar'
);

-- V6. Utilizatorii văd starea, nu tokenul ----------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(
  (select credential_status from public.source_connections where id = '50000000-0000-0000-0000-000000000031'),
  'unverified', 'V6: admin T1 vede starea credențialului'
);
select is(
  (select credential_updated_by from public.source_connections where id = '50000000-0000-0000-0000-000000000031'),
  '30000000-0000-0000-0000-000000000001'::uuid, 'V6: admin T1 vede cine a configurat'
);
select is_empty(
  $$ select 1 from public.source_connections where id = '50000000-0000-0000-0000-000000000032' $$,
  'V6: admin T1 nu vede conexiunea din T2'
);
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.source_connections $$, 'V6: clientul nu vede conexiunile');
reset role;

-- V7. Validare ---------------------------------------------------------------------------------
select tests.authenticate_as_service_role();
select is(public.record_source_validation('50000000-0000-0000-0000-000000000031', false, 'HTTP 403'), 'invalid',
  'V7: validare eșuată → invalid');
select is(public.record_source_validation('50000000-0000-0000-0000-000000000031', true), 'valid',
  'V7: validare reușită → valid');
select throws_ok(
  $$ select public.record_source_validation('50000000-0000-0000-0000-000000000011', true) $$,
  'P0002', null, 'V7: conexiune fără token nu poate fi marcată validă'
);
reset role;
select is(
  (select last_validation_error from public.source_connections where id = '50000000-0000-0000-0000-000000000031'),
  null, 'V7: eroarea anterioară se șterge la validare reușită'
);

-- V8. Secretul trebuie să aparțină conexiunii (simulăm o referință mutată direct în tabel, ca owner).
update public.source_connections set vault_secret_id = null, credential_status = 'missing'
where id in ('50000000-0000-0000-0000-000000000031', '50000000-0000-0000-0000-000000000032');
update public.source_connections
set vault_secret_id = (select id from vault.secrets where name = 'source_connection:50000000-0000-0000-0000-000000000031'),
    credential_status = 'unverified'
where id = '50000000-0000-0000-0000-000000000032';

select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.get_source_token('50000000-0000-0000-0000-000000000032') $$,
  '42501', 'Secretul nu corespunde conexiunii',
  'V8: conexiunea T2 nu poate folosi secretul conexiunii T1'
);
reset role;

-- V9. Ștergerea conexiunii șterge secretul -----------------------------------------------------
update public.source_connections set vault_secret_id = null, credential_status = 'missing'
where id = '50000000-0000-0000-0000-000000000032';
select tests.authenticate_as_service_role();
select public.set_source_token('30000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000032', 'TOKEN-T2-NOU');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
delete from public.source_connections where id = '50000000-0000-0000-0000-000000000032';
reset role;
select is_empty(
  $$ select 1 from vault.secrets where name = 'source_connection:50000000-0000-0000-0000-000000000032' $$,
  'V9: secretul conexiunii șterse a fost eliminat din Vault'
);

-- V10. provider_api_calls -----------------------------------------------------------------------
insert into public.provider_api_calls (tenant_id, brand_id, source_connection_id, call_date_utc, purpose, calls) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
   '50000000-0000-0000-0000-000000000031', '2026-10-07', 'validate', 1);
insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id) values
  ('50000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 'clarity', 'clarity-2a-bis');
insert into public.provider_api_calls (tenant_id, brand_id, source_connection_id, call_date_utc, purpose, calls) values
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021',
   '50000000-0000-0000-0000-000000000042', '2026-10-07', 'collect', 4);

select throws_ok(
  $$ insert into public.provider_api_calls (tenant_id, brand_id, source_connection_id, call_date_utc, purpose, calls)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
             '50000000-0000-0000-0000-000000000042', '2026-10-07', 'collect', 1) $$,
  '23503', null, 'V10: apelurile nu pot fi atribuite unei conexiuni din alt tenant'
);
select throws_ok($$ update public.provider_api_calls set calls = 0 $$, '42501', null, 'V10: append-only');

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select results_eq(
  $$ select sum(calls)::int from public.provider_api_calls $$, $$ values (1) $$,
  'V10: strategist T1 vede doar apelurile brandului 1A'
);
select throws_ok(
  $$ insert into public.provider_api_calls (tenant_id, brand_id, source_connection_id, call_date_utc, purpose, calls)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
             '50000000-0000-0000-0000-000000000031', '2026-10-07', 'collect', 1) $$,
  '42501', null, 'V10: utilizatorii nu pot scrie în provider_api_calls'
);
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.provider_api_calls $$, 'V10: clientul nu vede contorul de apeluri');
reset role;

select * from finish();
rollback;
