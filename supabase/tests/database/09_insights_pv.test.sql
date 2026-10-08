-- Analize, recomandări, acțiuni și farmacovigilență. Date SINTETICE, doar în acest fișier.
-- brand 1A = 2000…0011 · 1B = …0012 (T1) · 2A = …0021 (T2)
-- admin T1 = 3000…01 · strategist T1 (acces 1A) = …02 · account T1 (acces 1B) = …03 · client T1 (acces 1A) = …04
-- client fără acces = …05 · admin T2 = …11 · strategist T2 (acces 2A) = …12
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table ids (name text primary key, id uuid not null);
grant select, insert on ids to authenticated, service_role;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
create function pg_temp.keep(p_name text, p_title text) returns void language sql as $$
  insert into ids select p_name, id from public.insights where title = p_title
$$;

-- Date de sursă (ca owner): gsc 1A, 7 zile × 10 clicks în perioadă, 7 × 5 în perioada de comparație.
insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id) values
  ('50000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'gsc', 'sc-domain:test');
insert into public.search_daily (tenant_id, brand_id, date, device, clicks, impressions, position, source_id, collected_at, payload_hash, source_timezone, data_state, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', d::date, 'DESKTOP',
       case when d::date >= '2026-10-01' then 10 else 5 end, 100, 3, '50000000-0000-0000-0000-000000000099', now(), repeat('a', 64), 'America/Los_Angeles', 'final', 'test'
from generate_series('2026-09-24'::date, '2026-10-07'::date, interval '1 day') d;

-- ===== Analize: drafturi, vizibilitate, câmpuri ====================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Analiză A', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000002') $$,
  'I1: strategist cu acces creează un draft'
);
select throws_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id, status)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Fals', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000002', 'published') $$,
  '42501', null, 'I1: statusul nu se poate seta la inserare (coloană neacordată)'
);
select throws_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Autor fals', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'I1: autorul trebuie să fie utilizatorul curent'
);
select throws_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'Fără acces la 1B', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'I1: strategist fără brand_access nu creează analize pe alt brand'
);
reset role;
select pg_temp.keep('A', 'Analiză A');
select is((select status from public.insights where title = 'Analiză A'), 'draft', 'I1: statusul inițial e draft');
select is((select version from public.insights where title = 'Analiză A'), 1, 'I1: versiunea inițială e 1');

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
update public.insights set summary = 'Clicks în creștere', interpretation = 'Posibilă creștere sezonieră', limits = 'Perioadă scurtă', title = 'Analiză A' where id = pg_temp.id('A');
select is((select summary from public.insights where id = pg_temp.id('A')), 'Clicks în creștere', 'I2: autorul își editează draftul');
select throws_ok($$ update public.insights set status = 'published' where id = pg_temp.id('A') $$, '42501', null, 'I2: status nu se actualizează direct (coloană neacordată)');
select throws_ok($$ update public.insights set author_id = '30000000-0000-0000-0000-000000000001' where id = pg_temp.id('A') $$, '42501', null, 'I2: autorul nu se schimbă');
select throws_ok($$ update public.insights set brand_id = '20000000-0000-0000-0000-000000000012' where id = pg_temp.id('A') $$, '42501', null, 'I2: brandul nu se schimbă');
reset role;

-- clientul nu vede draftul (nici prin ID direct)
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.insights $$, 'I3: clientul nu vede nicio analiză în draft');
select is_empty($$ select 1 from public.insights where id = pg_temp.id('A') $$, 'I3: clientul nu vede draftul nici cu ID-ul direct');
select throws_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'De la client', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'I3: clientul nu creează analize'
);
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000012');
select is_empty($$ select 1 from public.insights $$, 'I3: strategist din alt tenant nu vede analiza');
reset role;

-- ===== Dovezi ==========================================================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'metric', 'metrica_inexistenta') $$,
  '22023', null, 'E1: metrică necunoscută respinsă');
select throws_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key, options) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'metric', 'gsc_clicks', '{"tenant_id": "x"}') $$,
  '22023', null, 'E1: opțiuni nepermise respinse');
select throws_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, record_table, record_id) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'record', 'auth.users', '1') $$,
  '23514', null, 'E1: înregistrare dintr-un tabel din afara listei respinsă');
select throws_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'metric') $$,
  '23514', null, 'E1: dovada de tip metric cere metric_key');

-- trimitere la review fără dovezi: lipsesc câmpuri
select throws_ok(
  $$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'in_review') $$,
  '23514', null, 'T1: draft → in_review fără dovezi respins (lipsesc dovezi)');
