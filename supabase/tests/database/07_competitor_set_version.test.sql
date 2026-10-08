-- create_competitor_set_version: acces, validare, atomicitate, versiuni, audit (docs/security-tests.md, E4 și secțiunea F).
-- Brand 1A (T1): strategist T1 și client T1 au acces · Brand 1B (T1): doar account T1 · T2: admin 3000…0011.
-- admin T1 = 3000…0001 · strategist T1 = 3000…0002 · account T1 = 3000…0003 · client T1 = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v text) on commit drop;
grant all on ctx to public;
insert into ctx values ('today', ((now() at time zone 'Europe/Bucharest')::date)::text);

-- F0. Starea inițială a brandului 1A -----------------------------------------------------
select is((select count(*) from public.competitor_sets where brand_id = '20000000-0000-0000-0000-000000000011'), 1::bigint,
  'F0: brandul 1A pornește cu o singură versiune');
insert into ctx select 'sets_1a', count(*)::text from public.competitor_sets;
insert into ctx select 'members_all', count(*)::text from public.competitor_set_members;

-- F1. Respinși: fără acces, rol greșit, alt tenant, anon ---------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000012', current_date + 30, null, '[{"name":"A"}]') $$,
  '42501', 'Nu ai dreptul să creezi o versiune a setului de competitori pentru acest brand',
  'F1: strategist fără acces la brand e respins');

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null, '[{"name":"A"}]') $$,
  '42501', null, 'F1: client_viewer cu acces la brand e respins');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null, '[{"name":"A"}]') $$,
  '42501', null, 'F1: client_viewer fără acces e respins');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000012', current_date + 30, null, '[{"name":"A"}]') $$,
  '42501', null, 'F1: account (rol nepermis) e respins chiar cu acces la brand');

select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null, '[{"name":"A"}]') $$,
  '42501', 'Nu ai dreptul să creezi o versiune a setului de competitori pentru acest brand',
  'F1: admin al altui tenant e respins pe brandul lui T1');
-- Fără oracol: brand inexistent → aceeași eroare ca brand străin existent.
select throws_ok(
  $$ select * from public.create_competitor_set_version(gen_random_uuid(), current_date + 30, null, '[{"name":"A"}]') $$,
  '42501', 'Nu ai dreptul să creezi o versiune a setului de competitori pentru acest brand',
  'F1: brand inexistent dă același răspuns ca brand străin');

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null, '[{"name":"A"}]') $$,
  '42501', null, 'F1: anon nu execută funcția');
reset role;

select is((select count(*)::text from public.competitor_sets), (select v from ctx where k = 'sets_1a'),
  'F1: nicio versiune creată de apelanții respinși');

-- F2. Validare + atomicitate: nimic parțial -----------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null, '[]') $$,
  '22023', 'Setul de competitori trebuie să aibă între 1 și 10 membri (primit: 0)', 'F2: 0 membri respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null,
       (select jsonb_agg(jsonb_build_object('name', 'C' || n)) from generate_series(1, 11) n)) $$,
  '22023', 'Setul de competitori trebuie să aibă între 1 și 10 membri (primit: 11)', 'F2: 11 membri respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null,
       '[{"name":"Bun"},{"name":"   "}]') $$,
  '22023', 'Membrul 2: numele nu poate fi gol', 'F2: nume gol respins (al doilea membru, primul fusese inserat)');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null,
       '[{"name":"Bun"},{"domain":"x.ro"}]') $$,
  '22023', 'Membrul 2: numele este obligatoriu', 'F2: nume lipsă respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null,
       '[{"name":"Alfa"},{"name":"Beta"},{"name":" alfa "}]') $$,
  '22023', 'Membrul 3: numele „alfa” apare de mai multe ori', 'F2: nume duplicat (fără diferență de majuscule/spații) respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null,
       '[{"name":"Alfa"},{"name":"Beta","color":"red"}]') $$,
  '22023', 'Membrul 2 (Beta): culoarea trebuie să aibă forma #RRGGBB', 'F2: culoare invalidă respinsă');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null,
       '[{"name":"Alfa"},{"name":"Beta","domain":"nu este domeniu"}]') $$,
  '22023', null, 'F2: domeniu invalid respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null, '{"name":"A"}') $$,
  '22023', null, 'F2: membrii care nu sunt listă sunt respinși');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date + 30, null, null) $$,
  '22023', null, 'F2: membri null respinși');
reset role;
select is((select count(*)::text from public.competitor_sets), (select v from ctx where k = 'sets_1a'),
  'F2: nicio versiune parțială după cererile invalide');
select is((select count(*)::text from public.competitor_set_members), (select v from ctx where k = 'members_all'),
  'F2: niciun membru orfan după cererile invalide');

