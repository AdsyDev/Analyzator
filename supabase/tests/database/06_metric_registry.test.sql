-- ANZ07: registrul de metrici și regulile de calcul (spec cap. 2, 9, 11, 26; brief cap. 4).
-- Toate datele de mai jos sunt SINTETICE și există doar în acest fișier de test.
-- Metricile Clarity sunt `draft`: testele care le folosesc presupun forma payloadului (de confirmat pe fixtures).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Helperi de test ------------------------------------------------------------------------------

create function pg_temp.def(p_key text) returns jsonb language sql as $$
  select to_jsonb(d) from public.metric_definitions d where d.metric_key = p_key and d.version = 1
$$;

-- Definiție sintetică (nu există în registru): {aggregation sum, count, fără prag, toleranță 0} + suprascrieri.
create function pg_temp.synth(p_overrides jsonb) returns jsonb language sql as $$
  select '{"metric_key": "test_metric", "version": 1, "unit": "count", "primary_source": "test",
           "aggregation": "sum", "multiplier": 1, "freshness_grace_days": 0, "lifecycle": "active"}'::jsonb
         || p_overrides
$$;

-- Perioada implicită: 7–8 oct 2026, închisă (as_of 20 oct), 2 zile confirmate, date până la 8 oct.
create function pg_temp.run(p_def jsonb, p_obs jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select metrics.compute(
    jsonb_build_object(
      'definition', p_def,
      'brand_id', '20000000-0000-0000-0000-000000000011',
      'as_of_date', '2026-10-20',
      'period', '{"start": "2026-10-07", "end": "2026-10-08", "kind": "custom"}'::jsonb,
      'connection', '{"connected": true, "query_ok": true}'::jsonb,
      'current', jsonb_build_object('observations', p_obs, 'confirmed_days', 2, 'data_as_of', '2026-10-08')
    ) || p_extra
  )
$$;

create function pg_temp.status(p_result jsonb) returns text language sql as $$
  select p_result -> 'metric' ->> 'status'
$$;

create function pg_temp.value(p_result jsonb) returns numeric language sql as $$
  select (p_result -> 'metric' ->> 'value')::numeric
$$;

create function pg_temp.has_warning(p_result jsonb, p_code text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(p_result -> 'warnings') w where w ->> 'code' = p_code)
$$;

-- R1. Numitor zero → null și cannot_compute ------------------------------------------------------

select is(
  pg_temp.status(pg_temp.run(pg_temp.synth('{"aggregation": "ratio", "unit": "percent", "multiplier": 100}'),
    '[{"date": "2026-10-07", "numerator": 0, "denominator": 0}, {"date": "2026-10-08", "numerator": 0, "denominator": 0}]')),
  'cannot_compute', 'R1: rată cu numitor zero → cannot_compute'
);
select is(
  pg_temp.value(pg_temp.run(pg_temp.synth('{"aggregation": "ratio", "unit": "percent", "multiplier": 100}'),
    '[{"date": "2026-10-07", "numerator": 0, "denominator": 0}, {"date": "2026-10-08", "numerator": 0, "denominator": 0}]')),
  null, 'R1: rată cu numitor zero → value null, nu 0'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.synth('{"aggregation": "weighted_mean", "weight_basis": "sessions"}'),
    '[{"date": "2026-10-07", "value": 50, "weight": 0}, {"date": "2026-10-08", "value": 70, "weight": 0}]')),
  'cannot_compute', 'R1: medie ponderată cu suma ponderilor zero → cannot_compute'
);
select is(metrics.ratio(5, 0, 100), null, 'R1: metrics.ratio(5, 0) = null');

-- R2. Lipsa conexiunii sau a accesului → not_connected -------------------------------------------

select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_sessions'),
    '[{"date": "2026-10-07", "value": 100}]', '{"connection": {"connected": false, "query_ok": false}}')),
  'not_connected', 'R2: fără conexiune → not_connected, chiar dacă există observații'
);
select ok(
  (pg_temp.run(pg_temp.def('ga4_sessions'), '[{"date": "2026-10-07", "value": 100}]',
    '{"connection": {"connected": false}}') -> 'metric' ->> 'value') is null,
  'R2: fără conexiune → value null'
);

-- R3. Zero real doar cu interogare reușită și acoperire confirmată --------------------------------