select lives_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'metric', 'gsc_clicks') $$,
  'E1: dovadă de tip metrică');
select lives_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, record_table, record_id) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'record', 'mentions', 'm-ev') $$,
  'E1: dovadă de tip înregistrare');
select throws_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'metric', 'gsc_clicks') $$,
  '23505', null, 'E1: aceeași metrică de două ori în aceeași analiză respinsă');
select lives_ok(
  $$ insert into public.recommendations (tenant_id, brand_id, insight_id, problem, action, expected_benefit, verification_metric_key, priority)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'Clicks sub țintă', 'Actualizăm pagina X', 'Mai multe clicks', 'gsc_clicks', 2) $$,
  'R1: recomandare cu toate câmpurile');
select throws_ok(
  $$ insert into public.recommendations (tenant_id, brand_id, insight_id, problem, action, expected_benefit, priority)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'p', 'a', 'b', 5) $$,
  '23514', null, 'R1: prioritate în afara scării 1–3 respinsă');
reset role;

-- ===== Tranziții: draft → in_review → draft → in_review ==========================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'published') $$, '23514', null, 'T2: draft → published direct respins');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'in_review') $$, 'T2: draft → in_review (câmpuri complete)');
select is((select status from public.insights where id = pg_temp.id('A')), 'in_review', 'T2: statusul a devenit in_review');
select isnt((select submitted_at from public.insights where id = pg_temp.id('A')), null, 'T2: submitted_at completat');
update public.insights set title = 'Modificat în review' where id = pg_temp.id('A');
select is((select title from public.insights where id = pg_temp.id('A')), 'Analiză A', 'T2: o analiză în review nu se editează');
select throws_ok(
  $$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A'), 'metric', 'gsc_impressions') $$,
  '42501', null, 'T2: dovezile nu se adaugă după trimiterea la review');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'in_review') $$, '23514', null, 'T2: in_review → in_review respins');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.insights where id = pg_temp.id('A') $$, 'T3: clientul nu vede analiza în review');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status, reason) values (pg_temp.id('A'), 'draft', 'x') $$, '42501', null, 'T3: clientul nu face tranziții');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000012');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status, reason) values (pg_temp.id('A'), 'draft', 'x') $$, '42501', null, 'T3: strategist din alt tenant nu face tranziții');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'published') $$, '42501', null, 'T3: admin din alt tenant nu publică');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'draft') $$, '23514', null, 'T4: returnarea la draft cere motiv');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status, reason) values (pg_temp.id('A'), 'draft', 'Mai adăugăm o dovadă') $$, 'T4: in_review → draft cu motiv');
select is((select status from public.insights where id = pg_temp.id('A')), 'draft', 'T4: înapoi în draft');
select is((select submitted_at from public.insights where id = pg_temp.id('A')), null, 'T4: submitted_at golit');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'in_review') $$, 'T4: retrimis la review');
reset role;

-- Roluri la publicare: account pe brandul lui (1B) trimite la review, dar nu publică.
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id, summary, interpretation, limits)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'Analiză B', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000003', 's', 'i', 'l');
reset role;
select pg_temp.keep('B', 'Analiză B');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, record_table, record_id) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', pg_temp.id('B'), 'record', 'mentions', 'm-b');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('B'), 'in_review') $$, 'P0: account trimite la review');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('B'), 'published') $$, '42501', null, 'P0: account nu publică (doar strategist sau agency_admin)');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status, reason) values (pg_temp.id('B'), 'draft', 'x') $$, '42501', null, 'P0: account nu returnează la draft');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('B'), 'published') $$, '42501', null, 'P0: strategist fără acces la 1B nu publică analiza lui 1B');
reset role;

