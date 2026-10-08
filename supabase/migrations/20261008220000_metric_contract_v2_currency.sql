-- Contractul MetricResponse, versiunea 2: unitatea `currency` și câmpul `currency` (cod ISO 4217; null pentru unitățile nemonetare).
-- Contract: docs/contracts/metric-response.md. Moneda vine din lotul de import (paid_daily.currency) prin observații.
--
-- - metric_definitions.unit acceptă `currency`;
-- - costul, CPC și CPA (cele trei platforme) primesc versiunea 2: unit = currency, active (versiunile 1 rămân, imutabile, ca istoric);
-- - metrics.compute emite `currency`; monede diferite în perioadă → `unavailable` (mixed_currency); valoare fără monedă →
--   `unavailable` (currency_missing); comparația în altă monedă se ignoră (comparison_currency_mismatch);
-- - private.metric_observations (instantaneul de la publicare) include moneda observațiilor paid.

alter table public.metric_definitions drop constraint metric_definitions_unit_check;
alter table public.metric_definitions add constraint metric_definitions_unit_check
  check (unit in ('count', 'percent', 'seconds', 'position', 'score', 'currency'));

create or replace function metrics.compute(p_input jsonb)
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
  v_currency text;
  v_cur_currencies text[] := '{}';
  v_cmp_currencies text[];
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
        'value', null, 'unit', v_unit, 'currency', null, 'numerator', null, 'denominator', null,
        'comparison_value', null, 'absolute_change', null, 'relative_change', null,
        'status', 'not_connected', 'data_as_of', null, 'coverage', null, 'evidence_query', v_evidence),
      'warnings', v_warnings);
  end if;

  -- 2. Interogare eșuată: eroare tehnică, nu zero.
  if not v_query_ok then
    return jsonb_build_object(
      'metric_key', v_key, 'metric_definition_version', v_version, 'source', v_def ->> 'primary_source',
      'metric', jsonb_build_object(
        'value', null, 'unit', v_unit, 'currency', null, 'numerator', null, 'denominator', null,
        'comparison_value', null, 'absolute_change', null, 'relative_change', null,
        'status', 'unavailable', 'data_as_of', v_data_as_of, 'coverage', null, 'evidence_query', v_evidence),
      'warnings', v_warnings || jsonb_build_object('metric_key', v_key, 'code', 'query_failed',
        'severity', 'warning', 'detail', null));
  end if;

  -- v2: moneda observațiilor (lotul de import). Monede diferite în aceeași perioadă nu se însumează.
  if v_unit = 'currency' then
    select coalesce(array_agg(distinct o ->> 'currency') filter (where o ->> 'currency' is not null), '{}'::text[])
      into v_cur_currencies
    from jsonb_array_elements(coalesce(v_cur -> 'observations', '[]'::jsonb)) o;
    if coalesce(array_length(v_cur_currencies, 1), 0) = 1 then
      v_currency := v_cur_currencies[1];
    elsif coalesce(array_length(v_cur_currencies, 1), 0) = 0 then
      v_currency := nullif(v_cur ->> 'currency', '');
    end if;
  end if;

  v_agg := metrics.aggregate(v_def, v_cur -> 'observations', v_start, v_end);
  v_coverage := case
    when v_aggregation in ('last_observation', 'interval_report_only') then
      case when (v_agg ->> 'has_value')::boolean then 1 else 0 end
    else round(least(greatest(coalesce((v_cur ->> 'confirmed_days')::numeric, 0), 0), v_days) / v_days, 4)
  end;
  v_resolved := metrics.resolve_value(v_aggregation, v_agg, v_coverage);
  if v_unit = 'currency' then
    if coalesce(array_length(v_cur_currencies, 1), 0) > 1 then
      v_resolved := jsonb_build_object('value', null, 'state', 'unavailable', 'reason', 'mixed_currency');
    elsif v_currency is null and (v_resolved ->> 'value') is not null then
      v_resolved := jsonb_build_object('value', null, 'state', 'unavailable', 'reason', 'currency_missing');
    end if;
  end if;
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
    if v_unit = 'currency' then
      select coalesce(array_agg(distinct o ->> 'currency') filter (where o ->> 'currency' is not null), '{}'::text[])
        into v_cmp_currencies
      from jsonb_array_elements(coalesce(v_cmp -> 'observations', '[]'::jsonb)) o;
      if coalesce(array_length(v_cmp_currencies, 1), 0) > 1
         or (coalesce(array_length(v_cmp_currencies, 1), 0) = 1 and v_cmp_currencies[1] is distinct from v_currency) then
        v_cmp_resolved := jsonb_build_object('value', null, 'state', 'unavailable', 'reason', 'comparison_currency_mismatch');
      end if;
    end if;
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
      'currency', case when v_unit = 'currency' then v_currency end,
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

create or replace function private.metric_observations(
  p_view text, p_agg text, p_tenant_id uuid, p_brand_id uuid, p_metric_key text, p_start date, p_end date, p_device text
) returns table (obs jsonb, days integer, as_of date)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_filter text := 'tenant_id = $1 and brand_id = $2 and metric_key = $3';
  v_device_filter text := case when p_device is null then '' else ' and device = $6' end;
