-- Gărzi de inventar: pică dacă apare un obiect nou care ar putea ocoli izolarea.
-- Vezi docs/security-tests.md (secțiunea A).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- A1. RLS pe toate tabelele expuse ------------------------------------------------
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'A1: toate tabelele din public au RLS activ'
);

-- A2. Politici explicite pentru toate cele 4 comenzi pe fiecare tabel ---------------
select is_empty(
  $$ select c.relname || ':' || cmd
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as cmd
     where n.nspname = 'public' and c.relkind = 'r'
       and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname and p.cmd = cmd) $$,
  'A2: fiecare tabel are politică explicită pe SELECT, INSERT, UPDATE, DELETE'
);

-- A3. Nicio politică permisivă true -------------------------------------------------
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
     where schemaname in ('public', 'storage')
       and (trim(qual) in ('true', '(true)') or trim(with_check) in ('true', '(true)')) $$,
  'A3: nicio politică true'
);

-- A4. Politicile se aplică doar lui authenticated (nu public/anon) --------------------
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
     where schemaname = 'public' and roles <> '{authenticated}' $$,
  'A4: toate politicile sunt restrânse la rolul authenticated'
);

-- A5. anon nu are niciun privilegiu pe tabelele din public ----------------------------
select is_empty(
  $$ select table_name || ':' || privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'PUBLIC') $$,
  'A5: anon și PUBLIC nu au privilegii pe tabele'
);
select is_empty(
  $$ select table_name || '.' || column_name from information_schema.column_privileges
     where table_schema = 'public' and grantee in ('anon', 'PUBLIC') $$,
  'A5: anon și PUBLIC nu au privilegii pe coloane'
);

-- A6. authenticated nu are TRUNCATE / REFERENCES / TRIGGER (TRUNCATE ocolește RLS) -----
select is_empty(
  $$ select table_name || ':' || privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated'
       and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER') $$,
  'A6: authenticated nu are TRUNCATE, REFERENCES sau TRIGGER'
);

-- A7. Coloanele de apartenență nu pot fi modificate de utilizatori -------------------
select is_empty(
  $$ select table_name || '.' || column_name from information_schema.column_privileges
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'UPDATE'
       and column_name in ('id', 'tenant_id', 'user_id', 'granted_by', 'created_by', 'uploaded_by',
                           'competitor_set_id', 'created_at') $$,
  'A7: tenant_id, user_id, id și coloanele de autor nu sunt actualizabile'
);
-- Referința Vault și starea credențialului se scriu doar prin set_source_token / record_source_validation.
select is_empty(
  $$ select privilege_type || ' ' || column_name from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'source_connections' and grantee = 'authenticated'
       and privilege_type in ('INSERT', 'UPDATE')
       and (column_name in ('vault_secret_id', 'credential_updated_by') or column_name like 'credential_%'
            or column_name like 'last_validat%') $$,
  'A7: authenticated nu poate scrie vault_secret_id sau starea credențialului'
);
-- brand_id e actualizabil doar pe source_connections (FK compus îl ține în același tenant).
select results_eq(
  $$ select table_name::text collate "C" from information_schema.column_privileges
     where table_schema = 'public' and grantee = 'authenticated'
       and privilege_type = 'UPDATE' and column_name = 'brand_id' $$,
  $$ values ('source_connections'::text collate "C") $$,
  'A7: brand_id actualizabil doar pe source_connections'
);

-- A8. View-uri: fie niciunul, fie toate security_invoker ------------------------------
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not coalesce('security_invoker=true' = any (c.reloptions), false) $$,
  'A8: orice view din public are security_invoker = true'
);

-- A9. Materialized views nu respectă RLS: interzise în schemele expuse -----------------
select is_empty(
  $$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'graphql_public') and c.relkind = 'm' $$,
  'A9: niciun materialized view în schemele expuse'
);

-- A10. Funcții SECURITY DEFINER --------------------------------------------------------
-- Excepție aprobată (7 oct 2026, docs/security-tests.md): funcțiile server din public, doar pentru service_role.
-- O funcție nouă în public trebuie adăugată explicit în lista de mai jos, după revizuire.
create temporary table allowed_public_functions (name text primary key) on commit drop;
insert into allowed_public_functions values
  ('get_source_token'), ('record_source_validation'), ('set_source_token');

