-- Etapa 3, prima felie (J-1…J-4): AI referrals, calitatea trackingului, buget și pacing. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 (GA4 conectat) · brand 2B = 2000…0022 (fără GA4)
-- admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · account T1 (acces doar 1B) = …0003
-- client T1 cu acces la 1A = …0004 · client fără acces = …0005 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;

-- GA4 pe brandul 1A: 1–5 oct. 2026, cu surse AI, o sursă care doar seamănă cu una AI și o zi lipsă (4 oct.).
insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, sessions, engaged_sessions, key_events,
                              source_id, collected_at, payload_hash, source_timezone, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', r.d::date, r.ch, r.sm, r.lp, md5(r.lp), r.s, r.s / 2, r.ke,
       '50000000-0000-0000-0000-000000000011', '2026-10-06 05:00:00+00', repeat('a', 64), 'Europe/Bucharest', 't'
from (values
  ('2026-10-01', 'Organic Search', 'google / organic',              '/a',        100, 5::numeric),
  ('2026-10-01', 'Referral',       'chatgpt.com / referral',        '/a',         10, 2),
  ('2026-10-02', 'Referral',       'www.perplexity.ai / referral',  '/b',          4, null),
  ('2026-10-02', 'Referral',       'chat.openai.com / referral',    '/a',          3, 1),
  ('2026-10-03', 'Unassigned',     'Perplexity / (not set)',        '(not set)',   6, null),
  ('2026-10-03', 'Referral',       'notchatgpt.com / referral',     '/c',         50, 4),
  ('2026-10-05', 'Organic Search', 'google / organic',              '/a',         20, 1)
) r (d, ch, sm, lp, s, ke);
insert into public.web_key_events (tenant_id, brand_id, date, event_name, key_events, source_id, collected_at, payload_hash, source_timezone, schema_version)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-01', 'purchase', 7,
        '50000000-0000-0000-0000-000000000011', '2026-10-06 05:00:00+00', repeat('a', 64), 'Europe/Bucharest', 't');
insert into public.source_reconciliations (tenant_id, brand_id, source, metric, period_start, period_end, source_timezone, property_ref,
                                           our_total, source_total, difference, difference_pct, status, tolerance_pct, checked_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'ga4', 'sessions', '2026-09-28', '2026-10-04', 'Europe/Bucharest', 'prop-1a',
        173, 176, -3, -1.7, 'mismatch', 1, '2026-10-06 05:00:00+00');

-- Paid pe 1A: 7 zile a câte 10 RON.
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', 'act_s3');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'act_s3';
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'meta_ads',
        '2026-10-01', '2026-10-07', 'succeeded', 7, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');
