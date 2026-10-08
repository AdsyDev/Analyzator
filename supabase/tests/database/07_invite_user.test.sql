-- Invitare: cine poate invita, izolare între tenanți, atomicitate, lista persoanelor.
-- admin T1 = 3000…0001 · strategist T1 = 3000…0002 · client T1 = 3000…0004 · admin T2 = 3000…0011
-- brand 1A = 2000…0011, 1B = 2000…0012 (T1) · 2A = 2000…0021 (T2)
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Utilizatorii invitați (în producție îi creează Auth Admin, înaintea funcției SQL).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, invited_at)
values
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'invitat.x@test.local', '{"full_name":"Ion Invitat"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'invitat.y@test.local', '{}', now(), now(), now());

-- I1. Utilizatorii și anon nu execută funcțiile ----------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', null, 'I1: authenticated (chiar agency_admin) nu execută invite_user_grant'
);
select throws_ok(
  $$ select * from public.list_tenant_people('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'I1: authenticated nu execută list_tenant_people'
);
select throws_ok($$ select email from auth.users $$, '42501', null, 'I1: authenticated nu citește auth.users');
reset role;
select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.list_tenant_people('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'I1: anon nu execută list_tenant_people'
);
reset role;

-- I2. Corpul verifică service_role, nu doar GRANT-ul (apelant postgres, fără rolul service_role) --
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', 'Permis doar pentru service_role', 'I2: invite_user_grant refuză un apelant care nu e service_role'
);
select throws_ok(
  $$ select * from public.list_tenant_people('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') $$,
  '42501', 'Permis doar pentru service_role', 'I2: list_tenant_people refuză un apelant care nu e service_role'
);

-- I3. Cine nu poate invita --------------------------------------------------------------------
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', null, 'I3: admin T2 nu invită în T1'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', null, 'I3: strategist nu invită'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'client_viewer', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', null, 'I3: client_viewer nu invită'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'account', array['20000000-0000-0000-0000-000000000012']::uuid[]) $$,
  '42501', null, 'I3: account nu invită'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', null, 'I3: un utilizator fără membership nu invită'
);
reset role;

-- agency_admin cu membership revocat
update public.memberships set revoked_at = now()
where tenant_id = '10000000-0000-0000-0000-000000000001' and user_id = '30000000-0000-0000-0000-000000000001';
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', null, 'I3: admin cu membership revocat nu invită'
);
reset role;
update public.memberships set revoked_at = null
where tenant_id = '10000000-0000-0000-0000-000000000001' and user_id = '30000000-0000-0000-0000-000000000001';

select is_empty(
  $$ select 1 from public.memberships where user_id in ('31000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002') $$,
  'I3: nicio încercare refuzată nu a lăsat membership'
);

-- I4. Validări: brand din alt tenant, brand lipsă pentru rol, admin cu branduri -----------------
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000021']::uuid[]) $$,
  '23503', null, 'I4: brand din alt tenant respins'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist',
       array['20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000021']::uuid[]) $$,
  '23503', null, 'I4: un brand valid + unul din alt tenant: se respinge totul'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'account', array['20000000-0000-0000-0000-0000000000ff']::uuid[]) $$,
  '23503', null, 'I4: brand inexistent respins'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', '{}'::uuid[]) $$,
  '22023', null, 'I4: strategist fără brand respins'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'client_viewer', null) $$,
  '22023', null, 'I4: client_viewer cu brand_ids null respins'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'agency_admin', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '22023', null, 'I4: agency_admin cu branduri respins'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011', null]::uuid[]) $$,
  '22023', null, 'I4: element null în brand_ids respins'
);
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-0000000000ff', 'agency_admin', '{}'::uuid[]) $$,
  'P0002', null, 'I4: utilizator invitat inexistent în auth.users'
);
reset role;
select is_empty(
  $$ select 1 from public.memberships where user_id in ('31000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002')
     union all select 1 from public.brand_access where user_id in ('31000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002')
     union all select 1 from public.audit_events where action = 'user_invited' $$,
  'I4: validările respinse nu lasă date parțiale'
);

-- I5. Atomicitate: eșec târziu (la audit) anulează membership-ul și accesele --------------------
create function pg_temp.fail_user_invited() returns trigger language plpgsql as $$
begin
  if new.action = 'user_invited' then raise exception 'eșec simulat la audit' using errcode = 'XX001'; end if;
  return new;
end;
$$;
create trigger fail_user_invited before insert on public.audit_events
  for each row execute function pg_temp.fail_user_invited();

select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'strategist', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  'XX001', null, 'I5: eșecul la ultimul pas ridică eroarea'
);
reset role;
select is_empty(
  $$ select 1 from public.memberships where user_id = '31000000-0000-0000-0000-000000000001'
     union all select 1 from public.brand_access where user_id = '31000000-0000-0000-0000-000000000001' $$,
  'I5: după eșec târziu nu rămân membership sau brand_access'
);
drop trigger fail_user_invited on public.audit_events;

