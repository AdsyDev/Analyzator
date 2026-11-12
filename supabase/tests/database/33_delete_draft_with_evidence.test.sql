-- Ștergerea unei ciorne cu dovezi și recomandări (deciziile T). Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · client T1 (acces 1A) = …0004
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create function pg_temp.id_of(p_title text) returns uuid language sql security definer as $$ select id from public.insights where title = p_title $$;
create function pg_temp.make(p_title text) returns void language sql as $$
  insert into public.insights (tenant_id, brand_id, author_id, title, period_start, period_end, summary, interpretation, limits)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', p_title, '2026-10-01', '2026-10-31', 'C', 'I', 'L');
  insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key)
  select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id_of(p_title), 'metric', k from unnest(array['gsc_clicks', 'ga4_sessions']) k;
  insert into public.recommendations (tenant_id, brand_id, insight_id, problem, action, expected_benefit, priority)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id_of(p_title), 'P', 'A', 'B', 1);
$$;
create function pg_temp.children(p_id uuid) returns bigint language sql security definer as $$
  select (select count(*) from public.evidence_links where insight_id = p_id) + (select count(*) from public.recommendations where insight_id = p_id)
$$;
create temporary table ids (k text primary key, v uuid) on commit drop;
grant all on ids to public;

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select pg_temp.make('Ciornă de șters');
select pg_temp.make('Ciornă păstrată');
select pg_temp.make('Publicată');
insert into ids values ('sters', pg_temp.id_of('Ciornă de șters')), ('publicata', pg_temp.id_of('Publicată'));
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id_of('Publicată'), 'in_review');
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id_of('Publicată'), 'published');

-- V1. Autorul își șterge ciorna, cu tot cu dovezi și recomandări -------------------------------------------------------------
select is(pg_temp.children((select v from ids where k = 'sters')), 3::bigint, 'V1: ciorna are două dovezi și o recomandare');
select lives_ok($$ delete from public.insights where title = 'Ciornă de șters' $$, 'V1: ciorna cu dovezi și recomandări se șterge');
select is((select count(*) from public.insights where title = 'Ciornă de șters'), 0::bigint, 'V1: analiza nu mai există');
select is(pg_temp.children((select v from ids where k = 'sters')), 0::bigint, 'V1: dovezile și recomandările ei au plecat odată cu ea');
select is(pg_temp.children(pg_temp.id_of('Ciornă păstrată')), 3::bigint, 'V1: cealaltă ciornă rămâne întreagă');

-- V2. Regula rămâne pentru tot restul ----------------------------------------------------------------------------------------
select lives_ok($$ delete from public.evidence_links where insight_id = pg_temp.id_of('Ciornă păstrată') and metric_key = 'ga4_sessions' $$, 'V2: o dovadă a unei ciorne se poate scoate');
select throws_ok($$ delete from public.evidence_links where insight_id = pg_temp.id_of('Publicată') $$, '42501', null, 'V2: dovezile unei analize publicate nu se șterg');
select throws_ok($$ delete from public.recommendations where insight_id = pg_temp.id_of('Publicată') $$, '42501', null, 'V2: nici recomandările ei');
select throws_ok($$ update public.recommendations set action = 'rescris' where insight_id = pg_temp.id_of('Publicată') $$, '42501', null, 'V2: și nu se editează');
select throws_ok($$ insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id_of('Publicată'), 'metric', 'gsc_ctr') $$, '42501', null, 'V2: nu se adaugă dovezi după publicare');
delete from public.insights where title = 'Publicată';
select is((select status from public.insights where title = 'Publicată'), 'published', 'V2: o analiză publicată nu se șterge (RLS nu o oferă ștergerii)');
select tests.authenticate_as_service_role();
select throws_ok($$ delete from public.insights where title = 'Publicată' $$, '42501', null, 'V2: nici cu cheia de service');
select throws_ok($$ delete from public.evidence_links where insight_id = (select v from ids where k = 'publicata') $$, '42501', null, 'V2: nici dovezile ei, cu cheia de service');
select is(pg_temp.children((select v from ids where k = 'publicata')), 3::bigint, 'V2: analiza publicată își păstrează dovezile și recomandarea');

-- V3. Cine poate șterge o ciornă nu s-a schimbat -----------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
delete from public.insights where title = 'Ciornă păstrată';
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select count(*) from public.insights where title = 'Ciornă păstrată'), 1::bigint, 'V3: clientul nu șterge ciorna (nici nu o vede)');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok($$ delete from public.insights where title = 'Ciornă păstrată' $$, 'V3: agency_admin șterge ciorna altcuiva, cu tot cu dovezi');
select is((select count(*) from public.insights where title = 'Ciornă păstrată'), 0::bigint, 'V3: ciorna nu mai există');

select * from finish();
rollback;
