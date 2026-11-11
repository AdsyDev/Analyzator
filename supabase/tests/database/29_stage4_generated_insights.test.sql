-- Etapa 4, a doua felie (deciziile O): ciorne generate de AdSy AI, proveniență și controlul „afișare”. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · brand 1B = 2000…0012 · brand 2A = 2000…0021
-- admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · account T1 (acces doar 1B) = …0003
-- client T1 cu acces la 1A = …0004 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;

create function pg_temp.req(p_k text, p_brand uuid, p_user uuid, p_task text, p_status text, p_start date default '2026-10-01', p_end date default '2026-10-31') returns void language sql as $$
  with r as (
    insert into public.ai_requests (tenant_id, brand_id, user_id, task, model_id, prompt_version, period_start, period_end, data_snapshot_id, cache_key, status, response, total_tokens)
    select b.tenant_id, b.id, p_user, p_task, 'model-x', 'insight-v1', p_start, p_end, repeat('a', 64), md5(p_k) || md5(p_k), p_status, '{"status":"ok"}'::jsonb, 100
    from public.brands b where b.id = p_brand
    returning id)
  insert into ctx select p_k, id from r
$$;
create function pg_temp.draft(p_title text, p_request text, p_author uuid, p_origin text default 'adsy_ai', p_brand uuid default '20000000-0000-0000-0000-000000000011',
                              p_start date default '2026-10-01', p_end date default '2026-10-31') returns void language sql as $$
  insert into public.insights (tenant_id, brand_id, author_id, title, period_start, period_end, summary, interpretation, limits, origin, ai_request_id)
  select b.tenant_id, b.id, p_author, p_title, p_start, p_end, 'Constatare', 'Interpretare', 'Limite', p_origin, (select v from ctx where k = p_request)
  from public.brands b where b.id = p_brand
$$;
create function pg_temp.seen(p_title text) returns jsonb language sql as $$
  select i from jsonb_array_elements(public.brand_insights('20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31')) i where i ->> 'title' = p_title
$$;
create function pg_temp.id_of(p_title text) returns uuid language sql security definer as $$ select id from public.insights where title = p_title $$;

-- Cererile din jurnal le scrie doar serverul.
select tests.authenticate_as_service_role();
select pg_temp.req('ok', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'generate_insight', 'ok');
select pg_temp.req('ok2', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'generate_insight', 'ok');
select pg_temp.req('chat', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'chat', 'ok');
select pg_temp.req('weak', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'generate_insight', 'insufficient_evidence');
select pg_temp.req('admin', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'generate_insight', 'ok');
select pg_temp.req('other_brand', '20000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000001', 'generate_insight', 'ok');
select pg_temp.req('t2', '20000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000011', 'generate_insight', 'ok');
select pg_temp.req('client', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000004', 'generate_insight', 'ok');

-- G1. Cine poate cere o ciornă -------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is(public.brand_ai_settings('20000000-0000-0000-0000-000000000011') ->> 'can_generate', 'true', 'G1: strategistul poate cere o ciornă');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(public.brand_ai_settings('20000000-0000-0000-0000-000000000011') ->> 'can_generate', 'true', 'G1: agency_admin poate cere o ciornă');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(public.brand_ai_settings('20000000-0000-0000-0000-000000000011') ->> 'can_generate', 'false', 'G1: clientul nu poate cere o ciornă');
select throws_ok($$ select pg_temp.draft('Ciornă de client', 'client', '30000000-0000-0000-0000-000000000004') $$, '42501', null, 'G1: clientul nu scrie o ciornă nici cu o cerere reușită a lui');

-- G2. Marcajul adsy_ai cere o cerere reușită, a aceluiași utilizator, brand și perioadă --------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ select pg_temp.draft('Fără cerere', 'nu-există', '30000000-0000-0000-0000-000000000002') $$, '42501', null, 'G2: fără cerere în jurnal');
select throws_ok($$ select pg_temp.draft('Cerere de chat', 'chat', '30000000-0000-0000-0000-000000000002') $$, '42501', null, 'G2: o cerere de chat nu produce o ciornă');
select throws_ok($$ select pg_temp.draft('Cerere respinsă', 'weak', '30000000-0000-0000-0000-000000000002') $$, '42501', null, 'G2: o cerere care nu a trecut verificarea nu produce o ciornă');
select throws_ok($$ select pg_temp.draft('Cererea altcuiva', 'admin', '30000000-0000-0000-0000-000000000002') $$, '42501', null, 'G2: cererea altui utilizator');
select throws_ok($$ select pg_temp.draft('Alt brand', 'other_brand', '30000000-0000-0000-0000-000000000002') $$, '42501', null, 'G2: cererea altui brand');
select throws_ok($$ select pg_temp.draft('Alt client', 't2', '30000000-0000-0000-0000-000000000002') $$, '42501', null, 'G2: cererea altui client');
select throws_ok($$ select pg_temp.draft('Altă perioadă', 'ok', '30000000-0000-0000-0000-000000000002', 'adsy_ai', '20000000-0000-0000-0000-000000000011', '2026-09-01', '2026-09-30') $$,
  '42501', null, 'G2: perioada ciornei trebuie să fie a cererii');
