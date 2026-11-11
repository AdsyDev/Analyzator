-- Răspunsul clientului la recomandări și comentariile pe analize (deciziile S). Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · brand 1B = 2000…0012
-- admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · account T1 (acces doar 1B) = …0003
-- client T1 cu acces la 1A = …0004 · client fără acces = …0005 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create function pg_temp.insight_id(p_title text) returns uuid language sql security definer as $$ select id from public.insights where title = p_title $$;
create function pg_temp.rec_id(p_problem text) returns uuid language sql security definer as $$ select id from public.recommendations where problem = p_problem $$;
create function pg_temp.respond(p_problem text, p_response text, p_comment text default null) returns void language sql as $$
  insert into public.recommendation_responses (recommendation_id, response, comment) values (pg_temp.rec_id(p_problem), p_response, p_comment)
$$;
create function pg_temp.comment(p_title text, p_body text) returns void language sql as $$
  insert into public.insight_comments (insight_id, body) values (pg_temp.insight_id(p_title), p_body)
$$;
create function pg_temp.seen(p_title text) returns jsonb language sql as $$
  select i from jsonb_array_elements(public.brand_insights('20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31')) i where i ->> 'title' = p_title
$$;
create function pg_temp.rec(p_title text, p_problem text) returns jsonb language sql as $$
  select r from jsonb_array_elements(pg_temp.seen(p_title) -> 'recommendations') r where r ->> 'problem' = p_problem
$$;

-- O analiză publicată cu două recomandări și o ciornă cu una, scrise de strategist.
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
insert into public.insights (tenant_id, brand_id, author_id, title, period_start, period_end, summary, interpretation, limits)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'Publicată', '2026-10-01', '2026-10-31', 'C', 'I', 'L'),
       ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'Ciornă', '2026-10-01', '2026-10-31', 'C', 'I', 'L');
insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.insight_id('Publicată'), 'metric', 'gsc_clicks');
insert into public.recommendations (tenant_id, brand_id, insight_id, problem, action, expected_benefit, priority)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.insight_id('Publicată'), 'P1', 'A1', 'B1', 1),
       ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.insight_id('Publicată'), 'P2', 'A2', 'B2', 2),
       ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.insight_id('Ciornă'), 'P-ciornă', 'A', 'B', 1);
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.insight_id('Publicată'), 'in_review');
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.insight_id('Publicată'), 'published');

-- F1. Cine răspunde la o recomandare: doar clientul brandului, doar pe o analiză publicată ----------------------------------
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response', 'null'::jsonb, 'F1: fără răspuns, câmpul e null, nu „acceptat”');
select throws_ok($$ select pg_temp.respond('P1', 'accepted') $$, '42501', 'Doar clientul răspunde la o recomandare', 'F1: strategistul nu acceptă în numele clientului');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select pg_temp.respond('P1', 'accepted') $$, '42501', 'Doar clientul răspunde la o recomandare', 'F1: nici agency_admin');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select pg_temp.respond('P1', 'accepted') $$, '42501', 'Recomandare inexistentă sau fără acces', 'F1: client fără acces la brand');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.respond('P1', 'accepted') $$, '42501', 'Recomandare inexistentă sau fără acces', 'F1: alt client, același mesaj ca pentru „inexistentă”');
select tests.authenticate_as_anon();
select throws_ok($$ select pg_temp.respond('P1', 'accepted') $$, '42501', null, 'F1: anon');

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select throws_ok($$ select pg_temp.respond('P-ciornă', 'accepted') $$, '42501', 'Recomandare inexistentă sau fără acces', 'F1: pe o ciornă nu se răspunde (și nu i se confirmă existența)');
select throws_ok($$ insert into public.recommendation_responses (recommendation_id, response) values ('5fffffff-0000-0000-0000-00000000ffff', 'accepted') $$, '42501', 'Recomandare inexistentă sau fără acces', 'F1: recomandare inexistentă');
select throws_ok($$ select pg_temp.respond('P1', 'refuzată') $$, '23514', null, 'F1: răspunsul are doar două valori');
select throws_ok($$ select pg_temp.respond('P1', 'adjustment_requested') $$, '23514', 'Scrie ce ajustare ceri', 'F1: cererea de ajustare are nevoie de motiv');
select throws_ok($$ select pg_temp.respond('P1', 'adjustment_requested', '   ') $$, '23514', 'Scrie ce ajustare ceri', 'F1: un motiv din spații nu e motiv');
select lives_ok($$ select pg_temp.respond('P1', 'adjustment_requested', '  Vrem alt termen.  ') $$, 'F1: clientul cere o ajustare, cu motiv');
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response' ->> 'response', 'adjustment_requested', 'F1: răspunsul apare pe recomandare');
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response' ->> 'comment', 'Vrem alt termen.', 'F1: motivul, fără spațiile de la capete');
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response' ->> 'own', 'true', 'F1: autorul își recunoaște răspunsul');
select is(pg_temp.rec('Publicată', 'P2') -> 'client_response', 'null'::jsonb, 'F1: cealaltă recomandare rămâne fără răspuns');

