-- Etapa 3, a treia felie (L-1…L-4): Indexare. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · brand 1B = 2000…0012 · brand 2A = 2000…0021
-- admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · account T1 (acces doar 1B) = …0003
-- client T1 cu acces la 1A = …0004 · client fără acces = …0005 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;

insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'gsc', 'sc-domain:brand1a.test');
insert into ctx select 'gsc', id from public.source_connections where external_account_id = 'sc-domain:brand1a.test';

create function pg_temp.inspect(p_url text, p_day date, p_origin text, p_verdict text, p_google text default null, p_user text default null) returns void language sql as $$
  insert into public.index_inspections (tenant_id, brand_id, url, url_md5, inspected_on, origin, verdict, coverage_state, google_canonical, user_canonical,
                                        source_id, collected_at, payload_hash, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_url, md5(p_url), p_day, p_origin, p_verdict,
          case p_verdict when 'PASS' then 'Submitted and indexed' when 'NEUTRAL' then 'Crawled - currently not indexed' end, p_google, p_user,
          (select v from ctx where k = 'gsc'), now(), repeat('a', 64), 't')
$$;
-- /a: neindexat pe 1 nov., indexat pe 8 nov. (contează ultima); /b: exclus; /c: eroare; /d: fără verdict; /e: canonical diferit.
select pg_temp.inspect('https://brand1a.test/a', '2026-11-01', 'priority', 'NEUTRAL');
select pg_temp.inspect('https://brand1a.test/a', '2026-11-08', 'priority', 'PASS', 'https://brand1a.test/a', 'https://brand1a.test/a');
select pg_temp.inspect('https://brand1a.test/b', '2026-11-08', 'top_page', 'NEUTRAL');
select pg_temp.inspect('https://brand1a.test/c', '2026-11-08', 'top_page', 'FAIL');
select pg_temp.inspect('https://brand1a.test/d', '2026-11-08', 'top_page', null);
select pg_temp.inspect('https://brand1a.test/e', '2026-11-08', 'top_page', 'PASS', 'https://brand1a.test/e-canonic', 'https://brand1a.test/e');

create function pg_temp.st() returns jsonb language sql as $$ select public.brand_index_status('20000000-0000-0000-0000-000000000011') $$;
create function pg_temp.url(p_url text) returns jsonb language sql as $$
  select u from jsonb_array_elements(pg_temp.st() -> 'urls') u where u ->> 'url' = p_url
$$;

-- X1. Clasificarea verdictului: funcție pură ------------------------------------------------------------------------------
select is(metrics.index_state('PASS'), 'indexed', 'X1: PASS = indexat');
select is(metrics.index_state('pass'), 'indexed', 'X1: fără deosebire de litere');
select is(metrics.index_state('NEUTRAL'), 'not_indexed', 'X1: NEUTRAL (exclus) = neindexat');
select is(metrics.index_state('FAIL'), 'not_indexed', 'X1: FAIL = neindexat');
select is(metrics.index_state('VERDICT_UNSPECIFIED'), 'unknown', 'X1: verdict nespecificat = necunoscut');
select is(metrics.index_state(null), 'unknown', 'X1: fără verdict = necunoscut, nu neindexat');

-- X2. Lista prioritară: scrie agenția cu acces la brand ---------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.index_urls (tenant_id, brand_id, url, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'https://brand1a.test/a', '30000000-0000-0000-0000-000000000002'),
         ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'https://brand1a.test/nou', '30000000-0000-0000-0000-000000000002') $$,
  'X2: strategistul cu acces la brand adaugă URL-uri prioritare');
select throws_ok($$ insert into public.index_urls (tenant_id, brand_id, url, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'https://brand1a.test/a', '30000000-0000-0000-0000-000000000002') $$,
  '23505', null, 'X2: același URL nu se adaugă de două ori');
