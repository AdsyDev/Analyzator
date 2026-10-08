-- Statusul surselor, acoperirea cu zile lipsă, actualitatea pentru client și alertele de refresh. Date SINTETICE, doar aici.
-- brand 1A = 2000…0011 · 1B = …0012 (T1) · 2A = …0021 (T2)
-- admin T1 = 3000…01 · strategist T1 (acces 1A) = …02 · account T1 (acces 1B) = …03 · client T1 (acces 1A) = …04
-- client fără acces = …05 · admin T2 = …11
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Starea inițială din seed: conexiuni existente, dar fără token și fără date. Nimic nu e inventat.
create function pg_temp.st(p_brand uuid, p_source text, p_col text) returns text language plpgsql as $$
declare v text;
begin
  execute format('select %I::text from public.source_status where brand_id = $1 and source = $2', p_col) into v using p_brand, p_source;
  return v;
end $$;

-- ===== Fără conexiune și fără date ======================================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'meta_ads', 'state'), 'not_connected', 'S1: CSV fără import → not_connected');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'meta_ads', 'reason'), 'no_import', 'S1: motivul: no_import');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'seomonitor', 'state'), 'not_connected', 'S1: SEOmonitor fără mapare → not_connected');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'gsc', 'state'), 'not_connected', 'S1: GSC fără conexiune → not_connected');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'reason'), 'credential_missing', 'S1: GA4 există, dar credentialul Google lipsește → credential_missing');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'clarity', 'reason'), 'credential_missing', 'S1: Clarity fără token → credential_missing');
select is((select count(*)::int from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011'), 9, 'S1: fiecare brand are un rând pentru fiecare dintre cele 9 surse');
select is((select coverage from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), 0::numeric, 'S1: acoperire 0, nu null, pentru o sursă API fără date');
select is((select data_as_of from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), null, 'S1: data_as_of null fără date');
select is((select coverage from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'planable_listening'), null,
  'S1: mențiunile nu au acoperire pe zile (o zi fără mențiuni nu e o lipsă)');
reset role;

-- ===== Conectat, rulări și acoperire cu zile lipsă ============================================================================================

-- credential Google valid pentru T1 + token pe Clarity 1A (ca owner)
insert into public.source_connections (id, tenant_id, brand_id, provider, external_account_id, credential_status, vault_secret_id) values
  ('50000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000001', null, 'google_service_account', 'sa', 'valid', gen_random_uuid());
update public.source_connections set credential_status = 'valid', vault_secret_id = gen_random_uuid() where id = '50000000-0000-0000-0000-000000000031';

-- GA4 1A: zile cu date în ultimele 35 de zile, cu goluri. Datele sunt relative la azi (Europe/Bucharest).
insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, sessions, source_id, collected_at, payload_hash, source_timezone, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', d, 'Direct', '(direct) / (none)', '/', md5('/'),
       case when extract(day from d)::int % 7 = 0 then null else 10 end,   -- zile cu sesiuni necunoscute (NULL)
       '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'Europe/Bucharest', 'test'
from generate_series(((now() at time zone 'Europe/Bucharest')::date - 20), ((now() at time zone 'Europe/Bucharest')::date - 1), interval '1 day') d
where d::date not in (((now() at time zone 'Europe/Bucharest')::date - 5), ((now() at time zone 'Europe/Bucharest')::date - 6));  -- 2 zile lipsă

create temp table expected as
  select count(distinct date)::int as covered, max(date) as last_day
  from public.web_daily
  where brand_id = '20000000-0000-0000-0000-000000000011' and sessions is not null;
grant select on expected to authenticated;

insert into public.sync_runs (id, tenant_id, brand_id, source, source_connection_id, period_start, period_end, status, rows_written, errors, started_at, finished_at) values
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'ga4', '50000000-0000-0000-0000-000000000011',
   (now() at time zone 'Europe/Bucharest')::date - 35, (now() at time zone 'Europe/Bucharest')::date - 1, 'succeeded', 30, '[]', now() - interval '2 hours', now() - interval '2 hours' + interval '12 seconds');

select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'state'), 'ok', 'C1: GA4 conectat, rulare reușită, date la zi → ok');
select is((select covered_days from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), (select covered from expected),
  'C1: acoperirea numără zilele cu date: fără zilele lipsă și fără cele cu sesiuni NULL');
select is((select coverage from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'),
  round((select covered from expected)::numeric / 35, 4), 'C1: coverage = zile acoperite / 35');
select ok((select covered from expected) < 20, 'C1: zilele lipsă și cele necunoscute chiar scad acoperirea (sanity)');
select is((select data_as_of from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), (select last_day from expected), 'C1: data_as_of = ultima zi cu date');
select is((select last_run_status from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), 'succeeded', 'C1: ultima rulare');
select isnt((select last_success_at from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), null, 'C1: ultima rulare reușită');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'connected'), 'true', 'C1: connected');
reset role;

