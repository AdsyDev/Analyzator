-- Metricile AI și ecranul AI Visibility (D-15). Seed: seomonitor T1 = 5000…0010; set competitori 1A: competitor1..3.test.
-- client T1 (acces 1A) = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- 10 răspunsuri ChatGPT într-o zi: 4 cu brand, 4 fără, 1 refuz, 1 eroare tehnică. Grupul 7 = „Criterii de alegere”.
insert into public.keyword_groups (tenant_id, brand_id, source_id, campaign_id, group_id, name, group_type, mapping_version, collected_at, payload_hash, schema_version)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', '7', 'Criterii de alegere', 'group', 1, now(), repeat('a', 64), 't');
insert into public.ai_answers (tenant_id, brand_id, source_id, campaign_id, engine, surface, keyword_id, crawl_at, content, my_brand_present, status, attributed_group_id, mapping_version, collected_at, payload_hash, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', 'openai', 'ai_search', n::text, current_date - 3,
       case when n <= 8 then 'Răspuns ' || n end,
       case when n <= 4 then true when n <= 8 then false end,
       case when n <= 4 then 'brand_present' when n <= 8 then 'brand_absent' when n = 9 then 'refusal' else 'technical_error' end,
       '7', 1, now(), repeat('a', 64), 't'
from generate_series(1, 10) n;
insert into public.ai_citations (tenant_id, brand_id, source_id, engine, keyword_id, crawl_at, url, position, is_own_domain, collected_at, payload_hash, schema_version)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', 'openai', '1', current_date - 3, 'https://www.1a.test/produs', 1, true, now(), repeat('a', 64), 't'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', 'openai', '1', current_date - 3, 'https://ghid.test/a', 2, false, now(), repeat('a', 64), 't'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', 'openai', '5', current_date - 3, 'https://1a.test/blog', 1, true, now(), repeat('a', 64), 't'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', 'openai', '10', current_date - 3, 'https://1a.test/eroare', 1, true, now(), repeat('a', 64), 't');
-- Prezențe: brandul în 4 răspunsuri, competitor1.test în 2, un domeniu din afara setului în 3 (nu intră în SoV).
insert into public.ai_brand_observations (tenant_id, brand_id, source_id, campaign_id, engine, keyword_id, crawl_at, observed_domain, is_own_brand, present, status, attributed_group_id, mapping_version, collected_at, payload_hash, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', 'openai', k::text, current_date - 3, d, d = '1a.test', true, 'brand_present', '7', 1, now(), repeat('a', 64), 't'
from (values ('1a.test', 1), ('1a.test', 2), ('1a.test', 3), ('1a.test', 4), ('competitor1.test', 1), ('competitor1.test', 5), ('altul.test', 1), ('altul.test', 2), ('altul.test', 3)) v (d, k);

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');

-- N1. Metricile din registru, calculate în SQL --------------------------------------------------------------
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_mention_rate'], current_date - 6, current_date) -> 'data' -> 0 ->> 'numerator')::int, 4, 'N1: numărătorul = răspunsuri cu brand');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_mention_rate'], current_date - 6, current_date) -> 'data' -> 0 ->> 'denominator')::int, 9,
  'N1: numitorul = 9 valide (refuzul intră, eroarea tehnică nu)');
select is(public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_mention_rate'], current_date - 6, current_date) -> 'data' -> 0 ->> 'status', 'insufficient_sample',
  'N1: sub 50 de răspunsuri valide: eșantion insuficient');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_valid_answers'], current_date - 6, current_date) -> 'data' -> 0 ->> 'value')::int, 9, 'N1: răspunsuri valide');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_owned_citation_rate'], current_date - 6, current_date) -> 'data' -> 0 ->> 'numerator')::int, 2,
  'N1: citarea proprie dintr-un răspuns cu eroare tehnică nu contează');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_sov'], current_date - 6, current_date) -> 'data' -> 0 ->> 'denominator')::int, 6,
  'N1: SoV: 4 prezențe ale brandului + 2 ale competitorului din set; domeniul din afara setului nu intră');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_mention_rate'], current_date - 6, current_date) -> 'data' -> 0 ->> 'coverage')::numeric, 0.5714::numeric,
  'N1: colectarea din ziua d-3 acoperă zilele d-3…d (4 din 7), nu zilele dinaintea ei');
select is(public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ai_recommendation_rate'], current_date - 6, current_date) -> 'data' -> 0 -> 'value', 'null'::jsonb,
  'N1: Recommendation Rate fără semnal în sursă: fără valoare');

-- N2. Ecranul: engines, matrice, surse, răspunsuri ----------------------------------------------------------------
select is(public.brand_ai_engines('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'engines' -> 0 ->> 'engine', 'chatgpt', 'N2: openai apare ca chatgpt');
select is((public.brand_ai_engines('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'engines' -> 0 ->> 'total_answers')::int, 10, 'N2: total = toate răspunsurile');
select is((public.brand_ai_topic_matrix('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'topics' -> 0 ->> 'topic'), 'Criterii de alegere', 'N2: topicul = numele grupului');
select is(jsonb_array_length(public.brand_ai_topic_matrix('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'entities'), 4, 'N2: brandul + cei 3 competitori din set');
select is((select s ->> 'kind' from jsonb_array_elements(public.brand_ai_cited_sources('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) -> 'sources') s where s ->> 'domain' = '1a.test'),
  'owned', 'N2: domeniul propriu e owned (fără www)');
select is((public.brand_ai_answers('20000000-0000-0000-0000-000000000011', current_date - 6, current_date, 'chatgpt', 'Criterii de alegere') ->> 'total')::int, 10, 'N2: filtrele engine și grup');
select is((select count(*) from jsonb_array_elements(public.brand_ai_answers('20000000-0000-0000-0000-000000000011', current_date - 6, current_date, null, null, 1, 100) -> 'items') i where i ->> 'outcome' = 'refused')::int,
  1, 'N2: refuzul rămâne refuz, nu „fără brand”');
select is(public.brand_ai_answer('20000000-0000-0000-0000-000000000011', (select id from public.ai_answers where keyword_id = '1' limit 1)) -> 'entities_present' -> 1,
  to_jsonb((select m.id from public.competitor_set_members m where m.domain = 'competitor1.test' and m.brand_id = '20000000-0000-0000-0000-000000000011')),
  'N2: detaliul arată competitorul prezent în același răspuns');

-- N3. Acces -----------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_ai_answers('20000000-0000-0000-0000-000000000011', current_date - 6, current_date) $$, '42501', null, 'N3: fără acces, refuzat');
select throws_ok($$ select public.brand_ai_answer('20000000-0000-0000-0000-000000000011', gen_random_uuid()) $$, '42501', null, 'N3: detaliul, fără acces, refuzat');
reset role;

select * from finish();
rollback;
