-- Datele competitorilor (deciziile Y): identificatorii pe setul de competitori, mențiunile cuvintelor Planable de tip
-- „competitor”, reclamele din Google Ads Transparency, matricea de Concurență și lista reclamelor. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · brand 1B = 2000…0012 · T2 = 1000…0002
-- admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · account T1 (acces doar 1B) = …0003
-- client T1 cu acces la 1A = …0004 · client fără acces = …0005 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v text) on commit drop;
grant all on ctx to public;

-- Y1. Identificatorii pe membrii setului: validare și normalizare ------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","ads_advertiser_ids":["XX123456"]}]') $$, '22023', null, 'Y1: ID de advertiser fără forma AR + cifre, refuzat');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","ads_advertiser_ids":["AR123456"]},{"name":"B","ads_advertiser_ids":["ar123456"]}]') $$, '22023', null,
  'Y1: același advertiser la doi competitori, refuzat');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","listening_keywords":["Beta"]},{"name":"beta"}]') $$, '22023', null,
  'Y1: un cuvânt atribuit unui competitor nu poate fi numele altuia (aceeași mențiune s-ar număra de două ori)');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","listening_keywords":"Beta"}]') $$, '22023', null, 'Y1: listening_keywords trebuie să fie listă');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","listening_keywords":["  "]}]') $$, '22023', null, 'Y1: cuvânt gol, refuzat');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","listening_keywords":["x","X"]}]') $$, '22023', null, 'Y1: același cuvânt de două ori, refuzat');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","social_handles":["are spatii"]}]') $$, '22023', null, 'Y1: profil cu spații, refuzat');
select throws_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, null,
    '[{"name":"A","social_handles":["@alfa"]},{"name":"B","social_handles":["ALFA"]}]') $$, '22023', null, 'Y1: același profil la doi competitori, refuzat');
select lives_ok($$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', current_date, 'Y',
    '[{"name":"Competitor 1","domain":"competitor1.test","ads_advertiser_ids":[" ar11111 "]},
      {"name":"Competitor 2","domain":"competitor2.test","listening_keywords":["comp2"," Comp Doi "],"social_handles":[" @Comp2.Ro "],"ads_advertiser_ids":["AR22222","AR22223"]},
      {"name":"Competitor 3","domain":"competitor3.test"}]') $$,
  'Y1: versiune nouă cu cuvinte și advertiseri');
reset role;
select is((select ads_advertiser_ids from public.competitor_set_members m join public.competitor_sets s on s.id = m.competitor_set_id
           where s.brand_id = '20000000-0000-0000-0000-000000000011' and s.effective_from = current_date and m.name = 'Competitor 1'),
  array['AR11111'], 'Y1: ID-ul de advertiser e normalizat (fără spații, cu majuscule)');
select is((select listening_keywords from public.competitor_set_members m join public.competitor_sets s on s.id = m.competitor_set_id
           where s.brand_id = '20000000-0000-0000-0000-000000000011' and s.effective_from = current_date and m.name = 'Competitor 2'),
  array['comp2', 'Comp Doi'], 'Y1: cuvintele sunt păstrate, fără spațiile de la capete');
select is((select social_handles from public.competitor_set_members m join public.competitor_sets s on s.id = m.competitor_set_id
           where s.brand_id = '20000000-0000-0000-0000-000000000011' and s.effective_from = current_date and m.name = 'Competitor 2'),
  array['comp2.ro'], 'Y1: profilul e normalizat (fără @, spații și majuscule)');
select is((select listening_keywords from public.competitor_set_members m join public.competitor_sets s on s.id = m.competitor_set_id
           where s.brand_id = '20000000-0000-0000-0000-000000000011' and s.effective_from = current_date and m.name = 'Competitor 3'),
  '{}'::text[], 'Y1: fără cuvinte, lista e goală (se caută numele)');
select throws_ok($$ insert into public.competitor_set_members (tenant_id, brand_id, competitor_set_id, name, ads_advertiser_ids)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000011', 'Direct', array['123']) $$,
  '23514', null, 'Y1: și o scriere directă cu un ID invalid e oprită de constrângere');

