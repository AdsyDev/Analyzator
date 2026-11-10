-- Etapa 2 (G-4, G-5): dovezile unei metrici și planul acțiunilor (efort, indicator urmărit). Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002
-- client T1 cu acces la 1A = …0004 · client fără acces = …0005 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;

insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', 'act_924');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'act_924';
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'meta_ads',
        current_date - 35, current_date - 1, 'succeeded', 7, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');
-- 7 zile: cost 10, 11, … 16 (ultima zi = 16), 4 clickuri pe zi.
insert into public.paid_daily (tenant_id, brand_id, source, account_id, campaign_id, date, spend, impressions, clicks, currency, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', '924', 'c1', d, 10 + (d - (current_date - 7)), 100, 4, 'RON', now(), 'api', repeat('e', 64), 'Europe/Bucharest', 't',
       (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')
from generate_series(current_date - 7, current_date - 1, interval '1 day') g (ts), lateral (select g.ts::date as d) x;

create function pg_temp.ev(p_key text, p_limit integer default 10) returns jsonb language sql as $$
  select public.brand_metric_evidence('20000000-0000-0000-0000-000000000011', p_key, current_date - 7, current_date - 1, null, p_limit)
$$;

-- N1. Agenția: observațiile reale, cele mai recente întâi, cu totalul lor ------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.ev('meta_ads_spend') ->> 'status', 'ok', 'N1: metrica cu observații are status ok');
select is((pg_temp.ev('meta_ads_spend') ->> 'total_records')::integer, 7, 'N1: totalul numără toate observațiile din interval');
select is(jsonb_array_length(pg_temp.ev('meta_ads_spend') -> 'records'), 7, 'N1: sub limită, vin toate');
select is((pg_temp.ev('meta_ads_spend') -> 'records' -> 0 ->> 'date')::date, current_date - 1, 'N1: cea mai recentă observație e prima');
select is((pg_temp.ev('meta_ads_spend') -> 'records' -> 0 ->> 'value')::numeric, 16::numeric, 'N1: valoarea e cea din sursă, necalculată');
select is(pg_temp.ev('meta_ads_spend') -> 'records' -> 0 ->> 'currency', 'RON', 'N1: moneda vine cu observația');
select is(pg_temp.ev('meta_ads_spend') ->> 'aggregation', 'sum', 'N1: agregarea din registru însoțește răspunsul');
select is(pg_temp.ev('meta_ads_spend') ->> 'source', 'meta_ads', 'N1: sursa din registru însoțește răspunsul');
select is(jsonb_array_length(pg_temp.ev('meta_ads_spend', 3) -> 'records'), 3, 'N1: limita taie lista');
select is((pg_temp.ev('meta_ads_spend', 3) ->> 'total_records')::integer, 7, 'N1: totalul nu depinde de limită');
select is((pg_temp.ev('meta_ads_spend', 3) -> 'records' -> 2 ->> 'date')::date, current_date - 3, 'N1: limita păstrează cele mai recente');
select is(jsonb_array_length(pg_temp.ev('meta_ads_spend', 100000) -> 'records'), 7, 'N1: o limită uriașă nu rupe cererea (plafon 100)');
select is(jsonb_array_length(pg_temp.ev('meta_ads_spend', 0) -> 'records'), 1, 'N1: limita minimă e 1');
select ok(pg_temp.ev('meta_ads_cpc') -> 'records' -> 0 ? 'numerator' and pg_temp.ev('meta_ads_cpc') -> 'records' -> 0 ? 'denominator',
  'N1: la o rată vin numărătorul și numitorul, nu rata gata calculată');
select is((pg_temp.ev('meta_ads_cpc') -> 'records' -> 0 ->> 'denominator')::numeric, 4::numeric, 'N1: numitorul e numărul de clickuri al zilei');

-- N2. Stări fără date: nimic inventat ---------------------------------------------------------------------------------
select is(pg_temp.ev('gsc_clicks') ->> 'status', 'not_connected', 'N2: sursă fără conexiune = not_connected');
select is(pg_temp.ev('gsc_clicks') -> 'records', '[]'::jsonb, 'N2: fără conexiune nu există înregistrări');
select is(pg_temp.ev('metrica_inexistenta') ->> 'status', 'not_connected', 'N2: o cheie din afara registrului nu are observații');
select is((pg_temp.ev('metrica_inexistenta') ->> 'total_records')::integer, 0, 'N2: total 0 pentru o cheie necunoscută');
select is(pg_temp.ev('ga4_sessions') ->> 'status', 'unavailable', 'N2: sursă conectată fără date = indisponibil, nu ok cu listă goală');
select throws_ok($$ select pg_temp.ev('Meta; drop table x') $$, '22023', 'Cheie de metrică invalidă', 'N2: cheia e validată');
select throws_ok($$ select public.brand_metric_evidence('20000000-0000-0000-0000-000000000011', 'meta_ads_spend', current_date - 1, current_date - 7) $$,
  '22023', 'Perioadă invalidă', 'N2: perioadă inversată');
select throws_ok($$ select public.brand_metric_evidence('20000000-0000-0000-0000-000000000011', 'meta_ads_spend', current_date - 500, current_date - 1) $$,
  '22023', 'Perioadă invalidă', 'N2: perioadă peste 400 de zile');

-- N3. Clientul cu acces vede aceleași observații, fără să vadă conexiunea ------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.source_connections where external_account_id = 'act_924' $$, 'N3: clientul nu vede conexiunea');
select is((pg_temp.ev('meta_ads_spend') ->> 'total_records')::integer, 7, 'N3: clientul vede aceleași observații ca agenția');

