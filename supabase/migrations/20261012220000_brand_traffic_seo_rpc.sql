-- Trafic și SEO pentru ecranele de brand (D-14). Toate SECURITY INVOKER (RLS pe tabelele sursă), formulele cu funcțiile din
-- `metrics`. Excepția E8 (aceleași condiții ca brand_metrics).

-- Canalele GA4 (web_daily, zilele simple). GA4 nu e colectat pe device: filtrul de device nu se poate aplica.
create function public.brand_traffic_channels(p_brand_id uuid, p_start date, p_end date, p_kind text default 'custom')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cmp jsonb;
  v_total numeric;
  v_out jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if not private.brand_source_connected(p_brand_id, 'ga4') then
    return jsonb_build_object('connected', false);
  end if;
  v_cmp := metrics.comparison_period(p_start, p_end, coalesce(p_kind, 'custom'));
  select sum(sessions) into v_total from public.web_daily where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'channel', c.channel, 'sessions', c.sessions,
      'share_pct', metrics.ratio(c.sessions, v_total, 100),
      'change_pct', metrics.change(c.sessions, p.sessions, 'count') -> 'relative_change',
      'engagement_rate', metrics.ratio(c.engaged, c.sessions, 100),
      'key_events', c.key_events) order by c.sessions desc nulls last, c.channel), '[]'::jsonb)
    into v_out
  from (
    select coalesce(nullif(channel_group, ''), '(neatribuit)') as channel, sum(sessions) as sessions, sum(engaged_sessions) as engaged,
           case when count(key_events) > 0 then sum(key_events) end as key_events
    from public.web_daily where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end
    group by 1
  ) c
  left join (
    select coalesce(nullif(channel_group, ''), '(neatribuit)') as channel, sum(sessions) as sessions
    from public.web_daily where brand_id = p_brand_id and window_days = 1
      and date between (v_cmp ->> 'start')::date and (v_cmp ->> 'end')::date
    group by 1
  ) p on p.channel = c.channel;

  return jsonb_build_object('connected', true, 'channels', v_out,
    'data_as_of', (select max(date) from public.web_daily where brand_id = p_brand_id and window_days = 1 and sessions is not null));
end;
$$;

-- Clarity pe device: aceleași definiții și agregări din registru ca metricile „Toate”, pe rândurile `dimension = device`.
create function public.brand_clarity_devices(p_brand_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days integer := p_end - p_start + 1;
  v_out jsonb := '[]'::jsonb;
  v_key text;
  v_def jsonb;
  v_col text;
  v_cells jsonb;
  v_dev text;
  v_obs jsonb;
  v_cov numeric;
  v_res jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if not private.brand_source_connected(p_brand_id, 'clarity') then
    return jsonb_build_object('connected', false);
  end if;

  foreach v_key in array array['clarity_rage_click_sessions', 'clarity_dead_click_sessions', 'clarity_quickback_sessions', 'clarity_scroll_depth'] loop
    select to_jsonb(d) into v_def from public.metric_definitions_current d where d.metric_key = v_key;
    v_col := case v_key when 'clarity_rage_click_sessions' then 'rage_click_count' when 'clarity_dead_click_sessions' then 'dead_click_count'
                        when 'clarity_quickback_sessions' then 'quickback_click' else 'scroll_depth' end;
    v_cells := '{}'::jsonb;
    foreach v_dev in array array['desktop', 'mobile', 'tablet'] loop
      -- Valorile Clarity pentru dimensiunea Device: PC / Desktop, Mobile, Tablet (de confirmat pe payload real).
      execute format(
        $q$select coalesce(jsonb_agg(jsonb_build_object('date', date, 'value', %1$I, 'weight', sessions) order by date) filter (where %1$I is not null), '[]'::jsonb),
                  count(distinct date) filter (where %1$I is not null)
           from public.clarity_daily
           where brand_id = $1 and dimension = 'device' and window_days = 1 and date between $2 and $3
             and case lower(dimension_value) when 'pc' then 'desktop' when 'desktop' then 'desktop' when 'mobile' then 'mobile' when 'tablet' then 'tablet' end = $4$q$,
        v_col)
        into v_obs, v_cov using p_brand_id, p_start, p_end, v_dev;
      v_res := case when v_def is null then jsonb_build_object('value', null, 'state', 'unavailable')
                    else metrics.resolve_value(v_def ->> 'aggregation', metrics.aggregate(v_def, v_obs, p_start, p_end), v_cov::numeric / v_days) end;
      v_cells := v_cells || jsonb_build_object(v_dev, jsonb_build_object('value', v_res -> 'value',
        'status', case when v_res ->> 'state' = 'ok' and v_cov < v_days then 'partial' else v_res ->> 'state' end));
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object('metric_key', v_key, 'cells', v_cells));
  end loop;
  return jsonb_build_object('connected', true, 'rows', v_out,
    'data_as_of', (select max(date) from public.clarity_daily where brand_id = p_brand_id and dimension = 'device' and window_days = 1));
