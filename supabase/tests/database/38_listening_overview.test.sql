-- Ecranul Listening (deciziile AI): brand_listening_overview, topicurile și acoperirea cuvintelor. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · strategist T1 (acces 1A) = 3000…0002 · client T1 (acces 1A) = 3000…0004
-- client T1 fără acces = 3000…0005 · strategist T2 = 3000…0012
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Setul de competitori: Competitor 1 (cuvântul = numele) și Competitor 2 (cuvântul „comp2”, neurmărit în Planable).
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, 'AI',
    '[{"name":"Competitor 1","domain":"competitor1.test"},{"name":"Competitor 2","domain":"competitor2.test","listening_keywords":["comp2"]}]') $$,
  'set de competitori');
reset role;

create temporary table ctx (k text primary key, v text) on commit drop;
grant all on ctx to public;
insert into ctx select m.name, m.id::text from public.competitor_set_members m join public.competitor_sets s on s.id = m.competitor_set_id
  where s.brand_id = '20000000-0000-0000-0000-000000000011' and s.effective_from = current_date;
insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-ah');
insert into public.sync_runs (id, tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
        '50000000-0000-0000-0000-0000000000a1', 'planable_listening', current_date - 35, current_date - 1, 'succeeded', 1, now(), now());

-- Acoperirea: cuvântul „brand” k1 citit complet pe ultimele 10 zile; k2 citit incomplet în zilele -5 și -4.
insert into public.listening_trackers (tenant_id, brand_id, kind, keyword_id, label, covered_from, covered_to, complete, last_seen_at, source_id) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'brand', 'k1', 'Brand 1A', current_date - 10, current_date - 1, true, now(), '50000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'brand', 'k2', 'Brand 1A Akut', current_date - 5, current_date - 4, false, now(), '50000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'topic', 't1', 'dureri articulare', current_date - 10, current_date - 1, true, now(), '50000000-0000-0000-0000-0000000000a1');
insert into public.competitor_trackers (tenant_id, brand_id, source, external_id, label, covered_from, covered_to, complete, last_seen_at, source_id) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable_listening', 'c1', 'competitor 1', current_date - 40, current_date, true, now(), '50000000-0000-0000-0000-0000000000a1');

create function pg_temp.mention(p_id text, p_day integer, p_platform text, p_text text, p_sentiment text, p_owned boolean,
                                p_author text default null, p_username text default null, p_engagement bigint default null)
returns void language sql as $$
  insert into public.mentions (tenant_id, brand_id, native_id, url, source_name, published_at, text, sentiment, author_is_owned,
                               author_name, author_username, engagement,
                               collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_id, case when p_id like 'h:%' then 'https://x.test/' || p_id end,
          p_platform, ((current_date - p_day)::timestamp + interval '12 hours') at time zone 'Europe/Bucharest', p_text, p_sentiment, p_owned,
          p_author, p_username, p_engagement,
          now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', '50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1')
$$;
select pg_temp.mention('h:ext', 2, 'instagram', 'Disconfortul și rigiditatea articulară îți pot afecta ritmul de zi cu zi.', 'positive', false, 'Ana Pop', 'ana.p', 5);
select pg_temp.mention('h:own', 2, 'instagram', 'Postarea noastră despre ritmul de zi cu zi și mișcare.', 'negative', true, 'Brand 1A', null, 40);
select pg_temp.mention('s:' || repeat('a', 32), 3, 'web', null, 'neutral', false, 'ziar.test', null, 3);
select pg_temp.mention('h:es', 2, 'instagram', '¿Remojas los frijoles, tiras el agua y aun así te inflan? No es tu panza: es una enzima que nadie fabrica.', 'negative', false, 'Juan', 'juan', 100);

create function pg_temp.tmention(p_id text, p_text text, p_sentiment text) returns void language sql as $$
  insert into public.topic_mentions (tenant_id, brand_id, keyword_id, native_id, platform, url, published_at, sentiment, engagement, source_id, collected_at, payload_hash, schema_version, language_text)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 't1', p_id, 'facebook', 'https://fb.test/' || p_id,
          now() - interval '3 days', p_sentiment, 7, '50000000-0000-0000-0000-0000000000a1', now(), repeat('a', 64), 't', p_text)
$$;
select pg_temp.tmention('h:' || repeat('1', 32), 'Durerile articulare îți pot afecta ritmul de zi cu zi și somnul.', 'positive');
select pg_temp.tmention('h:' || repeat('2', 32), '¿Remojas los frijoles, tiras el agua y aun así te inflan? No es tu panza: es una enzima que nadie fabrica.', 'negative');
insert into public.competitor_mentions (tenant_id, brand_id, keyword_id, native_id, platform, url, published_at, sentiment, source_id, collected_at, payload_hash, schema_version)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'c1', 'h:' || repeat('c', 32), 'instagram', 'https://ig.test/c',
        now() - interval '2 days', 'negative', '50000000-0000-0000-0000-0000000000a1', now(), repeat('a', 64), 't');