insert into public.paid_daily (tenant_id, brand_id, source, account_id, campaign_id, date, spend, impressions, clicks, currency, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', 's3', 'c1', g.ts::date, 10, 100, 4, 'RON', now(), 'api', repeat('e', 64), 'Europe/Bucharest', 't',
       (select v from ctx where k = 'conn'), (select v from ctx where k = 'run')
from generate_series('2026-10-01'::date, '2026-10-07'::date, interval '1 day') g (ts);

create function pg_temp.ai(p_start date default '2026-10-01', p_end date default '2026-10-10') returns jsonb language sql as $$
  select public.brand_ai_referrals('20000000-0000-0000-0000-000000000011', p_start, p_end)
$$;
create function pg_temp.tq(p_id text, p_start date default '2026-10-01', p_end date default '2026-10-10') returns jsonb language sql as $$
  select c from jsonb_array_elements(public.brand_tracking_quality('20000000-0000-0000-0000-000000000011', p_start, p_end) -> 'checks') c where c ->> 'id' = p_id
$$;
create function pg_temp.budget(p_day date) returns jsonb language sql as $$
  select public.brand_paid_budget('20000000-0000-0000-0000-000000000011', p_day) -> 'plan'
$$;

-- R1. Regulile de clasificare: funcție pură -----------------------------------------------------------------------------
select is(metrics.ai_referral_domain('chatgpt.com / referral'), 'chatgpt.com', 'R1: domeniul exact');
select is(metrics.ai_referral_domain('chat.openai.com / referral'), 'chatgpt.com', 'R1: domeniul vechi al ChatGPT intră la chatgpt.com');
select is(metrics.ai_referral_domain('WWW.Perplexity.AI / referral'), 'perplexity.ai', 'R1: subdomeniu și litere mari');
select is(metrics.ai_referral_domain('perplexity / (not set)'), 'perplexity.ai', 'R1: utm_source fără domeniu');
select is(metrics.ai_referral_domain('gemini.google.com / referral'), 'gemini.google.com', 'R1: Gemini');
select is(metrics.ai_referral_domain('notchatgpt.com / referral'), null, 'R1: un domeniu care doar se termină la fel nu e sursă AI');
select is(metrics.ai_referral_domain('google / organic'), null, 'R1: Google organic nu e sursă AI (AI Overviews nu se poate deosebi)');
select is(metrics.ai_referral_domain('chatgpt.com.evil.test / referral'), null, 'R1: domeniul AI ca prefix al altui domeniu nu se potrivește');
select is(metrics.ai_referral_domain(null), null, 'R1: fără sursă, fără clasificare');
select is(metrics.ai_referral_rules() ->> 'version', 'v1', 'R1: regulile au versiune');

-- R2. AI referrals pe brand ---------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.ai() ->> 'connected', 'true', 'R2: GA4 conectat');
select is(jsonb_array_length(pg_temp.ai() -> 'sources'), 2, 'R2: doar sursele AI recunoscute (fără notchatgpt.com)');
select is(pg_temp.ai() -> 'sources' -> 0 ->> 'domain', 'chatgpt.com', 'R2: sursele sunt ordonate după sesiuni');
select is((pg_temp.ai() -> 'sources' -> 0 ->> 'sessions')::numeric, 13::numeric, 'R2: chatgpt.com adună și chat.openai.com');
select is((pg_temp.ai() -> 'sources' -> 0 ->> 'key_events')::numeric, 3::numeric, 'R2: key events adunate pe sursă');
select is((pg_temp.ai() -> 'sources' -> 1 ->> 'sessions')::numeric, 10::numeric, 'R2: perplexity.ai adună domeniul și utm_source');
select is(pg_temp.ai() -> 'sources' -> 1 -> 'key_events', 'null'::jsonb, 'R2: fără key events în sursă = null, nu 0');
select is(pg_temp.ai() -> 'sources' -> 0 -> 'conversion_rate', 'null'::jsonb, 'R2: rata nu se calculează (fără definiție în registru)');
select is(pg_temp.ai() ->> 'rules_version', 'v1', 'R2: versiunea regulilor însoțește răspunsul');
select is((pg_temp.ai() ->> 'rules_effective_from')::date, '2026-11-11'::date, 'R2: data de intrare în vigoare a regulilor');
select is((pg_temp.ai() ->> 'data_as_of')::date, '2026-10-05'::date, 'R2: data ultimei zile cu sesiuni');
select is(pg_temp.ai('2026-10-02', '2026-10-05') -> 'sources' -> 1 -> 'key_events', 'null'::jsonb,
  'R2: fără raport de evenimente cheie în perioadă, key events rămân null chiar dacă rândul are o valoare');
select is(pg_temp.ai('2026-10-06', '2026-10-10') -> 'sources', '[]'::jsonb, 'R2: perioadă fără vizite AI = listă goală');
select throws_ok($$ select pg_temp.ai('2026-10-10', '2026-10-01') $$, '22023', 'Perioadă invalidă', 'R2: perioadă inversată');