-- Câmpurile trimise de client pentru brand, autor sau dată nu se iau în seamă (nici nu are drept să le trimită).
select throws_ok($$ insert into public.recommendation_responses (recommendation_id, response, user_id) values (pg_temp.rec_id('P2'), 'accepted', '30000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'F1: clientul nu poate semna răspunsul cu alt utilizator');

-- F2. Ultimul răspuns e cel în vigoare; istoricul rămâne și nu se rescrie ------------------------------------------------------
select lives_ok($$ select pg_temp.respond('P1', 'accepted') $$, 'F2: clientul se răzgândește și acceptă');
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response' ->> 'response', 'accepted', 'F2: ultimul răspuns e cel arătat');
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response' -> 'comment', 'null'::jsonb, 'F2: fără motiv la acceptare, câmpul e null');
select is((select count(*) from public.recommendation_responses where recommendation_id = pg_temp.rec_id('P1')), 2::bigint, 'F2: ambele răspunsuri rămân în istoric');
select throws_ok($$ update public.recommendation_responses set response = 'accepted' $$, '42501', null, 'F2: un răspuns nu se editează');
select throws_ok($$ delete from public.recommendation_responses $$, '42501', null, 'F2: și nu se șterge');
select tests.authenticate_as_service_role();
select throws_ok($$ update public.recommendation_responses set comment = 'rescris' $$, '42501', null, 'F2: nici cheia de service nu rescrie istoricul');
select throws_ok($$ delete from public.recommendation_responses $$, '42501', null, 'F2: nici nu îl șterge');

-- Echipa vede răspunsul clientului, dar nu ca „al ei”.
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response' ->> 'response', 'accepted', 'F2: strategistul vede răspunsul clientului');
select is(pg_temp.rec('Publicată', 'P1') -> 'client_response' ->> 'own', 'false', 'F2: pentru el nu e răspunsul propriu');
select ok(pg_temp.rec('Publicată', 'P1') -> 'client_response' ->> 'by' like 'Utilizator %', 'F2: autorul apare fără nume (E10)');

-- F3. Comentarii: client și echipă, doar pe analiza publicată -------------------------------------------------------------------
select lives_ok($$ select pg_temp.comment('Publicată', '  Mulțumim, discutăm la call.  ') $$, 'F3: strategistul comentează');
select throws_ok($$ select pg_temp.comment('Ciornă', 'Comentariu pe ciornă') $$, '42501', 'Analiză inexistentă sau fără acces', 'F3: pe o ciornă nu se comentează, nici de către echipă');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select lives_ok($$ select pg_temp.comment('Publicată', 'Putem muta termenul?') $$, 'F3: clientul comentează');
select throws_ok($$ select pg_temp.comment('Ciornă', 'x') $$, '42501', 'Analiză inexistentă sau fără acces', 'F3: clientul nu comentează pe o ciornă');
select throws_ok($$ select pg_temp.comment('Publicată', '   ') $$, '23514', null, 'F3: comentariu gol');
select throws_ok($$ select pg_temp.comment('Publicată', repeat('x', 2001)) $$, '23514', null, 'F3: comentariu prea lung');
select throws_ok($$ insert into public.insight_comments (insight_id, body, author_id) values (pg_temp.insight_id('Publicată'), 'fals', '30000000-0000-0000-0000-000000000002') $$, '42501', null, 'F3: comentariul nu se semnează cu alt utilizator');
select throws_ok($$ insert into public.insight_comments (insight_id, body, author_role) values (pg_temp.insight_id('Publicată'), 'fals', 'agency') $$, '42501', null, 'F3: clientul nu se poate da drept echipă');
select is(jsonb_array_length(pg_temp.seen('Publicată') -> 'comments'), 2, 'F3: ambele comentarii apar pe analiză');
select is(pg_temp.seen('Publicată') -> 'comments' -> 0 ->> 'body', 'Mulțumim, discutăm la call.', 'F3: în ordinea scrierii, fără spațiile de la capete');
select is(pg_temp.seen('Publicată') -> 'comments' -> 0 ->> 'author_role', 'agency', 'F3: primul e al echipei');
select is(pg_temp.seen('Publicată') -> 'comments' -> 1 ->> 'author_role', 'client', 'F3: al doilea e al clientului');
select is(pg_temp.seen('Publicată') -> 'comments' -> 1 ->> 'own', 'true', 'F3: clientul își recunoaște comentariul');
select is(pg_temp.seen('Publicată') -> 'comments' -> 0 ->> 'own', 'false', 'F3: și nu pe al echipei');
select throws_ok($$ update public.insight_comments set body = 'editat' $$, '42501', null, 'F3: un comentariu nu se editează');
select throws_ok($$ delete from public.insight_comments $$, '42501', null, 'F3: și nu se șterge');
select tests.authenticate_as_service_role();
select throws_ok($$ update public.insight_comments set body = 'rescris' $$, '42501', null, 'F3: nici cu cheia de service');

-- F4. Izolare ---------------------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.comment('Publicată', 'din alt client') $$, '42501', 'Analiză inexistentă sau fără acces', 'F4: alt client nu comentează');
select is((select count(*) from public.insight_comments), 0::bigint, 'F4: și nu citește comentariile');
select is((select count(*) from public.recommendation_responses), 0::bigint, 'F4: nici răspunsurile');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select pg_temp.comment('Publicată', 'fără acces') $$, '42501', 'Analiză inexistentă sau fără acces', 'F4: client fără acces la brand');
select is((select count(*) from public.insight_comments), 0::bigint, 'F4: nu citește nimic');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is((select count(*) from public.recommendation_responses), 0::bigint, 'F4: account fără acces la 1A nu vede răspunsurile');
select tests.authenticate_as_anon();
select throws_ok($$ select pg_temp.comment('Publicată', 'anon') $$, '42501', null, 'F4: anon nu comentează');