-- L1. Tabelele noi și coloanele -------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.topic_mentions where language_text is not null), 0, 'L1: textul topicurilor nu rămâne în tabel');
select is((select language_detected from public.topic_mentions where native_id = 'h:' || repeat('2', 32)), 'other', 'L1: limba topicului din trigger');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'topic_mentions' and column_name in ('text', 'author', 'author_name')),
  'L1: topic_mentions nu are coloane de text sau autor');
select throws_ok($$ update public.mentions set engagement = -1 where native_id = 'h:ext' $$, '23514', null, 'L1: interacțiunile nu pot fi negative');
select throws_ok($$ insert into public.listening_trackers (tenant_id, brand_id, kind, keyword_id, label, covered_from, covered_to, complete, last_seen_at, source_id)
                    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'competitor', 'x', 'x', current_date, current_date, true, now(), '50000000-0000-0000-0000-0000000000a1') $$,
  '23514', null, 'L1: tipul trackerului e doar brand sau topic');
select throws_ok($$ insert into public.listening_trackers (tenant_id, brand_id, kind, keyword_id, label, covered_from, covered_to, complete, last_seen_at, source_id)
                    values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000011', 'brand', 'x', 'x', current_date, current_date, true, now(), '50000000-0000-0000-0000-0000000000a1') $$,
  '23503', null, 'L1: brandul trebuie să fie al aceluiași tenant (FK compus)');

-- L2. Accesul ---------------------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000012');
select throws_ok($$ select public.brand_listening_overview('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) $$,
  '42501', null, 'L2: alt tenant nu citește');
select is((select count(*)::int from public.topic_mentions) + (select count(*)::int from public.listening_trackers), 0, 'L2: alt tenant nu vede topicurile sau acoperirea');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_listening_overview('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) $$,
  '42501', null, 'L2: clientul fără acces la brand nu citește');
select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_listening_overview('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) $$,
  '42501', null, 'L2: anon nu execută');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.brand_listening_overview('20000000-0000-0000-0000-000000000011', current_date, current_date - 6) $$,
  '22023', null, 'L2: perioadă inversată');
select throws_ok($$ insert into public.topic_mentions (tenant_id, brand_id, keyword_id, native_id, platform, url, published_at, source_id, collected_at, payload_hash, schema_version)
                    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 't1', 'h:' || repeat('9', 32), 'x', 'https://x.test/9', now(),
                            '50000000-0000-0000-0000-0000000000a1', now(), repeat('a', 64), 't') $$,
  '42501', null, 'L2: clientul nu scrie topicuri');
select throws_ok($$ update public.listening_trackers set complete = true where keyword_id = 'k2' $$, '42501', null, 'L2: clientul nu modifică acoperirea');

-- L3. Volumul: aceeași regulă ca „Mențiuni” (fără altă limbă, cu conturile proprii); seria pe zile confirmate ------------------------
create temporary table o as select public.brand_listening_overview('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) as j;
select is((select (j ->> 'total')::int from o), 3, 'L3: trei mențiuni (spaniola nu se numără)');
select is((select (j ->> 'total')::numeric from o),
          (public.brand_metrics('20000000-0000-0000-0000-000000000011', array['mentions_count'], current_date - 6, current_date) -> 'data' -> 0 ->> 'value')::numeric,
  'L3: totalul e cel al indicatorului „Mențiuni” (mentions_count)');
select is((select jsonb_array_length(j -> 'days') from o), 7, 'L3: o zi pe poziție');
select is((select j -> 'series' from o), '[0, null, null, 1, 2, 0, null]'::jsonb,
  'L3: zi confirmată fără mențiuni = 0; zi citită incomplet sau necitită = lipsă (null), nu zero');
select is((select j -> 'platforms' -> 0 ->> 'platform' from o), 'instagram', 'L3: rețelele în ordinea volumului');
select is((select j -> 'platforms' -> 0 -> 'values' from o), '[0, null, null, 0, 2, 0, null]'::jsonb, 'L3: seria pe rețea, cu aceleași goluri');
select is((select round((j -> 'platforms' -> 0 ->> 'share')::numeric, 2) from o), 66.67, 'L3: ponderea rețelei');

-- L4. Interacțiunile: suma valorilor raportate; lipsa nu e zero; fără perioadă anterioară cu valori, variația lipsește -----------
select is((select (j -> 'engagement' ->> 'value')::int from o), 48, 'L4: 5 + 40 + 3 (cele în altă limbă nu intră)');
select is((select (j -> 'engagement' ->> 'mentions_with_value')::int from o), 3, 'L4: câte mențiuni au interacțiuni raportate');
select is((select j -> 'engagement' -> 'change' ->> 'relative_change' from o), null, 'L4: fără valori în perioada anterioară, fără variație');

-- L5. Sentimentul automat: doar autorii externi, separat de cel revizuit --------------------------------------------------------
select is((select j -> 'auto_sentiment' from o) - 'shares' - 'net', '{"total": 2, "positive": 1, "neutral": 1, "negative": 0, "unknown": 0, "owned_excluded": 1}'::jsonb,
  'L5: contul propriu nu intră; spaniola nu intră');
select is((select (j -> 'auto_sentiment' ->> 'net')::numeric from o), 50::numeric, 'L5: net = 100 × (pozitive − negative) / total');
select is((public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) ->> 'total')::int, 0,
  'L5: distribuția revizuită rămâne neschimbată (nicio mențiune revizuită)');

