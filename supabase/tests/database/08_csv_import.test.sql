-- Import CSV: tabele noi, RLS, chei, view-uri de observații și metrics.compute. Date SINTETICE, doar în acest fișier.
-- brand 1A = 2000…0011 · 1B = …0012 (tenant T1) · 2A = …0021 (T2)
-- admin T1 = 3000…01 · strategist T1 (acces 1A) = …02 · account T1 (acces 1B) = …03 · client T1 (acces 1A) = …04 · client fără acces = …05 · admin T2 = …11
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Loturi (ca owner, fără RLS) -------------------------------------------------------------------------------------
insert into public.import_batches (id, tenant_id, brand_id, source, file_sha256, status, rows_accepted, uploaded_by, currency, timezone) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', repeat('1', 64), 'imported', 5, '30000000-0000-0000-0000-000000000003', 'RON', 'Europe/Bucharest'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable_listening', repeat('2', 64), 'imported', 3, '30000000-0000-0000-0000-000000000003', null, 'Europe/Bucharest');

create function pg_temp.paid(p_day date, p_campaign text, p_spend numeric, p_clicks bigint, p_currency text default 'RON',
                             p_breakdown text default 'none', p_attr text default 'unspecified') returns void language sql as $$
  insert into public.paid_daily (tenant_id, brand_id, source, account_id, campaign_id, date, breakdown_signature, attribution_config,
                                 spend, clicks, currency, import_batch_id, row_number, collected_at, payload_hash, source_timezone, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', 'acc', p_campaign, p_day, p_breakdown, p_attr,
          p_spend, p_clicks, p_currency, '60000000-0000-0000-0000-000000000001', 1, now(), repeat('a', 64), 'Europe/Bucharest', 'csv-1')
$$;

select pg_temp.paid('2026-10-05', 'C1', 10, 100);
select pg_temp.paid('2026-10-06', 'C1', 10, 900);
select pg_temp.paid('2026-10-07', 'C1', null, null);                -- zi necunoscută (NULL), nu 0
select pg_temp.paid('2026-10-05', 'C1', 999, 999, 'RON', 'device=mobile'); -- defalcare: nu intră în totaluri

insert into public.mentions (tenant_id, brand_id, native_id, url, published_at, sentiment, sentiment_reviewed_by, sentiment_reviewed_at,
                             import_batch_id, row_number, collected_at, payload_hash, source_timezone, schema_version) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'm1', 'https://x/1', '2026-10-05T10:00:00Z', 'positive', null, null, '60000000-0000-0000-0000-000000000002', 1, now(), repeat('b', 64), 'UTC', 'csv-1'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'm2', 'https://x/2', '2026-10-05T11:00:00Z', 'negative', '30000000-0000-0000-0000-000000000001', now(), '60000000-0000-0000-0000-000000000002', 2, now(), repeat('b', 64), 'UTC', 'csv-1'),
  -- 22:30 UTC pe 5 oct = 01:30 pe 6 oct la București
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'm3', 'https://x/3', '2026-10-05T22:30:00Z', 'unknown', null, null, '60000000-0000-0000-0000-000000000002', 3, now(), repeat('b', 64), 'UTC', 'csv-1');

insert into public.import_batch_rows (batch_id, row_number, tenant_id, brand_id, status, reason, target, data) values
  ('60000000-0000-0000-0000-000000000001', 1, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'accepted', null, 'paid_daily', '{"date": "2026-10-05"}'),
  ('60000000-0000-0000-0000-000000000001', 2, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'rejected', 'duplicat în fișier', null, null);