select throws_ok($$ insert into public.index_urls (tenant_id, brand_id, url, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'javascript:alert(1)', '30000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'X2: doar adrese http(s)');
select is((select url_md5 from public.index_urls where url = 'https://brand1a.test/nou'), md5('https://brand1a.test/nou'), 'X2: md5-ul URL-ului e calculat de bază');
select throws_ok($$ insert into public.index_urls (tenant_id, brand_id, url, url_md5, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'https://brand1a.test/x', md5('altceva'), '30000000-0000-0000-0000-000000000002') $$,
  '428C9', null, 'X2: md5-ul nu poate fi trimis de utilizator (coloană calculată)');
select throws_ok($$ insert into public.index_urls (tenant_id, brand_id, url, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'https://brand1a.test/y', '30000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'X2: autorul nu poate fi alt utilizator');
select throws_ok($$ insert into public.index_urls (tenant_id, brand_id, url, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'https://brand1b.test/a', '30000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'X2: strategistul nu scrie lista unui brand la care nu are acces');
select throws_ok($$ update public.index_urls set url = 'https://brand1a.test/z' $$, '42501', null, 'X2: URL-urile nu se modifică (fără drept de UPDATE)');
select throws_ok($$ insert into public.index_inspections (tenant_id, brand_id, url, url_md5, inspected_on, origin, source_id, collected_at, payload_hash, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'https://brand1a.test/f', md5('https://brand1a.test/f'), '2026-11-08', 'priority',
          (select v from ctx where k = 'gsc'), now(), repeat('a', 64), 't') $$,
  '42501', null, 'X2: inspecțiile le scrie doar workerul');

-- X3. Starea indexării --------------------------------------------------------------------------------------------------------
select is(pg_temp.st() ->> 'connected', 'true', 'X3: Search Console conectat');
select is((pg_temp.st() ->> 'inspected_on')::date, '2026-11-08'::date, 'X3: ziua ultimei inspecții');
select is(jsonb_array_length(pg_temp.st() -> 'urls'), 5, 'X3: un rând pe URL, nu pe inspecție');
select is(pg_temp.url('https://brand1a.test/a') ->> 'state', 'indexed', 'X3: contează ultima inspecție a URL-ului');
select is((pg_temp.url('https://brand1a.test/a') ->> 'inspected_on')::date, '2026-11-08'::date, 'X3: data ultimei inspecții pe URL');
select is(pg_temp.url('https://brand1a.test/a') ->> 'priority', 'true', 'X3: URL-ul din lista agenției e marcat prioritar');
select is(pg_temp.url('https://brand1a.test/b') ->> 'priority', 'false', 'X3: o pagină inspectată pentru clickuri nu e prioritară');
select is(pg_temp.url('https://brand1a.test/b') ->> 'state', 'not_indexed', 'X3: exclus = neindexat');
select is(pg_temp.url('https://brand1a.test/b') ->> 'coverage_state', 'Crawled - currently not indexed', 'X3: motivul Google vine neschimbat');
select is(pg_temp.url('https://brand1a.test/d') ->> 'state', 'unknown', 'X3: fără verdict = necunoscut');
select is(pg_temp.url('https://brand1a.test/d') -> 'canonical_matches', 'null'::jsonb, 'X3: fără canonical = necunoscut, nu „diferit”');
select is(pg_temp.url('https://brand1a.test/a') ->> 'canonical_matches', 'true', 'X3: canonicalul Google = cel declarat');
select is(pg_temp.url('https://brand1a.test/e') ->> 'canonical_matches', 'false', 'X3: canonicalul Google diferă de cel declarat');
select is(pg_temp.st() -> 'summary', '{"total": 5, "indexed": 2, "not_indexed": 2, "unknown": 1, "canonical_mismatch": 1}'::jsonb, 'X3: numărul de URL-uri pe stări');
select is(jsonb_array_length(pg_temp.st() -> 'priority_urls'), 2, 'X3: lista prioritară completă');
select is((select p ->> 'inspected' from jsonb_array_elements(pg_temp.st() -> 'priority_urls') p where p ->> 'url' = 'https://brand1a.test/nou'), 'false',
  'X3: un URL prioritar încă neinspectat apare ca atare, nu ca neindexat');

-- X4. Clientul citește, nu scrie ---------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.st() -> 'summary' ->> 'total', '5', 'X4: clientul cu acces vede starea indexării');
select is((select count(*) from public.index_urls), 2::bigint, 'X4: clientul cu acces vede lista prioritară');
select throws_ok($$ insert into public.index_urls (tenant_id, brand_id, url, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'https://brand1a.test/c', '30000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'X4: clientul nu adaugă URL-uri');
delete from public.index_urls;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select count(*) from public.index_urls), 2::bigint, 'X4: ștergerea încercată de client nu a șters nimic');
select lives_ok($$ delete from public.index_urls where url = 'https://brand1a.test/nou' $$, 'X4: agenția scoate un URL din listă');
select is(pg_temp.url('https://brand1a.test/a') ->> 'priority', 'true', 'X4: celălalt URL rămâne prioritar');

-- X5. Izolare și audit -------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select throws_ok($$ select pg_temp.st() $$, '42501', null, 'X5: account fără acces la brand: refuzat');
select is((select count(*) from public.index_inspections), 0::bigint, 'X5: account fără acces la brand nu vede inspecțiile');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select pg_temp.st() $$, '42501', null, 'X5: client fără acces: refuzat');
select is((select count(*) from public.index_urls), 0::bigint, 'X5: client fără acces nu vede lista');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.st() $$, '42501', null, 'X5: alt tenant: refuzat');
select is((select count(*) from public.index_inspections), 0::bigint, 'X5: alt tenant nu vede inspecțiile');
select is(public.brand_index_status('20000000-0000-0000-0000-000000000021') ->> 'connected', 'false', 'X5: brand fără Search Console = neconectat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select count(*) from public.audit_events where entity_type = 'index_urls' and action = 'insert'), 2::bigint, 'X5: adăugările sunt auditate');
select is((select count(*) from public.audit_events where entity_type = 'index_urls' and action = 'delete'), 1::bigint, 'X5: ștergerea e auditată');

-- X6. Plafonul listei prioritare ------------------------------------------------------------------------------------------------
reset role;
insert into public.index_urls (tenant_id, brand_id, url, created_by)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'https://brand1b.test/p' || n, '30000000-0000-0000-0000-000000000001'
from generate_series(1, 150) n;
select throws_ok($$ insert into public.index_urls (tenant_id, brand_id, url, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'https://brand1b.test/p151', '30000000-0000-0000-0000-000000000001') $$,
  '23514', null, 'X6: al 151-lea URL prioritar e respins');

select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_index_status('20000000-0000-0000-0000-000000000011') $$, '42501', null, 'X6: fără autentificare, refuzat');

select * from finish();
rollback;