-- ===== Publicare: snapshot prin metrics.compute ==========================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A'), 'published') $$, 'P1: strategist publică analiza A');
reset role;
select is((select status from public.insights where title = 'Analiză A'), 'published', 'P1: status published');
select is((select published_by from public.insights where title = 'Analiză A'), '30000000-0000-0000-0000-000000000002'::uuid, 'P1: publicat de strategist');
select isnt((select published_at from public.insights where title = 'Analiză A'), null, 'P1: published_at completat');
select is((select count(*)::int from public.insight_snapshots where insight_id = pg_temp.id('A')), 1, 'P2: un snapshot per metrică citată (înregistrările nu au snapshot)');
select is((select (result -> 'metric' ->> 'value')::numeric from public.insight_snapshots where insight_id = pg_temp.id('A')), 70::numeric, 'P2: snapshot = metrics.compute: 7 zile × 10 clicks');
select is((select (result -> 'metric' ->> 'comparison_value')::numeric from public.insight_snapshots where insight_id = pg_temp.id('A')), 35::numeric, 'P2: comparația = perioada anterioară de aceeași lungime');
select is((select (result -> 'metric' ->> 'absolute_change')::numeric from public.insight_snapshots where insight_id = pg_temp.id('A')), 35::numeric, 'P2: variația absolută');
select is((select metric_definition_version from public.insight_snapshots where insight_id = pg_temp.id('A')), 1, 'P2: versiunea definiției e păstrată');
select is((select count(*)::int from public.insight_transitions where insight_id = pg_temp.id('A')), 4, 'P2: jurnalul de tranziții are cele 4 evenimente');
select results_eq(
  $$ select from_status || '>' || to_status from public.insight_transitions where insight_id = pg_temp.id('A') order by id $$,
  $$ values ('draft>in_review'), ('in_review>draft'), ('draft>in_review'), ('in_review>published') $$,
  'P2: from_status se completează de trigger');

-- Snapshotul rămâne neschimbat după o corecție a datelor sursă și nu se modifică.
update public.search_daily set clicks = 1000 where date = '2026-10-03';
select is((select (result -> 'metric' ->> 'value')::numeric from public.insight_snapshots where insight_id = pg_temp.id('A')), 70::numeric, 'P3: snapshotul rămâne reproductibil după o corecție a datelor');
select throws_ok($$ update public.insight_snapshots set result = '{}' $$, '42501', null, 'P3: snapshotul e imutabil (update)');
select throws_ok($$ delete from public.insight_snapshots $$, '42501', null, 'P3: snapshotul e imutabil (delete)');
update public.search_daily set clicks = 10 where date = '2026-10-03';

-- Analiza publicată: nu se editează, nu se șterge; clientul o vede împreună cu dovezile, snapshotul și recomandările.
select throws_ok($$ update public.insights set title = 'Rescris' where id = pg_temp.id('A') $$, '42501', null, 'P4: analiza publicată nu se editează nici ca owner (trigger)');
select throws_ok($$ delete from public.insights where id = pg_temp.id('A') $$, '42501', null, 'P4: analiza publicată nu se șterge');
select throws_ok($$ update public.recommendations set action = 'Altceva' where insight_id = pg_temp.id('A') $$, '42501', null, 'P4: recomandarea publicată nu se modifică în tăcere');
select throws_ok($$ delete from public.evidence_links where insight_id = pg_temp.id('A') $$, '42501', null, 'P4: dovezile publicate nu se șterg');

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select title from public.insights $$, $$ values ('Analiză A') $$, 'P5: clientul cu acces vede analiza publicată');
select results_eq($$ select count(*)::int from public.evidence_links $$, $$ values (2) $$, 'P5: clientul vede dovezile');
select results_eq($$ select count(*)::int from public.insight_snapshots $$, $$ values (1) $$, 'P5: clientul vede snapshotul');
select results_eq($$ select count(*)::int from public.recommendations $$, $$ values (1) $$, 'P5: clientul vede recomandările');
select is_empty($$ select 1 from public.insight_transitions $$, 'P5: clientul nu vede jurnalul intern de tranziții');
update public.insights set title = 'De la client' where id = pg_temp.id('A');
delete from public.insights where id = pg_temp.id('A');
reset role;
select ok(exists (select 1 from public.insights where id = pg_temp.id('A')), 'P5: clientul nu șterge (RLS filtrează)');
select is((select title from public.insights where id = pg_temp.id('A')), 'Analiză A', 'P5: clientul nu modifică analiza');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is_empty($$ select 1 from public.insights $$, 'P5: clientul fără brand_access nu vede nimic');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.insights $$, 'P5: admin din alt tenant nu vede analiza');
select is_empty($$ select 1 from public.insight_snapshots $$, 'P5: nici snapshoturile');
reset role;

-- ===== Înlocuirea (versiune nouă) =========================================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id, supersedes_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'V2 pe draft', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000002', pg_temp.id('B')) $$,
  '22023', null, 'S0: nu se poate înlocui o analiză nepublicată sau din alt brand (același mesaj, fără a confirma existența)');