select is(
  pg_temp.run(pg_temp.def('ga4_key_events'), '[]') -> 'metric' -> 'value',
  '0'::jsonb, 'R3: fără evenimente, interogare reușită, 2/2 zile confirmate → 0 real'
);
select is(pg_temp.status(pg_temp.run(pg_temp.def('ga4_key_events'), '[]')), 'ok', 'R3: zero real → ok');
select is(
  pg_temp.run(pg_temp.def('ga4_key_events'), '[]',
    '{"current": {"observations": [], "confirmed_days": 1, "data_as_of": "2026-10-08"}}') -> 'metric' -> 'value',
  'null'::jsonb, 'R3: fără evenimente, dar doar 1/2 zile confirmate → null, nu 0'
);
select ok(
  pg_temp.has_warning(pg_temp.run(pg_temp.def('ga4_key_events'), '[]',
    '{"current": {"observations": [], "confirmed_days": 1, "data_as_of": "2026-10-08"}}'), 'zero_not_confirmed'),
  'R3: zero neconfirmat apare în warnings'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_key_events'), '[]',
    '{"connection": {"connected": true, "query_ok": false}}')),
  'unavailable', 'R3: interogare eșuată → unavailable (eroare tehnică, nu zero)'
);
select ok(
  pg_temp.run(pg_temp.def('ga4_key_events'), '[]',
    '{"connection": {"connected": true, "query_ok": false}}') -> 'metric' -> 'value' = 'null'::jsonb,
  'R3: interogare eșuată → value null'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_key_events'), '[]',
    '{"current": {"observations": [], "confirmed_days": 0, "data_as_of": "2026-10-08"}}')),
  'unavailable', 'R3: nicio zi confirmată → unavailable'
);

-- R4. Ratele se recalculează din numărător și numitor agregat ------------------------------------

