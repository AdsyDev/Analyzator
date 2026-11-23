-- Metricile sociale ale competitorilor din Planable (decizia Y-6, migrația 20261123120000).
-- Brand 1A (T1): strategist T1 = 3000…0002, client T1 = 3000…0004 (acces 1A), client fără acces = 3000…0005, admin T2 = 3000…0011.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ziua de azi în Europe/Bucharest (regula 9), ca setul nou să fie în vigoare la sfârșitul perioadei oricând rulează testul.
create function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'Europe/Bucharest')::date $$;
grant execute on function pg_temp.today() to public;

-- Planable conectat pentru 1A: o conexiune și o rulare reușită.
insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id) values
  ('50000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-1a');
insert into public.sync_runs (id, tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at) values
  ('60000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000041',
   'planable_analytics', pg_temp.today() - 35, pg_temp.today() - 1, 'succeeded', 10, now(), now());

-- Brandul: Instagram (intră) și X (nu are analiza competitorilor, nu intră). O postare cu două snapshoturi se numără o dată.
insert into public.social_daily (tenant_id, brand_id, platform, account_id, date, followers, engagements, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p, a, pg_temp.today() - d, f, 5, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't',
       '50000000-0000-0000-0000-000000000041', '60000000-0000-0000-0000-000000000041'
from (values ('instagram', 'ig-1a', 3, 1000), ('instagram', 'ig-1a', 1, 1010), ('x', 'x-1a', 1, 500)) v (p, a, d, f);
insert into public.social_posts (tenant_id, brand_id, platform, account_id, post_id, snapshot_date, metrics_scope, published_at, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p, a, id, pg_temp.today() - s, 'lifetime', (pg_temp.today() - 2)::timestamp at time zone 'Europe/Bucharest',
       now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', '50000000-0000-0000-0000-000000000041', '60000000-0000-0000-0000-000000000041'
from (values ('instagram', 'ig-1a', 'p1', 1), ('instagram', 'ig-1a', 'p1', 0), ('instagram', 'ig-1a', 'p2', 0), ('x', 'x-1a', 'p3', 0)) v (p, a, id, s);

-- S1. Profilurile sociale în versiunea setului ------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', pg_temp.today() + 40, null,
       '[{"name":"A","social":[{"platform":"twitter","handle":"a"}]}]') $$,
  '22023', 'Membrul 1 (A): rețeaua „twitter” nu are analiza competitorilor în Planable', 'S1: rețea fără analiza competitorilor respinsă');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', pg_temp.today() + 40, null,
       '[{"name":"A","social":[{"platform":"instagram","handle":"cu spatiu"}]}]') $$,
  '22023', null, 'S1: handle invalid respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', pg_temp.today() + 40, null,
       '[{"name":"A","social":[{"platform":"instagram","handle":"x"}]},{"name":"B","social":[{"platform":"instagram","handle":"@X"}]}]') $$,
  '22023', 'Membrul 2 (B): profilul instagram @x apare de mai multe ori în set', 'S1: același profil la doi competitori respins');
select throws_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', pg_temp.today() + 40, null,
       '[{"name":"A","social":{"platform":"instagram"}}]') $$,
  '22023', 'Membrul 1 (A): profilurile sociale trebuie trimise ca listă', 'S1: profilurile care nu sunt listă sunt respinse');
select lives_ok(
  $$ select * from public.create_competitor_set_version('20000000-0000-0000-0000-000000000011', pg_temp.today(), null,
       '[{"name":"Alfa","domain":"alfa.ro","social":[{"platform":"Instagram","handle":" @CompA "}]},
         {"name":"Beta"},
         {"name":"Gama","social":[{"platform":"tiktok","handle":"gama.ro"}]}]') $$,
  'S1: versiune cu profiluri sociale, în vigoare de azi');
reset role;
select is((select social_profiles from public.competitor_set_members where brand_id = '20000000-0000-0000-0000-000000000011' and name = 'Alfa'),
  '[{"handle": "compa", "platform": "instagram"}]'::jsonb, 'S1: rețeaua și handle-ul se salvează cu litere mici, fără „@” și spații');
select is((select social_profiles from public.competitor_set_members where brand_id = '20000000-0000-0000-0000-000000000011' and name = 'Beta'),
  '[]'::jsonb, 'S1: fără profiluri → listă goală, nu null');
-- Constrângerea ține și pentru inserările directe (RLS permite insert-ul membrilor pentru strategist).
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.competitor_set_members (tenant_id, brand_id, competitor_set_id, name, social_profiles)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000011', 'Direct',
             '[{"platform":"instagram","handle":"MAJUSCULE"}]') $$,
  '23514', null, 'S1: forma profilurilor e verificată și la insert direct');
reset role;