end;
$$;

-- Keywords SEOmonitor: ultima poziție din perioadă pe fiecare device; variația pe mobil = poziția de la început minus cea de
-- la sfârșit (+ = poziții câștigate), doar când ambele există. Fără poziție = null, nu 100 (metrics.rank_summary).
create function public.brand_search_keywords(p_brand_id uuid, p_start date, p_end date, p_keyword_type text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if p_keyword_type is not null and p_keyword_type not in ('brand', 'nonbrand') then
    raise exception 'Tip de keyword necunoscut' using errcode = '22023';
  end if;
  if not private.brand_source_connected(p_brand_id, 'seomonitor') then
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object('connected', true, 'keywords', coalesce((
    with obs as (
      select keyword_id, device, date, rank, url from public.rank_observations
      where brand_id = p_brand_id and date between p_start and p_end and device in ('desktop', 'mobile')
    ),
    last_rank as (select distinct on (keyword_id, device) keyword_id, device, rank, url from obs order by keyword_id, device, date desc),
    first_mobile as (select distinct on (keyword_id) keyword_id, rank from obs where device = 'mobile' order by keyword_id, date asc),
    other_urls as (
      select distinct r.url from public.rank_observations r
      where r.brand_id <> p_brand_id and r.url is not null and r.date between p_start and p_end
    )
    select jsonb_agg(jsonb_build_object(
      'id', k.keyword_id, 'keyword', k.keyword, 'url', coalesce(lm.url, ld.url, ''),
      'volume', k.search_volume, 'volume_as_of', (k.collected_at at time zone 'Europe/Bucharest')::date,
      'rank_mobile', lm.rank, 'rank_desktop', ld.rank,
      'change_mobile', case when fm.rank is not null and lm.rank is not null then fm.rank - lm.rank end,
      'is_brand', coalesce(k.is_branded, false), 'competitor', null,
      'shared', coalesce(lm.url, ld.url) in (select url from other_urls))
      order by k.search_volume desc nulls last, k.keyword)
    from public.keywords k
    left join last_rank lm on lm.keyword_id = k.keyword_id and lm.device = 'mobile'
    left join last_rank ld on ld.keyword_id = k.keyword_id and ld.device = 'desktop'
    left join first_mobile fm on fm.keyword_id = k.keyword_id
    where k.brand_id = p_brand_id and k.status = 'active'
      and exists (select 1 from obs o where o.keyword_id = k.keyword_id)
      and (p_keyword_type is null or (p_keyword_type = 'brand') = coalesce(k.is_branded, false))
  ), '[]'::jsonb));
end;
$$;

-- Landing pages din Search Console (detaliile pe query × pagină; interogările anonimizate nu sunt incluse, deci sumele sunt
-- sub totalurile din search_daily). Poziția = media ponderată cu afișările. Key events: null până la validarea mapării
-- pagină GSC ↔ landing page GA4.
create function public.brand_landing_pages(p_brand_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if not private.brand_source_connected(p_brand_id, 'gsc') then
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object('connected', true, 'pages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'url', p.page, 'clicks', p.clicks, 'impressions', p.impressions,
      'ctr', metrics.ratio(p.clicks, p.impressions, 100),
      'position', metrics.ratio(p.weighted, p.weight_sum),
      'key_events', null,
      'shared', exists (select 1 from public.search_queries o where o.brand_id <> p_brand_id and o.page_md5 = p.page_md5 and o.date between p_start and p_end))
      order by p.clicks desc nulls last, p.page)
    from (
      select page, page_md5, sum(clicks) as clicks, sum(impressions) as impressions,
             sum(position * impressions) filter (where position is not null) as weighted,
             sum(impressions) filter (where position is not null) as weight_sum
      from public.search_queries
      where brand_id = p_brand_id and date between p_start and p_end
      group by page, page_md5
      order by sum(clicks) desc nulls last
      limit 500
    ) p
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.brand_traffic_channels(uuid, date, date, text) from public, anon;
revoke all on function public.brand_clarity_devices(uuid, date, date) from public, anon;
revoke all on function public.brand_search_keywords(uuid, date, date, text) from public, anon;
revoke all on function public.brand_landing_pages(uuid, date, date) from public, anon;
grant execute on function public.brand_traffic_channels(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.brand_clarity_devices(uuid, date, date) to authenticated, service_role;
grant execute on function public.brand_search_keywords(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.brand_landing_pages(uuid, date, date) to authenticated, service_role;