select is(
  pg_temp.value(pg_temp.run(pg_temp.def('gsc_ctr'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 100}, {"date": "2026-10-08", "numerator": 10, "denominator": 900}]')),
  2::numeric, 'R4: CTR 10/100 + 10/900 = 2%, nu media ratelor (5,5%)'
);
select is(
  (pg_temp.run(pg_temp.def('gsc_ctr'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 100}, {"date": "2026-10-08", "numerator": 10, "denominator": 900}]')
    -> 'metric' ->> 'numerator')::numeric,
  20::numeric, 'R4: numerator = 20 clicks'
);
select is(
  (pg_temp.run(pg_temp.def('gsc_ctr'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 100}, {"date": "2026-10-08", "numerator": 10, "denominator": 900}]')
    -> 'metric' ->> 'denominator')::numeric,
  1000::numeric, 'R4: denominator = 1000 impressions'
);
-- CPC sintetic: spend / clicks. 10/1 și 90/30 → 100/31, nu (10 + 3) / 2 = 6,5.
select is(
  round(pg_temp.value(pg_temp.run(pg_temp.synth('{"aggregation": "ratio", "metric_key": "test_cpc"}'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 1}, {"date": "2026-10-08", "numerator": 90, "denominator": 30}]')), 4),
  3.2258::numeric, 'R4: CPC = spend total / clicks totale (3,2258), nu media CPC-urilor zilnice'
);
-- CPA sintetic: spend / conversii.
select is(
  pg_temp.value(pg_temp.run(pg_temp.synth('{"aggregation": "ratio", "metric_key": "test_cpa"}'),
    '[{"date": "2026-10-07", "numerator": 100, "denominator": 1}, {"date": "2026-10-08", "numerator": 100, "denominator": 9}]')),
  20::numeric, 'R4: CPA = 200 / 10 = 20, nu (100 + 11,1) / 2'
);

-- R5. Reach și active users nu se însumează; fără raport pe interval → unavailable ----------------

select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_active_users'),
    '[{"date": "2026-10-07", "value": 100}, {"date": "2026-10-08", "value": 80}]')),
  'unavailable', 'R5: active users doar pe zile (fără raport pe interval) → unavailable'
);
select ok(
  pg_temp.run(pg_temp.def('ga4_active_users'),
    '[{"date": "2026-10-07", "value": 100}, {"date": "2026-10-08", "value": 80}]') -> 'metric' -> 'value' = 'null'::jsonb,
  'R5: zilele nu se însumează (value null, nu 180)'
);
select is(
  pg_temp.value(pg_temp.run(pg_temp.def('ga4_active_users'),
    '[{"start": "2026-10-07", "end": "2026-10-07", "value": 100},
      {"start": "2026-10-08", "end": "2026-10-08", "value": 80},
      {"start": "2026-10-07", "end": "2026-10-08", "value": 150}]')),
  150::numeric, 'R5: se folosește doar raportul pe exact intervalul cerut (150), nu 330 sau 180'
);
select ok(
  pg_temp.has_warning(pg_temp.run(pg_temp.def('ga4_active_users'),
    '[{"start": "2026-10-07", "end": "2026-10-07", "value": 100}]'), 'interval_report_missing'),
  'R5: raport pe alt interval → interval_report_missing'
);
-- Reach sintetic, aceeași agregare.
select is(
  pg_temp.status(pg_temp.run(pg_temp.synth('{"aggregation": "interval_report_only", "metric_key": "test_reach"}'),
    '[{"start": "2026-10-01", "end": "2026-10-31", "value": 5000}]')),
  'unavailable', 'R5: reach lunar nu acoperă intervalul 7–8 oct → unavailable'
);

-- R6. Mediile se ponderează cu sesiunile -----------------------------------------------------------
-- Clarity scroll depth (formă presupusă): 80% pe 100 de sesiuni, 20% pe 900 → 26%, nu 50%.
select is(
  pg_temp.value(pg_temp.run(pg_temp.def('clarity_scroll_depth'),
    '[{"date": "2026-10-07", "value": 80, "weight": 100}, {"date": "2026-10-08", "value": 20, "weight": 900}]')),
  26::numeric, 'R6: scroll depth ponderat cu sesiunile = 26, nu 50'
);
-- Pagini per sesiune (sintetic): 2,0 pe 300 de sesiuni, 4,0 pe 100 → 2,5, nu 3,0.
select is(
  pg_temp.value(pg_temp.run(pg_temp.synth('{"aggregation": "weighted_mean", "weight_basis": "sessions", "metric_key": "test_pages_per_session"}'),
    '[{"date": "2026-10-07", "value": 2.0, "weight": 300}, {"date": "2026-10-08", "value": 4.0, "weight": 100}]')),
  2.5::numeric, 'R6: pagini per sesiune ponderat = 2,5, nu 3,0'
);
-- Poziția medie GSC, ponderată cu impressions.
select is(
  pg_temp.value(pg_temp.run(pg_temp.def('gsc_average_position'),
    '[{"date": "2026-10-07", "value": 2, "weight": 900}, {"date": "2026-10-08", "value": 12, "weight": 100}]')),
  3::numeric, 'R6: poziția medie GSC ponderată cu impressions = 3, nu 7'
);
-- Rânduri fără pondere: excluse, numărate în warnings, metrica devine partial.
select is(
  pg_temp.status(pg_temp.run(pg_temp.synth('{"aggregation": "weighted_mean", "weight_basis": "sessions"}'),
    '[{"date": "2026-10-07", "value": 80, "weight": 100}, {"date": "2026-10-08", "value": 10}]')),
  'partial', 'R6: un rând fără pondere → partial'
);
select is(
  (select w -> 'detail' from jsonb_array_elements(pg_temp.run(pg_temp.synth('{"aggregation": "weighted_mean", "weight_basis": "sessions"}'),
     '[{"date": "2026-10-07", "value": 80, "weight": 100}, {"date": "2026-10-08", "value": 10}]') -> 'warnings') w
   where w ->> 'code' = 'excluded_rows'),
  '{"reason": "missing_weight", "count": 1}'::jsonb,
  'R6: rândurile excluse sunt numărate în warnings, cu motivul'
);
select is(
  pg_temp.value(pg_temp.run(pg_temp.synth('{"aggregation": "weighted_mean", "weight_basis": "sessions"}'),
    '[{"date": "2026-10-07", "value": 80, "weight": 100}, {"date": "2026-10-08", "value": 10}]')),
  80::numeric, 'R6: valoarea folosește doar rândurile cu pondere'
);

-- R7. Diferența între procente în puncte procentuale ------------------------------------------------

select is(
  (pg_temp.run(pg_temp.def('gsc_ctr'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 100}, {"date": "2026-10-08", "numerator": 10, "denominator": 900}]',
    '{"comparison": {"confirmed_days": 2, "data_as_of": "2026-10-06",
      "observations": [{"date": "2026-10-05", "numerator": 3, "denominator": 100}, {"date": "2026-10-06", "numerator": 0, "denominator": 100}]}}')
    -> 'metric' ->> 'absolute_change')::numeric,
  0.5::numeric, 'R7: CTR 2% față de 1,5% → diferență absolută 0,5 (puncte procentuale)'
);
select is(
  round((pg_temp.run(pg_temp.def('gsc_ctr'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 100}, {"date": "2026-10-08", "numerator": 10, "denominator": 900}]',
    '{"comparison": {"confirmed_days": 2, "data_as_of": "2026-10-06",
      "observations": [{"date": "2026-10-05", "numerator": 3, "denominator": 100}, {"date": "2026-10-06", "numerator": 0, "denominator": 100}]}}')
    -> 'metric' ->> 'relative_change')::numeric, 2),
  33.33::numeric, 'R7: variația relativă se calculează separat (+33,33%)'
);
select is(metrics.change(2, 1.5, 'percent') ->> 'absolute_change_unit', 'pp',
  'R7: unitatea diferenței absolute pentru procente = pp');

