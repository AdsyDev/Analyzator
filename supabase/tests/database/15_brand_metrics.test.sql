-- Poarta de metrici pentru ecranele de brand (D-11, E8): acces, client_viewer, valori, serii zilnice.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · admin T1 = 3000…0001 · client T1 cu acces la 1A = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;

insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', 'act_515');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'act_515';
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'meta_ads',
        current_date - 35, current_date - 1, 'succeeded', 2, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');
insert into public.paid_daily (tenant_id, brand_id, source, account_id, campaign_id, date, spend, impressions, clicks, currency, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', '515', 'c1', d, 10, 100, 4, 'RON', now(), 'api', repeat('f', 64), 'Europe/Bucharest', 't',
       (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')
from generate_series(current_date - 7, current_date - 1, interval '1 day') g (ts), lateral (select g.ts::date as d) x;

-- L1. Agenția: valoare din SQL, monedă, metrică fără sursă = not_connected ------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend', 'ai_mention_rate'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'value')::numeric,
  70::numeric, 'L1: costul pe 7 zile vine calculat din SQL');
select is(public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'currency',
  'RON', 'L1: moneda vine cu valoarea');
select is(public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend', 'ai_mention_rate'], current_date - 7, current_date - 1) -> 'data' -> 1 ->> 'status',
  'not_connected', 'L1: o metrică fără sursă de observații e „Sursă neconectată”, fără valoare');
select is(public.brand_metrics('20000000-0000-0000-0000-000000000011', array['gsc_clicks'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'status',
  'not_connected', 'L1: Search Console fără conexiune = not_connected');
select is(public.brand_metrics('20000000-0000-0000-0000-000000000011', array['ga4_sessions'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'status',
  'unavailable', 'L1: GA4 conectat, dar fără date = indisponibil (nu 0)');

-- L2. Clientul cu acces vede aceeași valoare (conexiunea e verificată pentru el, deși nu vede source_connections) ---
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.source_connections where external_account_id = 'act_515' $$, 'L2: clientul nu vede conexiunea');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'value')::numeric,
  70::numeric, 'L2: clientul vede aceeași valoare ca agenția');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_cpc'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'value')::numeric,
  2.5::numeric, 'L2: CPC = cost total / clickuri totale, calculat în SQL');

-- L3. Fără acces: aceeași eroare pentru brand străin, inexistent și anon ---------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 7, current_date - 1) $$,
  '42501', 'Nu ai acces la acest spațiu de brand', 'L3: clientul fără acces e refuzat');
select is(private.brand_source_connected('20000000-0000-0000-0000-000000000011', 'meta_ads'), false, 'L3: fără acces, conexiunea apare false (fără oracol)');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 7, current_date - 1) $$,
  '42501', 'Nu ai acces la acest spațiu de brand', 'L3: adminul altui client e refuzat');
select throws_ok($$ select public.brand_metrics(gen_random_uuid(), array['meta_ads_spend'], current_date - 7, current_date - 1) $$,
  '42501', 'Nu ai acces la acest spațiu de brand', 'L3: brand inexistent, același răspuns');
select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 7, current_date - 1) $$,
  '42501', null, 'L3: anon nu execută');
reset role;

-- L4. Seria zilnică: valoarea pe zilele cu date, null (nu 0) pe celelalte ----------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select count(*) from jsonb_array_elements(public.brand_metric_trends('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 9, current_date - 1) -> 0 -> 'points')), 9::bigint,
  'L4: un punct pentru fiecare zi');
select is(public.brand_metric_trends('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 9, current_date - 1) -> 0 -> 'points' -> 0 -> 'value',
  'null'::jsonb, 'L4: ziua fără date e null, nu 0');
select is((public.brand_metric_trends('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date - 9, current_date - 1) -> 0 -> 'points' -> 8 ->> 'value')::numeric,
  10::numeric, 'L4: ziua cu date are valoarea zilei');
select is(public.brand_metric_trends('20000000-0000-0000-0000-000000000011', array['gsc_clicks'], current_date - 9, current_date - 1) -> 0 ->> 'status',
  'not_connected', 'L4: seria unei surse neconectate e not_connected');
select throws_ok($$ select public.brand_metrics('20000000-0000-0000-0000-000000000011', array['meta_ads_spend'], current_date, current_date - 5) $$,
  '22023', 'Perioadă invalidă', 'L4: perioadă inversată respinsă');
reset role;

-- L5. Paid Media (brand_paid): KPI-uri din SQL, rânduri, monede amestecate ----------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select (k ->> 'value')::numeric from jsonb_array_elements(public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'kpis') k where k ->> 'key' = 'spend'),
  70::numeric, 'L5: costul total pentru client');
select is((select (k ->> 'value')::numeric from jsonb_array_elements(public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'kpis') k where k ->> 'key' = 'ctr'),
  4::numeric, 'L5: CTR din totaluri (28 / 700 × 100)');
select is((select k ->> 'status' from jsonb_array_elements(public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'kpis') k where k ->> 'key' = 'cpa'),
  'cannot_compute', 'L5: fără conversii raportate, CPA nu se calculează (nu 0)');
select is(jsonb_array_length(public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'rows'), 7,
  'L5: un rând pe zi și campanie');
select is(public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1, 'custom', 'google_ads') ->> 'connected', 'false',
  'L5: platformă neconectată = connected false');
reset role;
insert into public.paid_daily (tenant_id, brand_id, source, account_id, campaign_id, date, spend, currency, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', '515', 'c-eur', current_date - 2, 5, 'EUR', now(), 'api', repeat('f', 64), 'Europe/Bucharest', 't',
        (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'));
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select k ->> 'status' from jsonb_array_elements(public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'kpis') k where k ->> 'key' = 'spend'),
  'unavailable', 'L5: monede diferite nu se adună: costul e indisponibil');
select is((select (k ->> 'value')::numeric from jsonb_array_elements(public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'kpis') k where k ->> 'key' = 'clicks'),
  28::numeric, 'L5: clickurile (fără monedă) rămân calculabile');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_paid('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) $$, '42501', null, 'L5: fără acces, refuzat');
reset role;

select * from finish();
rollback;
