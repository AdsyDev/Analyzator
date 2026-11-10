-- Restul Etapei 2 (H-1, H-2): comparația cu anul trecut și Google AI Overviews separat de asistenții AI. Date SINTETICE.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · ga4 1A = 5000…0011 · seomonitor T1 = 5000…0010
-- admin T1 = 3000…0001 · client T1 cu acces la 1A = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== H-1. Comparația cu anul trecut ===================================================================================

select is(metrics.comparison_period('2026-10-13', '2026-11-09', 'yoy'), '{"start": "2025-10-13", "end": "2025-11-09"}'::jsonb, 'Y1: yoy = același interval, cu un an înainte');
select is(metrics.comparison_period('2028-02-29', '2028-02-29', 'yoy'), '{"start": "2027-02-28", "end": "2027-02-28"}'::jsonb, 'Y1: 29 februarie se limitează la 28 februarie');
select is(metrics.comparison_period('2026-10-13', '2026-11-09', 'custom'), '{"start": "2026-09-15", "end": "2026-10-12"}'::jsonb, 'Y1: custom rămâne perioada anterioară de aceeași lungime');
select is(metrics.comparison_period('2026-11-01', '2026-11-09', 'mtd'), '{"start": "2026-10-01", "end": "2026-10-09"}'::jsonb, 'Y1: mtd rămâne aceeași porțiune din luna anterioară');
select is(metrics.is_incomplete_period('2026-11-09', 'yoy', '2026-11-10'), false, 'Y1: o perioadă încheiată, comparată cu anul trecut, nu e „incompletă”');

-- Sesiuni GA4 pe 1A: 7 zile × 10 acum, 7 zile × 4 cu un an înainte, nimic în săptămâna imediat anterioară.
insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, sessions, engaged_sessions, key_events, source_id, collected_at, payload_hash, source_timezone, schema_version, window_days)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', d, 'Direct', 'x / y', '/', md5('/'), s, s / 2, null,
       '50000000-0000-0000-0000-000000000011', now(), repeat('b', 64), 'Europe/Bucharest', 't', 1
from (
  select g.ts::date as d, 10 as s from generate_series(current_date - 7, current_date - 1, interval '1 day') g (ts)
  union all
  select (g.ts - interval '1 year')::date, 4 from generate_series(current_date - 7, current_date - 1, interval '1 day') g (ts)
) x;

create function pg_temp.sessions(p_kind text) returns jsonb language sql as $$
  select public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ga4_sessions'], current_date - 7, current_date - 1, p_kind)
$$;

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((pg_temp.sessions('yoy') -> 'data' -> 0 ->> 'value')::numeric, 70::numeric, 'Y2: valoarea perioadei nu depinde de comparație');
select is((pg_temp.sessions('yoy') -> 'data' -> 0 ->> 'comparison_value')::numeric, 28::numeric, 'Y2: comparația vine din același interval, cu un an înainte');
select is((pg_temp.sessions('yoy') -> 'data' -> 0 ->> 'relative_change')::numeric, 150::numeric, 'Y2: variația relativă față de anul trecut, calculată în SQL');
select is((pg_temp.sessions('yoy') -> 'meta' -> 'comparison_period' ->> 'start')::date, (current_date - 7 - interval '1 year')::date, 'Y2: meta spune perioada de comparație folosită');
select is(pg_temp.sessions('custom') -> 'data' -> 0 -> 'comparison_value', 'null'::jsonb, 'Y2: față de perioada anterioară nu există date: comparația rămâne null, nu zero');
select is(pg_temp.sessions('custom') -> 'data' -> 0 -> 'relative_change', 'null'::jsonb, 'Y2: fără comparație nu există variație');
select throws_ok($$ select pg_temp.sessions('anul_trecut') $$, '22023', null, 'Y2: un tip de perioadă necunoscut e refuzat în continuare');
-- Celelalte RPC-uri care validau tipul îl acceptă și ele.
select lives_ok($$ select public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1, 'yoy') $$, 'Y3: brand_paid acceptă yoy');
select lives_ok($$ select public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1, 'yoy') $$, 'Y3: brand_competition acceptă yoy');
select throws_ok($$ select public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1, 'altceva') $$, '22023', null, 'Y3: brand_paid refuză în continuare un tip necunoscut');
-- Fără acces, același răspuns ca înainte.
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select pg_temp.sessions('yoy') $$, '42501', 'Nu ai acces la acest spațiu de brand', 'Y3: fără acces, yoy nu schimbă refuzul');
reset role;

-- ===== H-2. Google AI Overviews separat de asistenții AI ================================================================

-- Într-o zi: 10 răspunsuri ChatGPT (4 cu brand, 5 fără, 1 eroare tehnică) și 6 AI Overviews pe desktop (5 cu brand, 1 fără).
insert into public.ai_answers (tenant_id, brand_id, source_id, campaign_id, engine, surface, device, keyword_id, crawl_at, content, my_brand_present, status, attributed_group_id, mapping_version, collected_at, payload_hash, schema_version)
select '10000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000011'::uuid, '50000000-0000-0000-0000-000000000010'::uuid, '1', 'openai', 'ai_search', 'none', 'c' || n, current_date - 3,
       'Răspuns', n <= 4, case when n <= 4 then 'brand_present' when n <= 9 then 'brand_absent' else 'technical_error' end, '7', 1, now(), repeat('c', 64), 't'
from generate_series(1, 10) n
union all
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', 'google_ai_overview', 'ai_overview', 'desktop', 'o' || n, current_date - 3,
       'Overview', n <= 5, case when n <= 5 then 'brand_present' else 'brand_absent' end, '7', 1, now(), repeat('d', 64), 't'
