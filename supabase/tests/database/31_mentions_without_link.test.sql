-- Mențiuni fără link (deciziile R): mențiunile web din Planable, fără `url` și fără `text`. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · admin T1 = 3000…0001 · client T1 (acces 1A) = 3000…0004 · admin T2 = 3000…0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-r');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'ws-r';
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'planable_listening',
        current_date - 35, current_date - 1, 'succeeded', 6, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');

create function pg_temp.mention(p_id text, p_url text, p_text text, p_source text, p_reviewed boolean default false, p_owned boolean default null, p_sentiment text default 'neutral')
returns void language sql as $$
  insert into public.mentions (tenant_id, brand_id, native_id, url, source_name, published_at, text, sentiment, sentiment_reviewed_by, sentiment_reviewed_at, author_is_owned,
                               collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_id, p_url, p_source, now() - interval '2 days', p_text, p_sentiment,
          case when p_reviewed then '30000000-0000-0000-0000-000000000001'::uuid end, case when p_reviewed then now() end, p_owned,
          now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'))
$$;
create function pg_temp.feed(p_sentiment text default null, p_source text default null) returns jsonb language sql as $$
  select public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, p_sentiment, p_source)
$$;
create function pg_temp.dist(p_key text) returns integer language sql as $$
  select (public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) ->> p_key)::integer
$$;

-- W1. Cheia: o mențiune fără link trebuie să poarte cheia construită de conector ---------------------------------------------
select lives_ok($$ select pg_temp.mention('h:cu-link', 'https://x.test/1', 'Text cu link.', 'instagram', true, false, 'positive') $$, 'W1: mențiune cu link și text, revizuită');
select lives_ok($$ select pg_temp.mention('h:nerevizuita', 'https://x.test/2', 'Altă mențiune.', 'facebook') $$, 'W1: mențiune cu link, nerevizuită');
select lives_ok($$ select pg_temp.mention('s:web-1', null, null, 'web') $$, 'W1: mențiune web fără link și fără text, cu cheie construită');
select lives_ok($$ select pg_temp.mention('s:web-2', null, null, 'web') $$, 'W1: a doua');
select lives_ok($$ select pg_temp.mention('s:web-3', null, '', 'web') $$, 'W1: textul gol e tot „fără conținut”');
select lives_ok($$ select pg_temp.mention('s:doar-text', null, 'Text fără link.', 'facebook') $$, 'W1: fără link, dar cu text: are conținut');
select throws_ok($$ select pg_temp.mention('h:fara-link', null, null, 'web') $$, '23514', null, 'W1: fără link, o cheie de tip hash de URL e refuzată');
select throws_ok($$ select pg_temp.mention('id-din-fisier', null, 'text', 'web') $$, '23514', null, 'W1: fără link, un ID oarecare e refuzat');
select throws_ok($$ select pg_temp.mention('s:web-1', null, null, 'web') $$, '23505', null, 'W1: aceeași cheie nu se scrie de două ori');
select throws_ok($$ select pg_temp.mention('h:gol', '', 'text', 'web') $$, '23514', null, 'W1: linkul gol rămâne nepermis; lipsa e NULL');

-- W2. Feed-ul arată doar mențiunile cu conținut și spune câte au venit fără ---------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((pg_temp.feed() ->> 'total')::integer, 3, 'W2: totalul feed-ului numără doar mențiunile cu link sau text');
select is(jsonb_array_length(pg_temp.feed() -> 'items'), 3, 'W2: și doar ele vin în listă');
select is((pg_temp.feed() ->> 'without_content')::integer, 3, 'W2: cele fără conținut sunt numărate separat');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.feed() -> 'items') i where i ->> 'id' like 's:web-%'), 'W2: niciun card gol');
select is((select i -> 'url' from jsonb_array_elements(pg_temp.feed() -> 'items') i where i ->> 'id' = 's:doar-text'), 'null'::jsonb, 'W2: o mențiune cu text, dar fără link, vine cu url null, nu cu un link inventat');
select is((pg_temp.feed(null, 'web') ->> 'total')::integer, 0, 'W2: filtrul pe web: nicio mențiune cu conținut');
select is((pg_temp.feed(null, 'web') ->> 'without_content')::integer, 3, 'W2: dar trei fără conținut, pe aceeași sursă');
select is((pg_temp.feed(null, 'instagram') ->> 'without_content')::integer, 0, 'W2: pe altă sursă, zero');
select is((pg_temp.feed('unreviewed') ->> 'total')::integer, 2, 'W2: „nerevizuite” sunt doar cele care pot fi revizuite');
select is((pg_temp.feed('unreviewed') ->> 'without_content')::integer, 0, 'W2: cu filtru de sentiment, numărul celor fără conținut nu se raportează');
select is((pg_temp.feed('positive') ->> 'total')::integer, 1, 'W2: filtrul pe sentiment revizuit rămâne neschimbat');

-- W3. Sentimentul: cele fără conținut nu așteaptă revizuire și nu intră în procente --------------------------------------------
select is(pg_temp.dist('total'), 1, 'W3: totalul are doar mențiunile revizuite');
select is(pg_temp.dist('unreviewed'), 2, 'W3: nerevizuite = cele cu conținut, fără etichetă umană');
select is(pg_temp.dist('without_content'), 3, 'W3: cele fără conținut apar separat');
select is((public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) -> 'shares' ->> 'positive')::numeric, 100::numeric, 'W3: procentele nu se schimbă din cauza lor');

-- W4. Indicatorul „Mențiuni” le numără: formula lui e numărul de mențiuni -------------------------------------------------------
select is((select sum(value)::integer from public.mentions_metric_observations where brand_id = '20000000-0000-0000-0000-000000000011' and date >= current_date - 7), 6, 'W4: mentions_count numără toate cele șase mențiuni');

-- W5. Scriere și izolare ----------------------------------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.mention('s:de-la-client', null, null, 'web') $$, '42501', null, 'W5: clientul nu scrie mențiuni');
select is((select count(*) from public.mentions where native_id like 's:%'), 4::bigint, 'W5: clientul brandului citește mențiunile fără link prin RLS');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is((select count(*) from public.mentions where native_id like 's:%'), 0::bigint, 'W5: alt client nu vede nimic');
select throws_ok($$ select pg_temp.feed() $$, '42501', null, 'W5: alt client nu citește feed-ul');
select tests.authenticate_as_anon();
select throws_ok($$ select pg_temp.feed() $$, '42501', null, 'W5: anon nu citește feed-ul');

-- W6. Farmacovigilență: o mențiune fără text se poate marca, cu snapshotul care spune că textul lipsește ------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.pv_flags (brand_id, entity_type, entity_ref, note) values ('20000000-0000-0000-0000-000000000011', 'mention', 's:web-1', 'test') $$, 'W6: marcajul se scrie');
reset role;
select is((select text_snapshot from public.pv_flags where entity_ref = 's:web-1'), '(mențiune fără text în sursă)', 'W6: snapshotul nu inventează text');
select is((select link from public.pv_flags where entity_ref = 's:web-1'), null, 'W6: și nici link');

select * from finish();
rollback;
