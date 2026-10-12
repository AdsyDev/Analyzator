-- Social din datele Planable (D-23). T1 = 1000…0001 · brand 1A = 2000…0011 · client T1 (acces 1A) = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-social');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'ws-social';

-- S0. Fără sincronizare Planable: neconectat (nu zero) -----------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(public.brand_social('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) -> 'connected', 'false'::jsonb, 'S0: fără rulare Planable, neconectat');
reset role;

insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'planable_analytics',
        current_date - 35, current_date - 1, 'succeeded', 10, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');

-- Două conturi: Instagram (urmăritori 100 → 106, interacțiuni 5/zi), TikTok (urmăritori doar într-o zi, fără interacțiuni).
insert into public.social_daily (tenant_id, brand_id, platform, account_id, date, followers, engagements, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'ig1', current_date - d, 106 - d, 5, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')
from generate_series(1, 7) d;
insert into public.social_daily (tenant_id, brand_id, platform, account_id, date, followers, engagements, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'tiktok', 'tt1', current_date - 2, 50, null, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'));
-- Comparația: 7 zile înainte, Instagram cu 2 interacțiuni/zi.
insert into public.social_daily (tenant_id, brand_id, platform, account_id, date, followers, engagements, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'ig1', current_date - d, 90, 2, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')
from generate_series(8, 14) d;
-- O postare cu două observații (contează ultima) și una nouă, fără metrici.
insert into public.social_posts (tenant_id, brand_id, platform, account_id, post_id, snapshot_date, metrics_scope, published_at, post_url, post_text, impressions, engagements, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'ig1', 'p1', current_date - 3, 'lifetime', now() - interval '6 days', 'https://ig.test/p1', 'prima', 100, 4, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'ig1', 'p1', current_date - 1, 'lifetime', now() - interval '6 days', 'https://ig.test/p1', 'prima', 180, 9, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'tiktok', 'tt1', 'p2', current_date - 1, 'lifetime', now() - interval '2 days', null, 'nouă', null, null, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'));

-- S1. Indicatorii din SQL --------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
create temporary table r on commit drop as select public.brand_social('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) as j;
select is((select (k ->> 'value')::numeric from r, jsonb_array_elements(j -> 'kpis') k where k ->> 'key' = 'posts'), 2::numeric, 'S1: două postări în perioadă (o postare cu două observații contează o dată)');
select is((select (k ->> 'value')::numeric from r, jsonb_array_elements(j -> 'kpis') k where k ->> 'key' = 'followers'), 155::numeric, 'S1: urmăritori = ultima observație pe cont, însumată (105 + 50)');
select is((select k -> 'value' from r, jsonb_array_elements(j -> 'kpis') k where k ->> 'key' = 'net_growth'), 'null'::jsonb,
  'S1: creșterea netă e null când un cont are o singură observație (nu se presupune 0)');
select is((select (k ->> 'value')::numeric from r, jsonb_array_elements(j -> 'kpis') k where k ->> 'key' = 'interactions'), 35::numeric, 'S1: interacțiunile zilnice însumate (lipsa TikTok nu e 0)');
select is((select (k ->> 'change')::numeric from r, jsonb_array_elements(j -> 'kpis') k where k ->> 'key' = 'interactions'), 150::numeric, 'S1: variația față de comparație, în procente (35 vs 14 = +150%)');
select is((select k ->> 'status' from r, jsonb_array_elements(j -> 'kpis') k where k ->> 'key' = 'reach'), 'unavailable', 'S1: reach indisponibil (nu se adună)');

-- S2. Postările: ultima observație, vârsta, maturizarea, lipsa = null --------------------------------------------
select is((select (p ->> 'interactions')::numeric from r, jsonb_array_elements(j -> 'posts') p where p ->> 'id' = 'instagram:p1'), 9::numeric, 'S2: metricile din ultima observație');
select is((select p -> 'interactions' from r, jsonb_array_elements(j -> 'posts') p where p ->> 'id' = 'tiktok:p2'), 'null'::jsonb, 'S2: fără metrici = null, nu 0');
select is((select p -> 'mature' from r, jsonb_array_elements(j -> 'posts') p where p ->> 'id' = 'tiktok:p2'), 'false'::jsonb, 'S2: postare sub 7 zile marcată nematură');

-- S3. Filtrul de platformă și accesul ---------------------------------------------------------------------------
select is((select (k ->> 'value')::numeric from jsonb_array_elements(public.brand_social('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1, 'tiktok') -> 'kpis') k where k ->> 'key' = 'followers'),
  50::numeric, 'S3: filtrul de platformă');
select throws_ok($$ select public.brand_social('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1, 'x; drop') $$, '22023', null, 'S3: platformă invalidă refuzată');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_social('20000000-0000-0000-0000-000000000011', current_date - 7, current_date - 1) $$, '42501', null, 'S3: fără acces, refuzat');

select * from finish();
rollback;