-- I6. Succes -------------------------------------------------------------------------------------
select tests.authenticate_as_service_role();
select isnt(
  public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001', 'strategist',
    array['20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012']::uuid[]),
  null, 'I6: admin T1 invită un strategist pe 1A și 1B (duplicat ignorat)'
);
reset role;
select results_eq(
  $$ select tenant_id, role::text, revoked_at is null from public.memberships where user_id = '31000000-0000-0000-0000-000000000001' $$,
  $$ values ('10000000-0000-0000-0000-000000000001'::uuid, 'strategist', true) $$,
  'I6: membership în T1, rol strategist'
);
select results_eq(
  $$ select brand_id, granted_by from public.brand_access where user_id = '31000000-0000-0000-0000-000000000001' order by brand_id $$,
  $$ values ('20000000-0000-0000-0000-000000000011'::uuid, '30000000-0000-0000-0000-000000000001'::uuid),
            ('20000000-0000-0000-0000-000000000012'::uuid, '30000000-0000-0000-0000-000000000001'::uuid) $$,
  'I6: acces la 1A și 1B, granted_by = admin T1'
);
select results_eq(
  $$ select actor_user_id, actor_type, entity_type, after ->> 'role', after ->> 'invited_user_id'
     from public.audit_events where action = 'user_invited' $$,
  $$ values ('30000000-0000-0000-0000-000000000001'::uuid, 'user', 'memberships', 'strategist', '31000000-0000-0000-0000-000000000001') $$,
  'I6: audit user_invited cu actorul'
);
select is_empty(
  $$ select 1 from public.audit_events where action = 'user_invited' and after::text like '%@%' $$,
  'I6: auditul nu conține adrese de e-mail'
);

-- Utilizatorul invitat vede 1A și 1B, nu 2A (RLS aplicat peste accesul creat)
select tests.authenticate_as('31000000-0000-0000-0000-000000000001');
select results_eq(
  $$ select id from public.brands order by id $$,
  $$ values ('20000000-0000-0000-0000-000000000011'::uuid), ('20000000-0000-0000-0000-000000000012'::uuid) $$,
  'I6: invitatul vede doar brandurile alocate, niciunul din T2'
);
reset role;

-- A doua invitație pentru același utilizator în același tenant: 23505, nimic schimbat
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.invite_user_grant('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '31000000-0000-0000-0000-000000000001', 'agency_admin', '{}'::uuid[]) $$,
  '23505', null, 'I6: re-invitarea aceluiași utilizator în tenant nu suprascrie rolul'
);
reset role;
select is(
  (select role::text from public.memberships where user_id = '31000000-0000-0000-0000-000000000001'),
  'strategist', 'I6: rolul inițial a rămas'
);

-- I7. agency_admin nou fără branduri; același utilizator poate avea roluri în tenanți diferiți ----
select tests.authenticate_as_service_role();
select isnt(
  public.invite_user_grant('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000002', 'agency_admin', '{}'::uuid[]),
  null, 'I7: admin T2 invită un agency_admin în T2'
);
reset role;
select is_empty(
  $$ select 1 from public.memberships where user_id = '31000000-0000-0000-0000-000000000002' and tenant_id <> '10000000-0000-0000-0000-000000000002' $$,
  'I7: invitația din T2 nu creează acces în T1'
);

-- I8. list_tenant_people --------------------------------------------------------------------------
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select * from public.list_tenant_people('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'I8: admin T2 nu vede persoanele din T1'
);
select throws_ok(
  $$ select * from public.list_tenant_people('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'I8: strategist nu vede lista'
);
select throws_ok(
  $$ select * from public.list_tenant_people('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'I8: client_viewer nu vede lista'
);
select results_eq(
  $$ select email from public.list_tenant_people('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') order by email $$,
  $$ values ('account.t1@test.local'::text), ('admin.t1@test.local'), ('client.noaccess.t1@test.local'),
            ('client.t1@test.local'), ('invitat.x@test.local'), ('strategist.t1@test.local') $$,
  'I8: admin T1 vede exact membrii T1, fără T2 și fără invitatul din T2'
);
select results_eq(
  $$ select full_name from public.list_tenant_people('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')
     where email = 'invitat.x@test.local' $$,
  $$ values ('Ion Invitat'::text) $$,
  'I8: numele vine din raw_user_meta_data.full_name'
);
select results_eq(
  $$ select email from public.list_tenant_people('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002') order by email $$,
  $$ values ('admin.t2@test.local'::text), ('invitat.y@test.local'), ('strategist.t2@test.local') $$,
  'I8: admin T2 vede exact membrii T2'
);
reset role;

select * from finish();
rollback;