insert into ctx select m.name, m.id::text from public.competitor_set_members m join public.competitor_sets s on s.id = m.competitor_set_id
  where s.brand_id = '20000000-0000-0000-0000-000000000011' and s.effective_from = current_date;

-- Fără date colectate: N/A cu motiv, nu zero ------------------------------------------------------------------------------
create function pg_temp.cell(p_dim text, p_row text, p_entity text) returns jsonb language sql as $$
  select r -> 'cells' -> p_entity
  from jsonb_array_elements(public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) -> 'groups') g,
       jsonb_array_elements(g -> 'rows') r
  where g ->> 'dimension' = p_dim and r ->> 'key' = p_row
$$;
create function pg_temp.c(p_name text) returns text language sql as $$ select v from ctx where k = p_name $$;

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 1')) ->> 'status', 'not_connected', 'Y2: înainte de colectare, mențiunile competitorului sunt neconectate');
select is(pg_temp.cell('ads', 'ads_shown', pg_temp.c('Competitor 1')) ->> 'status', 'not_connected', 'Y2: înainte de colectare, reclamele sunt neconectate');
select ok(pg_temp.cell('ads', 'ads_shown', pg_temp.c('Competitor 1')) -> 'value' = 'null'::jsonb, 'Y2: neconectat = valoare null, nu zero');
select is((public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) ->> 'connected'), 'false',
  'Y2: lista reclamelor, neconectată');
reset role;

-- Date sintetice --------------------------------------------------------------------------------------------------------------
insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-1a'),
  ('50000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', null, 'google_service_account', 'sa-t1');

create function pg_temp.tracker(p_source text, p_id text, p_label text, p_from date, p_to date, p_complete boolean default true) returns void language sql as $$
  insert into public.competitor_trackers (tenant_id, brand_id, source, external_id, label, covered_from, covered_to, complete, last_seen_at, source_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_source, p_id, p_label, p_from, p_to, p_complete, now(),
          case p_source when 'planable_listening' then '50000000-0000-0000-0000-0000000000a1'::uuid else '50000000-0000-0000-0000-0000000000a2'::uuid end)
$$;
create function pg_temp.mention(p_keyword text, p_native text, p_at timestamptz) returns void language sql as $$
  insert into public.competitor_mentions (tenant_id, brand_id, keyword_id, native_id, platform, url, published_at, source_id, collected_at, payload_hash, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_keyword, p_native, 'instagram',
          case when p_native like 'h:%' then 'https://instagram.test/' || p_native end, p_at,
          '50000000-0000-0000-0000-0000000000a1', now(), repeat('a', 64), 't')
$$;
create function pg_temp.ad(p_adv text, p_ad text, p_region text, p_first date, p_last date) returns void language sql as $$
  insert into public.competitor_ads (tenant_id, brand_id, source, advertiser_id, advertiser_name, native_ad_id, region_code, format, first_shown, last_shown,
                                     source_url, last_seen, source_id, collected_at, payload_hash, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'google_ads_transparency', p_adv, 'Advertiser ' || p_adv, p_ad, p_region,
          'image', p_first, p_last, 'https://adstransparency.google.com/advertiser/' || p_adv || '/creative/' || p_ad, now(),
          '50000000-0000-0000-0000-0000000000a2', now(), repeat('b', 64), 't')
$$;

