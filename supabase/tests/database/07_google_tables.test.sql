-- GA4 și Search Console: RLS pe tabelele noi și view-urile de observații pentru metrics.compute.
-- Toate datele de mai jos sunt SINTETICE și există doar în acest fișier de test.
-- brand 1A = 2000…0011 (tenant T1) · client cu acces = 3000…0004 · client fără acces = 3000…0005
-- strategist T1 (acces 1A) = 3000…0002 · admin T2 = 3000…0011 · conexiune = 5000…0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Date sintetice (ca owner, fără RLS) -------------------------------------------------------------
insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5,
  sessions, engaged_sessions, key_events, active_users_not_additive, source_id, collected_at, payload_hash, source_timezone, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', d.date, d.channel, 'src / med', d.lp, md5(d.lp),
       d.sessions, d.engaged, d.ke, d.au, '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'Europe/Bucharest', 'test'
from (values
  ('2026-10-05'::date, 'Organic Search', '/a', 100::bigint, 60::bigint, 5::numeric, 90::bigint),
  ('2026-10-05'::date, 'Direct',         '/',  50::bigint,  30::bigint, 1::numeric, 45::bigint),
  ('2026-10-06'::date, 'Organic Search', '/a', 200::bigint, 120::bigint, 0::numeric, 180::bigint),
  -- 2026-10-07: sesiuni necunoscute (NULL), nu zero
  ('2026-10-07'::date, 'Organic Search', '/a', null::bigint, null::bigint, null::numeric, null::bigint)
) as d (date, channel, lp, sessions, engaged, ke, au);

insert into public.web_key_events (tenant_id, brand_id, date, event_name, key_events, source_id, collected_at, payload_hash, source_timezone, schema_version) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-05', 'generate_lead', 4, '50000000-0000-0000-0000-000000000011', now(), repeat('b', 64), 'Europe/Bucharest', 'test'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-05', 'contact',       2, '50000000-0000-0000-0000-000000000011', now(), repeat('b', 64), 'Europe/Bucharest', 'test');

insert into public.web_active_users_interval (tenant_id, brand_id, interval_start, interval_end, active_users, source_id, collected_at, payload_hash, source_timezone, schema_version) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-09-28', '2026-10-04', 910, '50000000-0000-0000-0000-000000000011', now(), repeat('c', 64), 'Europe/Bucharest', 'test');

insert into public.search_daily (tenant_id, brand_id, date, device, clicks, impressions, ctr_reported, position, source_id, collected_at, payload_hash, source_timezone, data_state, schema_version) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-05', 'DESKTOP', 6, 60, 0.1, 5, '50000000-0000-0000-0000-000000000011', now(), repeat('d', 64), 'America/Los_Angeles', 'final', 'test'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-05', 'MOBILE',  4, 40, 0.1, 10, '50000000-0000-0000-0000-000000000011', now(), repeat('d', 64), 'America/Los_Angeles', 'final', 'test'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-06', 'DESKTOP', 10, 900, 0.0111, 2, '50000000-0000-0000-0000-000000000011', now(), repeat('d', 64), 'America/Los_Angeles', 'final', 'test');

insert into public.search_queries (tenant_id, brand_id, date, device, query, query_md5, page, page_md5, clicks, impressions, source_id, collected_at, payload_hash, source_timezone, data_state, schema_version) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-05', 'DESKTOP', 'q', md5('q'), 'https://x/p', md5('https://x/p'), 1, 10, '50000000-0000-0000-0000-000000000011', now(), repeat('e', 64), 'America/Los_Angeles', 'final', 'test');

insert into public.source_reconciliations (tenant_id, brand_id, source, metric, period_start, period_end, source_timezone, property_ref, our_total, source_total, difference, difference_pct, status, tolerance_pct, checked_at) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'gsc', 'clicks', '2026-09-03', '2026-10-07', 'America/Los_Angeles', 'sc-domain:x', 20, 20, 0, 0, 'match', 0.5, now());

-- Integritate ----------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, source_id, collected_at, payload_hash, source_timezone, schema_version)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-05', 'x', 'y', '/z', 'nu-e-md5', '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'UTC', 't') $$,
  '23514', null, 'G0: landing_page_md5 trebuie să fie md5(landing_page)'
);
select throws_ok(
  $$ insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, source_id, collected_at, payload_hash, source_timezone, schema_version)
     values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000011', '2026-10-05', 'x', 'y', '/z', md5('/z'), '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'UTC', 't') $$,
  '23503', null, 'G0: brand din T1 nu poate fi asociat cu T2 (FK compus)'
);
select throws_ok(
  $$ insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, sessions, source_id, collected_at, payload_hash, source_timezone, schema_version)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-09', 'x', 'y', '/z', md5('/z'), -1, '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'UTC', 't') $$,
  '23514', null, 'G0: sesiuni negative respinse'
);

-- View-uri de observații + metrics.compute ------------------------------------------------------------
create function pg_temp.def(p_key text) returns jsonb language sql as $$
  select to_jsonb(d) from public.metric_definitions d where d.metric_key = p_key and d.version = 1
$$;

create function pg_temp.compute(p_key text, p_obs jsonb, p_confirmed int, p_start date, p_end date) returns jsonb language sql as $$
  select metrics.compute(jsonb_build_object(
    'definition', pg_temp.def(p_key),
    'brand_id', '20000000-0000-0000-0000-000000000011',
    'as_of_date', '2026-10-20',
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'kind', 'custom'),
    'connection', '{"connected": true, "query_ok": true}'::jsonb,
    'current', jsonb_build_object('observations', p_obs, 'confirmed_days', p_confirmed, 'data_as_of', '2026-10-07')
  )) -> 'metric'
$$;

