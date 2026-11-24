-- Limba mențiunilor competitorilor, fără text (deciziile AF): matricea de Competiție doar pe română. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · strategist T1 (acces 1A) = 3000…0002 · client T1 (acces 1A) = 3000…0004
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Setul: Competitor 1 (cuvântul = numele) și Competitor 2 (cuvântul „comp2”).
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, 'AF',
    '[{"name":"Competitor 1","domain":"competitor1.test"},{"name":"Competitor 2","domain":"competitor2.test","listening_keywords":["comp2"]}]') $$,
  'set de competitori cu cuvinte Listening');
reset role;
create temporary table ctx (k text primary key, v text) on commit drop;
grant all on ctx to public;
insert into ctx select m.name, m.id::text from public.competitor_set_members m join public.competitor_sets s on s.id = m.competitor_set_id
  where s.brand_id = '20000000-0000-0000-0000-000000000011' and s.effective_from = current_date;

insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id) values
  ('50000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-af');
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-0000000000f1', 'planable_listening',
        current_date - 40, current_date, 'succeeded', 1, now(), now());
insert into public.competitor_trackers (tenant_id, brand_id, source, external_id, label, covered_from, covered_to, complete, last_seen_at, source_id) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable_listening', 'k1', 'competitor 1', current_date - 40, current_date, true, now(), '50000000-0000-0000-0000-0000000000f1'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable_listening', 'k2', 'comp2', current_date - 40, current_date, true, now(), '50000000-0000-0000-0000-0000000000f1');

create function pg_temp.cmention(p_keyword text, p_native text, p_text text) returns void language sql as $$
  insert into public.competitor_mentions (tenant_id, brand_id, keyword_id, native_id, platform, url, published_at, source_id, collected_at, payload_hash, schema_version, language_text)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_keyword, p_native, 'instagram',
          case when p_native like 'h:%' then 'https://instagram.test/' || p_native end, now() - interval '2 days',
          '50000000-0000-0000-0000-0000000000f1', now(), repeat('a', 64), 't', p_text)
$$;

-- F1. Triggerul: limba se stabilește, textul nu se scrie -------------------------------------------------------------------------
select pg_temp.cmention('k1', 'h:' || repeat('1', 32), 'Disconfortul și rigiditatea articulară îți pot afecta ritmul de zi cu zi.');
select pg_temp.cmention('k1', 'h:' || repeat('2', 32), '¿Remojas los frijoles, tiras el agua y aun así te inflan? No es tu panza: es una enzima que nadie fabrica.');
select pg_temp.cmention('k1', 's:' || repeat('3', 32), null);
select pg_temp.cmention('k2', 'h:' || repeat('4', 32), 'Eladóvá vált a doboz, Térdemre szedtem, csak mivel allergiáim vannak nem bírom sajnos!');
select pg_temp.cmention('k2', 'h:' || repeat('5', 32), 'Proenzi 👍');
select is((select language_detected from public.competitor_mentions where native_id = 'h:' || repeat('1', 32)), 'ro', 'F1: română');
select is((select language_detected from public.competitor_mentions where native_id = 'h:' || repeat('2', 32)), 'other', 'F1: spaniolă');
select is((select language_detected from public.competitor_mentions where native_id = 's:' || repeat('3', 32)), null, 'F1: fără text: nedeterminată');
select is((select language_detected from public.competitor_mentions where native_id = 'h:' || repeat('5', 32)), null, 'F1: prea scurt: nedeterminată');
select is((select count(*)::int from public.competitor_mentions where language_text is not null), 0, 'F1: niciun text nu rămâne în tabel');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'competitor_mentions' and column_name in ('text', 'author')),
  'F1: tabelul nu are coloane de text sau autor (Y-5)');

-- F2. Actualizarea: cu text se recalculează, fără text limba rămâne; textul nu poate fi forțat în tabel ------------------------------
update public.competitor_mentions set language_text = 'Rigiditatea articulară îți poate afecta ziua și somnul.' where native_id = 'h:' || repeat('2', 32);
select is((select language_detected from public.competitor_mentions where native_id = 'h:' || repeat('2', 32)), 'ro', 'F2: textul nou schimbă limba');
update public.competitor_mentions set language_text = '¿Remojas los frijoles, tiras el agua y aun así te inflan? No es tu panza: es una enzima que nadie fabrica.' where native_id = 'h:' || repeat('2', 32);
update public.competitor_mentions set sentiment = 'negative' where native_id = 'h:' || repeat('2', 32);
select is((select language_detected from public.competitor_mentions where native_id = 'h:' || repeat('2', 32)), 'other', 'F2: o actualizare fără text păstrează limba');
update public.competitor_mentions set language_detected = 'ro' where native_id = 'h:' || repeat('4', 32);
select is((select language_detected from public.competitor_mentions where native_id = 'h:' || repeat('4', 32)), 'other', 'F2: limba nu se scrie direct (o stabilește doar triggerul)');
select throws_ok($$ alter table public.competitor_mentions disable trigger competitor_mentions_language;
                    insert into public.competitor_mentions (tenant_id, brand_id, keyword_id, native_id, platform, url, published_at, source_id, collected_at, payload_hash, schema_version, language_text)
                    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'k1', 'h:' || repeat('6', 32), 'x', 'https://x.test/6', now(),
                            '50000000-0000-0000-0000-0000000000f1', now(), repeat('a', 64), 't', 'text') $$,
  '23514', null, 'F2: chiar fără trigger, constrângerea refuză un text stocat');

-- F3. Matricea: competitorii fără mențiunile clar în altă limbă; brandul din registru --------------------------------------------
create function pg_temp.cell(p_row text, p_entity text) returns jsonb language sql as $$
  select r -> 'cells' -> p_entity
  from jsonb_array_elements(public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) -> 'groups') g,
       jsonb_array_elements(g -> 'rows') r
  where g ->> 'dimension' = 'listening' and r ->> 'key' = p_row
$$;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((pg_temp.cell('mentions_count', (select v from ctx where k = 'Competitor 1')) ->> 'value')::int, 2, 'F3: Competitor 1 = română + nedeterminată, fără spaniola');
select is((pg_temp.cell('mentions_count', (select v from ctx where k = 'Competitor 2')) ->> 'value')::int, 1, 'F3: Competitor 2 = doar cea nedeterminată, fără maghiara');
select is(pg_temp.cell('mentions_count', '20000000-0000-0000-0000-000000000011') ->> 'status',
          public.brand_metrics('20000000-0000-0000-0000-000000000011', array['mentions_count'], current_date - 7, current_date) -> 'data' -> 0 ->> 'status',
  'F3: brandul vine din registru (mentions_count v2)');
select ok(coalesce(pg_temp.cell('mentions_count', '20000000-0000-0000-0000-000000000011') ->> 'reason', '') not like '%Toate limbile%', 'F3: fără excepția „toate limbile” din AE-3');
select is((select count(*)::int from public.competitor_mentions), 5, 'F3: clientul vede mențiunile prin RLS, toate, cu limba lor');
select is((select count(*)::int from public.competitor_mentions where language_text is not null), 0, 'F3: și niciun text');

-- F4. Scrierea rămâne doar a workerului --------------------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.cmention('k1', 'h:' || repeat('7', 32), 'text') $$, '42501', null, 'F4: clientul nu scrie mențiuni de competitori');
reset role;
select ok(not has_function_privilege('authenticated', 'private.competitor_mention_language()', 'execute'), 'F4: funcția triggerului nu e expusă');

select * from finish();
rollback;