select lives_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id, supersedes_id, summary, interpretation, limits)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Analiză A v2', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000002', pg_temp.id('A'), 'Constatare revizuită', 'Interpretare revizuită', 'Limite revizuite') $$,
  'S1: versiune nouă care înlocuiește analiza publicată');
select throws_ok(
  $$ insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id, supersedes_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'A v2 bis', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000002', pg_temp.id('A')) $$,
  '23505', null, 'S1: o singură versiune de înlocuire în lucru');
reset role;
select pg_temp.keep('A2', 'Analiză A v2');
select is((select version from public.insights where id = pg_temp.id('A2')), 2, 'S1: versiunea crește');
select is((select status from public.insights where id = pg_temp.id('A2')), 'draft', 'S1: versiunea nouă începe în draft');
select is((select count(*)::int from public.evidence_links where insight_id = pg_temp.id('A2')), 2, 'S1: dovezile se copiază în versiunea nouă');
select is((select count(*)::int from public.recommendations where insight_id = pg_temp.id('A2')), 1, 'S1: recomandările se copiază');
select is((select status from public.insights where id = pg_temp.id('A')), 'published', 'S1: versiunea veche rămâne publicată până la publicarea celei noi');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select title from public.insights $$, $$ values ('Analiză A') $$, 'S1: clientul vede în continuare doar versiunea publicată');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A2'), 'in_review') $$, 'S2: v2 trimisă la review');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('A2'), 'published') $$, 'S2: v2 publicată');
reset role;
select is((select status from public.insights where id = pg_temp.id('A')), 'superseded', 'S2: versiunea veche devine superseded');
select is((select superseded_by_id from public.insights where id = pg_temp.id('A')), pg_temp.id('A2'), 'S2: versiunea veche e legată de cea nouă');
select is((select supersedes_id from public.insights where id = pg_temp.id('A2')), pg_temp.id('A'), 'S2: versiunea nouă e legată de cea veche');
select is((select count(*)::int from public.insight_snapshots where insight_id = pg_temp.id('A')), 1, 'S2: istoricul (snapshotul versiunii vechi) se păstrează');
select is((select count(*)::int from public.insight_snapshots where insight_id = pg_temp.id('A2')), 1, 'S2: versiunea nouă are propriul snapshot');
select throws_ok($$ update public.insights set title = 'x' where id = pg_temp.id('A') $$, '42501', null, 'S2: nici analiza superseded nu se editează');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select title from public.insights $$, $$ values ('Analiză A v2') $$, 'S3: clientul vede doar versiunea curentă, nu pe cea superseded');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select results_eq($$ select count(*)::int from public.insights $$, $$ values (2) $$, 'S3: agenția vede istoricul (ambele versiuni)');
reset role;

-- ===== Metrici fără sursă / fără opțiuni ================================================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id, summary, interpretation, limits)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Analiză C', '2026-10-01', '2026-10-07', '30000000-0000-0000-0000-000000000002', 's', 'i', 'l');
reset role;
select pg_temp.keep('C', 'Analiză C');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('C'), 'metric', 'seomonitor_keywords_top3');
insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('C'), 'metric', 'meta_ads_clicks');
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('C'), 'in_review');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('C'), 'published') $$, '22023', null, 'P6: SEOmonitor fără device nu poate fi înghețat (publicarea eșuează)');
reset role;
select is((select status from public.insights where id = pg_temp.id('C')), 'in_review', 'P6: publicarea eșuată nu schimbă statusul');
select is((select count(*)::int from public.insight_snapshots where insight_id = pg_temp.id('C')), 0, 'P6: și nu lasă snapshoturi parțiale');

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status, reason) values (pg_temp.id('C'), 'draft', '') $$, '23514', null, 'P6: motiv gol respins');
insert into public.insight_transitions (insight_id, to_status, reason) values (pg_temp.id('C'), 'draft', 'Adăugăm device');
delete from public.evidence_links where insight_id = pg_temp.id('C');
insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key, options) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('C'), 'metric', 'seomonitor_keywords_top3', '{"device": "desktop"}');
insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('C'), 'metric', 'meta_ads_clicks');
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('C'), 'in_review');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id('C'), 'published') $$, 'P6: cu device, publicarea reușește');
reset role;
select is((select result -> 'metric' ->> 'status' from public.insight_snapshots where insight_id = pg_temp.id('C') and metric_key = 'meta_ads_clicks'), 'not_connected',
  'P6: metrică fără sursă conectată → snapshot cu status not_connected, nu o valoare inventată');
