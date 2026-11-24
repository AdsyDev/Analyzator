-- „Mențiuni” doar în română: versiunea 2 a mentions_count (deciziile AE). Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · client T1 (acces 1A) = 3000…0004 · client T2 = 3000…0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- M1. Registrul: versiunea 2 e cea curentă; versiunea 1 rămâne ca istoric ------------------------------------------------------
select is((select version from public.metric_definitions_current where metric_key = 'mentions_count'), 2, 'M1: versiunea curentă e 2');
select is((select count(*)::int from public.metric_definitions where metric_key = 'mentions_count'), 2, 'M1: versiunea 1 rămâne în registru');
select ok((select formula_ro like '%altă limbă decât româna%' from public.metric_definitions where metric_key = 'mentions_count' and version = 2), 'M1: formula spune ce se exclude');
select ok((select formula_ro like '%nedeterminată%' from public.metric_definitions where metric_key = 'mentions_count' and version = 2), 'M1: și ce rămâne numărat');
select is((select valid_from from public.metric_definitions where metric_key = 'mentions_count' and version = 2), '2026-11-24'::date, 'M1: în vigoare din 24 nov. 2026');
select ok((select (v1.unit, v1.aggregation, v1.direction, v1.freshness_grace_days) = (v2.unit, v2.aggregation, v2.direction, v2.freshness_grace_days)
           from public.metric_definitions v1 join public.metric_definitions v2 on v2.metric_key = v1.metric_key and v2.version = 2
           where v1.metric_key = 'mentions_count' and v1.version = 1), 'M1: unitatea, agregarea, direcția și toleranța nu se schimbă');

-- Date: o conexiune Planable și mențiuni în mai multe limbi, în aceeași zi -------------------------------------------------------
create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-ad');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'ws-ad';
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'planable_listening',
        current_date - 35, current_date - 1, 'succeeded', 7, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');

create function pg_temp.mention(p_id text, p_text text, p_language text default null, p_owned boolean default false, p_day integer default 2)
returns void language sql as $$
  insert into public.mentions (tenant_id, brand_id, native_id, url, source_name, published_at, text, author_is_owned, language,
                               collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_id, case when p_id like 'h:%' then 'https://x.test/' || p_id end,
          'instagram', ((current_date - p_day)::timestamp + interval '12 hours') at time zone 'Europe/Bucharest', p_text, p_owned, p_language,
          now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'))
$$;
select pg_temp.mention('h:ro', 'Disconfortul și rigiditatea articulară îți pot afecta ritmul de zi cu zi.');
select pg_temp.mention('h:scurt', 'Proenzi 👍');
select pg_temp.mention('s:web', null);
select pg_temp.mention('h:csv-ro', 'This text is English but the file says Romanian', 'ro');
select pg_temp.mention('h:proprie-ro', 'Proenzi Active Colagen se consumă direct din flacon, o doză pe zi, fără dizolvare.', null, true);
select pg_temp.mention('h:es', '¿Remojas los frijoles, tiras el agua y aun así te inflan? No es tu panza: es una enzima que nadie fabrica.');
select pg_temp.mention('h:hu', 'Eladóvá vált Proenzi Intenzív max 6 db hiányzik, Egyik doboz fel sincs bontva. Térdemre szedtem, csak mivel allergiáim vannak nem bírom sajnos!');
select pg_temp.mention('h:csv-en', 'Disconfortul și rigiditatea articulară îți pot afecta ritmul.', 'en');
select pg_temp.mention('h:doar-es', 'Tomo Proenzi para las articulaciones y me va muy bien con el deporte', null, false, 3);

-- M2. Observațiile: fără mențiunile clar în altă limbă -----------------------------------------------------------------------
select is((select value from public.mentions_metric_observations where brand_id = '20000000-0000-0000-0000-000000000011' and date = current_date - 2), 5::numeric,
  'M2: ro, nedeterminată, fără text, CSV declarat ro și contul propriu; fără es, hu și CSV declarat en');
select is((select count(*)::int from public.mentions_metric_observations where brand_id = '20000000-0000-0000-0000-000000000011' and date = current_date - 3), 0,
  'M2: o zi doar cu mențiuni în altă limbă nu are rând (ca o zi fără mențiuni), nu un zero inventat');
select is((select count(*)::int from public.mentions where brand_id = '20000000-0000-0000-0000-000000000011'), 9, 'M2: nimic nu se șterge din mentions');

-- M3. Indicatorul în aplicație (brand_metrics) --------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['mentions_count'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'value')::numeric, 5::numeric,
  'M3: „Mențiuni” = 5 pe perioadă (doar română și nedeterminate)');
select is((public.brand_metrics('20000000-0000-0000-0000-000000000011', array['mentions_count'], current_date - 7, current_date - 1) -> 'data' -> 0 -> 'evidence_query' ->> 'version')::int, 2,
  'M3: răspunsul poartă versiunea 2 a definiției');

-- M4. Matricea de Competiție: brandul pe aceeași bază ca competitorii (toate limbile) -----------------------------------------
create function pg_temp.brand_cell(p_row text) returns jsonb language sql as $$
  select r -> 'cells' -> '20000000-0000-0000-0000-000000000011'
  from jsonb_array_elements(public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'groups') g,
       jsonb_array_elements(g -> 'rows') r
  where g ->> 'dimension' = 'listening' and r ->> 'key' = p_row
$$;
select is((pg_temp.brand_cell('mentions_count') ->> 'value')::numeric, 9::numeric, 'M4: în matrice, brandul numără toate limbile (ca la competitori)');
select ok(pg_temp.brand_cell('mentions_count') ->> 'reason' like '%Toate limbile, ca la competitori%', 'M4: celula spune de ce diferă de Overview');
select is(pg_temp.brand_cell('mentions_count') ->> 'status',
          public.brand_metrics('20000000-0000-0000-0000-000000000011', array['mentions_count'], current_date - 7, current_date - 1) -> 'data' -> 0 ->> 'status',
  'M4: starea rămâne cea din registru');

-- M5. Izolare -----------------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.mentions_metric_observations where brand_id = '20000000-0000-0000-0000-000000000011'), 0, 'M5: alt client nu vede observațiile');
select throws_ok($$ select public.brand_competition('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) $$, '42501', null, 'M5: nici matricea');
reset role;
select ok(not (select prosecdef from pg_proc where oid = 'public.brand_competition(uuid, date, date, text)'::regprocedure), 'M5: brand_competition rămâne SECURITY INVOKER');
select ok((select coalesce(reloptions::text, '') like '%security_invoker=true%' from pg_class where oid = 'public.mentions_metric_observations'::regclass), 'M5: view-ul rămâne security_invoker');

select * from finish();
rollback;
