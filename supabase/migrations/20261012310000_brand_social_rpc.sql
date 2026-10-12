-- Social propriu în ecran (D-23), din datele Planable salvate (social_daily, social_posts). SECURITY INVOKER: RLS-ul
-- tabelelor rămâne autoritatea; E8 (aceleași condiții ca brand_metrics). Zilele perioadei sunt zile calendaristice în
-- Europe/Bucharest (regula 9). Lipsa nu devine 0 (regula 8): un indicator fără observații e null cu status `unavailable`.
--
-- Indicatori (pe conturile brandului, opțional pe o platformă):
--   posts         = postările publicate în perioadă (ultima observație a fiecărei postări);
--   followers     = suma, pe conturi, a ultimei observații de urmăritori din perioadă;
--   net_growth    = suma, pe conturi, a (ultima − prima observație de urmăritori din perioadă); null fără două observații;
--   interactions  = suma interacțiunilor zilnice (engagements) din perioadă;
--   reach         = indisponibil: reach-ul zilnic nu se adună între zile (`reach_not_additive`).
-- Variația: metrics.change față de perioada de comparație. Formatul, subiectul și concurența nu există în datele Planable.

create function public.brand_social(p_brand_id uuid, p_start date, p_end date, p_platform text default null, p_kind text default 'custom')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cmp jsonb;
  v_cs date;
  v_ce date;
  v_from timestamptz := (p_start::timestamp) at time zone 'Europe/Bucharest';
  v_to timestamptz := ((p_end + 1)::timestamp) at time zone 'Europe/Bucharest';
  c record;
  p record;
  v_posts jsonb;
  kpi jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform !~ '^[a-z_]{1,32}$' then
    raise exception 'Platformă invalidă' using errcode = '22023';
  end if;
  if not private.brand_source_connected(p_brand_id, 'planable_analytics') then
    return jsonb_build_object('connected', false);
  end if;
  v_cmp := metrics.comparison_period(p_start, p_end, coalesce(p_kind, 'custom'));
  v_cs := (v_cmp ->> 'start')::date;
  v_ce := (v_cmp ->> 'end')::date;

  -- Indicatorii pe o perioadă: aceeași regulă pentru perioada curentă și cea de comparație.
  with periods (k, s, e) as (values ('cur', p_start, p_end), ('cmp', v_cs, v_ce)),
  daily as (
    select pr.k, d.platform, d.account_id, d.date, d.followers, d.engagements
    from periods pr join public.social_daily d
      on d.brand_id = p_brand_id and d.date between pr.s and pr.e and (p_platform is null or d.platform = p_platform)
  ),
  acct as (
    select k, platform, account_id,
           (array_agg(followers order by date desc) filter (where followers is not null))[1] as last_f,
           (array_agg(followers order by date asc) filter (where followers is not null))[1] as first_f,
           count(followers) as n_f
    from daily group by k, platform, account_id
  ),
  agg as (
    select pr.k,
      (select sum(a.last_f) from acct a where a.k = pr.k) as followers,
      (select case when bool_and(a.n_f >= 2) then sum(a.last_f - a.first_f) end from acct a where a.k = pr.k) as net_growth,
      (select sum(d.engagements) from daily d where d.k = pr.k) as interactions,
      (select count(*) from (
         select distinct on (sp.platform, sp.account_id, sp.post_id) 1
         from public.social_posts sp
         where sp.brand_id = p_brand_id and (p_platform is null or sp.platform = p_platform)
           and sp.published_at >= (pr.s::timestamp) at time zone 'Europe/Bucharest'
           and sp.published_at < ((pr.e + 1)::timestamp) at time zone 'Europe/Bucharest'
         order by sp.platform, sp.account_id, sp.post_id, sp.snapshot_date desc) x) as posts,
      (select count(*) from daily d where d.k = pr.k) as daily_rows
    from periods pr
  )
  select (select row_to_json(a)::jsonb from agg a where a.k = 'cur') as cur,
         (select row_to_json(a)::jsonb from agg a where a.k = 'cmp') as cmp
    into c;

  kpi := jsonb_build_array();
  for p in select * from (values ('posts', 1), ('followers', 2), ('net_growth', 3), ('interactions', 4)) as t (key, ord) order by ord loop
    kpi := kpi || jsonb_build_array(jsonb_build_object(
      'key', p.key,
      'value', (c.cur ->> p.key)::numeric,
      'comparison_value', (c.cmp ->> p.key)::numeric,
      'change', metrics.change((c.cur ->> p.key)::numeric, (c.cmp ->> p.key)::numeric, 'count') -> 'relative_change',
      'status', case when (c.cur ->> p.key) is null then 'unavailable' else 'ok' end));
  end loop;
  kpi := kpi || jsonb_build_array(jsonb_build_object('key', 'reach', 'value', null, 'comparison_value', null, 'change', null, 'status', 'unavailable'));

  -- Postările din perioadă, cu ultima observație de metrici; vârsta = zile de la publicare la observație.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.platform || ':' || x.post_id, 'published_at', x.published_at, 'platform', x.platform,
      'excerpt', left(coalesce(x.post_text, ''), 280), 'permalink', x.post_url,
      'age_days', x.age_days, 'mature', x.age_days >= 7,
      'reach', x.reach_not_additive, 'impressions', x.impressions, 'interactions', x.engagements)
      order by x.published_at desc), '[]'::jsonb)
    into v_posts
  from (
    select distinct on (sp.platform, sp.account_id, sp.post_id) sp.platform, sp.post_id, sp.published_at, sp.post_text, sp.post_url,
           sp.reach_not_additive, sp.impressions, sp.engagements,
           greatest(0, sp.snapshot_date - (sp.published_at at time zone 'Europe/Bucharest')::date) as age_days
    from public.social_posts sp
    where sp.brand_id = p_brand_id and (p_platform is null or sp.platform = p_platform)
      and sp.published_at >= v_from and sp.published_at < v_to
    order by sp.platform, sp.account_id, sp.post_id, sp.snapshot_date desc
  ) x;

  return jsonb_build_object(
    'connected', true,
    'kpis', kpi,
    'posts', v_posts,
    'platforms', coalesce((select jsonb_agg(distinct d.platform order by d.platform) from public.social_daily d where d.brand_id = p_brand_id), '[]'::jsonb),
    'data_as_of', (select max(d.date) from public.social_daily d where d.brand_id = p_brand_id),
    'imported_at', (select max(d.collected_at) from public.social_daily d where d.brand_id = p_brand_id));
end;
$$;

revoke all on function public.brand_social(uuid, date, date, text, text) from public, anon;
grant execute on function public.brand_social(uuid, date, date, text, text) to authenticated, service_role;