-- F5. Acceptarea nu mută nimic singură; după înlocuire, clientul nu mai vede discuția analizei vechi ----------------------------
reset role;
select is((select status from public.insights where title = 'Publicată'), 'published', 'F5: analiza rămâne cum era');
select is((select count(*) from public.actions where insight_id = pg_temp.insight_id('Publicată')), 0::bigint, 'F5: acceptarea nu creează și nu mută acțiuni');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
insert into public.insights (tenant_id, brand_id, author_id, title, period_start, period_end, summary, interpretation, limits, supersedes_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'Versiunea 2', '2026-10-01', '2026-10-31', 'C', 'I', 'L', pg_temp.insight_id('Publicată'));
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.insight_id('Versiunea 2'), 'in_review');
insert into public.insight_transitions (insight_id, to_status) values (pg_temp.insight_id('Versiunea 2'), 'published');
select is((select count(*) from public.insight_comments where insight_id = pg_temp.insight_id('Publicată')), 2::bigint, 'F5: echipa păstrează discuția analizei înlocuite');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select count(*) from public.insight_comments), 0::bigint, 'F5: clientul nu mai vede comentariile unei analize înlocuite');
select is((select count(*) from public.recommendation_responses), 0::bigint, 'F5: nici răspunsurile ei');
select throws_ok($$ select pg_temp.comment('Publicată', 'pe analiza veche') $$, '42501', 'Analiză inexistentă sau fără acces', 'F5: pe o analiză înlocuită nu se mai comentează');
select is(jsonb_array_length(pg_temp.seen('Versiunea 2') -> 'comments'), 0, 'F5: versiunea nouă pornește fără comentarii');
select lives_ok($$ insert into public.recommendation_responses (recommendation_id, response)
  select r.id, 'accepted' from public.recommendations r where r.insight_id = pg_temp.insight_id('Versiunea 2') and r.problem = 'P1' $$, 'F5: clientul răspunde la recomandarea din versiunea nouă');

select * from finish();
rollback;