-- R8. Bază zero → base_zero, nu infinit ---------------------------------------------------------------

select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_key_events'),
    '[{"date": "2026-10-07", "value": 4}, {"date": "2026-10-08", "value": 6}]',
    '{"comparison": {"confirmed_days": 2, "data_as_of": "2026-10-06", "observations": []}}')),
  'base_zero', 'R8: comparație cu zero real → base_zero'
);
select ok(
  pg_temp.run(pg_temp.def('ga4_key_events'),
    '[{"date": "2026-10-07", "value": 4}, {"date": "2026-10-08", "value": 6}]',
    '{"comparison": {"confirmed_days": 2, "data_as_of": "2026-10-06", "observations": []}}') -> 'metric' -> 'relative_change' = 'null'::jsonb,
  'R8: relative_change null pe bază zero'
);
select is(
  (pg_temp.run(pg_temp.def('ga4_key_events'),
    '[{"date": "2026-10-07", "value": 4}, {"date": "2026-10-08", "value": 6}]',
    '{"comparison": {"confirmed_days": 2, "data_as_of": "2026-10-06", "observations": []}}') -> 'metric' ->> 'absolute_change')::numeric,
  10::numeric, 'R8: diferența absolută rămâne calculabilă (+10)'
);
select ok((metrics.change(0, 0, 'count') ->> 'base_zero')::boolean, 'R8: 0 față de 0 → base_zero');

-- R9. Comparația implicită: perioada anterioară de aceeași lungime -----------------------------------

select is(metrics.comparison_period('2026-10-07', '2026-10-13'),
  '{"start": "2026-09-30", "end": "2026-10-06"}'::jsonb, 'R9: 7–13 oct → 30 sep–6 oct');
select is(metrics.comparison_period('2026-10-01', '2026-10-31', 'month'),
  '{"start": "2026-08-31", "end": "2026-09-30"}'::jsonb, 'R9: octombrie (31 zile) → 31 aug–30 sep, aceeași lungime');
select is(
  pg_temp.run(pg_temp.def('ga4_sessions'), '[]') -> 'metric' -> 'evidence_query' -> 'comparison_period',
  '{"start": "2026-10-05", "end": "2026-10-06"}'::jsonb, 'R9: compute folosește implicit perioada anterioară'
);

-- R10. MTD și YTD: aceeași porțiune, marcate „perioadă incompletă" ---------------------------------

select is(metrics.comparison_period('2026-10-01', '2026-10-07', 'mtd'),
  '{"start": "2026-09-01", "end": "2026-09-07"}'::jsonb, 'R10: MTD 1–7 oct → 1–7 sep');
select is(metrics.comparison_period('2026-03-01', '2026-03-31', 'mtd'),
  '{"start": "2026-02-01", "end": "2026-02-28"}'::jsonb, 'R10: MTD 1–31 mar → 1–28 feb (limitat la sfârșitul lunii)');
select is(metrics.comparison_period('2028-01-01', '2028-02-29', 'ytd'),
  '{"start": "2027-01-01", "end": "2027-02-28"}'::jsonb, 'R10: YTD până la 29 feb 2028 → până la 28 feb 2027');
select ok(
  pg_temp.has_warning(pg_temp.run(pg_temp.def('ga4_sessions'), '[]',
    '{"period": {"start": "2026-10-07", "end": "2026-10-08", "kind": "mtd"}}'), 'incomplete_period'),
  'R10: MTD → incomplete_period'
);
select is(
  (select w ->> 'detail' from jsonb_array_elements(pg_temp.run(pg_temp.def('ga4_sessions'), '[]',
     '{"period": {"start": "2026-01-01", "end": "2026-10-08", "kind": "ytd"}}') -> 'warnings') w
   where w ->> 'code' = 'incomplete_period'),
  'perioadă incompletă', 'R10: YTD → „perioadă incompletă"'
);
select ok(
  pg_temp.has_warning(pg_temp.run(pg_temp.def('ga4_sessions'), '[]', '{"as_of_date": "2026-10-08"}'), 'incomplete_period'),
  'R10: perioadă care include ziua curentă → incompletă'
);
select ok(
  not pg_temp.has_warning(pg_temp.run(pg_temp.def('ga4_sessions'), '[]'), 'incomplete_period'),
  'R10: perioadă închisă → fără marcaj'
);

