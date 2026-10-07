-- ANZ07: registrul de metrici.
-- metric_definitions = registrul produsului (fără tenant_id, excepție documentată în CLAUDE.md și
-- docs/security-tests.md, E2). Formulele trăiesc în schema metrics: funcții pure (IMMUTABLE/STABLE,
-- SECURITY INVOKER, fără acces la tabele) care primesc definiția și observațiile ca jsonb.
-- View-urile și RPC-urile pe sursă (vin cu conectorii) transformă datele reale în observații și apelează
-- metrics.compute. Contractul răspunsului: docs/contracts/metric-response.md (spec cap. 26).

-- metric_definitions ------------------------------------------------------------------------

create table public.metric_definitions (
  metric_key           text not null check (metric_key ~ '^[a-z][a-z0-9_]*$'),
  version              integer not null check (version > 0),
  name_ro              text not null check (length(trim(name_ro)) > 0),
  formula_ro           text not null check (length(trim(formula_ro)) > 0),
  unit                 text not null check (unit in ('count', 'percent', 'seconds', 'position', 'score')),
  primary_source       text not null check (primary_source ~ '^[a-z0-9_]+$'),
  aggregation          text not null
    check (aggregation in ('sum', 'ratio', 'weighted_mean', 'last_observation', 'interval_report_only')),
  multiplier           numeric not null default 1 check (multiplier > 0),
  weight_basis         text check (weight_basis in ('sessions', 'impressions', 'days_covered')),
  aggregation_label    text,
  direction            text not null default 'higher_is_better'
    check (direction in ('higher_is_better', 'lower_is_better', 'neutral')),
  min_sample           numeric check (min_sample > 0),
  freshness_grace_days integer not null check (freshness_grace_days >= 0),
  lifecycle            text not null default 'active' check (lifecycle in ('draft', 'active', 'retired')),
  lifecycle_note       text,
  valid_from           date not null,
  doc_ref              text not null,
  created_at           timestamptz not null default now(),
  primary key (metric_key, version),
  check ((aggregation = 'weighted_mean') = (weight_basis is not null)),
  check (aggregation = 'ratio' or multiplier = 1),
  check (lifecycle <> 'draft' or lifecycle_note is not null)
);

comment on table public.metric_definitions is
  'Registrul de metrici (ANZ07). Versiuni imutabile: o schimbare = versiune nouă prin migrație.';

-- Versiunile nu se modifică și nu se șterg.
create trigger metric_definitions_immutable
  before update or delete on public.metric_definitions
  for each row execute function private.prevent_update();

-- Versiunea curentă per metrică (ultima nereținută).
create view public.metric_definitions_current
with (security_invoker = true) as
select distinct on (metric_key) *
from public.metric_definitions
where lifecycle <> 'retired'
order by metric_key, version desc;

grant select on public.metric_definitions to authenticated;
grant select on public.metric_definitions_current to authenticated;
alter table public.metric_definitions enable row level security;

-- Registrul e același pentru toți clienții: îl citește orice utilizator autentificat (cu sesiune de user).
create policy metric_definitions_select on public.metric_definitions for select to authenticated
  using ((select auth.uid()) is not null);
create policy metric_definitions_insert on public.metric_definitions for insert to authenticated
  with check (false);
create policy metric_definitions_update on public.metric_definitions for update to authenticated
  using (false);
create policy metric_definitions_delete on public.metric_definitions for delete to authenticated
  using (false);

-- Schema metrics: funcții pure ----------------------------------------------------------------

create schema metrics;
revoke all on schema metrics from public;
grant usage on schema metrics to authenticated, service_role;
alter default privileges for role postgres in schema metrics revoke execute on functions from public;

