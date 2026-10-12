-- Trafic și SEO pentru ecranele de brand (D-14).
-- Seed: ga4 1A = 5000…0011, seomonitor T1 = 5000…0010 · client T1 (acces 1A) = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'gsc', 'sc-domain:1a.test');
insert into ctx select 'gsc', id from public.source_connections where external_account_id = 'sc-domain:1a.test';

-- GA4: două canale pe trei zile, plus perioada de comparație.
insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, sessions, engaged_sessions, key_events, source_id, collected_at, payload_hash, source_timezone, schema_version, window_days)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', current_date - d, ch, 'x / y', '/', md5('/'), s, s / 2, null,
       '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'Europe/Bucharest', 't', 1
from generate_series(1, 6) d, (values ('Organic Search', 30), ('Direct', 10)) v (ch, s);

-- GSC: o pagină, două interogări.
insert into public.search_queries (tenant_id, brand_id, date, device, query, query_md5, page, page_md5, clicks, impressions, position, source_id, collected_at, payload_hash, source_timezone, data_state, schema_version, window_days)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', current_date - 3, 'MOBILE', 'q1', md5('q1'), 'https://1a.test/p', md5('https://1a.test/p'), 10, 100, 2, (select v from ctx where k = 'gsc'), now(), repeat('a', 64), 'America/Los_Angeles', 'final', 't', 1),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', current_date - 3, 'DESKTOP', 'q2', md5('q2'), 'https://1a.test/p', md5('https://1a.test/p'), 5, 300, 6, (select v from ctx where k = 'gsc'), now(), repeat('a', 64), 'America/Los_Angeles', 'final', 't', 1);

-- SEOmonitor: un keyword cu poziții pe mobil (8 → 5) și desktop, plus unul neclasat.
insert into public.keywords (tenant_id, brand_id, source_id, campaign_id, keyword_id, keyword, is_branded, search_volume, status, collected_at, payload_hash, schema_version)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', '101', 'urinal pastile', false, 900, 'active', now(), repeat('a', 64), 't'),
       ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', '102', 'urinal', true, 2400, 'active', now(), repeat('a', 64), 't');
insert into public.rank_observations (tenant_id, brand_id, source_id, campaign_id, keyword_id, device, date, domain, url, rank, rank_status, keyword_status, attributed_group_id, mapping_version, collected_at, payload_hash, schema_version, window_days)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', '101', 'mobile', current_date - 6, '1a.test', null, 8, 'ranked', 'active', '7', 1, now(), repeat('a', 64), 't', 1),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', '101', 'mobile', current_date - 1, '1a.test', 'https://1a.test/p', 5, 'ranked', 'active', '7', 1, now(), repeat('a', 64), 't', 1),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', '101', 'desktop', current_date - 1, '1a.test', 'https://1a.test/p', 3, 'ranked', 'active', '7', 1, now(), repeat('a', 64), 't', 1),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000010', '1', '102', 'mobile', current_date - 1, '1a.test', null, null, 'not_ranked', 'active', '7', 1, now(), repeat('a', 64), 't', 1);
insert into public.seomonitor_group_mappings (tenant_id, source_id, campaign_id, group_id, version, effective_from, mapping_kind, brand_id, brand_type)
values ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000010', '1', '7', 1, current_date - 30, 'brand', '20000000-0000-0000-0000-000000000011', 'nonbranded');

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');

-- T1. Canale: sesiuni, pondere, engagement din SQL ---------------------------------------------------------
select is((public.brand_traffic_channels('20000000-0000-0000-0000-000000000011', current_date - 3, current_date - 1) -> 'channels' -> 0 ->> 'channel'), 'Organic Search', 'T1: canalul principal primul');
select is((public.brand_traffic_channels('20000000-0000-0000-0000-000000000011', current_date - 3, current_date - 1) -> 'channels' -> 0 ->> 'share_pct')::numeric, 75::numeric, 'T1: ponderea (90 / 120)');
select is((public.brand_traffic_channels('20000000-0000-0000-0000-000000000011', current_date - 3, current_date - 1) -> 'channels' -> 0 ->> 'engagement_rate')::numeric, 50::numeric, 'T1: engagement rate');
select is((public.brand_traffic_channels('20000000-0000-0000-0000-000000000011', current_date - 3, current_date - 1) -> 'channels' -> 0 ->> 'change_pct')::numeric, 0::numeric, 'T1: variația față de perioada anterioară');
select is(public.brand_traffic_channels('20000000-0000-0000-0000-000000000011', current_date - 3, current_date - 1) -> 'channels' -> 0 -> 'key_events', 'null'::jsonb, 'T1: key events lipsă = null, nu 0');

-- T2. Clarity pe device: conectat, fără rânduri pe device → indisponibil, nu 0 -------------------------------
select is(public.brand_clarity_devices('20000000-0000-0000-0000-000000000011', current_date - 3, current_date - 1) -> 'rows' -> 0 -> 'cells' -> 'mobile' ->> 'status', 'unavailable',
  'T2: fără date pe device, celula e indisponibilă');

-- T3. Keywords: ultima poziție, variația pe mobil, fără poziție = null ------------------------------------------
select is((select k ->> 'change_mobile' from jsonb_array_elements(public.brand_search_keywords('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'keywords') k where k ->> 'id' = '101')::int,
  3, 'T3: 8 → 5 pe mobil = 3 poziții câștigate');
select is((select k -> 'rank_mobile' from jsonb_array_elements(public.brand_search_keywords('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'keywords') k where k ->> 'id' = '102'),
  'null'::jsonb, 'T3: keywordul neclasat are poziția null (nu 100)');
select is(jsonb_array_length(public.brand_search_keywords('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1, 'brand') -> 'keywords'), 1, 'T3: filtrul brand');

-- T4. Landing pages: CTR din totaluri, poziția ponderată cu afișările ---------------------------------------------
select is((public.brand_landing_pages('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'pages' -> 0 ->> 'ctr')::numeric, 3.75::numeric, 'T4: CTR = 15 / 400 × 100');
select is((public.brand_landing_pages('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'pages' -> 0 ->> 'position')::numeric, 5::numeric, 'T4: poziția ponderată (2×100 + 6×300) / 400');

-- T5. Acces -----------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_search_keywords('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) $$, '42501', null, 'T5: fără acces, refuzat');
reset role;

select * from finish();
rollback;