-- Stări: partial, error, stale, no_data (modificări ca owner)
update public.sync_runs set status = 'partial', errors = '[{"code":"gsc_truncated"}]' where id = 'a0000000-0000-0000-0000-000000000001';
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'state'), 'partial', 'C2: o rulare parțială nu apare ca ok');
select is((select last_run_error_count from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), 1, 'C2: numărul de erori ale ultimei rulări');
reset role;

insert into public.sync_runs (id, tenant_id, brand_id, source, source_connection_id, period_start, period_end, status, errors, started_at, finished_at, created_at) values
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'ga4', '50000000-0000-0000-0000-000000000011',
   (now() at time zone 'Europe/Bucharest')::date - 35, (now() at time zone 'Europe/Bucharest')::date - 1, 'failed', '[{"code":"access_denied"}]', now(), now(), now() + interval '1 minute');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'state'), 'error', 'C3: ultima rulare eșuată → error');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'last_run_status'), 'failed', 'C3: ultima rulare = cea mai recentă');
reset role;

update public.source_connections set credential_status = 'invalid' where id = '50000000-0000-0000-0000-0000000000e1';
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'state'), 'error', 'C4: credential Google invalid → error');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'reason'), 'credential_invalid', 'C4: motivul');
reset role;
update public.source_connections set credential_status = 'valid' where id = '50000000-0000-0000-0000-0000000000e1';
delete from public.sync_runs where id in ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001');

-- stale: date vechi (peste toleranța GA4 de 2 zile)
delete from public.web_daily where brand_id = '20000000-0000-0000-0000-000000000011';
insert into public.web_daily (tenant_id, brand_id, date, channel_group, source_medium, landing_page, landing_page_md5, sessions, source_id, collected_at, payload_hash, source_timezone, schema_version) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (now() at time zone 'Europe/Bucharest')::date - 10, 'Direct', 'd', '/', md5('/'), 5,
   '50000000-0000-0000-0000-000000000011', now(), repeat('a', 64), 'Europe/Bucharest', 'test');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'state'), 'stale', 'C5: date mai vechi decât toleranța → stale');
reset role;

delete from public.web_daily where brand_id = '20000000-0000-0000-0000-000000000011';
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'ga4', 'state'), 'no_data', 'C6: conectat, dar fără date → no_data (nu zero)');
reset role;

-- CSV: import confirmat
insert into public.import_batches (id, tenant_id, brand_id, source, file_sha256, status, rows_accepted, uploaded_by, confirmed_by, confirmed_at, currency, timezone) values
  ('60000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', repeat('4', 64), 'imported', 7,
   '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', now() - interval '1 day', 'RON', 'Europe/Bucharest');
insert into public.paid_daily (tenant_id, brand_id, source, campaign_id, date, spend, currency, import_batch_id, row_number, collected_at, payload_hash, source_timezone, schema_version)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'meta_ads', 'C1', d, 10, 'RON', '60000000-0000-0000-0000-0000000000b1', 1, now(), repeat('a', 64), 'UTC', 'csv-1'
from generate_series((now() at time zone 'Europe/Bucharest')::date - 10, (now() at time zone 'Europe/Bucharest')::date - 4, interval '1 day') d;
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'meta_ads', 'state'), 'ok', 'C7: CSV importat, date în toleranța de 14 zile → ok');
select is((select covered_days from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'meta_ads'), 7, 'C7: acoperire CSV = zile cu cost');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'meta_ads', 'last_run_rows'), '7', 'C7: rânduri acceptate la ultimul import');
select is(pg_temp.st('20000000-0000-0000-0000-000000000011', 'meta_ads', 'last_run_status'), 'succeeded', 'C7: importul confirmat = succeeded');
reset role;

-- ===== Statusul per rol ==========================================================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.source_status), 9, 'R1: strategistul cu acces vede statusul brandului lui (9 surse), nu al altora');
select is((select count(distinct brand_id)::int from public.source_status), 1, 'R1: doar brandul la care are acces');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is((select count(distinct brand_id)::int from public.source_status), 1, 'R1: account vede doar brandul lui (1B)');
select is((select brand_id from public.source_status limit 1), '20000000-0000-0000-0000-000000000012'::uuid, 'R1: și anume 1B');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select count(distinct brand_id)::int from public.source_status where tenant_id = '10000000-0000-0000-0000-000000000001'), 2, 'R1: agency_admin vede toate brandurile tenantului');
select is((select count(*)::int from public.source_status where tenant_id = '10000000-0000-0000-0000-000000000002'), 0, 'R1: nu și pe cele din alt tenant');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.source_status $$, 'R2: clientul nu vede statusul surselor (erori, conexiuni)');
select is_empty($$ select 1 from public.sync_history $$, 'R2: clientul nu vede istoricul sincronizărilor');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is_empty($$ select 1 from public.source_status $$, 'R2: client fără acces: nimic');
select is_empty($$ select 1 from public.source_freshness $$, 'R2: nici actualitatea');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.source_status where tenant_id = '10000000-0000-0000-0000-000000000001' $$, 'R2: admin T2 nu vede statusul T1');
select is_empty($$ select 1 from public.source_dataset_days where tenant_id = '10000000-0000-0000-0000-000000000001' $$, 'R2: nici zilele cu date');
reset role;