-- Competitor 1: cuvântul e numele lui (fără diferență de majuscule), acoperire completă.
select pg_temp.tracker('planable_listening', 'k1', 'competitor 1', current_date - 40, current_date);
select pg_temp.mention('k1', 'h:' || repeat('1', 32), now() - interval '2 days');
select pg_temp.mention('k1', 's:' || repeat('2', 32), now() - interval '5 days');
select pg_temp.mention('k1', 'h:' || repeat('3', 32), now() - interval '30 days');
-- Competitor 2: două cuvinte; aceeași mențiune găsită de amândouă se numără o dată; al doilea cuvânt e colectat doar de 10 zile.
select pg_temp.tracker('planable_listening', 'k2', 'comp2', current_date - 40, current_date);
select pg_temp.tracker('planable_listening', 'k3', 'comp doi', current_date - 9, current_date);
select pg_temp.mention('k2', 'h:' || repeat('4', 32), now() - interval '1 day');
select pg_temp.mention('k3', 'h:' || repeat('4', 32), now() - interval '1 day');
select pg_temp.mention('k3', 'h:' || repeat('5', 32), now() - interval '3 days');
-- Un cuvânt de tip „competitor” care nu e al niciunui competitor din set: nu se numără nicăieri.
select pg_temp.tracker('planable_listening', 'k9', 'alt brand', current_date - 40, current_date);
select pg_temp.mention('k9', 'h:' || repeat('9', 32), now() - interval '1 day');

-- Reclame: Competitor 1 are AR11111, colectat până azi; Competitor 2 are AR22222 colectat, AR22223 nu încă.
select pg_temp.tracker('google_ads_transparency', 'AR11111', 'Advertiser AR11111', null, current_date);
select pg_temp.tracker('google_ads_transparency', 'AR22222', 'Advertiser AR22222', null, current_date);
select pg_temp.ad('AR11111', 'CR1', 'RO', current_date - 60, current_date - 5);   -- afișată în perioadă, nu e nouă
select pg_temp.ad('AR11111', 'CR2', 'RO', current_date - 3, current_date - 1);    -- afișată și nouă
select pg_temp.ad('AR11111', 'CR3', 'RO', current_date - 90, current_date - 25);  -- înainte de perioadă
select pg_temp.ad('AR11111', 'CR4', 'DE', current_date - 3, current_date - 1);    -- altă regiune
select pg_temp.ad('AR22222', 'CR5', 'RO', current_date - 10, current_date);

-- Y3. RLS: clientul cu acces citește, nimeni nu scrie, alt brand și alt tenant nu văd -------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select count(*) from public.competitor_mentions), 7::bigint, 'Y3: clientul cu acces vede mențiunile competitorilor');
select is((select count(*) from public.competitor_ads), 5::bigint, 'Y3: clientul cu acces vede reclamele');
select is((select count(*) from public.competitor_trackers), 6::bigint, 'Y3: clientul cu acces vede ce s-a colectat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.competitor_ads (tenant_id, brand_id, source, advertiser_id, native_ad_id, region_code, format, last_seen, source_id, collected_at, payload_hash, schema_version)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'google_ads_transparency', 'AR11111', 'CRX', 'RO', 'text', now(),
            '50000000-0000-0000-0000-0000000000a2', now(), repeat('b', 64), 't') $$, '42501', null, 'Y3: nici adminul nu scrie reclame (doar workerul)');
select throws_ok($$ insert into public.competitor_trackers (tenant_id, brand_id, source, external_id, label, covered_to, complete, last_seen_at, source_id)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable_listening', 'kx', 'x', current_date, true, now(),
            '50000000-0000-0000-0000-0000000000a1') $$, '42501', null, 'Y3: nici adminul nu scrie ce s-a colectat');
select throws_ok($$ update public.competitor_mentions set sentiment = 'positive' $$, '42501', null, 'Y3: mențiunile competitorilor nu se modifică din aplicație');
select throws_ok($$ delete from public.competitor_ads $$, '42501', null, 'Y3: reclamele nu se șterg din aplicație');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is((select count(*) from public.competitor_mentions), 0::bigint, 'Y3: account fără acces la 1A nu vede mențiunile');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is((select count(*) from public.competitor_ads), 0::bigint, 'Y3: client fără acces nu vede reclamele');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is((select count(*) from public.competitor_trackers), 0::bigint, 'Y3: alt tenant nu vede nimic');
select throws_ok($$ select public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) $$, '42501', null,
  'Y3: alt tenant nu citește lista reclamelor');

-- Y4. Listening în matrice -----------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 1')), jsonb_build_object('value', 2, 'unit', 'count', 'status', 'ok', 'coverage', 1, 'reason', null),
  'Y4: Competitor 1 = 2 mențiuni în perioadă, după nume, fără mențiunea de acum 30 de zile');
