-- Paid Media pentru ecranul de brand (D-12): KPI-uri, serie zilnică și rânduri pe zi, platformă și campanie, din paid_daily.
-- SECURITY INVOKER (RLS pe paid_daily); formulele (CTR, CPC, CPA, variații) folosesc funcțiile din `metrics` (regula 4).
-- Doar rândurile fără defalcare (`breakdown_signature = 'none'`) intră în totaluri. Monede diferite nu se adună: KPI-urile
-- monetare devin `unavailable`. Excepția E8 (aceleași condiții ca brand_metrics).

create function public.brand_paid(p_brand_id uuid, p_start date, p_end date, p_kind text default 'custom', p_platform text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_sources   text[];
  v_cmp       jsonb;
  v_cur       record;
  v_prev      record;
  v_currencies text[];
  v_currency  text;
  v_mixed     boolean;
  v_kpis      jsonb := '[]'::jsonb;
  v_rows      jsonb;
  v_series    jsonb;
  v_meta      record;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if coalesce(p_kind, '') not in ('custom', 'mtd') then
    raise exception 'Tip de perioadă necunoscut: %', p_kind using errcode = '22023';
  end if;
  if p_platform is not null and p_platform not in ('google_ads', 'meta_ads', 'tiktok_ads') then
    raise exception 'Platformă necunoscută: %', p_platform using errcode = '22023';
  end if;

  select coalesce(array_agg(s), '{}') into v_sources
  from unnest(case when p_platform is null then array['google_ads', 'meta_ads', 'tiktok_ads'] else array[p_platform] end) s
  where private.brand_source_connected(p_brand_id, s);
  if cardinality(v_sources) = 0 then
    return jsonb_build_object('connected', false);
  end if;

  v_cmp := metrics.comparison_period(p_start, p_end, p_kind);

  select coalesce(array_agg(distinct currency order by currency), '{}') into v_currencies
  from public.paid_daily
  where brand_id = p_brand_id and source = any (v_sources) and breakdown_signature = 'none' and date between p_start and p_end;
  v_mixed := cardinality(v_currencies) > 1;
  v_currency := case when cardinality(v_currencies) = 1 then v_currencies[1] end;

  select sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks, sum(conversions) as conversions,
         count(*) filter (where conversions is not null) as conv_rows, count(*) as n
    into v_cur
  from public.paid_daily
  where brand_id = p_brand_id and source = any (v_sources) and breakdown_signature = 'none' and date between p_start and p_end;
  select sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks, sum(conversions) as conversions,
         count(*) filter (where conversions is not null) as conv_rows, count(*) as n,
         count(distinct currency) as currencies, min(currency) as currency
    into v_prev
  from public.paid_daily
  where brand_id = p_brand_id and source = any (v_sources) and breakdown_signature = 'none'
    and date between (v_cmp ->> 'start')::date and (v_cmp ->> 'end')::date;

  select max(collected_at) as imported_at, max(date) as data_as_of, min(source_timezone) as tz
    into v_meta
  from public.paid_daily
  where brand_id = p_brand_id and source = any (v_sources) and breakdown_signature = 'none';

  -- KPI-urile: valoarea, comparația (doar în aceeași monedă la sume) și statusul.
  with k (ord, key, label, unit, money, cur_value, prev_value, definition, note) as (
    values
      (1, 'spend', 'Cost', 'currency', true, v_cur.spend, v_prev.spend,
          'Suma costurilor zilnice din platformele de ads, în moneda contului.', null::text),
      (2, 'impressions', 'Afișări', 'count', false, v_cur.impressions::numeric, v_prev.impressions::numeric,
          'Numărul de afișări ale reclamelor.', null),
      (3, 'clicks', 'Clickuri', 'count', false, v_cur.clicks::numeric, v_prev.clicks::numeric,
          'Numărul de clickuri raportat de platformă (toate clickurile).', 'toate clickurile'),
      (4, 'ctr', 'CTR', 'percent', false, metrics.ratio(v_cur.clicks, v_cur.impressions, 100), metrics.ratio(v_prev.clicks, v_prev.impressions, 100),
          'Clickuri / afișări × 100, din totalurile perioadei (nu media zilelor).', null),
      (5, 'cpc', 'CPC', 'currency', true, metrics.ratio(v_cur.spend, v_cur.clicks), metrics.ratio(v_prev.spend, v_prev.clicks),
          'Cost total / clickuri totale.', null),
      (6, 'conversions', 'Conversii', 'count', false, case when v_cur.conv_rows > 0 then v_cur.conversions end, case when v_prev.conv_rows > 0 then v_prev.conversions end,
          'Conversiile raportate de platformă (Meta: neconfigurate încă; Google Ads: conversiile principale; TikTok: obiectivul de optimizare).', null),
      (7, 'cpa', 'CPA', 'currency', true, case when v_cur.conv_rows > 0 then metrics.ratio(v_cur.spend, v_cur.conversions) end,
          case when v_prev.conv_rows > 0 then metrics.ratio(v_prev.spend, v_prev.conversions) end,
          'Cost total / conversii totale, doar unde platforma raportează conversii.', null)
  )
  select jsonb_agg(jsonb_build_object(
    'key', key, 'label', label, 'unit', unit, 'definition', definition, 'note', note,
    'currency', case when unit = 'currency' and not v_mixed then v_currency end,
    'value', case when money and v_mixed then null else cur_value end,
    'change', case
      when (money and (v_mixed or v_prev.currencies > 1 or v_prev.currency is distinct from v_currency)) or cur_value is null or prev_value is null then null
      when unit = 'percent' then metrics.change(cur_value, prev_value, 'percent') -> 'absolute_change'
      else metrics.change(cur_value, prev_value, unit) -> 'relative_change' end,
    'status', case
      when v_cur.n = 0 then 'unavailable'
      when money and v_mixed then 'unavailable'
      when cur_value is null and key in ('ctr', 'cpc', 'cpa') then 'cannot_compute'
      when cur_value is null then 'unavailable'
      else 'ok' end
  ) order by ord) into v_kpis from k;

  select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'spend', case when v_mixed then null else t.spend end, 'results', t.conversions) order by d.day), '[]'::jsonb)
    into v_series
  from generate_series(p_start, p_end, interval '1 day') g (ts)
  cross join lateral (select g.ts::date as day) d
  left join lateral (
    select sum(spend) as spend, case when count(conversions) > 0 then sum(conversions) end as conversions, count(*) as n
    from public.paid_daily
    where brand_id = p_brand_id and source = any (v_sources) and breakdown_signature = 'none' and date = d.day
    having count(*) > 0
  ) t on true;

  select coalesce(jsonb_agg(r order by r ->> 'date' desc, r ->> 'platform', r ->> 'campaign'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'date', date, 'platform', source, 'account', coalesce(max(account_name), account_id),
      'campaign', coalesce(max(campaign_name), campaign_id), 'objective', null, 'currency', currency,
      'spend', sum(spend), 'impressions', sum(impressions), 'clicks', sum(clicks),
      'ctr', metrics.ratio(sum(clicks), sum(impressions), 100), 'cpc', metrics.ratio(sum(spend), sum(clicks)),
      'conversions', case when count(conversions) > 0 then sum(conversions) end,
      'cpa', case when count(conversions) > 0 and sum(conversions) > 0 then metrics.ratio(sum(spend), sum(conversions)) end,
      'attribution_window', nullif(attribution_config, 'unspecified')) as r
    from public.paid_daily
    where brand_id = p_brand_id and source = any (v_sources) and breakdown_signature = 'none' and date between p_start and p_end
    group by date, source, account_id, campaign_id, currency, attribution_config
    limit 5000
  ) x;

  return jsonb_build_object(
    'connected', true, 'sources', to_jsonb(v_sources),
    'currency', v_currency, 'mixed_currency', v_mixed,
    'source_timezone', v_meta.tz, 'imported_at', v_meta.imported_at, 'data_as_of', v_meta.data_as_of,
    'comparison_period', v_cmp, 'kpis', v_kpis, 'series', v_series, 'rows', v_rows);
end;
$$;

revoke all on function public.brand_paid(uuid, date, date, text, text) from public, anon;
grant execute on function public.brand_paid(uuid, date, date, text, text) to authenticated, service_role;