select is((select result -> 'metric' ->> 'value' from public.insight_snapshots where insight_id = pg_temp.id('C') and metric_key = 'meta_ads_clicks'), null, 'P6: value null (nu 0)');
select is((select result -> 'metric' ->> 'status' from public.insight_snapshots where insight_id = pg_temp.id('C') and metric_key = 'seomonitor_keywords_top3'), 'unavailable',
  'P6: sursă conectată, dar fără observații → unavailable (nu zero)');
select is((select options from public.insight_snapshots where insight_id = pg_temp.id('C') and metric_key = 'seomonitor_keywords_top3'), '{"device": "desktop"}'::jsonb, 'P6: opțiunile (device) se păstrează în snapshot');

-- ===== Acțiuni =====================================================================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, responsible_user_id) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A2'), 'Act', '30000000-0000-0000-0000-000000000004') $$,
  '23514', null, 'X1: responsabilul trebuie să fie din agenție (nu client_viewer)');
select throws_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, responsible_user_id) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A2'), 'Act', '30000000-0000-0000-0000-000000000011') $$,
  '23514', null, 'X1: responsabil din alt tenant respins (nu e membru activ al agenției; FK compus ca a doua barieră)');
select throws_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, responsible_user_id, status) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A2'), 'Act', '30000000-0000-0000-0000-000000000002', 'done') $$,
  '42501', null, 'X1: statusul nu se setează la inserare');
select lives_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, description, responsible_user_id, due_date)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A2'), 'Actualizăm pagina X', 'Detalii', '30000000-0000-0000-0000-000000000002', '2026-11-15') $$,
  'X1: acțiune creată (proposed)');
select lives_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, responsible_user_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id('A2'), 'Acțiune de anulat', '30000000-0000-0000-0000-000000000002') $$,
  'X1: a doua acțiune');
reset role;
insert into ids select 'X1', id from public.actions where title = 'Actualizăm pagina X';
insert into ids select 'X2', id from public.actions where title = 'Acțiune de anulat';
select is((select status from public.actions where id = pg_temp.id('X1')), 'proposed', 'X1: statusul inițial e proposed');
select is((select created_by from public.actions where id = pg_temp.id('X1')), '30000000-0000-0000-0000-000000000002'::uuid, 'X1: created_by = utilizatorul curent');