-- Integritate -----------------------------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.paid('2026-10-05', 'C1', 1, 1) $$, '23505', null, 'C1: aceeași cheie naturală nu se dublează');
select throws_ok($$ select pg_temp.paid('2026-10-08', 'C2', -1, 1) $$, '23514', null, 'C1: cost negativ respins');
select throws_ok($$ select pg_temp.paid('2026-10-08', 'C2', 1, 1, 'lei') $$, '23514', null, 'C1: moneda trebuie să fie cod ISO în majuscule');
select throws_ok(
  $$ insert into public.paid_daily (tenant_id, brand_id, source, campaign_id, date, spend, currency, import_batch_id, row_number, collected_at, payload_hash, source_timezone, schema_version)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'meta_ads', 'C9', '2026-10-05', 1, 'RON',
             '60000000-0000-0000-0000-000000000001', 9, now(), repeat('a', 64), 'UTC', 'csv-1') $$,
  '23503', null, 'C1: rândul nu poate referi un lot din alt brand (FK compus tenant, brand, lot)'
);
select throws_ok(
  $$ insert into public.mentions (tenant_id, brand_id, native_id, url, published_at, sentiment_reviewed_by, import_batch_id, row_number, collected_at, payload_hash, source_timezone, schema_version)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'm9', 'https://x/9', now(), '30000000-0000-0000-0000-000000000001',
             '60000000-0000-0000-0000-000000000002', 9, now(), repeat('b', 64), 'UTC', 'csv-1') $$,
  '23514', null, 'C1: sentiment_reviewed_by cere și sentiment_reviewed_at'
);
select throws_ok(
  $$ insert into public.import_batch_rows (batch_id, row_number, tenant_id, brand_id, status, reason, target, data)
     values ('60000000-0000-0000-0000-000000000001', 3, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'rejected', null, null, null) $$,
  '23514', null, 'C1: rândul respins cere motiv'
);
select throws_ok(
  $$ insert into public.import_batch_rows (batch_id, row_number, tenant_id, brand_id, status, reason, target, data)
     values ('60000000-0000-0000-0000-000000000001', 3, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'rejected', 'x', null, null) $$,
  '23503', null, 'C1: rândul de lot nu poate fi legat de alt brand'
);
select throws_ok(
  $$ insert into public.import_batches (tenant_id, brand_id, source, file_sha256, uploaded_by)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', repeat('1', 64), '30000000-0000-0000-0000-000000000003') $$,
  '23505', null, 'C1: fișier identic (același hash) pentru același brand și aceeași sursă nu se înregistrează de două ori'
);

-- View-uri + metrics.compute -----------------------------------------------------------------------------------------
create function pg_temp.def(p_key text) returns jsonb language sql as $$
  select to_jsonb(d) from public.metric_definitions d where d.metric_key = p_key and d.version = 1
$$;
create function pg_temp.compute(p_key text, p_obs jsonb, p_confirmed int, p_start date, p_end date) returns jsonb language sql as $$
  select metrics.compute(jsonb_build_object(
    'definition', pg_temp.def(p_key), 'brand_id', '20000000-0000-0000-0000-000000000011', 'as_of_date', '2026-10-20',
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'kind', 'custom'),
    'connection', '{"connected": true, "query_ok": true}'::jsonb,
    'current', jsonb_build_object('observations', p_obs, 'confirmed_days', p_confirmed, 'data_as_of', '2026-10-07')
  )) -> 'metric'
$$;

select is((select count(*)::int from public.metric_definitions where metric_key ~ '^(google|meta|tiktok)_ads_(spend|impressions|clicks|conversions|cpc|cpa)$' or metric_key = 'mentions_count'),
  19, 'M0: 18 de metrici paid (3 platforme × 6) + mentions_count în registru');
select is((select lifecycle from public.metric_definitions where metric_key = 'meta_ads_spend'), 'draft', 'M0: costul e draft (unitatea monetară lipsește din contract)');

select is(
  (select jsonb_agg(jsonb_build_object('date', date, 'value', value) order by date) from public.paid_metric_observations where metric_key = 'meta_ads_spend'),
  '[{"date":"2026-10-05","value":10},{"date":"2026-10-06","value":10},{"date":"2026-10-07","value":null}]'::jsonb,
  'M1: rândurile cu defalcare nu intră în total; ziua necunoscută rămâne NULL, nu 0'
);
select is(
  (pg_temp.compute('meta_ads_cpc',
     (select jsonb_agg(jsonb_build_object('date', date, 'numerator', numerator, 'denominator', denominator)) from public.paid_metric_observations where metric_key = 'meta_ads_cpc' and date < '2026-10-07'),
     2, '2026-10-05', '2026-10-06') ->> 'value')::numeric,
  0.02::numeric, 'M2: CPC = Σcost / Σclicks = 20 / 1000, nu media ratelor (0,1 și 0,0111)'
);
select is(
  (pg_temp.compute('meta_ads_spend',
     (select jsonb_agg(jsonb_build_object('date', date, 'value', value)) from public.paid_metric_observations where metric_key = 'meta_ads_spend'),
     2, '2026-10-05', '2026-10-07') ->> 'value')::numeric,
  20::numeric, 'M3: costul exclude ziua NULL și însumează 10 + 10'
);

-- Monede diferite în aceeași zi: nu se însumează → indisponibil.
select pg_temp.paid('2026-10-08', 'C3', 5, 5, 'RON');
select pg_temp.paid('2026-10-08', 'C4', 7, 7, 'EUR');
select is(
  pg_temp.compute('meta_ads_spend',
     (select jsonb_agg(jsonb_build_object('date', date, 'value', value)) from public.paid_metric_observations where metric_key = 'meta_ads_spend' and date = '2026-10-08'),
     1, '2026-10-08', '2026-10-08') ->> 'status',
  'unavailable', 'M4: monede diferite în aceeași zi → duplicate_observations → indisponibil, nu o sumă'
);
select is(
  (select count(distinct currency)::int from public.paid_metric_observations where date = '2026-10-08' and metric_key = 'meta_ads_spend'),
  2, 'M4: view-ul păstrează moneda per grup'
);