select lives_ok($$ select pg_temp.draft('Ciornă generată', 'ok', '30000000-0000-0000-0000-000000000002') $$, 'G2: strategistul scrie ciorna din cererea lui reușită');
select is((select status from public.insights where title = 'Ciornă generată'), 'draft', 'G2: e ciornă');
select is((select origin from public.insights where title = 'Ciornă generată'), 'adsy_ai', 'G2: proveniența e adsy_ai');
select throws_ok($$ select pg_temp.draft('A doua din aceeași cerere', 'ok', '30000000-0000-0000-0000-000000000002') $$, '23505', null, 'G2: o cerere produce o singură ciornă');

-- O analiză scrisă de om nu poate purta o cerere, iar una marcată greșit nu trece.
select lives_ok($$ select pg_temp.draft('Scrisă de om', 'ok2', '30000000-0000-0000-0000-000000000002', 'human') $$, 'G2: analiză scrisă de om');
select is((select ai_request_id from public.insights where title = 'Scrisă de om'), null, 'G2: o analiză umană nu păstrează nicio cerere');
select throws_ok($$ select pg_temp.draft('Origine necunoscută', 'ok2', '30000000-0000-0000-0000-000000000002', 'model') $$, '23514', null, 'G2: proveniența are doar două valori');

-- G3. Proveniența nu se rescrie ---------------------------------------------------------------------------------------------------
select throws_ok($$ update public.insights set origin = 'human' where title = 'Ciornă generată' $$, '42501', null, 'G3: autorul nu poate șterge eticheta');
select lives_ok($$ update public.insights set summary = 'Constatare editată de om' where title = 'Ciornă generată' $$, 'G3: textul ciornei se poate edita');
select is((select origin from public.insights where title = 'Ciornă generată'), 'adsy_ai', 'G3: editarea nu schimbă proveniența');
select tests.authenticate_as_service_role();
select throws_ok($$ update public.insights set origin = 'human', ai_request_id = null where title = 'Ciornă generată' $$, '42501', null, 'G3: nici cheia de service nu rescrie proveniența');
select throws_ok($$ update public.insights set origin = 'adsy_ai', ai_request_id = (select v from ctx where k = 'ok2') where title = 'Scrisă de om' $$, '42501', null, 'G3: o analiză umană nu devine generată ulterior');

-- G4. Afișarea: fără politică, conținutul generat e ascuns; cel scris de om rămâne ------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is(pg_temp.seen('Ciornă generată'), null, 'G4: fără politică, ciorna generată nu apare în brand_insights');
select is(pg_temp.seen('Scrisă de om') ->> 'origin', 'human', 'G4: analiza scrisă de om apare, cu proveniența ei');
select is((select count(*) from public.insights where title = 'Ciornă generată'), 1::bigint, 'G4: afișarea e prezentare, nu acces: rândul rămâne citibil prin RLS');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
insert into public.ai_brand_policies (tenant_id, brand_id, chat_enabled, generation_enabled, display_enabled, updated_by)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', false, true, true, '30000000-0000-0000-0000-000000000001');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is(pg_temp.seen('Ciornă generată') ->> 'origin', 'adsy_ai', 'G4: cu afișarea pornită, ciorna apare, marcată adsy_ai');
select is(pg_temp.seen('Ciornă generată') ->> 'status', 'draft', 'G4: și rămâne ciornă');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.seen('Ciornă generată'), null, 'G4: clientul nu vede ciorna (nepublicată), nici cu afișarea pornită');

