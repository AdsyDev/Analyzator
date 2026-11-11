-- Etapa 4, prima felie (M-1…M-4): controalele AdSy AI și jurnalul cererilor. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · brand 1B = 2000…0012 · brand 2A = 2000…0021
-- admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · account T1 (acces doar 1B) = …0003
-- client T1 cu acces la 1A = …0004 · client fără acces = …0005 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create function pg_temp.s(p_path text[]) returns text language sql as $$
  select public.brand_ai_settings('20000000-0000-0000-0000-000000000011') #>> p_path
$$;
create function pg_temp.policy(p_user uuid, p_chat boolean, p_generation boolean, p_display boolean) returns void language sql as $$
  insert into public.ai_brand_policies (tenant_id, brand_id, chat_enabled, generation_enabled, display_enabled, updated_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_chat, p_generation, p_display, p_user)
$$;

-- C1. Fără politică: totul oprit ------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.s('{policy,chat}'), 'false', 'C1: fără politică, chatul e oprit');
select is(pg_temp.s('{policy,generation}'), 'false', 'C1: fără politică, generarea e oprită');
select is(pg_temp.s('{policy,display}'), 'false', 'C1: fără politică, afișarea e oprită');
select is(pg_temp.s('{preference,chat}'), 'true', 'C1: fără preferință salvată, utilizatorul nu a oprit nimic');
select is(pg_temp.s('{effective,chat}'), 'false', 'C1: preferința nu pornește ce politica nu permite');
select is(pg_temp.s('{effective,display}'), 'false', 'C1: afișarea efectivă e oprită');
select is(pg_temp.s('{can_edit_policy}'), 'false', 'C1: clientul nu poate schimba politica');
select is(public.brand_ai_settings('20000000-0000-0000-0000-000000000011') -> 'month_tokens', 'null'::jsonb, 'C1: clientul nu vede consumul brandului');
select is(pg_temp.s('{tenant_id}'), '10000000-0000-0000-0000-000000000001', 'C1: clientul brandului însoțește răspunsul');

-- C2. Politica o scrie doar agency_admin ----------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.policy('30000000-0000-0000-0000-000000000004', true, true, true) $$, '42501', null, 'C2: clientul nu scrie politica');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ select pg_temp.policy('30000000-0000-0000-0000-000000000002', true, true, true) $$, '42501', null, 'C2: strategistul nu scrie politica');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.policy('30000000-0000-0000-0000-000000000011', true, true, true) $$, '42501', null, 'C2: adminul altui client nu scrie politica');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select pg_temp.policy('30000000-0000-0000-0000-000000000002', true, true, true) $$, '42501', null, 'C2: autorul nu poate fi alt utilizator');
select lives_ok($$ select pg_temp.policy('30000000-0000-0000-0000-000000000001', true, false, true) $$, 'C2: agency_admin pornește chatul și afișarea');
select is(pg_temp.s('{can_edit_policy}'), 'true', 'C2: agency_admin poate schimba politica');
select is(pg_temp.s('{policy,monthly_token_cap}'), '2000000', 'C2: plafonul lunar implicit');
select is(pg_temp.s('{month_tokens}'), '0', 'C2: agency_admin vede consumul lunii (zero cereri)');
select throws_ok($$ update public.ai_brand_policies set monthly_token_cap = 0 $$, '23514', null, 'C2: plafonul nu poate fi zero');
select throws_ok($$ update public.ai_brand_policies set tenant_id = '10000000-0000-0000-0000-000000000002' $$, '42501', null, 'C2: politica nu se mută la alt client');
select throws_ok($$ delete from public.ai_brand_policies $$, '42501', null, 'C2: politica nu se șterge (fără drept de DELETE)');

-- C3. Politica bate preferința ------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.s('{effective,chat}'), 'true', 'C3: politica pornită, fără preferință = chat pornit');
select is(pg_temp.s('{effective,generation}'), 'false', 'C3: generarea rămâne oprită de politică');
select lives_ok($$ insert into public.ai_user_preferences (tenant_id, brand_id, user_id, chat_enabled, display_enabled)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000004', false, true) $$,
  'C3: utilizatorul își oprește chatul');
select is(pg_temp.s('{effective,chat}'), 'false', 'C3: preferința personală oprește chatul');
select is(pg_temp.s('{effective,display}'), 'true', 'C3: afișarea rămâne pornită');
select is(pg_temp.s('{policy,chat}'), 'true', 'C3: politica brandului nu se schimbă prin preferință');
select throws_ok($$ insert into public.ai_user_preferences (tenant_id, brand_id, user_id, chat_enabled, display_enabled)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', false, false) $$,
  '42501', null, 'C3: nimeni nu scrie preferința altui utilizator');