-- Mențiuni: pe zi în Europe/Bucharest; sentiment ca distribuție.
select is(
  (select jsonb_agg(jsonb_build_object('date', date, 'value', value) order by date) from public.mentions_metric_observations),
  '[{"date":"2026-10-05","value":2},{"date":"2026-10-06","value":1}]'::jsonb,
  'M5: mențiunile se numără pe ziua publicării în Europe/Bucharest (22:30 UTC = ziua următoare)'
);
select is(
  (select jsonb_object_agg(sentiment, mentions) from public.mention_sentiment_daily),
  '{"positive":1,"negative":1,"unknown":1}'::jsonb, 'M6: distribuția sentimentului păstrează „unknown” ca stare proprie'
);
select is((select reviewed from public.mention_sentiment_daily where sentiment = 'negative'), 1::bigint, 'M6: corecția umană e numărată separat');

-- RLS -----------------------------------------------------------------------------------------------------------------
-- client cu acces la 1A: vede datele importate, nu loturile
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select results_eq($$ select count(*)::int from public.paid_daily $$, $$ values (6) $$, 'RLS: clientul cu acces vede paid_daily');
select results_eq($$ select count(*)::int from public.mentions $$, $$ values (3) $$, 'RLS: clientul vede mențiunile');
select results_eq($$ select count(*)::int from public.paid_metric_observations where metric_key = 'meta_ads_spend' $$, $$ values (5) $$, 'RLS: view-ul respectă accesul');
select is_empty($$ select 1 from public.import_batches $$, 'RLS: clientul nu vede loturile');
select is_empty($$ select 1 from public.import_batch_rows $$, 'RLS: clientul nu vede rândurile respinse');
select throws_ok(
  $$ insert into public.mentions (tenant_id, brand_id, native_id, url, published_at, import_batch_id, row_number, collected_at, payload_hash, source_timezone, schema_version)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'x', 'https://x', now(), '60000000-0000-0000-0000-000000000002', 7, now(), repeat('b', 64), 'UTC', 'csv-1') $$,
  '42501', null, 'RLS: clientul nu poate scrie mențiuni'
);
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is_empty($$ select 1 from public.paid_daily $$, 'RLS: client fără acces nu vede paid_daily');
select is_empty($$ select 1 from public.mentions $$, 'RLS: client fără acces nu vede mențiunile');
select is_empty($$ select 1 from public.paid_metric_observations $$, 'RLS: client fără acces nu vede observațiile');
reset role;

-- strategist cu acces la 1A: vede loturile și rândurile (agenție); account cu acces doar la 1B: nu vede 1A
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select results_eq($$ select count(*)::int from public.import_batches $$, $$ values (2) $$, 'RLS: strategistul vede loturile brandului');
select results_eq($$ select count(*)::int from public.import_batch_rows $$, $$ values (2) $$, 'RLS: strategistul vede rândurile (acceptate și respinse)');
select throws_ok(
  $$ insert into public.import_batch_rows (batch_id, row_number, tenant_id, brand_id, status, reason)
     values ('60000000-0000-0000-0000-000000000001', 8, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'rejected', 'x') $$,
  '42501', null, 'RLS: nimeni nu scrie rânduri de lot direct (doar service role)'
);
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is_empty($$ select 1 from public.paid_daily $$, 'RLS: account fără acces la 1A nu vede paid_daily');
select is_empty($$ select 1 from public.import_batches where brand_id = '20000000-0000-0000-0000-000000000011' $$, 'RLS: account fără acces la 1A nu vede loturile lui 1A');
reset role;

select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.paid_daily $$, 'RLS: admin T2 nu vede paid_daily din T1');
select is_empty($$ select 1 from public.mentions $$, 'RLS: admin T2 nu vede mențiunile din T1');
select is_empty($$ select 1 from public.import_batch_rows $$, 'RLS: admin T2 nu vede rândurile de lot din T1');
reset role;

-- Doar service role scrie (exemplu: poate actualiza lotul)
select tests.authenticate_as_service_role();
select lives_ok($$ update public.import_batches set rows_skipped = 1 where id = '60000000-0000-0000-0000-000000000001' $$, 'service_role poate scrie în loturi');
reset role;

select * from finish();
rollback;