-- Datele colectate ale competitorului Alfa: 7 zile de serie, 3 postări în perioadă, una în afara ei.
insert into public.competitor_social_daily (tenant_id, brand_id, platform, handle, display_name, date, followers, engagement, source_id, sync_run_id, collected_at, payload_hash, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'compa', 'Comp A', pg_temp.today() - d, 200 + (6 - d), 10,
       '50000000-0000-0000-0000-000000000041', '60000000-0000-0000-0000-000000000041', now(), repeat('a', 64), 't'
from generate_series(0, 6) d;
insert into public.competitor_social_posts (tenant_id, brand_id, platform, handle, post_key, post_url, posted_at, likes, comments, shares, source_id, sync_run_id, collected_at, payload_hash, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'compa', md5(u), u, (pg_temp.today() - d)::timestamp at time zone 'Europe/Bucharest' + interval '10 hours',
       l, c, s, '50000000-0000-0000-0000-000000000041', '60000000-0000-0000-0000-000000000041', now(), repeat('a', 64), 't'
from (values ('https://instagram.com/p/1', 1, 10, 2, null::bigint), ('https://instagram.com/p/2', 2, 20, 3, 5), ('https://instagram.com/p/3', 3, 0, 0, 0),
             ('https://instagram.com/p/vechi', 20, 100, 100, 100)) v (u, d, l, c, s);

-- S2. Matricea, ca client cu acces ------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
create temporary table m on commit drop as
  select public.brand_competition('20000000-0000-0000-0000-000000000011', pg_temp.today() - 6, pg_temp.today()) as j;
create temporary table ids on commit drop as
  select x ->> 'name' as name, x ->> 'id' as id from m, jsonb_array_elements(m.j -> 'entities') x;
create temporary table social on commit drop as
  select r ->> 'key' as key, r -> 'cells' as cells from m, jsonb_array_elements(m.j -> 'groups' -> 2 -> 'rows') r;

select is((select j -> 'groups' -> 2 ->> 'dimension' from m), 'social', 'S2: grupul social rămâne al treilea (AI, SEO, social, listening)');
select results_eq($$ select key from social $$, $$ values ('social_cadence'), ('social_followers'), ('social_interactions_per_post') $$,
  'S2: trei rânduri sociale, în ordine');
select is((select (cells -> (select id from ids where name = 'Brand 1A') ->> 'value')::numeric from social where key = 'social_cadence'), 2::numeric,
  'S2: brandul: 2 postări pe Instagram în 7 zile (snapshoturile nu se dublează, X nu intră)');
select is((select (cells -> (select id from ids where name = 'Brand 1A') ->> 'value')::numeric from social where key = 'social_followers'), 1010::numeric,
  'S2: brandul: ultima observație de urmăritori pe Instagram');
select is((select cells -> (select id from ids where name = 'Brand 1A') ->> 'status' from social where key = 'social_interactions_per_post'), 'unavailable',
  'S2: brandul: interacțiunile publice pe postare nu se pot calcula din datele Planable proprii');
select is((select (cells -> (select id from ids where name = 'Alfa') ->> 'value')::numeric from social where key = 'social_cadence'), 3::numeric,
  'S2: Alfa: 3 postări în perioadă / 1 săptămână; postarea veche nu intră');
select is((select (cells -> (select id from ids where name = 'Alfa') ->> 'value')::numeric from social where key = 'social_followers'), 206::numeric,
  'S2: Alfa: ultima observație de urmăritori');
select is((select round((cells -> (select id from ids where name = 'Alfa') ->> 'value')::numeric, 2) from social where key = 'social_interactions_per_post'), 13.33,
  'S2: Alfa: (10+2 + 20+3+5 + 0) / 3 postări; distribuirile lipsă nu se inventează');
select is((select cells -> (select id from ids where name = 'Alfa') ->> 'status' from social where key = 'social_cadence'), 'ok', 'S2: Alfa: perioadă acoperită complet');
select is((select (cells -> (select id from ids where name = 'Alfa') ->> 'coverage')::numeric from social where key = 'social_cadence'), 1::numeric, 'S2: Alfa: acoperire 1');
select is((select cells -> (select id from ids where name = 'Beta') ->> 'status' from social where key = 'social_followers'), 'unavailable', 'S2: Beta fără profiluri: N/A');
select matches((select cells -> (select id from ids where name = 'Beta') ->> 'reason' from social where key = 'social_followers'), 'nu are profiluri sociale',
  'S2: Beta: motivul spune ce lipsește');
select ok((select cells -> (select id from ids where name = 'Beta') -> 'value' = 'null'::jsonb from social where key = 'social_cadence'), 'S2: Beta: null, nu 0');
select matches((select cells -> (select id from ids where name = 'Gama') ->> 'reason' from social where key = 'social_cadence'), 'nu are observații',
  'S2: Gama are profil, dar nicio observație: N/A cu motiv');
select is((select j -> 'social_as_of' ->> (select id from ids where name = 'Alfa') from m), pg_temp.today()::text, 'S2: social_as_of = ultima zi observată');

-- Perioadă de 14 zile: doar 7 acoperite → parțial, cu acoperirea în celulă.
select is((select public.brand_competition('20000000-0000-0000-0000-000000000011', pg_temp.today() - 13, pg_temp.today())
                  -> 'groups' -> 2 -> 'rows' -> 0 -> 'cells' -> (select id from ids where name = 'Alfa') ->> 'status'), 'partial',
  'S2: 7 din 14 zile observate → parțial');

-- S3. RLS pe tabelele noi -------------------------------------------------------------------------------------------------
select is((select count(*) from public.competitor_social_daily), 7::bigint, 'S3: clientul cu acces la 1A vede seriile');
select throws_ok($$ insert into public.competitor_social_daily (tenant_id, brand_id, platform, handle, date, source_id, collected_at, payload_hash, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'x', pg_temp.today(), '50000000-0000-0000-0000-000000000041', now(), repeat('a', 64), 't') $$,
  '42501', null, 'S3: utilizatorii nu scriu date colectate');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is((select count(*) from public.competitor_social_daily), 0::bigint, 'S3: client fără acces: nimic');
select is((select count(*) from public.competitor_social_posts), 0::bigint, 'S3: client fără acces: nicio postare');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is((select count(*) from public.competitor_social_posts), 0::bigint, 'S3: admin T2: nimic din T1');
reset role;

select * from finish();
rollback;
