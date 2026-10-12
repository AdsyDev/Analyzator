-- Listening și Analize pentru ecranele de brand (D-13).
-- T1 = 1000…0001 · brand 1A = 2000…0011 · admin T1 = 3000…0001 · strateg T1 (acces 1A) = 3000…0002 · client T1 (acces 1A) = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-m');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'ws-m';
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'planable_listening',
        current_date - 35, current_date - 1, 'succeeded', 3, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');
insert into public.mentions (tenant_id, brand_id, native_id, url, source_name, published_at, text, sentiment, sentiment_reviewed_by, sentiment_reviewed_at, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'h:1', 'https://x.test/1', 'instagram', now() - interval '2 days', 'bun', 'positive', '30000000-0000-0000-0000-000000000001', now(), now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'h:2', 'https://x.test/2', 'tiktok', now() - interval '3 days', 'rău', 'negative', '30000000-0000-0000-0000-000000000001', now(), now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'h:3', 'https://x.test/3', 'tiktok', now() - interval '3 days', 'neutru după furnizor', 'neutral', null, null, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'));

-- M1. Mențiuni: paginare, filtre, sentimentul doar după revizuire ------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) ->> 'total')::int, 3, 'M1: clientul vede mențiunile brandului');
select is((public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, null, 'tiktok') ->> 'total')::int, 2, 'M1: filtrul de sursă');
select is((public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, 'unreviewed') ->> 'total')::int, 1, 'M1: filtrul „nerevizuite”');
select is(public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, 'unreviewed') -> 'items' -> 0 -> 'sentiment', 'null'::jsonb,
  'M1: sentimentul furnizorului nu se arată ca etichetă până la revizuire');
select is(jsonb_array_length(public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, null, null, 2, 2) -> 'items'), 1, 'M1: pagina 2 din 2');

-- M2. Distribuția: doar revizuitele, procente din SQL ---------------------------------------------------------
select is((public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) ->> 'total')::int, 2, 'M2: totalul are doar revizuitele');
select is((public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) -> 'shares' ->> 'positive')::numeric, 50::numeric, 'M2: procentul vine calculat');
select is((public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) ->> 'unreviewed')::int, 1, 'M2: nerevizuitele se numără separat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) $$, '42501', null, 'M2: fără acces, refuzat');
reset role;

-- M3. Analize: clientul doar publicate --------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
insert into public.insights (tenant_id, brand_id, title, period_start, period_end, summary, author_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Ciornă internă', current_date - 28, current_date - 1, 'x', '30000000-0000-0000-0000-000000000002');
select is(jsonb_array_length(public.brand_insights('20000000-0000-0000-0000-000000000011', current_date - 28, current_date - 1)), 1, 'M3: agenția vede ciorna');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(jsonb_array_length(public.brand_insights('20000000-0000-0000-0000-000000000011', current_date - 28, current_date - 1)), 0, 'M3: clientul nu vede ciorna');
reset role;

select * from finish();
rollback;