-- G1. sessions: suma rândurilor zilei; ziua cu NULL nu devine 0.
select is(
  (select jsonb_agg(jsonb_build_object('date', date, 'value', value) order by date) from public.web_metric_observations where metric_key = 'ga4_sessions'),
  '[{"date":"2026-10-05","value":150},{"date":"2026-10-06","value":200},{"date":"2026-10-07","value":null}]'::jsonb,
  'G1: ga4_sessions = suma zilei; ziua cu sesiuni necunoscute rămâne NULL, nu 0'
);
select is(
  (pg_temp.compute('ga4_sessions',
    (select jsonb_agg(jsonb_build_object('date', date, 'value', value)) from public.web_metric_observations where metric_key = 'ga4_sessions'),
    2, '2026-10-05', '2026-10-07') ->> 'value')::numeric,
  350::numeric, 'G1: compute exclude ziua NULL și însumează 150 + 200'
);

-- G2. key events din web_key_events (total independent de landing page).
select is(
  (select value from public.web_metric_observations where metric_key = 'ga4_key_events' and date = '2026-10-05'),
  6::numeric, 'G2: ga4_key_events = suma pe eventName'
);

-- G3. utilizatori activi: raport pe interval, nu suma zilelor; alt interval → unavailable.
select is(
  (pg_temp.compute('ga4_active_users',
    (select jsonb_agg(jsonb_build_object('start', start, 'end', "end", 'value', value)) from public.web_active_users_observations),
    7, '2026-09-28', '2026-10-04') ->> 'value')::numeric,
  910::numeric, 'G3: active users = raportul pe exact intervalul cerut'
);
select is(
  pg_temp.compute('ga4_active_users',
    (select jsonb_agg(jsonb_build_object('start', start, 'end', "end", 'value', value)) from public.web_active_users_observations),
    5, '2026-09-30', '2026-10-04') ->> 'status',
  'unavailable', 'G3: interval fără raport → unavailable (zilele nu se însumează)'
);
select ok(
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'web_metric_observations' and column_name like '%active%'),
  'G3: activeUsers pe zile nu apare în view-ul de observații'
);

-- G4. CTR: 10/100 + 10/900 = 2%, nu media ratelor.
select is(
  (pg_temp.compute('gsc_ctr',
    (select jsonb_agg(jsonb_build_object('date', date, 'numerator', numerator, 'denominator', denominator)) from public.search_metric_observations where metric_key = 'gsc_ctr'),
    2, '2026-10-05', '2026-10-06') ->> 'value')::numeric,
  2::numeric, 'G4: gsc_ctr = 100 × Σclicks / Σimpressions = 2%'
);

-- G5. poziția: ponderată cu impressions (zi: ponderat pe device-uri, perioadă: ponderat pe zile).
select is(
  (select value from public.search_metric_observations where metric_key = 'gsc_average_position' and date = '2026-10-05'),
  7::numeric, 'G5: poziția zilei = (5×60 + 10×40) / 100'
);
select is(
  (pg_temp.compute('gsc_average_position',
    (select jsonb_agg(jsonb_build_object('date', date, 'value', value, 'weight', weight)) from public.search_metric_observations where metric_key = 'gsc_average_position'),
    2, '2026-10-05', '2026-10-06') ->> 'value')::numeric,
  2.5::numeric, 'G5: poziția perioadei = (7×100 + 2×900) / 1000 = 2,5'
);
select is(
  (select sum(value) from public.search_metric_observations where metric_key = 'gsc_clicks'),
  20::numeric, 'G5: gsc_clicks = suma device-urilor'
);

-- RLS: client cu acces ----------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select count(*)::int from public.web_daily $$, $$ values (4) $$, 'RLS: clientul cu acces vede web_daily al brandului');
select results_eq($$ select count(*)::int from public.search_daily $$, $$ values (3) $$, 'RLS: clientul vede search_daily');
select results_eq($$ select count(*)::int from public.search_queries $$, $$ values (1) $$, 'RLS: clientul vede search_queries');
select results_eq($$ select count(*)::int from public.web_active_users_interval $$, $$ values (1) $$, 'RLS: clientul vede intervalele de active users');
select results_eq($$ select count(*)::int from public.web_metric_observations where metric_key = 'ga4_sessions' $$, $$ values (3) $$, 'RLS: view-ul respectă accesul (security_invoker)');
select is_empty($$ select 1 from public.source_reconciliations $$, 'RLS: clientul nu vede reconcilierile (doar agenția)');
select throws_ok(
  $$ insert into public.search_daily (tenant_id, brand_id, date, device, source_id, collected_at, payload_hash, source_timezone, data_state, schema_version)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-09', 'MOBILE', '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'UTC', 'final', 't') $$,
  '42501', null, 'RLS: clientul nu poate scrie în search_daily'
);
reset role;

-- RLS: fără acces, alt tenant, agenție ------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is_empty($$ select 1 from public.web_daily $$, 'RLS: client fără brand_access nu vede web_daily');
select is_empty($$ select 1 from public.search_queries $$, 'RLS: client fără brand_access nu vede search_queries');
select is_empty($$ select 1 from public.web_metric_observations $$, 'RLS: client fără acces nu vede observațiile');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.web_daily $$, 'RLS: admin T2 nu vede web_daily din T1');
select is_empty($$ select 1 from public.search_daily $$, 'RLS: admin T2 nu vede search_daily din T1');
select is_empty($$ select 1 from public.source_reconciliations $$, 'RLS: admin T2 nu vede reconcilierile din T1');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select results_eq($$ select count(*)::int from public.source_reconciliations $$, $$ values (1) $$, 'RLS: strategistul cu acces vede reconcilierile');
reset role;

select * from finish();
rollback;