-- R11. Rank absent nu primește poziția 100 -----------------------------------------------------------

select is(
  metrics.rank_summary('[{"keyword": "a", "rank": 1}, {"keyword": "b", "rank": 3}, {"keyword": "c", "rank": null},
                          {"keyword": "d", "rank": 15}, {"keyword": "e"}]') - 'average_rank',
  '{"tracked": 5, "ranked": 3, "unranked": 2, "top3": 2, "top10": 2}'::jsonb,
  'R11: keywords fără rank rămân „fără rank", nu intră în Top 3/10'
);
select is(
  round((metrics.rank_summary('[{"rank": 1}, {"rank": 3}, {"rank": null}, {"rank": 15}, {"rank": null}]') ->> 'average_rank')::numeric, 4),
  6.3333::numeric, 'R11: rank mediu doar pe keywords cu rank (19/3), nu 43,8 cu 100 pentru absente'
);
select is(metrics.rank_summary('[{"rank": null}]') -> 'average_rank', 'null'::jsonb,
  'R11: niciun rank → rank mediu null');
select throws_ok($$ select metrics.rank_summary('[{"rank": 0}]') $$, '22023', null, 'R11: rank 0 invalid');

-- R12. Eroare tehnică, refuz valid și absență de brand sunt trei stări -------------------------------

select is(metrics.classify_ai_answer(false, null, null), 'technical_error', 'R12: colectare eșuată → technical_error');
select is(metrics.classify_ai_answer(false, false, false), 'technical_error',
  'R12: eroarea tehnică nu devine absență de brand, chiar dacă brand_present = false');
select is(metrics.classify_ai_answer(true, true, false), 'refusal', 'R12: refuz valid al motorului → refusal');
select is(metrics.classify_ai_answer(true, false, false), 'brand_absent', 'R12: răspuns valid fără brand → brand_absent');
select is(metrics.classify_ai_answer(true, false, true), 'brand_present', 'R12: răspuns valid cu brand → brand_present');
select is(metrics.classify_ai_answer(true, false, null), 'technical_error',
  'R12: răspuns fără verdict pe brand → nu se presupune absență');
-- Exemplul din spec cap. 11: 24 cu brand din 80 valide → 30%. Plus 5 erori tehnice și 6 refuzuri.
select is(
  (with answers as (
     select jsonb_agg(a) as list from (
       select jsonb_build_object('collection_ok', true, 'engine_refused', false, 'brand_present', true) a from generate_series(1, 24)
       union all select jsonb_build_object('collection_ok', true, 'engine_refused', false, 'brand_present', false) from generate_series(1, 50)
       union all select jsonb_build_object('collection_ok', true, 'engine_refused', true, 'brand_present', false) from generate_series(1, 6)
       union all select jsonb_build_object('collection_ok', false, 'engine_refused', null, 'brand_present', null) from generate_series(1, 5)
     ) s)
   select metrics.ai_rate_inputs(list) from answers),
  '{"planned": 85, "valid": 80, "brand_present": 24, "brand_absent": 50, "refusals": 6, "technical_errors": 5, "coverage": 0.9412}'::jsonb,
  'R12: erorile tehnice nu intră la numitor; refuzurile sunt valide; acoperire 80/85'
);
select is(metrics.ratio(24, 80, 100), 30::numeric, 'R12: Mention Rate 24/80 = 30%');

-- R13. Eșantion sub prag → insufficient_sample ---------------------------------------------------------

select is(
  pg_temp.status(pg_temp.run(pg_temp.synth('{"aggregation": "ratio", "unit": "percent", "multiplier": 100, "min_sample": 50}'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 20}, {"date": "2026-10-08", "numerator": 5, "denominator": 20}]')),
  'insufficient_sample', 'R13: 40 de răspunsuri sub pragul de 50 → insufficient_sample'
);
select is(
  pg_temp.value(pg_temp.run(pg_temp.synth('{"aggregation": "ratio", "unit": "percent", "multiplier": 100, "min_sample": 50}'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 20}, {"date": "2026-10-08", "numerator": 5, "denominator": 20}]')),
  37.5::numeric, 'R13: valoarea rămâne calculată, statusul semnalează eșantionul'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.synth('{"aggregation": "ratio", "unit": "percent", "multiplier": 100, "min_sample": 50}'),
    '[{"date": "2026-10-07", "numerator": 10, "denominator": 25}, {"date": "2026-10-08", "numerator": 5, "denominator": 25}]')),
  'ok', 'R13: exact 50 → ok'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.def('gsc_ctr'),
    '[{"date": "2026-10-07", "numerator": 1, "denominator": 2}, {"date": "2026-10-08", "numerator": 0, "denominator": 1}]')),
  'ok', 'R13: nivel A fără prag (min_sample null) → fără insufficient_sample'
);