-- R3. Calitatea trackingului --------------------------------------------------------------------------------------------
select is(pg_temp.tq('key_events') ->> 'status', 'ok', 'R3: există evenimente cheie în perioadă');
select is((pg_temp.tq('key_events') ->> 'event_names')::integer, 1, 'R3: numărul de evenimente cheie distincte');
select is(pg_temp.tq('key_events', '2026-10-02', '2026-10-05') ->> 'status', 'warning', 'R3: fără evenimente cheie în perioadă = avertisment');
select is(pg_temp.tq('daily_coverage') ->> 'status', 'warning', 'R3: o zi fără sesiuni între zilele colectate = avertisment');
select is((pg_temp.tq('daily_coverage') ->> 'covered_days')::integer, 4, 'R3: zilele cu sesiuni');
select is((pg_temp.tq('daily_coverage') ->> 'expected_days')::integer, 5, 'R3: zilele așteptate se opresc la ultima zi colectată, nu la sfârșitul perioadei');
select is(pg_temp.tq('daily_coverage', '2026-10-01', '2026-10-03') ->> 'status', 'ok', 'R3: toate zilele au sesiuni');
select is(pg_temp.tq('daily_coverage', '2026-10-06', '2026-10-10') ->> 'status', 'unknown', 'R3: perioadă încă necolectată = necunoscut, nu problemă');
select is(pg_temp.tq('reconciliation') ->> 'status', 'warning', 'R3: reconciliere cu diferență peste toleranță = avertisment');
select is((pg_temp.tq('reconciliation') ->> 'difference_pct')::numeric, -1.7::numeric, 'R3: diferența vine din reconcilierea salvată');
select is(pg_temp.tq('reconciliation', '2026-10-05', '2026-10-10') ->> 'status', 'unknown', 'R3: fără reconciliere pe perioadă = necunoscut');
select is(pg_temp.tq('unassigned') ->> 'status', 'ok', 'R3: trafic neîncadrat sub prag');
select is(round((pg_temp.tq('unassigned') ->> 'share_pct')::numeric, 2), round(100.0 * 6 / 193, 2), 'R3: cota traficului neîncadrat');
select is(pg_temp.tq('unassigned', '2026-10-03', '2026-10-03') ->> 'status', 'warning', 'R3: trafic neîncadrat peste prag');
select is(pg_temp.tq('landing_not_set', '2026-10-03', '2026-10-03') ->> 'status', 'warning', 'R3: sesiuni fără landing page peste prag');
select is((pg_temp.tq('landing_not_set') ->> 'threshold_pct')::numeric, 10::numeric, 'R3: pragul însoțește verificarea');
select is((public.brand_tracking_quality('20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-10') ->> 'checked_at')::timestamptz,
  '2026-10-06 05:00:00+00'::timestamptz, 'R3: „verificat la” e momentul ultimei colectări, nu ora cererii');
select is(public.brand_tracking_quality('20000000-0000-0000-0000-000000000012', '2026-10-01', '2026-10-10') -> 'checks', '[]'::jsonb,
  'R3: GA4 conectat fără nicio colectare = nicio verificare, nu verificări inventate');

-- R4. Buget: scrie agenția cu acces la brand ------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, note, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31', 1000, 'RON', 'plan lunar', '30000000-0000-0000-0000-000000000002') $$,
  'R4: strategistul cu acces la brand introduce bugetul');
select throws_ok($$ insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-11-01', '2026-11-30', 1000, 'RON', '30000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'R4: autorul nu poate fi alt utilizator');
select throws_ok($$ insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', '2026-10-01', '2026-10-31', 1000, 'RON', '30000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'R4: strategistul nu scrie bugetul unui brand la care nu are acces');
select throws_ok($$ insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-31', '2026-10-01', 1000, 'RON', '30000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'R4: interval inversat respins');
select throws_ok($$ insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31', 0, 'RON', '30000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'R4: buget zero respins (lipsa unui buget nu se scrie ca 0)');
select throws_ok($$ update public.paid_budgets set amount = 5 $$, '42501', null, 'R4: bugetul nu se modifică (fără drept de UPDATE)');

select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select throws_ok($$ insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31', 1000, 'RON', '30000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'R4: account fără acces la brand nu îi scrie bugetul');
select is((select count(*) from public.paid_budgets), 0::bigint, 'R4: account fără acces la brand nu îi vede bugetul');

-- R5. Buget: clientul citește, nu scrie ----------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select count(*) from public.paid_budgets), 1::bigint, 'R5: clientul cu acces vede bugetul aprobat');
select throws_ok($$ insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-31', 9, 'RON', '30000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'R5: clientul nu introduce bugete');
delete from public.paid_budgets;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select count(*) from public.paid_budgets), 1::bigint, 'R5: ștergerea încercată de client nu a șters nimic');

