-- Revocarea se aplică la următorul query, cu același JWT (sesiune existentă). Auditul e append-only.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Revocare brand_access de către admin T1 ------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select results_eq($$ select count(*)::int from public.brands $$, $$ values (1) $$,
  'înainte de revocare: strategist T1 vede 1A');

reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
update public.brand_access set revoked_at = now()
where user_id = '30000000-0000-0000-0000-000000000002'
  and brand_id = '20000000-0000-0000-0000-000000000011';

reset role;
select isnt((select revoked_at from public.brand_access
             where user_id = '30000000-0000-0000-0000-000000000002'
               and brand_id = '20000000-0000-0000-0000-000000000011'), null,
  'admin T1 a revocat accesul strategistului la 1A');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.brands $$,          'după revocare: 0 branduri, același JWT');
select is_empty($$ select 1 from public.sync_runs $$,       'după revocare: 0 sync_runs');
select is_empty($$ select 1 from public.competitor_sets $$, 'după revocare: 0 competitor_sets');
select is_empty($$ select 1 from public.tenants $$,         'după revocare: tenantul nu mai e vizibil');
select throws_ok(
  $$ insert into public.competitor_sets (tenant_id, brand_id, version, effective_from, created_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 3, '2026-12-01',
             '30000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'după revocare: nu mai poate scrie'
);

-- Revocare membership (client T1) --------------------------------------------------
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select count(*)::int from public.brands $$, $$ values (1) $$,
  'înainte de revocarea membership: client vede 1A');

reset role;
update public.memberships set revoked_at = now()
where user_id = '30000000-0000-0000-0000-000000000004';

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.brands $$, 'membership revocat: 0 branduri, deși brand_access rămâne');

-- Arhivarea tenantului suspendă tot accesul, inclusiv pentru admin --------------------
reset role;
update public.tenants set status = 'archived' where id = '10000000-0000-0000-0000-000000000002';
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.brands $$, 'tenant arhivat: admin T2 nu mai vede branduri');

-- Audit ------------------------------------------------------------------------------
reset role;
select ok(
  exists (select 1 from public.audit_events
          where entity_type = 'brand_access' and action = 'update'
            and actor_user_id = '30000000-0000-0000-0000-000000000001'
            and actor_type = 'user'),
  'revocarea e auditată cu actorul admin T1'
);
select ok(
  exists (select 1 from public.audit_events
          where entity_type = 'import_batches' and action = 'insert'
            and actor_user_id = '30000000-0000-0000-0000-000000000003'),
  'importul e auditat cu cine a încărcat (uploaded_by)'
);
select throws_ok($$ update public.audit_events set action = 'x' $$, '42501', null,
  'audit_events nu poate fi modificat nici de owner');
select throws_ok($$ delete from public.audit_events $$, '42501', null,
  'audit_events nu poate fi șters nici de owner');

-- RLS activ pe toate tabelele din public ---------------------------------------------
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'toate tabelele din public au RLS activ'
);
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public' and (qual = 'true' or with_check = 'true') $$,
  'nicio politică permisivă true'
);

select * from finish();
rollback;