-- L6. Vocile principale: autori externi, ordonați după mențiuni și interacțiuni ----------------------------------------------------
select is((select jsonb_agg(v ->> 'name' order by n) from o, jsonb_array_elements(j -> 'top_voices') with ordinality as x(v, n)), '["Ana Pop", "ziar.test"]'::jsonb,
  'L6: contul propriu și autorul în altă limbă nu apar');
select is((select j -> 'voices_basis' from o), '{"external": 2, "with_author": 2}'::jsonb, 'L6: baza vocilor');

-- L7. Topicurile ------------------------------------------------------------------------------------------------------------------
select is((select j -> 'topics' -> 0 ->> 'label' from o), 'dureri articulare', 'L7: topicul citit în perioadă');
select is((select (j -> 'topics' -> 0 ->> 'mentions')::int from o), 1, 'L7: fără mențiunea în altă limbă');
select is((select j -> 'topics' -> 0 ->> 'status' from o), 'partial', 'L7: azi nu e încă citit: parțial');
select is((select (j -> 'topics' -> 0 ->> 'coverage')::numeric from o), 0.8571, 'L7: șase zile din șapte');
select is((select (j -> 'topics' -> 0 -> 'sentiment' ->> 'positive')::int from o), 1, 'L7: sentimentul automat al topicului');
select is((select jsonb_array_length(j -> 'topics') from public.brand_listening_overview('20000000-0000-0000-0000-000000000011', current_date - 30, current_date - 20) as j),
  0, 'L7: un topic necitit în perioadă nu apare');

-- L8. Competiția: mențiunile și share of voice sunt cele din matrice ---------------------------------------------------------------
create function pg_temp.cell(p_row text, p_entity text) returns jsonb language sql as $$
  select r -> 'cells' -> p_entity
  from jsonb_array_elements(public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'groups') g,
       jsonb_array_elements(g -> 'rows') r
  where g ->> 'dimension' = 'listening' and r ->> 'key' = p_row
$$;
select is((select jsonb_array_length(j -> 'competition' -> 'entities') from o), 3, 'L8: brandul și cei doi competitori');
select is((select e -> 'mentions' from o, jsonb_array_elements(j -> 'competition' -> 'entities') e where e ->> 'id' = (select v from ctx where k = 'Competitor 1')),
          pg_temp.cell('mentions_count', (select v from ctx where k = 'Competitor 1')), 'L8: celula de mențiuni = matricea');
select is((select e -> 'share_of_voice' from o, jsonb_array_elements(j -> 'competition' -> 'entities') e where e ->> 'kind' = 'brand'),
          pg_temp.cell('mentions_sov', '20000000-0000-0000-0000-000000000011'), 'L8: share of voice = matricea');
select is((select (e -> 'sentiment' ->> 'negative')::int from o, jsonb_array_elements(j -> 'competition' -> 'entities') e where e ->> 'id' = (select v from ctx where k = 'Competitor 1')),
          1, 'L8: sentimentul automat al competitorului');
select is((select (e ->> 'tracked')::boolean from o, jsonb_array_elements(j -> 'competition' -> 'entities') e where e ->> 'id' = (select v from ctx where k = 'Competitor 2')),
          false, 'L8: competitorul fără cuvânt urmărit e marcat');
select is((select p -> 'counts' -> (select v from ctx where k = 'Competitor 1') from o, jsonb_array_elements(j -> 'competition' -> 'platforms') p where p ->> 'platform' = 'instagram'),
          '1'::jsonb, 'L8: mențiunile competitorului pe rețea');
select is((select p ->> 'brand_share' from o, jsonb_array_elements(j -> 'competition' -> 'platforms') p where p ->> 'platform' = 'instagram'),
          null, 'L8: fără share of voice (Competitor 2 incomplet), fără cota pe rețea');

-- L10. Feed-ul arată autorul (numele, altfel username-ul); grant-urile brand_mentions rămân -------------------------------------
select is((select i ->> 'author' from jsonb_array_elements(public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'items') i
           where i ->> 'id' = 'h:ext'), 'Ana Pop', 'L10: autorul în feed');
select ok(not has_function_privilege('anon', 'public.brand_mentions(uuid, date, date, text, text, integer, integer, text, text)', 'execute'),
  'L10: anon tot nu execută brand_mentions');

-- L9. Fără set de competitori: competiția e null ---------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select j -> 'competition' from public.brand_listening_overview('20000000-0000-0000-0000-000000000011', current_date - 400, current_date - 380) as j),
  'null'::jsonb, 'L9: înainte de primul set, fără comparație');

select * from finish();
rollback;
