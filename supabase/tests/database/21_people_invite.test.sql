-- Utilizatori (E-4, excepția E10): identitatea persoanelor doar pentru agency_admin, pe tenantul lui; totul doar prin
-- service role (funcția server `users`), cu actorul explicit.
-- T1 = 1000…0001, T2 = 1000…0002 · admin T1 = 3000…0001, strategist T1 = …0002, client T1 = …0004, admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- P1. tenant_people_for: doar service role; emailurile doar pentru agency_admin, doar în tenantul lui -----------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.tenant_people_for('30000000-0000-0000-0000-000000000001') $$, '42501', null,
  'P1: authenticated nu execută tenant_people_for, nici ca agency_admin');
select tests.authenticate_as_anon();
select throws_ok($$ select * from public.tenant_people_for('30000000-0000-0000-0000-000000000001') $$, '42501', null,
  'P1: anon nu execută tenant_people_for');

select tests.authenticate_as_service_role();
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000001')), 5, 'P1: admin T1 vede cele 5 persoane din T1');
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where tenant_id <> '10000000-0000-0000-0000-000000000001'), 0,
  'P1: admin T1 nu vede nicio persoană din T2');
select is((select email from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where user_id = '30000000-0000-0000-0000-000000000002'),
  'strategist.t1@test.local', 'P1: emailul vine din contul persoanei');
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000011')), 2, 'P1: admin T2 vede doar cele 2 persoane din T2');
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000002')), 0, 'P1: strategist nu vede emailurile nimănui');
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000004')), 0, 'P1: client_viewer nu vede emailurile nimănui');
reset role;

-- Adminul revocat nu mai vede nimic.
update public.memberships set revoked_at = now()
where tenant_id = '10000000-0000-0000-0000-000000000002' and user_id = '30000000-0000-0000-0000-000000000011';
select tests.authenticate_as_service_role();
select is((select count(*)::int from public.tenant_people_for('30000000-0000-0000-0000-000000000011')), 0, 'P1: un agency_admin revocat nu mai vede emailurile');
reset role;
update public.memberships set revoked_at = null
where tenant_id = '10000000-0000-0000-0000-000000000002' and user_id = '30000000-0000-0000-0000-000000000011';

-- P2. find_user_for_invite: doar service role ------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.find_user_for_invite('strategist.t2@test.local') $$, '42501', null,
  'P2: agency_admin nu caută conturi după email');
select tests.authenticate_as_service_role();
select is((select user_id from public.find_user_for_invite('  Strategist.T2@test.local ')), '30000000-0000-0000-0000-000000000012'::uuid,
  'P2: căutarea ignoră majusculele și spațiile');
select is((select confirmed from public.find_user_for_invite('strategist.t2@test.local')), true, 'P2: contul seed e confirmat');
select is((select count(*)::int from public.find_user_for_invite('nimeni@test.local')), 0, 'P2: email necunoscut = niciun rând');
reset role;

-- P3. grant_invited_access -------------------------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
                        phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000099', 'authenticated', 'authenticated',
        'nou.t1@test.local', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Ana Nouă"}', now(), now(),
        '', '', '', '', '', '', '', '');

select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000099', 'client_viewer', array['20000000-0000-0000-0000-000000000011']::uuid[]) $$,
  '42501', null, 'P3: authenticated nu execută grant_invited_access, nici ca agency_admin');

select tests.authenticate_as_service_role();
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000099', 'client_viewer', '{}'::uuid[]) $$,
  '42501', null, 'P3: un strategist nu poate invita');
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000099', 'client_viewer', '{}'::uuid[]) $$,
  '42501', null, 'P3: adminul T2 nu poate invita în T1');
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000099', 'client_viewer', array['20000000-0000-0000-0000-000000000021']::uuid[]) $$,
  '22023', null, 'P3: un brand din T2 nu se poate acorda în T1');
select throws_ok($$ select public.grant_invited_access('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002', 'account', '{}'::uuid[]) $$,
  '23505', null, 'P3: o persoană care are deja un rând în tenant nu se invită din nou');

select isnt((select public.grant_invited_access('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000099', 'client_viewer',
  array['20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011']::uuid[])), null,
  'P3: adminul T1 acordă acces persoanei invitate');
reset role;

select is((select role::text from public.memberships where user_id = '30000000-0000-0000-0000-000000000099'), 'client_viewer',
  'P3: membership creat cu rolul cerut');
select is((select count(*)::int from public.brand_access where user_id = '30000000-0000-0000-0000-000000000099'), 1,
  'P3: brandurile duplicate se acordă o singură dată');
select is((select granted_by from public.brand_access where user_id = '30000000-0000-0000-0000-000000000099'),
  '30000000-0000-0000-0000-000000000001'::uuid, 'P3: granted_by = cine a invitat');
select ok(exists (select 1 from public.audit_events where action = 'user_invited' and actor_type = 'user'
  and actor_user_id = '30000000-0000-0000-0000-000000000001' and after ->> 'user_id' = '30000000-0000-0000-0000-000000000099'),
  'P3: invitația e auditată cu actorul real');

select tests.authenticate_as_service_role();
select is((select full_name from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where user_id = '30000000-0000-0000-0000-000000000099'),
  'Ana Nouă', 'P3: persoana invitată apare cu numele din cont');
select is((select last_sign_in_at from public.tenant_people_for('30000000-0000-0000-0000-000000000001') where user_id = '30000000-0000-0000-0000-000000000099'),
  null, 'P3: fără autentificare încă');
reset role;

select * from finish();
rollback;