begin
  if p_view not in ('web_metric_observations', 'web_active_users_observations', 'search_metric_observations',
                    'clarity_metric_observations', 'seomonitor_metric_observations', 'paid_metric_observations',
                    'mentions_metric_observations') then
    raise exception 'View de observații necunoscut: %', p_view using errcode = '22023';
  end if;

  if p_agg = 'interval_report_only' then
    return query execute format(
      $q$select coalesce(jsonb_agg(jsonb_build_object('start', start, 'end', "end", 'value', value)), '[]'::jsonb),
                coalesce(max(($5 - $4 + 1)) filter (where value is not null), 0)::integer,
                max("end") filter (where value is not null)
         from public.%I where %s and start = $4 and "end" = $5$q$, p_view, v_filter)
      using p_tenant_id, p_brand_id, p_metric_key, p_start, p_end, p_device;
    return;
  end if;

  return query execute format(
    $q$select coalesce(jsonb_agg(jsonb_build_object('date', date, %s) order by date), '[]'::jsonb),
              count(distinct date) filter (where %s)::integer,
              max(date) filter (where %s)
       from public.%I where %s and date between $4 and $5%s$q$,
    (case p_agg
      when 'ratio' then $s$'numerator', numerator, 'denominator', denominator$s$
      when 'weighted_mean' then $s$'value', value, 'weight', weight$s$
      else $s$'value', value$s$ end)
    || (case when p_view = 'paid_metric_observations' then $s$, 'currency', currency$s$ else '' end),
    case p_agg when 'ratio' then 'numerator is not null and denominator is not null' else 'value is not null' end,
    case p_agg when 'ratio' then 'numerator is not null and denominator is not null' else 'value is not null' end,
    p_view, v_filter, v_device_filter)
    using p_tenant_id, p_brand_id, p_metric_key, p_start, p_end, p_device;
end;
$$;

insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('google_ads_spend', 2, 'Cost Google Ads', 'Costul Google Ads în perioadă, în moneda lotului de import (unit = currency; câmpul currency poartă codul ISO 4217); suma zilelor. Monede diferite în aceeași perioadă nu se însumează: metrica devine indisponibilă (mixed_currency).', 'currency', 'google_ads', 'sum', 1, null,
   null, 'neutral', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#google_ads_spend'),
  ('google_ads_cpc', 2, 'CPC Google Ads', 'Cost / clicks pe totalurile perioadei (Google Ads), în moneda lotului (unit = currency); nu media ratelor zilnice.', 'currency', 'google_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#google_ads_cpc'),
  ('google_ads_cpa', 2, 'CPA Google Ads', 'Cost / conversii pe totalurile perioadei (Google Ads), pentru aceeași acțiune și configurație de atribuire, în moneda lotului (unit = currency).', 'currency', 'google_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#google_ads_cpa'),
  ('meta_ads_spend', 2, 'Cost Meta Ads', 'Costul Meta Ads în perioadă, în moneda lotului de import (unit = currency; câmpul currency poartă codul ISO 4217); suma zilelor. Monede diferite în aceeași perioadă nu se însumează: metrica devine indisponibilă (mixed_currency).', 'currency', 'meta_ads', 'sum', 1, null,
   null, 'neutral', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#meta_ads_spend'),
  ('meta_ads_cpc', 2, 'CPC Meta Ads', 'Cost / clicks pe totalurile perioadei (Meta Ads), în moneda lotului (unit = currency); nu media ratelor zilnice.', 'currency', 'meta_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#meta_ads_cpc'),
  ('meta_ads_cpa', 2, 'CPA Meta Ads', 'Cost / conversii pe totalurile perioadei (Meta Ads), pentru aceeași acțiune și configurație de atribuire, în moneda lotului (unit = currency).', 'currency', 'meta_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#meta_ads_cpa'),
  ('tiktok_ads_spend', 2, 'Cost TikTok Ads', 'Costul TikTok Ads în perioadă, în moneda lotului de import (unit = currency; câmpul currency poartă codul ISO 4217); suma zilelor. Monede diferite în aceeași perioadă nu se însumează: metrica devine indisponibilă (mixed_currency).', 'currency', 'tiktok_ads', 'sum', 1, null,
   null, 'neutral', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#tiktok_ads_spend'),
  ('tiktok_ads_cpc', 2, 'CPC TikTok Ads', 'Cost / clicks pe totalurile perioadei (TikTok Ads), în moneda lotului (unit = currency); nu media ratelor zilnice.', 'currency', 'tiktok_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#tiktok_ads_cpc'),
  ('tiktok_ads_cpa', 2, 'CPA TikTok Ads', 'Cost / conversii pe totalurile perioadei (TikTok Ads), pentru aceeași acțiune și configurație de atribuire, în moneda lotului (unit = currency).', 'currency', 'tiktok_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'active', null, '2026-10-08', 'docs/metrics/registry-b.md#tiktok_ads_cpa');