-- R6. Pacing ------------------------------------------------------------------------------------------------------------
select is((pg_temp.budget('2026-10-10') ->> 'approved_budget')::numeric, 1000::numeric, 'R6: planul în vigoare în ziua cerută');
select is((pg_temp.budget('2026-10-10') ->> 'spent')::numeric, 70::numeric, 'R6: costul adunat din plan');
select is((pg_temp.budget('2026-10-10') ->> 'data_as_of')::date, '2026-10-07'::date, 'R6: ultima zi cu date de cost');
select is((pg_temp.budget('2026-10-10') ->> 'elapsed_days')::integer, 7, 'R6: zilele trecute se numără până la ultima zi cu date');
select is((pg_temp.budget('2026-10-10') ->> 'planned_days')::integer, 31, 'R6: zilele planului');
select is((pg_temp.budget('2026-10-10') ->> 'spend_pct')::numeric, 7::numeric, 'R6: cost / buget, în procente');
select is(round((pg_temp.budget('2026-10-10') ->> 'time_pct')::numeric, 2), round(100.0 * 7 / 31, 2), 'R6: zile trecute / zile planificate, în procente');
select is(pg_temp.budget('2026-10-10') ->> 'plan_note', 'plan lunar', 'R6: nota planului');
select is(pg_temp.budget('2026-11-05'), 'null'::jsonb, 'R6: zi fără plan = fără buget, nu buget zero');

-- Un plan mai nou pe același interval îl înlocuiește; în altă monedă decât costul, costul nu se adună.
-- `created_at` nu poate fi scris de utilizatori și e același în toată tranzacția testului: rândul se introduce ca proprietar.
reset role;
insert into public.paid_budgets (tenant_id, brand_id, plan_from, plan_to, amount, currency, created_by, created_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-14', 500, 'EUR', '30000000-0000-0000-0000-000000000002', now() + interval '1 second');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((pg_temp.budget('2026-10-10') ->> 'approved_budget')::numeric, 500::numeric, 'R6: la suprapunere, planul introdus cel mai recent');
select is(pg_temp.budget('2026-10-10') -> 'spent', 'null'::jsonb, 'R6: cost în altă monedă decât planul = nu se adună');
select is(pg_temp.budget('2026-10-10') ->> 'currency_mismatch', 'true', 'R6: nepotrivirea de monedă e semnalată');
select is(pg_temp.budget('2026-10-10') -> 'spend_pct', 'null'::jsonb, 'R6: fără cost comparabil, fără procent');
select is((pg_temp.budget('2026-10-20') ->> 'approved_budget')::numeric, 1000::numeric, 'R6: în afara planului nou rămâne cel vechi');

select lives_ok($$ delete from public.paid_budgets where currency = 'EUR' $$, 'R6: agenția șterge un plan greșit');
select is((select count(*) from public.paid_budgets), 1::bigint, 'R6: a rămas planul corect');

-- R7. Audit și izolare ----------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select count(*) from public.audit_events where entity_type = 'paid_budgets' and action = 'insert'), 2::bigint, 'R7: fiecare buget introdus e auditat');
select is((select count(*) from public.audit_events where entity_type = 'paid_budgets' and action = 'delete'), 1::bigint, 'R7: ștergerea e auditată');

select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is(jsonb_array_length(pg_temp.ai() -> 'sources'), 2, 'R7: clientul cu acces vede aceleași AI referrals');
select is((pg_temp.budget('2026-10-10') ->> 'approved_budget')::numeric, 1000::numeric, 'R7: clientul cu acces vede pacing-ul');

select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select pg_temp.ai() $$, '42501', null, 'R7: client fără acces: AI referrals refuzat');
select throws_ok($$ select public.brand_tracking_quality('20000000-0000-0000-0000-000000000011', '2026-10-01', '2026-10-10') $$, '42501', null, 'R7: client fără acces: tracking refuzat');
select throws_ok($$ select pg_temp.budget('2026-10-10') $$, '42501', null, 'R7: client fără acces: buget refuzat');
select is((select count(*) from public.paid_budgets), 0::bigint, 'R7: client fără acces nu vede bugete');

select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.ai() $$, '42501', null, 'R7: alt tenant: AI referrals refuzat');
select throws_ok($$ select pg_temp.budget('2026-10-10') $$, '42501', null, 'R7: alt tenant: buget refuzat');
select is((select count(*) from public.paid_budgets), 0::bigint, 'R7: alt tenant nu vede bugetele');
select is(public.brand_ai_referrals('20000000-0000-0000-0000-000000000022', '2026-10-01', '2026-10-10') ->> 'connected', 'false', 'R7: brand fără GA4 = neconectat');
select is(public.brand_tracking_quality('20000000-0000-0000-0000-000000000022', '2026-10-01', '2026-10-10') ->> 'connected', 'false', 'R7: brand fără GA4 = fără verificări');

select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_paid_budget('20000000-0000-0000-0000-000000000011', '2026-10-10') $$, '42501', null, 'R7: fără autentificare, refuzat');

select * from finish();
rollback;