-- clientul nu vede propunerile
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.actions $$, 'X2: clientul nu vede acțiunile doar propuse');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ update public.actions set status = 'done' where id = pg_temp.id('X1') $$, '42501', null, 'X3: status nu se actualizează direct');
select lives_ok($$ update public.actions set due_date = '2026-11-30' where id = pg_temp.id('X1') $$, 'X3: termenul se editează direct');
select throws_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X1'), 'done') $$, '23514', null, 'X4: proposed → done respins');
select throws_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X1'), 'cancelled') $$, '23514', null, 'X4: anularea cere motiv');
select lives_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X1'), 'agreed') $$, 'X4: proposed → agreed');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select title from public.actions $$, $$ values ('Actualizăm pagina X') $$, 'X5: clientul vede acțiunea agreată a analizei publicate');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X1'), 'done') $$, '23514', null, 'X4: agreed → done respins');
select lives_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X1'), 'in_progress') $$, 'X4: agreed → in_progress');
select lives_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X1'), 'done') $$, 'X4: in_progress → done');
select throws_ok($$ insert into public.action_transitions (action_id, to_status, implemented_at) values (pg_temp.id('X1'), 'measured', '2026-10-01') $$, '23514', null, 'X4: measured cere result_note');
select lives_ok($$ insert into public.action_transitions (action_id, to_status, result_note) values (pg_temp.id('X1'), 'measured', 'Clicks +12% după 4 crawluri') $$, 'X4: done → measured cu rezultat');
select throws_ok($$ insert into public.action_transitions (action_id, to_status, reason) values (pg_temp.id('X1'), 'cancelled', 'x') $$, '23514', null, 'X4: measured e terminal');
select throws_ok($$ update public.actions set title = 'Rescris' where id = pg_temp.id('X1') $$, '42501', null, 'X4: o acțiune measured nu se mai modifică');
reset role;
select is((select implemented_at from public.actions where id = pg_temp.id('X1')), (now() at time zone 'Europe/Bucharest')::date, 'X4: data implementării completată la done (Europe/Bucharest)');
select is((select result_note from public.actions where id = pg_temp.id('X1')), 'Clicks +12% după 4 crawluri', 'X4: rezultatul urmărit păstrat');
select results_eq(
  $$ select from_status || '>' || to_status from public.action_transitions where action_id = pg_temp.id('X1') order by id $$,
  $$ values ('proposed>agreed'), ('agreed>in_progress'), ('in_progress>done'), ('done>measured') $$, 'X4: jurnalul de tranziții al acțiunii');

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.action_transitions (action_id, to_status, reason) values (pg_temp.id('X2'), 'cancelled', 'Prioritate schimbată') $$, 'X5: proposed → cancelled cu motiv');
select throws_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X2'), 'agreed') $$, '23514', null, 'X5: cancelled e terminal');
reset role;
select is((select status_reason from public.actions where id = pg_temp.id('X2')), 'Prioritate schimbată', 'X5: motivul anulării păstrat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select count(*)::int from public.actions $$, $$ values (1) $$, 'X5: clientul nu vede acțiunea anulată');
select throws_ok($$ insert into public.action_transitions (action_id, to_status) values (pg_temp.id('X1'), 'cancelled') $$, '42501', null, 'X5: clientul nu face tranziții');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000012');
select throws_ok($$ insert into public.action_transitions (action_id, to_status, reason) values (pg_temp.id('X2'), 'cancelled', 'x') $$, '42501', null, 'X6: strategist din alt tenant nu face tranziții');
select is_empty($$ select 1 from public.actions $$, 'X6: nici nu vede acțiunile');
reset role;

-- ===== Farmacovigilență ==================================================================================================================================

-- date de test pentru entități (ca owner)
insert into public.import_batches (id, tenant_id, brand_id, source, file_sha256, status, uploaded_by) values
  ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable_listening', repeat('9', 64), 'imported', '30000000-0000-0000-0000-000000000003');
insert into public.mentions (tenant_id, brand_id, native_id, url, published_at, text, import_batch_id, row_number, collected_at, payload_hash, source_timezone, schema_version) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'm-pv', 'https://exemplu.ro/relatare', now(), 'Text original al mențiunii', '60000000-0000-0000-0000-0000000000a1', 1, now(), repeat('b', 64), 'UTC', 'csv-1'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'm-pv2', 'https://exemplu.ro/alta', now(), null, '60000000-0000-0000-0000-0000000000a1', 2, now(), repeat('b', 64), 'UTC', 'csv-1');
insert into public.ai_answers (id, tenant_id, brand_id, source_id, campaign_id, engine, surface, keyword_id, crawl_at, content, my_brand_present, status, attributed_group_id, mapping_version, collected_at, payload_hash, schema_version) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000011', 'c', 'openai', 'ai_search', 'k1', '2026-10-05', 'Răspuns AI original', false, 'brand_absent', 'g', 1, now(), repeat('c', 64), 'test');

-- contacte: doar agency_admin
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.pv_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000001', 'pv@agentie.ro') $$, '42501', null, 'V1: strategistul nu configurează contactele PV');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.pv_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000001', 'nu-e-email') $$, '23514', null, 'V1: e-mail invalid respins');
select lives_ok($$ insert into public.pv_contacts (tenant_id, email, name) values ('10000000-0000-0000-0000-000000000001', 'PV@Agentie.ro', 'Farmacovigilență') $$, 'V1: agency_admin adaugă un contact');
select throws_ok($$ insert into public.pv_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000001', 'pv@agentie.ro') $$, '23505', null, 'V1: același e-mail (fără diferență de majuscule) nu se dublează');
select throws_ok($$ insert into public.pv_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000002', 'x@agentie.ro') $$, '42501', null, 'V1: admin T1 nu adaugă contacte pe tenantul T2');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.pv_contacts $$, 'V1: admin T2 nu vede contactele din T1');
reset role;

-- marcare
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ insert into public.pv_flags (brand_id, entity_type, entity_ref, text_snapshot, link) values ('20000000-0000-0000-0000-000000000011', 'mention', 'm-pv', 'TEXT FALS DE LA UTILIZATOR', 'https://fals.example') $$,
  'V2: strategist marchează o mențiune');
select throws_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'mention', 'nu-exista') $$, '23503', null, 'V2: mențiune inexistentă respinsă');
select throws_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'review', 'r1') $$, '23514', null, 'V2: review fără text furnizat respins');
select lives_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref, text_snapshot, link) values ('20000000-0000-0000-0000-000000000011', 'review', 'r1', 'Text din review', 'https://magazin.example/r1') $$, 'V2: review cu text furnizat');
select lives_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'ai_answer', '70000000-0000-0000-0000-000000000001') $$, 'V2: răspuns AI');
select throws_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'ai_answer', 'nu-e-uuid') $$, '22023', null, 'V2: ID de răspuns AI invalid');
select lives_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'mention', 'm-pv2') $$, 'V2: mențiune fără text în sursă');
select throws_ok(
  $$ insert into public.pv_flags (brand_id, entity_type, entity_ref, status) values ('20000000-0000-0000-0000-000000000011', 'mention', 'm-pv', 'closed') $$,
  '42501', null, 'V2: statusul nu se setează la marcare');
