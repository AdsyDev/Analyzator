-- AB: variația compară aceleași zile când perioada curentă nu are încă date până la final.
--
-- Perioada aleasă se termină ieri, dar sursele aduc datele cu întârziere (Search Console marțea, până cu 3 zile în urmă;
-- GA4 până ieri). Valoarea curentă adună doar zilele cu date, iar comparația lua toată perioada anterioară: pe 23 nov
-- 2026, clicks GSC pe 20 de zile față de 28 de zile complete dădeau −14,7%, deși pe zi traficul crescuse.
--
-- Regula (aceeași ca la MTD/YTD, spec 2.3: „aceeași porțiune din perioada de referință"): când lipsesc zile la sfârșitul
-- perioadei curente, comparația se oprește la aceeași poziție în perioada de referință. Perioada afișată, valoarea curentă
-- și statusul (`partial`) nu se schimbă; avertismentul `comparison_matched` și `evidence_query.comparison_period` spun ce
-- s-a comparat. Se aplică doar agregărilor pe zile (sum, ratio, weighted_mean); `last_observation` compară deja ultima
-- observație, iar `interval_report_only` are raport doar pe intervalul exact (fără zile lipsă la final).
-- Decizia: docs/decisions.md, AB. Contractul: docs/contracts/metric-response.md.

-- 1. Regula, ca funcție pură --------------------------------------------------------------------------------------------------

create function metrics.matched_comparison_period(
  p_start date, p_end date, p_kind text, p_aggregation text, p_confirmed_days integer, p_data_as_of date
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_natural jsonb := metrics.comparison_period(p_start, p_end, p_kind);
  v_cmp_start date := (v_natural ->> 'start')::date;
  v_cmp_end date := (v_natural ->> 'end')::date;
begin
  if p_aggregation not in ('sum', 'ratio', 'weighted_mean')
     or p_data_as_of is null or p_data_as_of >= p_end or p_data_as_of < p_start
     or coalesce(p_confirmed_days, 0) >= p_end - p_start + 1 then
    return v_natural || jsonb_build_object('matched', false);
  end if;
  return jsonb_build_object(
    'start', v_cmp_start,
    'end', least(v_cmp_start + (p_data_as_of - p_start), v_cmp_end),
    'matched', true);
end;
$$;

comment on function metrics.matched_comparison_period(date, date, text, text, integer, date) is
  'Intervalul de comparație efectiv (AB): perioada de referință, oprită la aceeași poziție ca ultima zi cu date a perioadei '
  'curente când lipsesc zile la final. matched = true când s-a scurtat.';

revoke all on function metrics.matched_comparison_period(date, date, text, text, integer, date) from public, anon;
grant execute on function metrics.matched_comparison_period(date, date, text, text, integer, date) to authenticated, service_role;

-- 2. metrics.compute folosește intervalul efectiv ---------------------------------------------------------------------------------
-- Înlocuiri exacte în corpul funcției (ca în 20261110120000): fiecare text vechi trebuie găsit exact o dată.

do $$
declare
  v_def text := pg_get_functiondef('metrics.compute(jsonb)'::regprocedure);
  v_pairs text[][] := array[
    array[
      E'  v_cmp_period jsonb;\n',
      E'  v_cmp_period jsonb;\n  v_cmp_matched boolean := false;\n'],
    array[
      E'  v_cmp_period := metrics.comparison_period(v_start, v_end, v_kind);\n',
      E'  -- AB: când lipsesc zile la sfârșitul perioadei curente, comparația ia aceeași porțiune din perioada de referință.\n'
      || E'  v_cmp_period := metrics.matched_comparison_period(v_start, v_end, v_kind, v_aggregation,\n'
      || E'    (v_cur ->> ''confirmed_days'')::integer, v_data_as_of);\n'
      || E'  v_cmp_matched := (v_cmp_period ->> ''matched'')::boolean;\n'
      || E'  v_cmp_period := v_cmp_period - ''matched'';\n'
      || E'  -- Zilele confirmate ale comparației trebuie numărate pe același interval: cine apelează îl declară.\n'
      || E'  if v_cmp_matched and v_cmp is not null and jsonb_typeof(v_cmp) = ''object''\n'
      || E'     and (v_cmp -> ''period'') is distinct from v_cmp_period then\n'
      || E'    raise exception ''Comparația trebuie citită pe intervalul %, nu pe %'', v_cmp_period, coalesce(v_cmp -> ''period'', ''null'')\n'
      || E'      using errcode = ''22023'';\n'
      || E'  end if;\n'],
    array[
      E'  v_change := metrics.change(v_value, v_comparison, v_unit);\n',
      E'  if v_cmp_matched and v_comparison is not null then\n'
      || E'    v_warnings := v_warnings || jsonb_build_object(''metric_key'', v_key, ''code'', ''comparison_matched'',\n'
      || E'      ''severity'', ''info'', ''detail'', jsonb_build_object(''days'', v_cmp_days, ''comparison_period'', v_cmp_period));\n'
      || E'  end if;\n'
      || E'  v_change := metrics.change(v_value, v_comparison, v_unit);\n']
  ];
  i integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'metrics.compute nu mai conține exact o dată textul așteptat: %', v_pairs[i][1];
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end;
$$;

-- 3. Observațiile comparației se citesc pe același interval ----------------------------------------------------------------------

do $$
declare
  v_def text := pg_get_functiondef('private.compute_metric_snapshot(uuid, uuid, text, date, date, text, jsonb)'::regprocedure);
  v_pairs text[][] := array[
    array[
      E'  select o.obs, o.days, o.as_of into v_cmp_obs, v_cmp_days, v_cmp_asof\n',
      E'  -- AB: intervalul efectiv al comparației depinde de zilele cu date ale perioadei curente.\n'
      || E'  v_cmp := metrics.matched_comparison_period(p_start, p_end, p_kind, v_agg, v_cur_days, v_cur_asof) - ''matched'';\n'
      || E'  select o.obs, o.days, o.as_of into v_cmp_obs, v_cmp_days, v_cmp_asof\n'],
    array[
      E'''comparison'', jsonb_build_object(''observations'', v_cmp_obs, ''confirmed_days'', v_cmp_days, ''data_as_of'', v_cmp_asof)',
      E'''comparison'', jsonb_build_object(''observations'', v_cmp_obs, ''confirmed_days'', v_cmp_days, ''data_as_of'', v_cmp_asof,\n'
      || E'                                  ''period'', v_cmp)']
  ];
  i integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'private.compute_metric_snapshot nu mai conține exact o dată textul așteptat: %', v_pairs[i][1];
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end;
$$;

revoke all on all functions in schema metrics from public, anon;
grant execute on all functions in schema metrics to authenticated, service_role;