select is(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 2')) ->> 'value', '2', 'Y4: Competitor 2 = 2 (mențiunea găsită de două cuvinte se numără o dată)');
select is(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 2')) ->> 'status', 'partial', 'Y4: al doilea cuvânt e colectat doar de 10 zile = parțial');
select is((pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 2')) ->> 'coverage')::numeric, 0.5, 'Y4: acoperirea = 10 din 20 de zile');
select is(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 3')) ->> 'status', 'unavailable', 'Y4: Competitor 3 nu are cuvânt urmărit = indisponibil');
select ok(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 3')) ->> 'reason' like '%Competitor 3%', 'Y4: motivul spune ce cuvânt s-a căutat');
select ok(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 3')) -> 'value' = 'null'::jsonb, 'Y4: indisponibil = null, nu zero');
select is(pg_temp.cell('listening', 'mentions_sov', pg_temp.c('Competitor 1')) ->> 'status', 'unavailable', 'Y4: share of voice doar când toate celulele sunt complete');
select is((public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) -> 'groups' -> 3 ->> 'dimension'), 'listening',
  'Y4: ordinea grupurilor rămâne (listening pe poziția 4)');

-- Y5. Reclamele în matrice -----------------------------------------------------------------------------------------------------
select is((public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) -> 'groups' -> 4 ->> 'dimension'), 'ads',
  'Y5: reclamele sunt ultimul grup');
select is(pg_temp.cell('ads', 'ads_shown', pg_temp.c('Competitor 1')), jsonb_build_object('value', 2, 'unit', 'count', 'status', 'ok', 'coverage', 1, 'reason', null),
  'Y5: Competitor 1 = 2 reclame afișate în România în perioadă (fără cea veche și fără DE)');
select is(pg_temp.cell('ads', 'ads_new', pg_temp.c('Competitor 1')) ->> 'value', '1', 'Y5: o reclamă nouă (prima afișare în perioadă)');
select is(pg_temp.cell('ads', 'ads_shown', pg_temp.c('Competitor 2')) ->> 'status', 'partial', 'Y5: Competitor 2 are un advertiser neinterogat = parțial');
select is(pg_temp.cell('ads', 'ads_shown', pg_temp.c('Competitor 2')) ->> 'value', '1', 'Y5: Competitor 2 = 1 reclamă din advertiserul interogat');
select is(pg_temp.cell('ads', 'ads_shown', pg_temp.c('Competitor 3')) ->> 'status', 'unavailable', 'Y5: Competitor 3 fără advertiser = indisponibil');
select is(pg_temp.cell('ads', 'ads_shown', '20000000-0000-0000-0000-000000000011') ->> 'status', 'unavailable', 'Y5: brandul = N/A (reclamele proprii sunt în Paid media)');
select is((select pg_temp.cell('ads', 'ads_shown', pg_temp.c('Competitor 1')) ->> 'value'
           from (select 1) x), '2', 'Y5: aceeași valoare la al doilea apel (fără stare ascunsă)');
-- Perioada după ultima colectare: indisponibil; perioada care o depășește parțial: parțial.
select is((select r -> 'cells' -> pg_temp.c('Competitor 1') ->> 'status'
           from jsonb_array_elements(public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 9, current_date + 10) -> 'groups') g,
                jsonb_array_elements(g -> 'rows') r where g ->> 'dimension' = 'ads' and r ->> 'key' = 'ads_shown'), 'partial',
  'Y5: zilele de după ultima colectare fac celula parțială');

-- Y6. Lista reclamelor ----------------------------------------------------------------------------------------------------------
select is((public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) ->> 'total')::integer, 3,
  'Y6: lista are reclamele afișate în România în perioadă, ale advertiserilor din set');
select is((public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) -> 'items' -> 0 ->> 'ad_id'), 'CR5',
  'Y6: ordonate după ultima afișare');
select is((public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date, 1, 1) -> 'items' -> 0 ->> 'ad_id'), 'CR2',
  'Y6: paginare pe server');
select is((public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date, 1, 1) -> 'items' -> 0 ->> 'new_in_period'), 'true',
  'Y6: marcajul „nouă” vine din prima afișare declarată');