reset role;
select is((select text_snapshot from public.pv_flags where entity_ref = 'm-pv'), 'Text original al mențiunii', 'V3: snapshotul vine din entitate, nu de la utilizator');
select is((select link from public.pv_flags where entity_ref = 'm-pv'), 'https://exemplu.ro/relatare', 'V3: linkul vine din entitate');
select is((select snapshot_source from public.pv_flags where entity_ref = 'm-pv'), 'entity', 'V3: sursa snapshotului = entity');
select is((select snapshot_source from public.pv_flags where entity_ref = 'r1'), 'user_provided', 'V3: la review snapshotul e etichetat user_provided');
select is((select text_snapshot from public.pv_flags where entity_type = 'ai_answer'), 'Răspuns AI original', 'V3: snapshot pentru răspuns AI');
select is((select text_snapshot from public.pv_flags where entity_ref = 'm-pv2'), '(mențiune fără text în sursă)', 'V3: mențiune fără text: marcaj explicit, nu text inventat');
select is((select flagged_by from public.pv_flags where entity_ref = 'm-pv'), '30000000-0000-0000-0000-000000000002'::uuid, 'V3: utilizatorul = cel autentificat');
select is((select status from public.pv_flags where entity_ref = 'm-pv'), 'open', 'V3: status inițial open');
select is((select tenant_id from public.pv_flags where entity_ref = 'm-pv'), '10000000-0000-0000-0000-000000000001'::uuid, 'V3: tenant_id derivat din brand, nu de la client');
select is((select count(*)::int from public.pv_flag_events where event_type = 'marked'), 4, 'V3: evenimentul „marked” în jurnal pentru fiecare marcaj');

-- coada de notificări: niciodată pierdută
select is((select count(*)::int from public.pv_notifications), (select count(*)::int from public.pv_flags), 'N1: fiecare marcaj are o notificare în coadă');
select is((select count(*)::int from public.pv_notifications where status = 'pending' and attempts = 0), 4, 'N1: toate sunt pending (fără trimitere, nimic nu se pierde)');
select is((select count(*)::int from public.pv_notifications where status = 'pending' and recipients is null), 4, 'N1: destinatarii se rezolvă la trimitere, nu la marcare');

-- vizibilitate
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select results_eq($$ select count(*)::int from public.pv_flags $$, $$ values (4) $$, 'V4: agency_admin vede toate marcajele din tenant');
select results_eq($$ select count(*)::int from public.pv_flag_events $$, $$ values (4) $$, 'V4: agency_admin vede jurnalul');
select results_eq($$ select count(*)::int from public.pv_notifications $$, $$ values (4) $$, 'V4: agency_admin vede coada');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select results_eq($$ select count(*)::int from public.pv_flags $$, $$ values (4) $$, 'V4: strategistul își vede marcajele');
select is_empty($$ select 1 from public.pv_flag_events $$, 'V4: strategistul nu vede jurnalul (doar agency_admin)');
select is_empty($$ select 1 from public.pv_notifications $$, 'V4: nici coada');
select throws_ok($$ update public.pv_flags set text_snapshot = 'rescris' $$, '42501', null, 'V4: snapshotul nu se modifică (coloană neacordată)');
select throws_ok($$ update public.pv_flags set status = 'closed' $$, '42501', null, 'V4: statusul nu se modifică direct');
select throws_ok($$ delete from public.pv_flags $$, '42501', null, 'V4: marcajele nu se șterg');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.pv_flags $$, 'V4: clientul nu vede marcajele');
select is_empty($$ select 1 from public.pv_flag_events $$, 'V4: clientul nu vede jurnalul');
select throws_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'mention', 'm-pv') $$, '42501', null, 'V4: clientul nu marchează');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is_empty($$ select 1 from public.pv_flags $$, 'V4: account fără acces la 1A nu vede marcajele lui 1A');
select throws_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'mention', 'm-pv') $$, '42501', null, 'V4: account fără acces nu marchează pe 1A');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.pv_flags $$, 'V4: admin T2 nu vede marcajele din T1');
select throws_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref) values ('20000000-0000-0000-0000-000000000011', 'mention', 'm-pv') $$, '42501', null, 'V4: admin T2 nu marchează în T1');
reset role;