-- actualitatea pentru client: doar data și o explicație
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select freshness from public.source_freshness where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'meta_ads'), 'current', 'F1: clientul vede că datele Meta sunt la zi');
select is((select freshness from public.source_freshness where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'ga4'), 'no_data', 'F1: fără date: no_data (sursă neconectată sau neimportată), nu zero');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_freshness'
  and column_name in ('last_run_status', 'last_run_error_count', 'credential_status', 'reason', 'connected')), 'F1: view-ul clientului nu expune erori sau conexiuni');
select is((select count(distinct brand_id)::int from public.source_freshness), 1, 'F1: doar brandul la care are acces');
reset role;

-- ===== Istoricul sincronizărilor ========================================================================================================================

insert into public.sync_runs (id, tenant_id, brand_id, source, period_start, period_end, status, rows_written, errors, started_at, finished_at, coverage) values
  ('a0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'gsc',
   '2026-09-01', '2026-09-30', 'partial', 5, '[{"code":"a"},{"code":"a"},{"code":"b"}]', '2026-10-01 10:00:00+00', '2026-10-01 10:00:20+00', '{"search_daily":{"coverage":0.5}}');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select duration_seconds from public.sync_history where id = 'a0000000-0000-0000-0000-000000000009'), 20.000::numeric, 'H1: durata din started_at / finished_at');
select is((select error_count from public.sync_history where id = 'a0000000-0000-0000-0000-000000000009'), 3, 'H1: numărul de erori');
select is((select error_codes from public.sync_history where id = 'a0000000-0000-0000-0000-000000000009'), '["a", "b"]'::jsonb, 'H1: codurile distincte');
select is((select coverage -> 'search_daily' ->> 'coverage' from public.sync_history where id = 'a0000000-0000-0000-0000-000000000009'), '0.5', 'H1: acoperirea raportată de conector');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is_empty($$ select 1 from public.sync_history where id = 'a0000000-0000-0000-0000-000000000009' $$, 'H1: account fără acces la 1A nu vede istoricul lui 1A');
reset role;

-- ===== Alerte: contacte și coadă =========================================================================================================================

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.alert_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000001', 'ops@agentie.ro') $$, '42501', null, 'A1: strategistul nu configurează alertele');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.alert_contacts (tenant_id, email, name) values ('10000000-0000-0000-0000-000000000001', 'Ops@Agentie.ro', 'Ops') $$, 'A1: agency_admin adaugă un contact');
select throws_ok($$ insert into public.alert_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000001', 'ops@agentie.ro') $$, '23505', null, 'A1: fără dubluri (indiferent de majuscule)');
select throws_ok($$ insert into public.alert_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000002', 'x@agentie.ro') $$, '42501', null, 'A1: nu pe alt tenant');
select throws_ok($$ insert into public.alert_contacts (tenant_id, email) values ('10000000-0000-0000-0000-000000000001', 'nu-e-email') $$, '23514', null, 'A1: e-mail invalid');
reset role;
select ok(exists (select 1 from public.audit_events where entity_type = 'alert_contacts' and action = 'insert' and actor_user_id = '30000000-0000-0000-0000-000000000001'), 'A1: configurarea e auditată');

insert into public.ops_notifications (tenant_id, brand_id, sync_run_id, kind, source, subject, body) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000009', 'refresh_failed', 'gsc', 's', 'b');
select throws_ok(
  $$ insert into public.ops_notifications (tenant_id, brand_id, sync_run_id, kind, source, subject, body)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000009', 'refresh_failed', 'gsc', 's', 'b') $$,
  '23505', null, 'A2: o singură alertă per rulare eșuată (idempotent)');
select lives_ok(
  $$ insert into public.ops_notifications (tenant_id, brand_id, sync_run_id, kind, source, subject, body)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000009', 'refresh_partial', 'gsc', 's', 'b') $$,
  'A2: aceeași rulare poate avea și o alertă de tip refresh_partial (cheie: rulare + tip)');
select throws_ok(
  $$ insert into public.ops_notifications (tenant_id, brand_id, sync_run_id, kind, source, subject, body)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000009', 'refresh_unknown', 'gsc', 's', 'b') $$,
  '23514', null, 'A2: tip de alertă necunoscut respins');
select is((select count(*)::int from public.ops_notifications where status = 'pending'), 2, 'A2: alertele încep pending');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select results_eq($$ select count(*)::int from public.ops_notifications $$, $$ values (2) $$, 'A2: agency_admin vede coada (ambele alerte)');
select throws_ok($$ update public.ops_notifications set status = 'sent' $$, '42501', null, 'A2: coada nu se modifică de utilizatori');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.ops_notifications $$, 'A2: strategistul nu vede coada');
select is_empty($$ select 1 from public.alert_contacts $$, 'A2: nici contactele');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select is_empty($$ select 1 from public.ops_notifications $$, 'A2: admin T2 nu vede coada din T1');
reset role;
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.ops_notifications $$, 'A2: clientul nu vede coada');
reset role;

select * from finish();
rollback;
