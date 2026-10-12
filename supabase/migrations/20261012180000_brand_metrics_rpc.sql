-- Metricile pentru ecranele de brand (decizia D-11, 12 oct 2026): poarta RPC dintre UI și calculul din SQL.
--
-- Formulele rămân în schema `metrics` (regula 4); UI-ul cere doar chei, perioadă și brand.
-- 1. private.brand_source_connected / brand_source_query_ok: SECURITY DEFINER, întorc doar boolean și răspund doar pentru
--    brandurile la care apelantul are acces (altfel false, fără oracol). Fără ele, un utilizator client n-ar vedea nicio
--    metrică: conexiunile și rulările sunt vizibile prin RLS doar agenției.
-- 2. private.compute_metric_snapshot folosește funcțiile de mai sus (restul corpului e neschimbat).
-- 3. public.brand_metrics și public.brand_metric_trends: SECURITY INVOKER, deci RLS-ul view-urilor de observații rămâne
--    autoritatea. Excepția E8 din docs/security-tests.md.

create function private.brand_source_connected(p_brand_id uuid, p_source text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_brand_access(p_brand_id) and exists (
    select 1 from public.brands b
    where b.id = p_brand_id
      and case
        when p_source in ('ga4', 'gsc', 'clarity') then exists (
          select 1 from public.source_connections c
          where c.tenant_id = b.tenant_id and c.brand_id = b.id and c.provider = p_source and c.status = 'active')
        when p_source = 'seomonitor' then exists (
          select 1 from public.source_connections c
          where c.tenant_id = b.tenant_id and c.provider = 'seomonitor' and c.status = 'active')
        else exists (
          select 1 from public.import_batches ib
          where ib.tenant_id = b.tenant_id and ib.brand_id = b.id and ib.source = p_source and ib.status = 'imported')
        or exists (
          select 1 from public.sync_runs r
          where r.tenant_id = b.tenant_id and r.brand_id = b.id and r.source = p_source and r.status in ('succeeded', 'partial'))
      end
  );
$$;

create function private.brand_source_query_ok(p_brand_id uuid, p_source text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_brand_access(p_brand_id) and coalesce((
    select s.status <> 'failed' from public.sync_runs s
    join public.brands b on b.id = s.brand_id and b.tenant_id = s.tenant_id
    where s.brand_id = p_brand_id and s.source = p_source
    order by s.created_at desc limit 1), true);
$$;

revoke all on function private.brand_source_connected(uuid, text) from public, anon;
revoke all on function private.brand_source_query_ok(uuid, text) from public, anon;
grant execute on function private.brand_source_connected(uuid, text) to authenticated, service_role;
grant execute on function private.brand_source_query_ok(uuid, text) to authenticated, service_role;

create or replace function private.compute_metric_snapshot(
  p_tenant_id uuid, p_brand_id uuid, p_metric_key text, p_start date, p_end date, p_kind text, p_options jsonb
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_def        jsonb;
  v_source     text;
  v_agg        text;
  v_view       text;
  v_device     text := p_options ->> 'device';
  v_connected  boolean;
  v_query_ok   boolean;
  v_cmp        jsonb;
  v_cur_obs    jsonb;
  v_cmp_obs    jsonb;
  v_cur_days   integer;
  v_cmp_days   integer;
  v_cur_asof   date;
  v_cmp_asof   date;
  v_as_of      date := (now() at time zone 'Europe/Bucharest')::date;
begin
  select to_jsonb(d) into v_def from public.metric_definitions_current d where d.metric_key = p_metric_key;
  if v_def is null then
    raise exception 'Metrică necunoscută sau retrasă: %', p_metric_key using errcode = '22023';
  end if;
  v_source := v_def ->> 'primary_source';
  v_agg := v_def ->> 'aggregation';

  v_view := case
    when p_metric_key = 'ga4_active_users' then 'web_active_users_observations'
    when p_metric_key like 'ga4\_%' then 'web_metric_observations'
    when p_metric_key like 'gsc\_%' then 'search_metric_observations'
    when p_metric_key like 'clarity\_%' then 'clarity_metric_observations'
    when p_metric_key like 'seomonitor\_%' then 'seomonitor_metric_observations'
    when p_metric_key ~ '^(google|meta|tiktok)_ads_' then 'paid_metric_observations'
    when p_metric_key = 'mentions_count' then 'mentions_metric_observations'
  end;
  if v_view is null then
    raise exception 'Metrica % nu are încă o sursă de observații pentru analize', p_metric_key using errcode = '22023';
  end if;
  if p_metric_key like 'seomonitor\_%' and coalesce(v_device, '') not in ('desktop', 'mobile') then
    raise exception 'Metrica % cere opțiunea device (desktop sau mobile)', p_metric_key using errcode = '22023';
  end if;

  v_cmp := metrics.comparison_period(p_start, p_end, p_kind);

  -- Conexiunea și ultima rulare, prin funcțiile booleene de mai jos: răspund și pentru utilizatorii client, care nu văd
  -- source_connections sau sync_runs (RLS doar pentru agenție), dar numai pentru brandurile la care au acces (D-11).
  v_connected := private.brand_source_connected(p_brand_id, v_source);
  v_query_ok := private.brand_source_query_ok(p_brand_id, v_source);

  select o.obs, o.days, o.as_of into v_cur_obs, v_cur_days, v_cur_asof
  from private.metric_observations(v_view, v_agg, p_tenant_id, p_brand_id, p_metric_key, p_start, p_end, v_device) o;
  select o.obs, o.days, o.as_of into v_cmp_obs, v_cmp_days, v_cmp_asof
  from private.metric_observations(v_view, v_agg, p_tenant_id, p_brand_id, p_metric_key,
                                   (v_cmp ->> 'start')::date, (v_cmp ->> 'end')::date, v_device) o;

  return metrics.compute(jsonb_build_object(
    'definition', v_def,
    'brand_id', p_brand_id,
    'as_of_date', v_as_of,
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'kind', p_kind),
    'connection', jsonb_build_object('connected', v_connected, 'query_ok', v_query_ok),
    'current', jsonb_build_object('observations', v_cur_obs, 'confirmed_days', v_cur_days, 'data_as_of', v_cur_asof),
    'comparison', jsonb_build_object('observations', v_cmp_obs, 'confirmed_days', v_cmp_days, 'data_as_of', v_cmp_asof)
  ));
end;
$$;

-- Calculul și observațiile rulează cu drepturile apelantului (INVOKER): RLS-ul view-urilor filtrează datele.
grant execute on function private.compute_metric_snapshot(uuid, uuid, text, date, date, text, jsonb) to authenticated;
grant execute on function private.metric_observations(text, text, uuid, uuid, text, date, date, text) to authenticated;

-- Poarta pentru metrici: același răspuns {data, meta} ca metrics.build_response (docs/contracts/metric-response.md).
create function public.brand_metrics(
  p_brand_id uuid, p_metric_keys text[], p_start date, p_end date, p_kind text default 'custom', p_device text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_key     text;
  v_items   jsonb := '[]'::jsonb;
  v_item    jsonb;
  v_device  text := case when p_device in ('desktop', 'mobile') then p_device end;
  v_cmp     jsonb;
begin
  -- Același răspuns pentru brand inexistent, brand străin și sesiune lipsă (fără oracol).
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_metric_keys is null or cardinality(p_metric_keys) = 0 or cardinality(p_metric_keys) > 40 then
    raise exception 'Între 1 și 40 de metrici per cerere' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if coalesce(p_kind, '') not in ('custom', 'mtd') then
    raise exception 'Tip de perioadă necunoscut: %', p_kind using errcode = '22023';
  end if;
  select b.tenant_id into v_tenant from public.brands b where b.id = p_brand_id;
  v_cmp := metrics.comparison_period(p_start, p_end, p_kind);

  foreach v_key in array p_metric_keys loop
    begin
      v_item := private.compute_metric_snapshot(v_tenant, p_brand_id, v_key, p_start, p_end, p_kind,
        -- SEOmonitor are rankuri pe device; fără device ales, se raportează desktop (convenția ecranului SEO).
        jsonb_build_object('device', case when v_key like 'seomonitor\_%' then coalesce(v_device, 'desktop') end));
    exception when sqlstate '22023' then
      -- Metrică fără definiție sau fără sursă de observații: „Sursă neconectată”, nu o valoare inventată.
      v_item := jsonb_build_object(
        'metric_key', v_key, 'metric_definition_version', 0, 'source', null,
        'metric', jsonb_build_object(
          'value', null, 'unit', 'count', 'currency', null, 'numerator', null, 'denominator', null,
          'comparison_value', null, 'absolute_change', null, 'relative_change', null, 'status', 'not_connected',
          'data_as_of', null, 'coverage', null,
          'evidence_query', jsonb_build_object('metric_key', v_key, 'version', 0, 'brand_id', p_brand_id,
            'period', jsonb_build_object('start', p_start, 'end', p_end), 'comparison_period', v_cmp)),
        'warnings', jsonb_build_array(jsonb_build_object('metric_key', v_key, 'code', 'no_observation_source', 'severity', 'warning', 'detail', null)));
    end;
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  return metrics.build_response(
    jsonb_build_object('tenant_id', v_tenant, 'brand_id', p_brand_id,
      'period', jsonb_build_object('start', p_start, 'end', p_end, 'kind', p_kind),
      'comparison_period', v_cmp, 'cohort_version', null),
    v_items);
end;
$$;

-- Seria zilnică a fiecărei metrici: aceeași agregare din registru, aplicată pe fiecare zi. Zilele fără observații sunt
-- null (nu 0). Metricile pe interval (utilizatori activi) nu au serie zilnică: status `unavailable`.
create function public.brand_metric_trends(
  p_brand_id uuid, p_metric_keys text[], p_start date, p_end date, p_device text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_key    text;
  v_def    jsonb;
  v_view   text;
  v_obs    jsonb;
  v_points jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_device text := case when p_device in ('desktop', 'mobile') then p_device end;
  v_status text;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_metric_keys is null or cardinality(p_metric_keys) = 0 or cardinality(p_metric_keys) > 20 then
    raise exception 'Între 1 și 20 de metrici per cerere' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  select b.tenant_id into v_tenant from public.brands b where b.id = p_brand_id;

  foreach v_key in array p_metric_keys loop
    select to_jsonb(d) into v_def from public.metric_definitions_current d where d.metric_key = v_key;
    v_view := case
      when v_key = 'ga4_active_users' then null
      when v_key like 'ga4\_%' then 'web_metric_observations'
      when v_key like 'gsc\_%' then 'search_metric_observations'
      when v_key like 'clarity\_%' then 'clarity_metric_observations'
      when v_key like 'seomonitor\_%' then 'seomonitor_metric_observations'
      when v_key ~ '^(google|meta|tiktok)_ads_' then 'paid_metric_observations'
      when v_key = 'mentions_count' then 'mentions_metric_observations'
    end;
    if v_def is null or v_view is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('metric_key', v_key, 'label', coalesce(v_def ->> 'name_ro', v_key),
        'unit', coalesce(v_def ->> 'unit', 'count'), 'points', '[]'::jsonb, 'comparison_points', null,
        'status', case when v_def is null then 'not_connected' else 'unavailable' end));
      continue;
    end if;
    if not private.brand_source_connected(p_brand_id, v_def ->> 'primary_source') then
      v_out := v_out || jsonb_build_array(jsonb_build_object('metric_key', v_key, 'label', v_def ->> 'name_ro', 'unit', v_def ->> 'unit',
        'points', '[]'::jsonb, 'comparison_points', null, 'status', 'not_connected'));
      continue;
    end if;

    select o.obs into v_obs
    from private.metric_observations(v_view, v_def ->> 'aggregation', v_tenant, p_brand_id, v_key, p_start, p_end,
      case when v_key like 'seomonitor\_%' then coalesce(v_device, 'desktop') end) o;

    select coalesce(jsonb_agg(jsonb_build_object('date', d.day,
             'value', case when day_obs.obs is null then null
                           else metrics.resolve_value(v_def ->> 'aggregation', metrics.aggregate(v_def, day_obs.obs, d.day, d.day), 1) -> 'value' end)
           order by d.day), '[]'::jsonb)
      into v_points
    from generate_series(p_start, p_end, interval '1 day') as g (ts)
    cross join lateral (select g.ts::date as day) d
    left join lateral (
      select jsonb_agg(e) as obs from jsonb_array_elements(coalesce(v_obs, '[]'::jsonb)) e where (e ->> 'date')::date = d.day
    ) day_obs on true;

    v_status := case when private.brand_source_query_ok(p_brand_id, v_def ->> 'primary_source') then
                  case when exists (select 1 from jsonb_array_elements(v_points) p where p -> 'value' <> 'null'::jsonb) then 'ok' else 'unavailable' end
                else 'unavailable' end;
    v_out := v_out || jsonb_build_array(jsonb_build_object('metric_key', v_key, 'label', v_def ->> 'name_ro', 'unit', v_def ->> 'unit',
      'points', v_points, 'comparison_points', null, 'status', v_status));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.brand_metrics(uuid, text[], date, date, text, text) from public, anon;
revoke all on function public.brand_metric_trends(uuid, text[], date, date, text) from public, anon;
grant execute on function public.brand_metrics(uuid, text[], date, date, text, text) to authenticated, service_role;
grant execute on function public.brand_metric_trends(uuid, text[], date, date, text) to authenticated, service_role;