-- tranziții de status prin jurnal
insert into ids select 'F1', id from public.pv_flags where entity_ref = 'm-pv';
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F1'), 'closed') $$, '23514', null, 'W1: open → closed respins (se transmite întâi)');
select throws_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F1'), 'marked') $$, '42501', null, 'W1: „marked” îl scrie doar sistemul');
select throws_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F1'), 'notification_sent') $$, '42501', null, 'W1: „notification_sent” îl scrie doar sistemul');
select lives_ok($$ insert into public.pv_flag_events (flag_id, event_type, note) values (pg_temp.id('F1'), 'note', 'Verificat cu echipa') $$, 'W1: notă în jurnal');
select lives_ok($$ insert into public.pv_flag_events (flag_id, event_type, note) values (pg_temp.id('F1'), 'transmitted', 'Trimis la contactul clientului') $$, 'W1: open → transmitted');
select is((select status from public.pv_flags where id = pg_temp.id('F1')), 'transmitted', 'W1: status transmitted');
select throws_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F1'), 'transmitted') $$, '23514', null, 'W1: transmitted → transmitted respins');
select lives_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F1'), 'closed') $$, 'W1: transmitted → closed');
select is((select status from public.pv_flags where id = pg_temp.id('F1')), 'closed', 'W1: status closed');
select throws_ok($$ update public.pv_flag_events set note = 'x' $$, '42501', null, 'W1: jurnalul e append-only (update)');
select throws_ok($$ delete from public.pv_flag_events $$, '42501', null, 'W1: jurnalul e append-only (delete)');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F1'), 'note') $$, '42501', null, 'W1: strategistul nu scrie în jurnal');
reset role;
select results_eq(
  $$ select event_type from public.pv_flag_events where flag_id = pg_temp.id('F1') order by id $$,
  $$ values ('marked'), ('note'), ('transmitted'), ('closed') $$, 'W1: jurnalul păstrează secvența');

-- sistemul (service role): trimitere reușită → notified
insert into ids select 'F2', id from public.pv_flags where entity_ref = 'r1';
select tests.authenticate_as_service_role();
select lives_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F2'), 'no_contacts') $$, 'W2: sistemul poate nota lipsa contactelor');
select is((select status from public.pv_flags where id = pg_temp.id('F2')), 'open', 'W2: fără contacte, marcajul rămâne open (și notificarea pending)');
select lives_ok($$ insert into public.pv_flag_events (flag_id, event_type, note) values (pg_temp.id('F2'), 'notification_failed', 'HTTP 500') $$, 'W2: eșec de trimitere în jurnal');
select lives_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F2'), 'notification_sent') $$, 'W2: trimitere reușită');
select is((select status from public.pv_flags where id = pg_temp.id('F2')), 'notified', 'W2: open → notified');
select throws_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F2'), 'closed') $$, '42501', null, 'W2: sistemul nu închide marcaje');
select lives_ok($$ update public.pv_notifications set status = 'sent', sent_at = now(), attempts = 2, recipients = array['pv@agentie.ro'] where flag_id = pg_temp.id('F2') $$, 'W2: service role actualizează coada');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.pv_flag_events (flag_id, event_type) values (pg_temp.id('F2'), 'transmitted') $$, 'W3: notified → transmitted');
reset role;

-- ===== Audit ===================================================================================================================================================

select ok(exists (select 1 from public.audit_events where entity_type = 'insights' and action = 'update' and actor_user_id = '30000000-0000-0000-0000-000000000002' and (after ->> 'status') = 'published'),
  'U1: publicarea e auditată cu actorul');
select ok(exists (select 1 from public.audit_events where entity_type = 'actions' and action = 'insert' and actor_user_id = '30000000-0000-0000-0000-000000000002'), 'U1: crearea acțiunii e auditată');
select ok(exists (select 1 from public.audit_events where entity_type = 'pv_contacts' and action = 'insert' and actor_user_id = '30000000-0000-0000-0000-000000000001'), 'U1: configurarea contactelor PV e auditată');
select is_empty($$ select 1 from public.audit_events where entity_type = 'pv_flags' $$, 'U1: textul sensibil al marcajelor nu se duplică în audit_events');

select * from finish();
rollback;