-- Stale (toleranță din registru) ---------------------------------------------------------------------

select is(
  pg_temp.status(pg_temp.run(pg_temp.def('gsc_clicks'), '[{"date": "2026-10-07", "value": 5}]',
    '{"current": {"observations": [{"date": "2026-10-07", "value": 5}], "confirmed_days": 2, "data_as_of": "2026-10-05"}}')),
  'ok', 'S1: GSC cu date până la 5 oct pentru perioada până la 8 oct (toleranță 3 zile) → ok'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.def('gsc_clicks'), '[{"date": "2026-10-07", "value": 5}]',
    '{"current": {"observations": [{"date": "2026-10-07", "value": 5}], "confirmed_days": 2, "data_as_of": "2026-10-04"}}')),
  'stale', 'S1: GSC cu date până la 4 oct → stale'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_sessions'), '[{"date": "2026-10-07", "value": 5}]',
    '{"current": {"observations": [{"date": "2026-10-07", "value": 5}], "confirmed_days": 2, "data_as_of": "2026-10-05"}}')),
  'stale', 'S1: aceeași dată, GA4 (toleranță 2 zile) → stale'
);

-- Ordinea statusurilor și condițiile secundare ---------------------------------------------------------

select is(
  pg_temp.status(pg_temp.run(pg_temp.synth('{"aggregation": "ratio"}'),
    '[{"date": "2026-10-07", "numerator": 0, "denominator": 0}]',
    '{"current": {"observations": [{"date": "2026-10-07", "numerator": 0, "denominator": 0}], "confirmed_days": 1, "data_as_of": "2026-09-01"}}')),
  'cannot_compute', 'O1: cannot_compute are prioritate față de stale și partial'
);
select ok(
  (select bool_and(w ->> 'metric_key' = 'test_metric')
   from jsonb_array_elements(pg_temp.run(pg_temp.synth('{"aggregation": "ratio"}'),
     '[{"date": "2026-10-07", "numerator": 0, "denominator": 0}]',
     '{"current": {"observations": [{"date": "2026-10-07", "numerator": 0, "denominator": 0}], "confirmed_days": 1, "data_as_of": "2026-09-01"}}') -> 'warnings') w)
  and pg_temp.has_warning(pg_temp.run(pg_temp.synth('{"aggregation": "ratio"}'),
     '[{"date": "2026-10-07", "numerator": 0, "denominator": 0}]',
     '{"current": {"observations": [{"date": "2026-10-07", "numerator": 0, "denominator": 0}], "confirmed_days": 1, "data_as_of": "2026-09-01"}}'), 'stale')
  and pg_temp.has_warning(pg_temp.run(pg_temp.synth('{"aggregation": "ratio"}'),
     '[{"date": "2026-10-07", "numerator": 0, "denominator": 0}]',
     '{"current": {"observations": [{"date": "2026-10-07", "numerator": 0, "denominator": 0}], "confirmed_days": 1, "data_as_of": "2026-09-01"}}'), 'partial'),
  'O1: stale și partial apar în warnings, cu metric_key'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_sessions'),
    '[{"date": "2026-10-07", "value": 5}, {"date": "2026-10-07", "value": 5}]')),
  'unavailable', 'O2: aceeași zi de două ori nu se adună (duplicate_observations → unavailable)'
);
select ok(
  pg_temp.has_warning(pg_temp.run(pg_temp.def('ga4_sessions'),
    '[{"date": "2026-10-07", "value": 5}, {"date": "2026-10-07", "value": 5}]'), 'duplicate_observations'),
  'O2: duplicatul e semnalat'
);
select is(
  pg_temp.status(pg_temp.run(pg_temp.def('ga4_sessions'),
    '[{"date": "2026-10-07", "value": 5}, {"date": "2026-10-08", "value": 7}]',
    '{"current": {"observations": [{"date": "2026-10-07", "value": 5}], "confirmed_days": 1, "data_as_of": "2026-10-08"}}')),
  'partial', 'O3: o zi din două confirmată → partial'
);