select is((public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date, 1, 1) -> 'items' -> 0 ->> 'competitor_label'), 'C1',
  'Y6: fiecare reclamă are competitorul din set');
select throws_ok($$ select public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date, 0, 0) $$, '22023', null,
  'Y6: o pagină goală e refuzată');
select throws_ok($$ select public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date, 101, 0) $$, '22023', null,
  'Y6: cel mult 100 de reclame pe pagină');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) $$, '42501', null,
  'Y6: client fără acces, refuzat');
select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_competitor_ads('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) $$, '42501', null,
  'Y6: anon, refuzat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is((public.brand_competitor_ads('20000000-0000-0000-0000-000000000012', current_date - 19, current_date) ->> 'connected'), 'false',
  'Y6: un alt brand al aceluiași client nu vede reclamele colectate pentru 1A');

-- Y7. Share of voice: toți competitorii compleți și brandul cu mențiuni ------------------------------------------------------
reset role;
select pg_temp.tracker('planable_listening', 'k4', 'competitor 3', current_date - 40, current_date);
update public.competitor_trackers set covered_from = current_date - 40 where external_id = 'k3';
insert into public.sync_runs (id, tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-0000000000a1',
        'planable_listening', current_date - 40, current_date, 'succeeded', 3, now(), now());
insert into public.mentions (tenant_id, brand_id, native_id, url, published_at, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'h:' || md5(g::text), 'https://brand1a.test/m/' || g, now() - (g || ' days')::interval,
       now(), 'api', repeat('c', 64), 'Europe/Bucharest', 't', '50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1'
from generate_series(1, 3) g;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.cell('listening', 'mentions_count', pg_temp.c('Competitor 3')) ->> 'value', '0', 'Y7: competitorul urmărit fără mențiuni = zero real (colectat complet)');
select is(pg_temp.cell('listening', 'mentions_count', '20000000-0000-0000-0000-000000000011') ->> 'status', 'partial',
  'Y7: celula brandului e cea din registru (zilele fără mențiuni nu sunt confirmate)');
select is((pg_temp.cell('listening', 'mentions_sov', '20000000-0000-0000-0000-000000000011') ->> 'value')::numeric, metrics.ratio(3, 7, 100),
  'Y7: cota brandului = 3 / (3 + 2 + 2 + 0)');
select is((pg_temp.cell('listening', 'mentions_sov', pg_temp.c('Competitor 3')) ->> 'value')::numeric, 0::numeric, 'Y7: cota competitorului fără mențiuni = 0');
select is(pg_temp.cell('listening', 'mentions_sov', pg_temp.c('Competitor 1')) ->> 'status', 'partial', 'Y7: cota preia starea parțială a brandului, cu motiv');
reset role;
update public.competitor_trackers set complete = false where external_id = 'k4';
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.cell('listening', 'mentions_sov', pg_temp.c('Competitor 1')) ->> 'status', 'unavailable', 'Y7: un competitor citit incomplet oprește cota tuturor');