from generate_series(1, 6) n;
-- O citare proprie într-un AI Overview și una într-un răspuns ChatGPT.
insert into public.ai_citations (tenant_id, brand_id, source_id, engine, device, keyword_id, crawl_at, url, position, is_own_domain, collected_at, payload_hash, schema_version)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', 'google_ai_overview', 'desktop', 'o1', current_date - 3, 'https://1a.test/aio', 1, true, now(), repeat('d', 64), 't'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', 'openai', 'none', 'c1', current_date - 3, 'https://1a.test/chat', 1, true, now(), repeat('c', 64), 't');
-- Prezențe pentru SoV: brandul în 2 răspunsuri ChatGPT și în 3 AI Overviews; competitor1.test într-un răspuns ChatGPT.
insert into public.ai_brand_observations (tenant_id, brand_id, source_id, campaign_id, engine, device, keyword_id, crawl_at, observed_domain, is_own_brand, present, status, attributed_group_id, mapping_version, collected_at, payload_hash, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', e, dv, k, current_date - 3, d, d = '1a.test', true, 'brand_present', '7', 1, now(), repeat('c', 64), 't'
from (values ('openai', 'none', 'c1', '1a.test'), ('openai', 'none', 'c2', '1a.test'), ('openai', 'none', 'c3', 'competitor1.test'),
             ('google_ai_overview', 'desktop', 'o1', '1a.test'), ('google_ai_overview', 'desktop', 'o2', '1a.test'), ('google_ai_overview', 'desktop', 'o3', '1a.test')) v (e, dv, k, d);

create function pg_temp.ai(p_key text) returns jsonb language sql as $$
  select public.brand_metrics('20000000-0000-0000-0000-000000000011', array[p_key], current_date - 6, current_date) -> 'data' -> 0
$$;

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((pg_temp.ai('ai_mention_rate') ->> 'numerator')::int, 4, 'O1: Mention Rate numără doar răspunsurile asistenților AI');
select is((pg_temp.ai('ai_mention_rate') ->> 'denominator')::int, 9, 'O1: numitorul nu include AI Overviews (9 valide, nu 15)');
select is((pg_temp.ai('ai_valid_answers') ->> 'value')::int, 9, 'O1: răspunsurile valide sunt ale asistenților');
select is((pg_temp.ai('ai_owned_citation_rate') ->> 'numerator')::int, 1, 'O1: citarea proprie dintr-un AI Overview nu intră în rata asistenților');
select is((pg_temp.ai('ai_sov') ->> 'numerator')::int, 2, 'O1: SoV numără prezențele din răspunsurile asistenților');
select is((pg_temp.ai('ai_sov') ->> 'denominator')::int, 3, 'O1: numitorul SoV nu include prezențele din AI Overviews');
select is((pg_temp.ai('ai_overviews_mention_rate') ->> 'numerator')::int, 5, 'O2: AI Overviews are metrica lui: 5 cu brand');
select is((pg_temp.ai('ai_overviews_mention_rate') ->> 'denominator')::int, 6, 'O2: din 6 AI Overviews valide');
select is(pg_temp.ai('ai_overviews_mention_rate') ->> 'status', 'insufficient_sample', 'O2: sub 50 de observații, eșantion insuficient');
select is((public.brand_metric_evidence('20000000-0000-0000-0000-000000000011', 'ai_overviews_mention_rate', current_date - 6, current_date) -> 'records' -> 0 ->> 'denominator')::int, 6,
  'O2: dovezile metricii AI Overviews arată aceleași observații');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_mention_rate'], current_date - 6, current_date) -> 'meta' ->> 'tenant_id') is not null, true, 'O2: răspunsul păstrează forma contractului');

-- Matricea de Concurență folosește aceiași numitori ca metrica din registru (doar asistenții).
create function pg_temp.comp_ai() returns jsonb language sql as $$
  select r -> 'cells' -> '20000000-0000-0000-0000-000000000011'
  from jsonb_array_elements(public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'groups') g,
       jsonb_array_elements(g -> 'rows') r
  where r ->> 'key' = 'ai_mention_rate'
$$;
select is(round((pg_temp.comp_ai() ->> 'value')::numeric, 2), round(100.0 * 4 / 9, 2), 'O3: Mention Rate din Concurență = 4 din 9, ca pe card');
select is(round((pg_temp.ai('ai_mention_rate') ->> 'value')::numeric, 2), round((pg_temp.comp_ai() ->> 'value')::numeric, 2), 'O3: cardul și rândul din comparație au aceeași valoare');

-- Ecranul AI Visibility păstrează AI Overviews ca engine separat, cu cifrele lui.
select is((select (e ->> 'valid_answers')::int from jsonb_array_elements(public.brand_ai_engines('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'engines') e where e ->> 'engine' = 'aio'), 6,
  'O4: AI Overviews rămâne vizibil ca engine separat în ecranul AI Visibility');
reset role;

-- Versiunile vechi rămân în registru; cea curentă e 2.
select is((select count(*)::int from public.metric_definitions where metric_key = 'ai_mention_rate'), 2, 'O5: versiunea 1 rămâne în registru, ca istoric');
select is((select version from public.metric_definitions_current where metric_key = 'ai_mention_rate'), 2, 'O5: versiunea curentă e 2');
select ok((select formula_ro from public.metric_definitions_current where metric_key = 'ai_mention_rate') like '%Google AI Overviews se raportează separat%', 'O5: formula spune ce a ieșit din metrică');

select * from finish();
rollback;