-- G5. Fluxul de revizuire e cel al oricărei analize: nimic generat nu se publică singur -----------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ update public.insights set status = 'published' where title = 'Ciornă generată' $$, '42501', null, 'G5: statusul nu se scrie direct');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id_of('Ciornă generată'), 'in_review') $$, '23514', null, 'G5: fără dovezi, ciorna nu pleacă la review');
insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', pg_temp.id_of('Ciornă generată'), 'metric', 'gsc_clicks');
select throws_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id_of('Ciornă generată'), 'published') $$, '23514', null, 'G5: o ciornă nu sare peste review');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id_of('Ciornă generată'), 'in_review') $$, 'G5: trimisă la review de un om');
select lives_ok($$ insert into public.insight_transitions (insight_id, to_status) values (pg_temp.id_of('Ciornă generată'), 'published') $$, 'G5: publicată de strategist');
select is((select origin from public.insights where title = 'Ciornă generată'), 'adsy_ai', 'G5: eticheta rămâne și după publicare');
select is((select published_by from public.insights where title = 'Ciornă generată'), '30000000-0000-0000-0000-000000000002'::uuid, 'G5: publicarea are un om care răspunde de ea');

-- G6. Clientul vede analiza generată și publicată doar cu afișarea pornită (politică și preferință) -------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.seen('Ciornă generată') ->> 'origin', 'adsy_ai', 'G6: clientul vede analiza publicată, marcată ca generată');
insert into public.ai_user_preferences (tenant_id, brand_id, user_id, chat_enabled, display_enabled)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000004', true, false);
select is(pg_temp.seen('Ciornă generată'), null, 'G6: preferința personală o ascunde');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select isnt(pg_temp.seen('Ciornă generată'), null, 'G6: preferința unui utilizator nu ascunde nimic altuia');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
update public.ai_user_preferences set display_enabled = true;
select isnt(pg_temp.seen('Ciornă generată'), null, 'G6: cu preferința repornită, apare din nou');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
update public.ai_brand_policies set display_enabled = false, updated_by = '30000000-0000-0000-0000-000000000001';
select is(pg_temp.seen('Ciornă generată'), null, 'G6: politica brandului o ascunde și agenției');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.seen('Ciornă generată'), null, 'G6: și clientului, oricare i-ar fi preferința');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
update public.ai_brand_policies set display_enabled = true, updated_by = '30000000-0000-0000-0000-000000000001';

-- G7. Versiunea nouă a unei analize generate rămâne marcată --------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.insights (tenant_id, brand_id, author_id, title, period_start, period_end, summary, interpretation, limits, supersedes_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'Versiunea a doua', '2026-10-01', '2026-10-31', 'C', 'I', 'L', pg_temp.id_of('Ciornă generată')) $$,
  'G7: versiune nouă, trimisă fără proveniență');
select is((select origin from public.insights where title = 'Versiunea a doua'), 'adsy_ai', 'G7: versiunea nouă moștenește proveniența');
select is((select ai_request_id from public.insights where title = 'Versiunea a doua'), (select v from ctx where k = 'ok'), 'G7: și cererea de origine');
select is((select version from public.insights where title = 'Versiunea a doua'), 2, 'G7: versiunea e a doua');

-- G8. Izolare ---------------------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select public.brand_insights('20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31') $$, '42501', null, 'G8: alt client nu citește analizele');
select is((select count(*) from public.insights where origin = 'adsy_ai'), 0::bigint, 'G8: alt client nu vede nicio analiză generată');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.brand_insights('20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31') $$, '42501', null, 'G8: account fără acces la brand');
select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_insights('20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31') $$, '42501', null, 'G8: anon nu citește nimic');

select * from finish();
rollback;