-- Y8. Social public (Planable Competitors) ------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(public.brand_social_competitors('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) ->> 'connected', 'false',
  'Y8: înainte de colectare, concurența publică e neconectată');
select is(pg_temp.cell('social', 'social_cadence', pg_temp.c('Competitor 1')) ->> 'status', 'not_connected', 'Y8: matricea, la fel');
reset role;
create function pg_temp.profile(p_id text, p_handle text, p_name text, p_from date, p_complete boolean default true) returns void language sql as $$
  insert into public.competitor_trackers (tenant_id, brand_id, source, external_id, label, display_name, covered_from, covered_to, complete, last_seen_at, source_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable_competitors', p_id, p_handle, p_name, p_from, current_date,
          p_complete, now(), '50000000-0000-0000-0000-0000000000a1')
$$;
create function pg_temp.day(p_id text, p_own boolean, p_day date, p_followers numeric, p_posts numeric, p_eng numeric) returns void language sql as $$
  insert into public.competitor_social_daily (tenant_id, brand_id, platform, profile_id, is_own, handle, display_name, date, followers, posts, engagement,
                                              source_id, collected_at, payload_hash, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', p_id, p_own, p_id, p_id, p_day, p_followers, p_posts, p_eng,
          '50000000-0000-0000-0000-0000000000a1', now(), repeat('d', 64), 't')
$$;
-- Competitor 1: fără profiluri în set, găsit după numele afișat. Competitor 2: după handle, colectat doar de 10 zile.
select pg_temp.profile('sp1', 'competitor_1_official', 'Competitor 1', current_date - 40);
select pg_temp.profile('sp2', 'comp2.ro', 'Alt nume', current_date - 9);
select pg_temp.profile('sp9', 'altcineva', 'Alt brand', current_date - 40);
select pg_temp.day('sp1', false, current_date - 2, 1000, 2, 50);
select pg_temp.day('sp1', false, current_date - 1, 1010, 1, 40);
select pg_temp.day('sp1', false, current_date - 30, 900, 5, 500);
select pg_temp.day('sp2', false, current_date - 1, 500, 0, 0);
select pg_temp.day('own1', true, current_date - 1, 2000, 4, 100);
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((pg_temp.cell('social', 'social_cadence', pg_temp.c('Competitor 1')) ->> 'value')::numeric, metrics.ratio(3, 20::numeric / 7),
  'Y8: ritmul competitorului = postările din perioadă / săptămânile ei (fără ziua de acum 30 de zile)');
select is(pg_temp.cell('social', 'social_followers', pg_temp.c('Competitor 1')) ->> 'value', '1010', 'Y8: urmăritorii = ultima valoare din perioadă');
select is((pg_temp.cell('social', 'social_interactions_per_post', pg_temp.c('Competitor 1')) ->> 'value')::numeric, 30::numeric, 'Y8: interacțiuni pe postare = 90 / 3');
select is(pg_temp.cell('social', 'social_cadence', pg_temp.c('Competitor 2')) ->> 'status', 'partial', 'Y8: profilul colectat de 10 zile = parțial');
select is(pg_temp.cell('social', 'social_interactions_per_post', pg_temp.c('Competitor 2')) ->> 'status', 'base_zero', 'Y8: fără postări, interacțiunile pe postare nu au bază');
select is(pg_temp.cell('social', 'social_cadence', pg_temp.c('Competitor 3')) ->> 'status', 'unavailable', 'Y8: competitor fără profil = indisponibil');
select ok(pg_temp.cell('social', 'social_cadence', pg_temp.c('Competitor 3')) ->> 'reason' like '%Competitor 3%', 'Y8: motivul spune după ce s-a căutat');
select is((pg_temp.cell('social', 'social_interactions_per_post', '20000000-0000-0000-0000-000000000011') ->> 'value')::numeric, 25::numeric,
  'Y8: brandul, din pagina proprie a aceleiași comparații = 100 / 4');
select is((public.brand_social_competitors('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) -> 'items' -> 0 ->> 'followers'), '1010',
  'Y8: ecranul Social primește aceleași valori');
select is((public.brand_social_competitors('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) -> 'items' -> 0 ->> 'as_of')::date, current_date - 1,
  'Y8: „la data” = ultima zi cu date din perioadă');
select is(jsonb_array_length(public.brand_social_competitors('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) -> 'items'), 3,
  'Y8: câte un rând pe competitor din set');
select is((select count(*) from public.competitor_social_daily), 5::bigint, 'Y8: clientul cu acces citește seria');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is((select count(*) from public.competitor_social_daily), 0::bigint, 'Y8: client fără acces nu vede seria');
select throws_ok($$ select public.brand_social_competitors('20000000-0000-0000-0000-000000000011', current_date - 19, current_date) $$, '42501', null,
  'Y8: client fără acces, refuzat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ delete from public.competitor_social_daily $$, '42501', null, 'Y8: seria nu se șterge din aplicație');

select * from finish();
rollback;
