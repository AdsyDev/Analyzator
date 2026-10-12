-- Metricile AI Visibility în registru (decizia D-15, 12 oct 2026), după spec cap. 10–11 și 13.
--
-- Definițiile (spec cap. 11): Mention Rate, Recommendation Rate, Owned Citation Rate, SoV în setul urmărit, răspunsuri
-- valide. Sursa: răspunsurile AI colectate de SEOmonitor (ai_answers, ai_citations, ai_brand_observations).
-- - Stările unui răspuns (spec 2.2): eroarea tehnică iese din numitor; refuzul valid intră în numitor, fără brand.
-- - Prag de eșantion 50 de răspunsuri valide (spec cap. 10); sub prag: `insufficient_sample`.
-- - Toate engine-urile urmărite, neponderat (spec: „nu ponderăm motoarele după cote de piață”).
-- - Recommendation Rate rămâne `draft` fără observații: SEOmonitor nu expune un semnal de recomandare explicită.
-- - Acoperirea: o zi e acoperită dacă a existat o colectare în ultimele 7 zile (ritm săptămânal, spec cap. 10).

insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('ai_mention_rate', 1, 'AI Mention Rate', '100 × răspunsuri valide cu brandul menționat / toate răspunsurile valide (refuzurile intră la numitor; erorile tehnice nu).', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'Forma răspunsurilor AI SEOmonitor e derivată din documentație; se confirmă la prima rulare reală.', '2026-10-12', 'docs/metrics/registry.md#ai_mention_rate'),
  ('ai_recommendation_rate', 1, 'AI Recommendation Rate', '100 × răspunsuri valide care recomandă explicit brandul / răspunsuri valide.', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'SEOmonitor nu expune un semnal de recomandare explicită; fără observații până la o sursă care îl dă.', '2026-10-12', 'docs/metrics/registry.md#ai_recommendation_rate'),
  ('ai_owned_citation_rate', 1, 'Owned Citation Rate', '100 × răspunsuri valide cu cel puțin o citare a domeniului propriu / răspunsuri valide.', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'Citare eligibilă = URL pe domeniul brandului (sau subdomeniu); se confirmă la prima rulare reală.', '2026-10-12', 'docs/metrics/registry.md#ai_owned_citation_rate'),
  ('ai_sov', 1, 'AI SoV în setul urmărit', '100 × prezențele brandului / suma prezențelor brandului și ale competitorilor din setul în vigoare, maximum una per brand și răspuns.', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'Prezențele competitorilor vin din competiția AI SEOmonitor; potrivirea pe domeniul din setul de competitori.', '2026-10-12', 'docs/metrics/registry.md#ai_sov'),
  ('ai_valid_answers', 1, 'Răspunsuri AI valide', 'Numărul de răspunsuri AI colectate fără eroare tehnică (inclusiv refuzurile valide); suma zilelor de colectare.', 'count', 'seomonitor', 'sum', 1, null,
   null, 'neutral', null, 7, 'draft', 'Ritm săptămânal: zilele dintre colectări sunt acoperite de colectarea din ultimele 7 zile.', '2026-10-12', 'docs/metrics/registry.md#ai_valid_answers');

-- Observațiile pe ziua colectării. RLS-ul tabelelor AI se aplică celui care citește (security_invoker).
create view public.ai_metric_observations
with (security_invoker = true) as
with answers as (
  select a.tenant_id, a.brand_id, a.crawl_at as date, a.engine, a.keyword_id, a.device, a.status,
         exists (select 1 from public.ai_citations c
                 where c.tenant_id = a.tenant_id and c.brand_id = a.brand_id and c.engine = a.engine and c.keyword_id = a.keyword_id
                   and c.crawl_at = a.crawl_at and c.device = a.device and c.is_own_domain) as owned_citation
  from public.ai_answers a
)
select tenant_id, brand_id, 'ai_mention_rate'::text as metric_key, date, null::numeric as value,
       count(*) filter (where status = 'brand_present')::numeric as numerator,
       count(*) filter (where status <> 'technical_error')::numeric as denominator
from answers group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'ai_owned_citation_rate', date, null,
       count(*) filter (where status <> 'technical_error' and owned_citation)::numeric,
       count(*) filter (where status <> 'technical_error')::numeric
from answers group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'ai_valid_answers', date, count(*) filter (where status <> 'technical_error')::numeric, null, null
from answers group by tenant_id, brand_id, date
union all
select o.tenant_id, o.brand_id, 'ai_sov', o.crawl_at, null,
       count(distinct (o.engine, o.keyword_id, o.device)) filter (where o.is_own_brand and o.present)::numeric,
       count(distinct (o.engine, o.keyword_id, o.device, o.observed_domain)) filter (where o.present and (o.is_own_brand or exists (
         select 1 from public.competitor_sets cs join public.competitor_set_members m on m.competitor_set_id = cs.id
         where cs.tenant_id = o.tenant_id and cs.brand_id = o.brand_id and m.domain = o.observed_domain
           and cs.effective_from = (select max(c2.effective_from) from public.competitor_sets c2
                                    where c2.tenant_id = o.tenant_id and c2.brand_id = o.brand_id and c2.effective_from <= o.crawl_at))))::numeric
from public.ai_brand_observations o
where o.status <> 'technical_error'
group by o.tenant_id, o.brand_id, o.crawl_at;

grant select on public.ai_metric_observations to authenticated;
comment on view public.ai_metric_observations is
  'Observațiile metricilor AI Visibility pe ziua colectării (D-15). Recommendation Rate nu are observații (fără semnal în sursă).';

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
                    'mentions_metric_observations', 'ai_metric_observations') then
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

  -- AI Visibility: un răspuns pe săptămână per întrebare și engine (spec cap. 10). O zi e acoperită dacă a existat o
  -- colectare validă în ultimele 7 zile; observațiile rămân în ziua colectării (sumele și ratele nu se schimbă).
  if p_view = 'ai_metric_observations' then
    return query execute format(
      $q$with o as (
           select date, numerator, denominator, value from public.ai_metric_observations where %s and date between $4 - 6 and $5
         )
         select coalesce((select jsonb_agg(jsonb_build_object('date', date, %s) order by date) from o where date between $4 and $5), '[]'::jsonb),
                (select count(*)::integer from generate_series($4, $5, interval '1 day') g (d)
                  where exists (select 1 from o where o.date between g.d::date - 6 and g.d::date and %s)),
                (select max(date) from o where date between $4 and $5 and %s)$q$,
      v_filter,
      case p_agg when 'ratio' then $s$'numerator', numerator, 'denominator', denominator$s$ else $s$'value', value$s$ end,
      case p_agg when 'ratio' then 'o.numerator is not null and o.denominator is not null' else 'o.value is not null' end,
      case p_agg when 'ratio' then 'numerator is not null and denominator is not null' else 'value is not null' end)
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
    when p_metric_key like 'ai\_%' then 'ai_metric_observations'
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

create or replace function public.brand_metric_trends(
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
      when v_key like 'ai\_%' then 'ai_metric_observations'
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