-- N4. Fără acces: aceeași eroare pentru brand străin, inexistent și anon ---------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select pg_temp.ev('meta_ads_spend') $$, '42501', 'Nu ai acces la acest spațiu de brand', 'N4: clientul fără acces e refuzat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.ev('meta_ads_spend') $$, '42501', 'Nu ai acces la acest spațiu de brand', 'N4: adminul altui client e refuzat');
select throws_ok($$ select public.brand_metric_evidence(gen_random_uuid(), 'meta_ads_spend', current_date - 7, current_date - 1) $$,
  '42501', 'Nu ai acces la acest spațiu de brand', 'N4: brand inexistent, același răspuns');
select throws_ok($$ select pg_temp.ev('metrica_inexistenta') $$, '42501', 'Nu ai acces la acest spațiu de brand', 'N4: fără acces, nici o cheie necunoscută nu răspunde altfel (fără oracol)');
select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_metric_evidence('20000000-0000-0000-0000-000000000011', 'meta_ads_spend', current_date - 7, current_date - 1) $$,
  '42501', null, 'N4: anon nu execută');
reset role;

-- ===== Planul acțiunilor: efort și indicator urmărit ===================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
insert into public.insights (tenant_id, brand_id, title, period_start, period_end, author_id, summary, interpretation, limits)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Analiză plan', current_date - 7, current_date - 1,
        '30000000-0000-0000-0000-000000000002', 'Constatare', 'Interpretare', 'Limite');
reset role;
insert into ctx select 'insight', id from public.insights where title = 'Analiză plan';

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
insert into public.recommendations (tenant_id, brand_id, insight_id, problem, action, expected_benefit, priority)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'insight'), 'Problemă', 'Ce facem', 'Beneficiu', 1);
select lives_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, responsible_user_id, due_date, effort, tracked_metric_key)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'insight'), 'Acțiune cu plan',
             '30000000-0000-0000-0000-000000000002', current_date + 10, '2 zile', 'ga4_sessions') $$,
  'P1: o acțiune primește efort și indicator urmărit din registru');
select throws_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, responsible_user_id, tracked_metric_key)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'insight'), 'Cheie inventată',
             '30000000-0000-0000-0000-000000000002', 'nu_exista_in_registru') $$,
  '23514', null, 'P1: un indicator din afara registrului e refuzat');
select throws_ok(
  $$ insert into public.actions (tenant_id, brand_id, insight_id, title, responsible_user_id, effort)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'insight'), 'Efort gol',
             '30000000-0000-0000-0000-000000000002', '   ') $$,
  '23514', null, 'P1: efortul gol e refuzat (se lasă NULL, nu spații)');
select lives_ok($$ update public.actions set effort = '3 zile', tracked_metric_key = 'gsc_clicks' where title = 'Acțiune cu plan' $$, 'P2: planul se poate actualiza');
select throws_ok($$ update public.actions set tracked_metric_key = 'alta_inventata' where title = 'Acțiune cu plan' $$, '23514', null, 'P2: nici la actualizare nu intră o cheie inventată');
select lives_ok($$ update public.actions set effort = null, tracked_metric_key = null where title = 'Acțiune cu plan' $$, 'P2: planul se poate goli');
update public.actions set effort = '2 zile', tracked_metric_key = 'ga4_sessions' where title = 'Acțiune cu plan';

create function pg_temp.insight() returns jsonb language sql as $$
  select i from jsonb_array_elements(public.brand_insights('20000000-0000-0000-0000-000000000011', current_date - 30, current_date)) i where i ->> 'title' = 'Analiză plan'
$$;
select is(pg_temp.insight() -> 'actions' -> 0 ->> 'effort', '2 zile', 'P3: brand_insights întoarce efortul');
select is(pg_temp.insight() -> 'actions' -> 0 -> 'tracked_metric' ->> 'metric_key', 'ga4_sessions', 'P3: și cheia indicatorului urmărit');
select is(pg_temp.insight() -> 'actions' -> 0 -> 'tracked_metric' ->> 'label', 'Sesiuni', 'P3: cu numele din registru');
select is(pg_temp.insight() -> 'actions' -> 0 ->> 'stage', 'proposed', 'P3: și stadiul exact al acțiunii');
select is(pg_temp.insight() ->> 'interpretation', 'Interpretare', 'P3: interpretarea vine pentru editor');
select is(pg_temp.insight() -> 'recommendations' -> 0 ->> 'action', 'Ce facem', 'P3: recomandările vin cu analiza');
select is((pg_temp.insight() ->> 'version')::integer, 1, 'P3: versiunea analizei');

-- Clientul nu vede draftul și nici planul lui.
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.insight(), null, 'P4: clientul nu primește analiza în draft');
-- RLS nu arată clientului acțiunea unui draft, deci actualizarea lui nu atinge niciun rând (fără eroare, fără efect).
update public.actions set effort = 'schimbat de client' where title = 'Acțiune cu plan';
reset role;
select is((select effort from public.actions where title = 'Acțiune cu plan'), '2 zile', 'P4: clientul nu poate scrie planul unei acțiuni');

select * from finish();
rollback;