-- Numără un motiv de excludere: {"missing_weight": 2, ...}
create function metrics.count_reason(p_counts jsonb, p_reason text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(coalesce(p_counts, '{}'::jsonb), array[p_reason],
                   to_jsonb(coalesce((p_counts ->> p_reason)::integer, 0) + 1));
$$;

-- Rată din numărător și numitor agregat. Numitor zero sau lipsă → null.
create function metrics.ratio(p_numerator numeric, p_denominator numeric, p_multiplier numeric default 1)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_numerator is null or p_denominator is null or p_denominator = 0 then null
    else coalesce(p_multiplier, 1) * p_numerator / p_denominator
  end;
$$;

-- Perioada de comparație. Implicit: perioada anterioară de aceeași lungime.
-- mtd / ytd: aceeași porțiune din luna / anul de referință (spec 2.3), limitată la sfârșitul lunii.
create function metrics.comparison_period(p_start date, p_end date, p_kind text default 'custom')
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
  v_ref_month date;
  v_ref_month_end date;
  v_month_start date;
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Perioadă invalidă: % – %', p_start, p_end using errcode = '22023';
  end if;

  if p_kind = 'mtd' then
    v_month_start := date_trunc('month', p_start)::date;
    v_ref_month := (v_month_start - interval '1 month')::date;
    v_ref_month_end := (v_ref_month + interval '1 month' - interval '1 day')::date;
    v_start := least(v_ref_month + (p_start - v_month_start), v_ref_month_end);
    v_end := least(v_ref_month + (p_end - v_month_start), v_ref_month_end);
  elsif p_kind = 'ytd' then
    -- Scăderea unui an limitează 29 februarie la 28 februarie.
    v_start := (p_start - interval '1 year')::date;
    v_end := (p_end - interval '1 year')::date;
  else
    v_end := p_start - 1;
    v_start := p_start - (p_end - p_start + 1);
  end if;

  return jsonb_build_object('start', v_start, 'end', v_end);
end;
$$;

-- Perioadă incompletă: MTD, YTD sau o perioadă care include ziua curentă (ori viitorul).
create function metrics.is_incomplete_period(p_end date, p_kind text, p_as_of date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_kind, '') in ('mtd', 'ytd') or p_end >= p_as_of;
$$;

-- Diferența absolută (în puncte procentuale pentru unit = percent) și variația relativă (%).
-- Bază zero: relative_change null și base_zero = true, nu infinit.
create function metrics.change(p_value numeric, p_comparison numeric, p_unit text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'absolute_change', case when p_value is null or p_comparison is null then null else p_value - p_comparison end,
    'absolute_change_unit', case when p_unit = 'percent' then 'pp' else p_unit end,
    'relative_change', case
      when p_value is null or p_comparison is null or p_comparison = 0 then null
      else 100 * (p_value - p_comparison) / abs(p_comparison)
    end,
    'base_zero', p_value is not null and p_comparison = 0
  );
$$;

-- Rankuri: rank absent nu primește o poziție artificială (de ex. 100).
-- Intrare: [{"keyword": "...", "rank": 3 | null}, ...]
create function metrics.rank_summary(p_ranks jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  r jsonb;
  v_rank numeric;
  v_tracked integer := 0;
  v_ranked integer := 0;
  v_top3 integer := 0;
  v_top10 integer := 0;
  v_sum numeric := 0;
begin
  if jsonb_typeof(coalesce(p_ranks, '[]'::jsonb)) <> 'array' then
    raise exception 'ranks trebuie să fie listă' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(coalesce(p_ranks, '[]'::jsonb)) loop
    v_tracked := v_tracked + 1;
    if r ->> 'rank' is null then
      continue;
    end if;
    v_rank := (r ->> 'rank')::numeric;
    if v_rank < 1 then
      raise exception 'Rank invalid: %', v_rank using errcode = '22023';
    end if;
    v_ranked := v_ranked + 1;
    v_sum := v_sum + v_rank;
    if v_rank <= 3 then v_top3 := v_top3 + 1; end if;
    if v_rank <= 10 then v_top10 := v_top10 + 1; end if;
  end loop;

  return jsonb_build_object(
    'tracked', v_tracked,
    'ranked', v_ranked,
    'unranked', v_tracked - v_ranked,
    'top3', v_top3,
    'top10', v_top10,
    'average_rank', case when v_ranked = 0 then null else v_sum / v_ranked end
  );
end;
$$;

-- Starea unui răspuns AI: eroarea tehnică, refuzul valid al motorului și absența brandului sunt distincte.
create function metrics.classify_ai_answer(p_collection_ok boolean, p_engine_refused boolean, p_brand_present boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_collection_ok is distinct from true then 'technical_error'
    when p_engine_refused then 'refusal'
    when p_brand_present then 'brand_present'
    when p_brand_present = false then 'brand_absent'
    else 'technical_error'
  end;
$$;

-- Intrări pentru o rată AI: erorile tehnice nu intră la numitor (scad acoperirea);
-- refuzurile sunt răspunsuri valide fără brand.
-- Intrare: [{"collection_ok": true, "engine_refused": false, "brand_present": true}, ...]
create function metrics.ai_rate_inputs(p_answers jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with states as (
    select metrics.classify_ai_answer(
      (a ->> 'collection_ok')::boolean, (a ->> 'engine_refused')::boolean, (a ->> 'brand_present')::boolean
    ) as state
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as a
  )
  select jsonb_build_object(
    'planned', count(*),
    'valid', count(*) filter (where state <> 'technical_error'),
    'brand_present', count(*) filter (where state = 'brand_present'),
    'brand_absent', count(*) filter (where state = 'brand_absent'),
    'refusals', count(*) filter (where state = 'refusal'),
    'technical_errors', count(*) filter (where state = 'technical_error'),
    'coverage', case when count(*) = 0 then null
                     else round(count(*) filter (where state <> 'technical_error')::numeric / count(*), 4) end
  )
  from states;
$$;

-- Agregarea observațiilor după tipul din definiție.
-- sum:                  [{"date", "value"}]
-- ratio:                [{"date", "numerator", "denominator"}]
-- weighted_mean:        [{"date", "value", "weight"}]
-- last_observation:     [{"date", "value"}]
-- interval_report_only: [{"start", "end", "value"}] — doar raportul pe exact intervalul cerut; nu se însumează.
create function metrics.aggregate(p_definition jsonb, p_observations jsonb, p_start date, p_end date)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_agg text := p_definition ->> 'aggregation';
  v_mult numeric := coalesce((p_definition ->> 'multiplier')::numeric, 1);
  v_obs jsonb := coalesce(p_observations, '[]'::jsonb);
  v_excluded jsonb := '{}'::jsonb;
  r jsonb;
  v_date date;
  v_dates date[] := '{}';
  v_duplicate boolean := false;
  v_used integer := 0;
  v_sum numeric := 0;
  v_num numeric := 0;
  v_den numeric := 0;
  v_weight numeric;
  v_last_date date;
  v_last_value numeric;
  v_report numeric;
  v_has_report boolean := false;
  v_value numeric;
begin
  if jsonb_typeof(v_obs) <> 'array' then
    raise exception 'observations trebuie să fie listă' using errcode = '22023';
  end if;
  if v_agg not in ('sum', 'ratio', 'weighted_mean', 'last_observation', 'interval_report_only') or v_agg is null then
    raise exception 'Agregare necunoscută: %', v_agg using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(v_obs) loop
    if v_agg = 'interval_report_only' then
      if r ->> 'value' is null then
        v_excluded := metrics.count_reason(v_excluded, 'missing_value');
      elsif (r ->> 'start')::date is distinct from p_start or (r ->> 'end')::date is distinct from p_end then
        v_excluded := metrics.count_reason(v_excluded, 'interval_mismatch');
      elsif v_has_report then
        v_duplicate := true;
      else
        v_report := (r ->> 'value')::numeric;
        v_has_report := true;
        v_used := v_used + 1;
      end if;
      continue;
    end if;

    v_date := (r ->> 'date')::date;
    if v_date is null or v_date < p_start or v_date > p_end then
      v_excluded := metrics.count_reason(v_excluded, 'outside_period');
      continue;
    end if;

    if v_agg in ('sum', 'last_observation', 'weighted_mean') and r ->> 'value' is null then
      v_excluded := metrics.count_reason(v_excluded, 'missing_value');
      continue;
    end if;
    if v_agg = 'ratio' and (r ->> 'numerator' is null or r ->> 'denominator' is null) then
      v_excluded := metrics.count_reason(v_excluded, 'missing_numerator_or_denominator');
      continue;
    end if;
    if v_agg = 'weighted_mean' and r ->> 'weight' is null then
      v_excluded := metrics.count_reason(v_excluded, 'missing_weight');
      continue;
    end if;

    -- Sumele cer intervale disjuncte: aceeași zi de două ori nu se adună.
    if v_date = any (v_dates) then
      v_duplicate := true;
      continue;
    end if;
    v_dates := v_dates || v_date;
    v_used := v_used + 1;

    if v_agg = 'sum' then
      v_sum := v_sum + (r ->> 'value')::numeric;
    elsif v_agg = 'ratio' then
      v_num := v_num + (r ->> 'numerator')::numeric;
      v_den := v_den + (r ->> 'denominator')::numeric;
    elsif v_agg = 'weighted_mean' then
      v_weight := (r ->> 'weight')::numeric;
      if v_weight < 0 then
        raise exception 'Pondere negativă la %', v_date using errcode = '22023';
      end if;
      v_num := v_num + (r ->> 'value')::numeric * v_weight;
      v_den := v_den + v_weight;
    elsif v_agg = 'last_observation' then
      if v_last_date is null or v_date > v_last_date then
        v_last_date := v_date;
        v_last_value := (r ->> 'value')::numeric;
      end if;
    end if;
  end loop;

  if v_agg = 'sum' then
    return jsonb_build_object('value', v_sum, 'numerator', null, 'denominator', null, 'n', v_used,
      'has_value', true, 'used_rows', v_used, 'excluded', v_excluded, 'duplicate', v_duplicate);
  elsif v_agg = 'ratio' then
    v_value := metrics.ratio(v_num, v_den, v_mult);
    return jsonb_build_object('value', v_value, 'numerator', v_num, 'denominator', v_den, 'n', v_den,
      'has_value', v_value is not null, 'used_rows', v_used, 'excluded', v_excluded, 'duplicate', v_duplicate);
  elsif v_agg = 'weighted_mean' then
    v_value := case when v_den > 0 then v_num / v_den end;
    return jsonb_build_object('value', v_value, 'numerator', v_num, 'denominator', v_den, 'n', v_den,
      'has_value', v_value is not null, 'used_rows', v_used, 'excluded', v_excluded, 'duplicate', v_duplicate);
  elsif v_agg = 'last_observation' then
    return jsonb_build_object('value', v_last_value, 'numerator', null, 'denominator', null,
      'n', case when v_last_date is null then 0 else 1 end, 'has_value', v_last_date is not null,
      'observed_on', v_last_date, 'used_rows', v_used, 'excluded', v_excluded, 'duplicate', v_duplicate);
  else
    return jsonb_build_object('value', v_report, 'numerator', null, 'denominator', null,
      'n', case when v_has_report then 1 else 0 end, 'has_value', v_has_report,
      'used_rows', v_used, 'excluded', v_excluded, 'duplicate', v_duplicate);
  end if;
end;
$$;

-- Valoarea afișabilă și starea ei, cu regulile din spec 2.2.
-- Zero real doar cu interogare reușită și acoperire confirmată.
create function metrics.resolve_value(p_aggregation text, p_agg jsonb, p_coverage numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_agg ->> 'duplicate')::boolean then
      jsonb_build_object('value', null, 'state', 'unavailable', 'reason', 'duplicate_observations')
    when p_aggregation = 'interval_report_only' and not (p_agg ->> 'has_value')::boolean then
      jsonb_build_object('value', null, 'state', 'unavailable', 'reason', 'interval_report_missing')
    when p_aggregation = 'last_observation' and not (p_agg ->> 'has_value')::boolean then
      jsonb_build_object('value', null, 'state', 'unavailable', 'reason', 'no_observation')
    when p_aggregation in ('sum', 'ratio', 'weighted_mean') and coalesce(p_coverage, 0) = 0 then
      jsonb_build_object('value', null, 'state', 'unavailable', 'reason', 'no_confirmed_data')
    when p_aggregation in ('ratio', 'weighted_mean') and not (p_agg ->> 'has_value')::boolean then
      jsonb_build_object('value', null, 'state', 'cannot_compute', 'reason', 'zero_denominator')
    when p_aggregation in ('sum', 'ratio', 'weighted_mean') and (p_agg ->> 'value')::numeric = 0 and p_coverage < 1 then
      jsonb_build_object('value', null, 'state', 'partial', 'reason', 'zero_not_confirmed')
    else
      jsonb_build_object('value', p_agg -> 'value', 'state', 'ok', 'reason', null)
  end;
$$;

-- Calculul unei metrici. Intrare:
-- {
--   "definition": { rândul din metric_definitions },
--   "brand_id": "...", "as_of_date": "YYYY-MM-DD" (ziua curentă în Europe/Bucharest),
--   "period": {"start", "end", "kind": "custom" | "week" | "month" | "year" | "mtd" | "ytd"},
--   "connection": {"connected": bool, "query_ok": bool},
--   "current":    {"observations": [...], "confirmed_days": int, "data_as_of": date},
--   "comparison": {"observations": [...], "confirmed_days": int, "data_as_of": date} | null
-- }
-- Ieșire: {"metric_key", "metric_definition_version", "source", "metric": {contract}, "warnings": [...]}
create function metrics.compute(p_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_def jsonb := p_input -> 'definition';
  v_key text := v_def ->> 'metric_key';
  v_version integer := (v_def ->> 'version')::integer;
  v_unit text := v_def ->> 'unit';
  v_aggregation text := v_def ->> 'aggregation';
  v_grace integer := coalesce((v_def ->> 'freshness_grace_days')::integer, 0);
  v_min_sample numeric := (v_def ->> 'min_sample')::numeric;
  v_start date := (p_input -> 'period' ->> 'start')::date;
  v_end date := (p_input -> 'period' ->> 'end')::date;
  v_kind text := coalesce(p_input -> 'period' ->> 'kind', 'custom');
  v_as_of date := (p_input ->> 'as_of_date')::date;
  v_connected boolean := coalesce((p_input -> 'connection' ->> 'connected')::boolean, false);
  v_query_ok boolean := coalesce((p_input -> 'connection' ->> 'query_ok')::boolean, false);
  v_cur jsonb := coalesce(p_input -> 'current', '{}'::jsonb);
  v_cmp jsonb := p_input -> 'comparison';
  v_cmp_period jsonb;
  v_days integer;
  v_cmp_days integer;
  v_coverage numeric;
  v_cmp_coverage numeric;
  v_data_as_of date := (v_cur ->> 'data_as_of')::date;
  v_agg jsonb;
  v_cmp_agg jsonb;
  v_resolved jsonb;
  v_cmp_resolved jsonb;
  v_value numeric;
  v_comparison numeric;
  v_change jsonb;
  v_conditions text[] := '{}';
  v_status text;
  v_warnings jsonb := '[]'::jsonb;
  v_reason text;
  v_expected date;
  v_evidence jsonb;
  v_condition text;
begin
  if v_key is null or v_version is null or v_aggregation is null then
    raise exception 'Definiție incompletă' using errcode = '22023';
  end if;
  if v_as_of is null then
    raise exception 'Lipsește as_of_date' using errcode = '22023';
  end if;

  v_cmp_period := metrics.comparison_period(v_start, v_end, v_kind);
  v_days := v_end - v_start + 1;
  v_cmp_days := (v_cmp_period ->> 'end')::date - (v_cmp_period ->> 'start')::date + 1;
  v_evidence := jsonb_build_object(
    'metric_key', v_key,
    'version', v_version,
    'brand_id', p_input ->> 'brand_id',
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'comparison_period', v_cmp_period
  );

  -- Informații care însoțesc orice răspuns.
  if (v_def ->> 'lifecycle') = 'draft' then
    v_warnings := v_warnings || jsonb_build_object('metric_key', v_key, 'code', 'definition_draft',
      'severity', 'info', 'detail', v_def ->> 'lifecycle_note');
  end if;
  if v_def ->> 'aggregation_label' is not null then
    v_warnings := v_warnings || jsonb_build_object('metric_key', v_key, 'code', 'aggregation_label',
      'severity', 'info', 'detail', v_def ->> 'aggregation_label');
  end if;
  if metrics.is_incomplete_period(v_end, v_kind, v_as_of) then
    v_warnings := v_warnings || jsonb_build_object('metric_key', v_key, 'code', 'incomplete_period',
      'severity', 'info', 'detail', 'perioadă incompletă');
  end if;

  -- 1. Fără conexiune sau acces.
  if not v_connected then
    return jsonb_build_object(
      'metric_key', v_key, 'metric_definition_version', v_version, 'source', v_def ->> 'primary_source',
      'metric', jsonb_build_object(
        'value', null, 'unit', v_unit, 'numerator', null, 'denominator', null,
        'comparison_value', null, 'absolute_change', null, 'relative_change', null,
        'status', 'not_connected', 'data_as_of', null, 'coverage', null, 'evidence_query', v_evidence),
      'warnings', v_warnings);
  end if;

  -- 2. Interogare eșuată: eroare tehnică, nu zero.
  if not v_query_ok then
    return jsonb_build_object(
      'metric_key', v_key, 'metric_definition_version', v_version, 'source', v_def ->> 'primary_source',
      'metric', jsonb_build_object(
        'value', null, 'unit', v_unit, 'numerator', null, 'denominator', null,
        'comparison_value', null, 'absolute_change', null, 'relative_change', null,
        'status', 'unavailable', 'data_as_of', v_data_as_of, 'coverage', null, 'evidence_query', v_evidence),
      'warnings', v_warnings || jsonb_build_object('metric_key', v_key, 'code', 'query_failed',
        'severity', 'warning', 'detail', null));
  end if;

  v_agg := metrics.aggregate(v_def, v_cur -> 'observations', v_start, v_end);
  v_coverage := case
    when v_aggregation in ('last_observation', 'interval_report_only') then
      case when (v_agg ->> 'has_value')::boolean then 1 else 0 end
    else round(least(greatest(coalesce((v_cur ->> 'confirmed_days')::numeric, 0), 0), v_days) / v_days, 4)
  end;
  v_resolved := metrics.resolve_value(v_aggregation, v_agg, v_coverage);
  v_value := (v_resolved ->> 'value')::numeric;
  v_reason := v_resolved ->> 'reason';

  if v_reason is not null then
    v_warnings := v_warnings || jsonb_build_object('metric_key', v_key, 'code', v_reason,
      'severity', 'warning', 'detail', null);
  end if;
  if v_agg -> 'excluded' <> '{}'::jsonb then
    v_warnings := v_warnings || (
      select coalesce(jsonb_agg(jsonb_build_object('metric_key', v_key, 'code', 'excluded_rows', 'severity', 'warning',
        'detail', jsonb_build_object('reason', e.key, 'count', e.value::integer)) order by e.key), '[]'::jsonb)
      from jsonb_each_text(v_agg -> 'excluded') as e
    );
  end if;

  -- Condiții, în ordinea gravității (spec + decizia din 7 oct 2026).
  if (v_resolved ->> 'state') = 'unavailable' then
    v_conditions := v_conditions || 'unavailable'::text;
  end if;
  if (v_resolved ->> 'state') = 'cannot_compute' then
    v_conditions := v_conditions || 'cannot_compute'::text;
  end if;
  if v_min_sample is not null and coalesce((v_agg ->> 'n')::numeric, 0) < v_min_sample then
    v_conditions := v_conditions || 'insufficient_sample'::text;
  end if;
  v_expected := least(v_end, v_as_of - 1) - v_grace;
  if v_data_as_of is null or v_data_as_of < v_expected then
    v_conditions := v_conditions || 'stale'::text;
  end if;
  if v_coverage < 1 or v_agg -> 'excluded' <> '{}'::jsonb or (v_resolved ->> 'state') = 'partial' then
    v_conditions := v_conditions || 'partial'::text;
  end if;

  -- Comparația: aceeași definiție, perioada de comparație.
  if v_cmp is not null and jsonb_typeof(v_cmp) = 'object' then
    v_cmp_agg := metrics.aggregate(v_def, v_cmp -> 'observations',
      (v_cmp_period ->> 'start')::date, (v_cmp_period ->> 'end')::date);
    v_cmp_coverage := case
      when v_aggregation in ('last_observation', 'interval_report_only') then
        case when (v_cmp_agg ->> 'has_value')::boolean then 1 else 0 end
      else round(least(greatest(coalesce((v_cmp ->> 'confirmed_days')::numeric, 0), 0), v_cmp_days) / v_cmp_days, 4)
    end;
    v_cmp_resolved := metrics.resolve_value(v_aggregation, v_cmp_agg, v_cmp_coverage);
    v_comparison := (v_cmp_resolved ->> 'value')::numeric;
    if v_comparison is null then
      v_warnings := v_warnings || jsonb_build_object('metric_key', v_key, 'code', 'comparison_unavailable',
        'severity', 'warning', 'detail', v_cmp_resolved ->> 'reason');
    elsif v_cmp_coverage < 1 then
      v_warnings := v_warnings || jsonb_build_object('metric_key', v_key, 'code', 'comparison_partial',
        'severity', 'warning', 'detail', jsonb_build_object('coverage', v_cmp_coverage));
    end if;
  end if;

  v_change := metrics.change(v_value, v_comparison, v_unit);
  if (v_change ->> 'base_zero')::boolean then
    v_conditions := v_conditions || 'base_zero'::text;
  end if;

  v_status := coalesce(v_conditions[1], 'ok');
  -- Condițiile secundare ajung în warnings, cu metric_key.
  foreach v_condition in array coalesce(v_conditions[2:], '{}'::text[]) loop
    v_warnings := v_warnings || jsonb_build_object('metric_key', v_key, 'code', v_condition,
      'severity', 'warning', 'detail', null);
  end loop;

  return jsonb_build_object(
    'metric_key', v_key,
    'metric_definition_version', v_version,
    'source', v_def ->> 'primary_source',
    'metric', jsonb_build_object(
      'value', v_value,
      'unit', v_unit,
      'numerator', case when v_status in ('unavailable') then null else v_agg -> 'numerator' end,
      'denominator', case when v_status in ('unavailable') then null else v_agg -> 'denominator' end,
      'comparison_value', v_comparison,
      'absolute_change', v_change -> 'absolute_change',
      'relative_change', v_change -> 'relative_change',
      'status', v_status,
      'data_as_of', v_data_as_of,
      'coverage', v_coverage,
      'evidence_query', v_evidence
    ),
    'warnings', v_warnings
  );
end;
$$;

-- Anvelopa răspunsului (spec cap. 26): data + meta. tenant_id vine rezolvat de server (RPC-ul care apelează).
-- meta.data_as_of = cea mai veche dată dintre metrici; meta.coverage = cea mai mică acoperire.
-- Fiecare metrică își păstrează propriile data_as_of și coverage (decizia din 7 oct 2026).
create function metrics.build_response(p_context jsonb, p_items jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(jsonb_build_object('metric_key', i ->> 'metric_key') || (i -> 'metric')
                                       order by ord)
                      from jsonb_array_elements(p_items) with ordinality as t (i, ord)), '[]'::jsonb),
    'meta', jsonb_build_object(
      'tenant_id', p_context ->> 'tenant_id',
      'brand_id', p_context ->> 'brand_id',
      'period', p_context -> 'period',
      'comparison_period', p_context -> 'comparison_period',
      'data_as_of', (select min((i -> 'metric' ->> 'data_as_of')::date) from jsonb_array_elements(p_items) i),
      'generated_at', now(),
      'sources', coalesce((select jsonb_agg(distinct i ->> 'source') from jsonb_array_elements(p_items) i), '[]'::jsonb),
      'coverage', (select min((i -> 'metric' ->> 'coverage')::numeric) from jsonb_array_elements(p_items) i),
      'cohort_version', p_context -> 'cohort_version',
      'metric_definition_version', coalesce((select jsonb_object_agg(i ->> 'metric_key', (i ->> 'metric_definition_version')::integer)
                                             from jsonb_array_elements(p_items) i), '{}'::jsonb),
      'warnings', coalesce((select jsonb_agg(w) from jsonb_array_elements(p_items) i,
                                                   jsonb_array_elements(i -> 'warnings') w), '[]'::jsonb)
    )
  );
$$;

revoke all on all functions in schema metrics from public, anon;
grant execute on all functions in schema metrics to authenticated, service_role;

-- Definițiile de nivel A (date de referință ale produsului, nu date demo). Sursa umană: docs/metrics/registry.md
insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('ga4_sessions', 1, 'Sesiuni', 'Numărul de sesiuni GA4 în perioadă; suma zilelor.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-10-01', 'docs/metrics/registry.md#ga4_sessions'),
  ('ga4_active_users', 1, 'Utilizatori activi', 'Utilizatori activi GA4 din raportul pe intervalul întreg; zilele nu se însumează. Fără raport pe interval, valoarea e indisponibilă.', 'count', 'ga4', 'interval_report_only', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-10-01', 'docs/metrics/registry.md#ga4_active_users'),
  ('ga4_engaged_sessions', 1, 'Sesiuni cu implicare', 'Numărul de sesiuni GA4 cu implicare (engaged sessions); suma zilelor.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-10-01', 'docs/metrics/registry.md#ga4_engaged_sessions'),
  ('ga4_key_events', 1, 'Key events', 'Numărul de key events GA4 în perioadă; suma zilelor. Separat de conversiile platformelor de ads.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-10-01', 'docs/metrics/registry.md#ga4_key_events'),
  ('gsc_clicks', 1, 'Clicks (Search Console)', 'Clicks din rezultatele Google Search; suma zilelor.', 'count', 'gsc', 'sum', 1, null,
   null, 'higher_is_better', null, 3, 'active', null, '2026-10-01', 'docs/metrics/registry.md#gsc_clicks'),
  ('gsc_impressions', 1, 'Impressions (Search Console)', 'Afișări în rezultatele Google Search; suma zilelor.', 'count', 'gsc', 'sum', 1, null,
   null, 'higher_is_better', null, 3, 'active', null, '2026-10-01', 'docs/metrics/registry.md#gsc_impressions'),
  ('gsc_ctr', 1, 'CTR (Search Console)', '100 × clicks / impressions, recalculat din totalurile perioadei, nu media ratelor zilnice.', 'percent', 'gsc', 'ratio', 100, null,
   null, 'higher_is_better', null, 3, 'active', null, '2026-10-01', 'docs/metrics/registry.md#gsc_ctr'),
  ('gsc_average_position', 1, 'Poziție medie (Search Console)', 'Poziția medie GSC, ponderată cu impressions. Nu este rankul SEOmonitor.', 'position', 'gsc', 'weighted_mean', 1, 'impressions',
   null, 'lower_is_better', null, 3, 'active', null, '2026-10-01', 'docs/metrics/registry.md#gsc_average_position'),
  ('seomonitor_visibility', 1, 'Visibility SEOmonitor (medie în perioadă)', 'Visibility raportată de SEOmonitor, medie în perioadă ponderată cu zilele acoperite de fiecare observație; nu se însumează.', 'score', 'seomonitor', 'weighted_mean', 1, 'days_covered',
   'medie în perioadă', 'higher_is_better', null, 7, 'draft', 'Unitatea (procent sau scor) se confirmă pe payloadul SEOmonitor.', '2026-10-01', 'docs/metrics/registry.md#seomonitor_visibility'),
  ('seomonitor_visibility_latest', 1, 'Visibility SEOmonitor (ultima observație)', 'Ultima valoare de visibility raportată de SEOmonitor până la sfârșitul perioadei.', 'score', 'seomonitor', 'last_observation', 1, null,
   'ultima observație', 'higher_is_better', null, 7, 'draft', 'Unitatea (procent sau scor) se confirmă pe payloadul SEOmonitor.', '2026-10-01', 'docs/metrics/registry.md#seomonitor_visibility_latest'),
  ('seomonitor_keywords_top3', 1, 'Keywords în Top 3', 'Numărul de keywords urmărite cu rank 1–3 la ultima observație din perioadă. Keywords fără rank nu primesc o poziție artificială.', 'count', 'seomonitor', 'last_observation', 1, null,
   'ultima observație', 'higher_is_better', null, 7, 'active', null, '2026-10-01', 'docs/metrics/registry.md#seomonitor_keywords_top3'),
  ('seomonitor_keywords_top10', 1, 'Keywords în Top 10', 'Numărul de keywords urmărite cu rank 1–10 la ultima observație din perioadă. Keywords fără rank nu primesc o poziție artificială.', 'count', 'seomonitor', 'last_observation', 1, null,
   'ultima observație', 'higher_is_better', null, 7, 'active', null, '2026-10-01', 'docs/metrics/registry.md#seomonitor_keywords_top10'),
  ('clarity_rage_click_sessions', 1, 'Sesiuni cu rage clicks', 'Sesiunile Clarity cu rage clicks; suma zilelor.', 'count', 'clarity', 'sum', 1, null,
   null, 'lower_is_better', null, 1, 'draft', 'Forma payloadului Clarity (număr sau procent) se confirmă pe fixtures reale.', '2026-10-01', 'docs/metrics/registry.md#clarity_rage_click_sessions'),
  ('clarity_dead_click_sessions', 1, 'Sesiuni cu dead clicks', 'Sesiunile Clarity cu dead clicks; suma zilelor.', 'count', 'clarity', 'sum', 1, null,
   null, 'lower_is_better', null, 1, 'draft', 'Forma payloadului Clarity (număr sau procent) se confirmă pe fixtures reale.', '2026-10-01', 'docs/metrics/registry.md#clarity_dead_click_sessions'),
  ('clarity_quickback_sessions', 1, 'Sesiuni cu quick backs', 'Sesiunile Clarity cu quick backs; suma zilelor.', 'count', 'clarity', 'sum', 1, null,
   null, 'lower_is_better', null, 1, 'draft', 'Forma payloadului Clarity (număr sau procent) se confirmă pe fixtures reale.', '2026-10-01', 'docs/metrics/registry.md#clarity_quickback_sessions'),
  ('clarity_scroll_depth', 1, 'Scroll depth mediu', 'Scroll depth Clarity, medie ponderată cu sesiunile fiecărei zile.', 'percent', 'clarity', 'weighted_mean', 1, 'sessions',
   null, 'higher_is_better', null, 1, 'draft', 'Forma payloadului Clarity (număr sau procent) se confirmă pe fixtures reale.', '2026-10-01', 'docs/metrics/registry.md#clarity_scroll_depth');