-- Etichete, draft, evidence_query ------------------------------------------------------------------

select is(
  pg_temp.value(pg_temp.run(pg_temp.def('seomonitor_visibility'),
    '[{"date": "2026-10-07", "value": 40, "weight": 7}, {"date": "2026-10-08", "value": 60, "weight": 1}]')),
  42.5::numeric, 'E1: visibility = medie ponderată cu zilele acoperite (40 × 7 + 60 × 1) / 8'
);
select is(
  (select w ->> 'detail' from jsonb_array_elements(pg_temp.run(pg_temp.def('seomonitor_visibility'),
     '[{"date": "2026-10-07", "value": 40, "weight": 7}]') -> 'warnings') w where w ->> 'code' = 'aggregation_label'),
  'medie în perioadă', 'E1: eticheta „medie în perioadă" ajunge în răspuns'
);
select is(
  pg_temp.value(pg_temp.run(pg_temp.def('seomonitor_visibility_latest'),
    '[{"date": "2026-10-07", "value": 40}, {"date": "2026-10-08", "value": 60}]')),
  60::numeric, 'E1: cardul folosește ultima observație (60)'
);
select ok(
  pg_temp.has_warning(pg_temp.run(pg_temp.def('clarity_rage_click_sessions'), '[{"date": "2026-10-07", "value": 3}]'), 'definition_draft'),
  'E2: metricile Clarity sunt marcate draft în răspuns'
);
select is(
  pg_temp.run(pg_temp.def('gsc_ctr'), '[]') -> 'metric' -> 'evidence_query',
  '{"metric_key": "gsc_ctr", "version": 1, "brand_id": "20000000-0000-0000-0000-000000000011",
    "period": {"start": "2026-10-07", "end": "2026-10-08"},
    "comparison_period": {"start": "2026-10-05", "end": "2026-10-06"}}'::jsonb,
  'E3: evidence_query = referință stabilă (metric_key, versiune, brand, perioadă, comparație)'
);
select is(
  pg_temp.run(pg_temp.def('gsc_ctr'), '[]') -> 'metric' -> 'evidence_query',
  pg_temp.run(pg_temp.def('gsc_ctr'), '[{"date": "2026-10-07", "numerator": 1, "denominator": 10}]') -> 'metric' -> 'evidence_query',
  'E3: evidence_query nu depinde de date (stabilă)'
);

-- Contractul (spec cap. 26 + decizia: data_as_of și coverage și pe metrică) ---------------------------

select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.run(pg_temp.def('gsc_ctr'), '[]') -> 'metric') k),
  array['absolute_change', 'comparison_value', 'coverage', 'currency', 'data_as_of', 'denominator', 'evidence_query',
        'numerator', 'relative_change', 'status', 'unit', 'value'],
  'C1: metrica are exact câmpurile contractului (versiunea 2, cu currency)'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.run(pg_temp.def('gsc_ctr'), '[]',
     '{"connection": {"connected": false}}') -> 'metric') k),
  array['absolute_change', 'comparison_value', 'coverage', 'currency', 'data_as_of', 'denominator', 'evidence_query',
        'numerator', 'relative_change', 'status', 'unit', 'value'],
  'C1: aceleași câmpuri și pentru not_connected'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     metrics.build_response('{"tenant_id": "t", "brand_id": "b", "period": {}, "comparison_period": {}, "cohort_version": null}',
       jsonb_build_array(pg_temp.run(pg_temp.def('gsc_ctr'), '[]'))) -> 'meta') k),
  array['brand_id', 'cohort_version', 'comparison_period', 'coverage', 'data_as_of', 'generated_at',
        'metric_definition_version', 'period', 'sources', 'tenant_id', 'warnings'],
  'C2: meta are exact câmpurile din spec cap. 26'
);
select is(
  metrics.build_response('{"tenant_id": "t", "brand_id": "b"}',
    jsonb_build_array(
      pg_temp.run(pg_temp.def('gsc_clicks'), '[]',
        '{"current": {"observations": [], "confirmed_days": 2, "data_as_of": "2026-10-06"}}'),
      pg_temp.run(pg_temp.def('ga4_sessions'), '[]',
        '{"current": {"observations": [], "confirmed_days": 1, "data_as_of": "2026-10-08"}}'))) -> 'meta' -> 'data_as_of',
  '"2026-10-06"'::jsonb, 'C2: meta.data_as_of = cea mai veche dată dintre metrici'
);
select is(
  (metrics.build_response('{}', jsonb_build_array(
      pg_temp.run(pg_temp.def('gsc_clicks'), '[]'),
      pg_temp.run(pg_temp.def('ga4_sessions'), '[]',
        '{"current": {"observations": [], "confirmed_days": 1, "data_as_of": "2026-10-08"}}'))) -> 'data' -> 1 ->> 'data_as_of'),
  '2026-10-08', 'C2: fiecare metrică își păstrează propriul data_as_of'
);
select is(
  (metrics.build_response('{}', jsonb_build_array(pg_temp.run(pg_temp.def('ga4_sessions'), '[]',
      '{"current": {"observations": [], "confirmed_days": 1, "data_as_of": "2026-10-08"}}'))) -> 'meta' -> 'warnings' -> 0 ->> 'metric_key'),
  'ga4_sessions', 'C2: meta.warnings poartă metric_key'
);
select is(
  metrics.build_response('{}', jsonb_build_array(pg_temp.run(pg_temp.def('gsc_ctr'), '[]'))) -> 'meta' -> 'metric_definition_version',
  '{"gsc_ctr": 1}'::jsonb, 'C2: metric_definition_version per metrică'
);