-- F3. Data efectivă -----------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date - 400, null, '[{"name":"A"}]') $$,
  '22023', null, 'F3: effective_from în trecut respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011',
       ((now() at time zone 'Europe/Bucharest')::date) - 1, null, '[{"name":"A"}]') $$,
  '22023', null, 'F3: ieri (Europe/Bucharest) respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', null, null, '[{"name":"A"}]') $$,
  '22023', 'Data de la care se aplică versiunea este obligatorie', 'F3: effective_from null respins');

-- F4. Succes: versiune, membri, normalizare, autor ----------------------------------------
select lives_ok(
  $$ create temporary table r1 on commit drop as
     select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011',
       (now() at time zone 'Europe/Bucharest')::date, '  Rebranding  ',
       '[{"name":" Alfa ","domain":"HTTPS://User@WWW.Alfa.RO:8080/produse?x=1#a","color":"#A1B2C3"},
         {"name":"Beta","domain":"  ","color":null},
         {"name":"Gama","domain":"gama.ro"}]') $$,
  'F4: strategist cu acces creează versiunea pentru brandul 1A, cu data de azi (Europe/Bucharest)');
grant select on r1 to public;
select is((select version from r1), 2, 'F4: versiunea următoare = max + 1');
select is((select member_count from r1), 3, 'F4: member_count');
reset role;
select results_eq(
  $$ select name, domain, color, sort_order from public.competitor_set_members
     where competitor_set_id = (select competitor_set_id from r1) order by sort_order $$,
  $$ values ('Alfa'::text, 'www.alfa.ro'::text, '#A1B2C3'::text, 0), ('Beta', null, null, 1), ('Gama', 'gama.ro', null, 2) $$,
  'F4: nume tăiat, domeniu normalizat (fără schemă, cale, port), domeniu gol → null, ordinea păstrată');
select results_eq(
  $$ select note, created_by, tenant_id, brand_id from public.competitor_sets where id = (select competitor_set_id from r1) $$,
  $$ values ('Rebranding'::text, '30000000-0000-0000-0000-000000000002'::uuid,
             '10000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000011'::uuid) $$,
  'F4: note tăiată, created_by = apelantul, tenant_id din brand');
select is((select count(*) from public.competitor_set_members where competitor_set_id = '40000000-0000-0000-0000-000000000011'), 3::bigint,
  'F4: versiunea 1 are aceiași membri (neatinsă)');

-- F5. Audit: setul și fiecare membru, cu actorul -----------------------------------------
select is(
  (select count(*) from public.audit_events where entity_type = 'competitor_sets' and action = 'insert'
     and entity_id = (select competitor_set_id::text from r1) and actor_user_id = '30000000-0000-0000-0000-000000000002'
     and actor_type = 'user' and brand_id = '20000000-0000-0000-0000-000000000011'),
  1::bigint, 'F5: un eveniment de audit pentru set, cu actor');
select is(
  (select count(*) from public.audit_events where entity_type = 'competitor_set_members' and action = 'insert'
     and (after ->> 'competitor_set_id') = (select competitor_set_id::text from r1)
     and actor_user_id = '30000000-0000-0000-0000-000000000002'),
  3::bigint, 'F5: câte un eveniment de audit pentru fiecare membru');

-- F6. Dată duplicată și creștere de versiune ----------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011',
       (now() at time zone 'Europe/Bucharest')::date, null, '[{"name":"A"}]') $$,
  '23505', null, 'F6: effective_from egal cu o versiune existentă respins');
select lives_ok(
  $$ create temporary table r2 on commit drop as
     select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011',
       (now() at time zone 'Europe/Bucharest')::date + 7, null, '[{"name":"Alfa"}]') $$,
  'F6: a doua versiune nouă');
grant select on r2 to public;
select is((select version from r2), 3, 'F6: versiunea crește la 3');
-- Aceeași tranzacție ține lock-ul advisory al brandului: serializează apelurile concurente.
select cmp_ok((select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()), '>=', 1::bigint,
  'F6: funcția ia lock advisory pe brand (apeluri concurente se serializează)');

-- F7. Alt brand, alt tenant: versiuni independente ----------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select version from public.create_competitor_set_version('20000000-0000-0000-0000-000000000012', current_date + 5, null, '[{"name":"X"}]')),
  2, 'F7: admin T1 pe brandul 1B: versiunea 2 (numărătoare per brand)');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is((select version from public.create_competitor_set_version('20000000-0000-0000-0000-000000000022', current_date + 5, null, '[{"name":"X"}]')),
  2, 'F7: admin T2 pe brandul 2B (agency_admin vede tot tenantul)');

-- F8. Imutabilitatea rămâne -----------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.competitor_sets set note = 'x' $$, '42501', null, 'F8: update pe competitor_sets rămâne interzis');
select throws_ok($$ delete from public.competitor_sets $$, '42501', null, 'F8: delete pe competitor_sets rămâne interzis');
select throws_ok($$ delete from public.competitor_set_members $$, '42501', null, 'F8: delete pe competitor_set_members rămâne interzis');
reset role;

select * from finish();
rollback;