select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname not in (select name from allowed_public_functions) $$,
  'A10/A11: nicio funcție în public în afara listei aprobate'
);
select is_empty(
  $$ select p.proname || ' → ' || r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated']) r
     where n.nspname in ('public', 'graphql_public') and p.prosecdef
       and has_function_privilege(r, p.oid, 'execute') $$,
  'A10: nicio funcție SECURITY DEFINER din schemele expuse nu e executabilă de anon/authenticated'
);
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') $$,
  'A10: nicio funcție din public nu are EXECUTE pentru PUBLIC'
);
select results_eq(
  $$ select p.proname::text collate "C" from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'execute') order by 1 $$,
  $$ values ('get_source_token'::text collate "C"), ('record_source_validation'), ('set_source_token') $$,
  'A10: funcțiile aprobate sunt executabile de service_role'
);
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') $$,
  'A10: orice SECURITY DEFINER are search_path fixat'
);
-- O funcție definer care returnează date (nu boolean/trigger/void) trebuie revizuită manual
-- și adăugată în lista de mai jos după ce verifică accesul în corp.
select is_empty(
  $$ select n.nspname || '.' || p.proname || ' → ' || pg_get_function_result(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and pg_get_function_result(p.oid) not in ('boolean', 'trigger', 'void')
       and not (n.nspname = 'public' and p.proname in (select name from allowed_public_functions)) $$,
  'A10: nicio funcție SECURITY DEFINER nu returnează date, în afara celor aprobate (doar service_role)'
);
-- Funcțiile care primesc un user_id arbitrar nu sunt executabile de clienți.
select ok(not has_function_privilege('authenticated', 'private.user_has_brand_role(uuid, uuid, public.membership_role[])', 'execute'),
  'A10: authenticated nu execută user_has_brand_role');
select ok(not has_function_privilege('authenticated', 'private.user_can_import(uuid, uuid)', 'execute'),
  'A10: authenticated nu execută user_can_import');
select ok(not has_function_privilege('authenticated', 'private.audit_row()', 'execute'),
  'A10: authenticated nu execută audit_row');
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute') $$,
  'A10: anon nu execută nicio funcție din private'
);
-- Lista exactă a funcțiilor private executabile de authenticated (toate primesc doar ID-ul
-- brandului/tenantului și răspund pentru auth.uid(), deci nu sunt oracol pentru alți useri).
select results_eq(
  $$ select p.proname::text collate "C" from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')
     order by 1 $$,
  $$ values ('can_see_tenant'::text collate "C"), ('has_brand_access'), ('has_brand_role'), ('has_role') $$,
  'A10: doar cele 4 funcții de autorizare sunt executabile de authenticated'
);

-- A11. RPC în public: doar lista aprobată (verificat mai sus), niciuna executabilă de clienți --
select is_empty(
  $$ select p.proname || ' → ' || r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated']) r
     where n.nspname = 'public' and has_function_privilege(r, p.oid, 'execute') $$,
  'A11: nicio funcție din public executabilă de anon sau authenticated'
);

-- A12. Storage: niciun bucket public; politicile pe objects nu sunt permisive ----------
select is_empty($$ select id from storage.buckets where public $$, 'A12: niciun bucket public');

-- A13. Realtime: niciun tabel publicat ------------------------------------------------
select is_empty(
  $$ select tablename from pg_publication_tables where pubname = 'supabase_realtime' $$,
  'A13: niciun tabel în publicația supabase_realtime'
);
select ok(not exists (select 1 from pg_publication where puballtables),
  'A13: nicio publicație FOR ALL TABLES');

-- A14. Ca utilizator: funcțiile de autorizare nu dezvăluie existența brandurilor străine --
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is(private.has_brand_access('20000000-0000-0000-0000-000000000021'),
          private.has_brand_access(gen_random_uuid()),
  'A14: brand străin existent și brand inexistent dau același răspuns (fără oracol)');
select ok(not private.has_role('10000000-0000-0000-0000-000000000002',
                               array['agency_admin','strategist','account','client_viewer']::public.membership_role[]),
  'A14: has_role cu tenant străin = false');
select throws_ok(
  $$ select private.user_has_brand_role('30000000-0000-0000-0000-000000000011',
                                        '20000000-0000-0000-0000-000000000021',
                                        array['agency_admin']::public.membership_role[]) $$,
  '42501', null,
  'A14: authenticated nu poate interoga accesul altui utilizator'
);
select throws_ok($$ truncate public.brands $$, '42501', null, 'A14: authenticated nu poate TRUNCATE');
reset role;

select * from finish();
rollback;