-- Registrul ----------------------------------------------------------------------------------------

select is((select count(*)::int from public.metric_definitions where primary_source in ('ga4', 'gsc', 'seomonitor', 'clarity')), 16, 'D1: 16 definiții de nivel A (nivelul B, import CSV, are propriile teste în 08)');
select is((select count(*)::int from public.metric_definitions_current where primary_source in ('ga4', 'gsc', 'seomonitor', 'clarity')), 16, 'D1: câte o versiune curentă per metrică (nivel A)');
select is_empty(
  $$ select metric_key from public.metric_definitions where primary_source = 'clarity' and lifecycle <> 'draft' $$,
  'D1: toate metricile Clarity sunt draft până la fixtures'
);
select results_eq(
  $$ select primary_source::text collate "C", min(freshness_grace_days), max(freshness_grace_days)
     from public.metric_definitions where primary_source in ('ga4', 'gsc', 'seomonitor', 'clarity') group by 1 order by 1 $$,
  $$ values ('clarity'::text collate "C", 1, 1), ('ga4', 2, 2), ('gsc', 3, 3), ('seomonitor', 7, 7) $$,
  'D1: toleranța stale per sursă: GA4 2, GSC 3, SEOmonitor 7, Clarity 1'
);
select is_empty($$ select metric_key from public.metric_definitions where min_sample is not null and primary_source in ('ga4', 'gsc', 'seomonitor', 'clarity') $$,
  'D1: nivelul A nu are prag de eșantion');
select throws_ok($$ update public.metric_definitions set formula_ro = 'alta' where metric_key = 'gsc_ctr' $$,
  '42501', null, 'D2: versiunile nu se modifică (nici de owner)');
select throws_ok($$ delete from public.metric_definitions where metric_key = 'gsc_ctr' $$,
  '42501', null, 'D2: versiunile nu se șterg');
select throws_ok(
  $$ insert into public.metric_definitions (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation,
       freshness_grace_days, valid_from, doc_ref)
     values ('x_bad', 1, 'X', 'X', 'count', 'test', 'weighted_mean', 0, '2026-10-01', 'x') $$,
  '23514', null, 'D2: medie ponderată fără weight_basis respinsă'
);

-- Acces ---------------------------------------------------------------------------------------------

select tests.authenticate_as('30000000-0000-0000-0000-000000000005'); -- client fără niciun brand
select cmp_ok((select count(*)::int from public.metric_definitions), '>=', 16, 'A1: registrul e citibil de orice utilizator autentificat');
select is(pg_temp.status(pg_temp.run(pg_temp.def('gsc_ctr'), '[]')), 'cannot_compute',
  'A1: authenticated poate executa funcțiile pure din metrics');
select throws_ok(
  $$ insert into public.metric_definitions (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation,
       freshness_grace_days, valid_from, doc_ref)
     values ('x_user', 1, 'X', 'X', 'count', 'test', 'sum', 0, '2026-10-01', 'x') $$,
  '42501', null, 'A1: utilizatorii nu pot scrie în registru'
);
reset role;
select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.metric_definitions $$, '42501', null, 'A2: anon nu citește registrul');
select throws_ok($$ select metrics.ratio(1, 2) $$, '42501', null, 'A2: anon nu execută funcțiile din metrics');
reset role;

select * from finish();
rollback;