select throws_ok($$ insert into public.ai_user_preferences (tenant_id, brand_id, user_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'C3: fără preferință pe un brand la care nu ai acces');
select throws_ok($$ update public.ai_user_preferences set user_id = '30000000-0000-0000-0000-000000000002' $$, '42501', null, 'C3: preferința nu se mută la alt utilizator');
select lives_ok($$ update public.ai_user_preferences set chat_enabled = true $$, 'C3: utilizatorul își repornește chatul');
select is(pg_temp.s('{effective,chat}'), 'true', 'C3: chat pornit din nou');

-- Alt utilizator al aceluiași brand nu e afectat de preferința clientului și nu o vede.
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select count(*) from public.ai_user_preferences), 0::bigint, 'C3: preferințele altora nu se văd');
select is(pg_temp.s('{effective,chat}'), 'true', 'C3: preferința unui utilizator nu îl afectează pe altul');

-- Adminul oprește chatul din politică: preferința pornită nu îl mai poate ține deschis.
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.ai_brand_policies set chat_enabled = false, updated_by = '30000000-0000-0000-0000-000000000001' $$, 'C3: agency_admin oprește chatul');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(pg_temp.s('{effective,chat}'), 'false', 'C3: politica oprită bate preferința pornită');
select is(pg_temp.s('{preference,chat}'), 'true', 'C3: preferința rămâne cum a lăsat-o utilizatorul');

-- C4. Jurnalul cererilor: scrie doar serverul; fiecare își vede cererile, agency_admin pe toate ---------------------------------
select throws_ok($$ insert into public.ai_requests (tenant_id, brand_id, user_id, task, model_id, prompt_version, period_start, period_end, data_snapshot_id, cache_key, status)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000004', 'chat', 'm', 'v', '2026-10-01', '2026-10-31', repeat('a', 64), repeat('b', 64), 'ok') $$,
  '42501', null, 'C4: utilizatorul nu își scrie singur cereri (nici răspunsuri în cache)');
select tests.authenticate_as_service_role();
insert into public.ai_requests (tenant_id, brand_id, user_id, task, model_id, prompt_version, question, period_start, period_end, data_snapshot_id, cache_key, status, response, prompt_tokens, output_tokens, total_tokens)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000004', 'chat', 'model-x', 'chat-v1', 'Cum au mers sesiunile?', '2026-10-01', '2026-10-31', repeat('a', 64), repeat('b', 64), 'ok', '{"summary": "…"}', 900, 100, 1000),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', 'chat', 'model-x', 'chat-v1', 'Altă întrebare', '2026-10-01', '2026-10-31', repeat('a', 64), repeat('c', 64), 'insufficient_evidence', null, 400, 100, 500),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000011', 'chat', 'model-x', 'chat-v1', 'Întrebare T2', '2026-10-01', '2026-10-31', repeat('a', 64), repeat('b', 64), 'ok', '{"summary": "T2"}', 50, 50, 100);
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select count(*) from public.ai_requests), 1::bigint, 'C4: clientul își vede doar cererile lui');
select throws_ok($$ update public.ai_requests set response = '{"summary": "fals"}' $$, '42501', null, 'C4: răspunsul din cache nu poate fi rescris');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select count(*) from public.ai_requests), 1::bigint, 'C4: strategistul își vede doar cererile lui');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select count(*) from public.ai_requests), 2::bigint, 'C4: agency_admin vede toate cererile brandurilor lui, nu și ale altui client');
select is(pg_temp.s('{month_tokens}'), '1500', 'C4: consumul lunii adună tokenii brandului');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is((select count(*) from public.ai_requests where tenant_id = '10000000-0000-0000-0000-000000000001'), 0::bigint, 'C4: alt client nu vede cererile');

-- C5. Izolare și audit ---------------------------------------------------------------------------------------------------------
select throws_ok($$ select public.brand_ai_settings('20000000-0000-0000-0000-000000000011') $$, '42501', null, 'C5: alt client: setări refuzate');
select is((select count(*) from public.ai_brand_policies), 0::bigint, 'C5: alt client nu vede politica');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_ai_settings('20000000-0000-0000-0000-000000000011') $$, '42501', null, 'C5: client fără acces: setări refuzate');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.brand_ai_settings('20000000-0000-0000-0000-000000000011') $$, '42501', null, 'C5: account fără acces la brand: setări refuzate');
select is(public.brand_ai_settings('20000000-0000-0000-0000-000000000012') #>> '{effective,chat}', 'false', 'C5: politica unui brand nu se aplică altui brand');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select count(*) from public.audit_events where entity_type = 'ai_brand_policies' and action = 'insert'), 1::bigint, 'C5: pornirea AI-ului e auditată');
select is((select count(*) from public.audit_events where entity_type = 'ai_brand_policies' and action = 'update'), 1::bigint, 'C5: schimbarea politicii e auditată');
select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_ai_settings('20000000-0000-0000-0000-000000000011') $$, '42501', null, 'C5: fără autentificare, refuzat');

select * from finish();
rollback;
