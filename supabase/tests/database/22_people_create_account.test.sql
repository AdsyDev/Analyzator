-- Utilizatori (E-5, excepția E10): contul creat direct cu parolă temporară. Starea contului în lista de persoane și
-- auditul distinct `user_created`; totul doar prin service role (funcția server `users`).
-- T1 = 1000…0001 · admin T1 = 3000…0001, strategist T1 = …0002, client fără brand T1 = …0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- C1. tenant_people_for: temporary_password din app_metadata, doar `true` explicit ----------------------------------
select tests.authenticate_as_service_role();
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where temporary_password), 0,
  'C1: conturile seed nu au parolă temporară');
reset role;

update auth.users set raw_app_meta_data = raw_app_meta_data || '{"must_change_password": true}'
where id = '30000000-0000-0000-0000-000000000005';
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"must_change_password": "da"}'
where id = '30000000-0000-0000-0000-000000000002';

select tests.authenticate_as_service_role();
select is((select temporary_password from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where user_id = '30000000-0000-0000-0000-000000000005'),
  true, 'C1: marcajul must_change_password = true apare ca parolă temporară');
select is((select temporary_password from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where user_id = '30000000-0000-0000-0000-000000000002'),
  false, 'C1: o valoare care nu e true nu se interpretează ca parolă temporară');
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000002')), 0,
  'C1: strategistul tot nu vede nimic, nici starea conturilor');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.tenant_people_for('30000000-0000-0000-0000-000000000001') $$, '42501', null,
  'C1: authenticated nu execută tenant_people_for după înlocuire');
reset role;

-- C2. grant_invited_access: auditul user_created, doar acțiuni cunoscute --------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        email_confirmed_at, confirmation_token, recovery_token, email_change, email_change_token_new,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000098', 'authenticated', 'authenticated',
        'creat.t1@test.local', '', '{"provider":"email","providers":["email"],"must_change_password":true}', '{"full_name":"Cont Creat"}',
        now(), now(), now(), '', '', '', '', '', '', '', '');

select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000098', 'client_viewer', array['20000000-0000-0000-0000-000000000011']::uuid[], 'user_created') $$,
  '42501', null, 'C2: authenticated nu execută grant_invited_access (6 argumente), nici ca agency_admin');

select tests.authenticate_as_service_role();
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000098', 'client_viewer', '{}'::uuid[], 'role_changed') $$,
  '22023', null, 'C2: o acțiune de audit necunoscută e refuzată');
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000098', 'client_viewer', '{}'::uuid[], 'user_created') $$,
  '42501', null, 'C2: un strategist nu poate crea conturi');
select isnt((select public.grant_invited_access('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000098', 'account', array['20000000-0000-0000-0000-000000000011']::uuid[], 'user_created')), null,
  'C2: adminul T1 acordă acces contului creat');
reset role;

select ok(exists (select 1 from public.audit_events where action = 'user_created' and actor_type = 'user'
  and actor_user_id = '30000000-0000-0000-0000-000000000001' and after ->> 'user_id' = '30000000-0000-0000-0000-000000000098'),
  'C2: crearea e auditată ca user_created, cu actorul real');
select ok(not exists (select 1 from public.audit_events where action = 'user_invited' and after ->> 'user_id' = '30000000-0000-0000-0000-000000000098'),
  'C2: crearea nu apare ca invitație');
select ok(not exists (select 1 from public.audit_events where action = 'user_created' and after::text ilike '%password%'),
  'C2: auditul nu conține nicio parolă');

select tests.authenticate_as_service_role();
select is((select temporary_password from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where user_id = '30000000-0000-0000-0000-000000000098'),
  true, 'C2: contul creat apare cu parolă temporară până la prima schimbare');
reset role;

select * from finish();
rollback;
