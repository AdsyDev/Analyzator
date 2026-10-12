-- Key events pe canal (Trafic → Canale): pe date reale (Hepathrombin, 12 oct 2026) GA4 a întors keyEvents = 0 pentru o
-- proprietate fără evenimente cheie, iar tabelul arăta 0 în timp ce indicatorul „Key events” (din web_key_events) era,
-- corect, fără date. Regula 8: lipsa nu devine 0. Pe canal, key events apar doar dacă web_key_events are date în
-- perioadă. Aceeași semnătură și aceleași drepturi (SECURITY INVOKER, grant-urile rămân).

create or replace function public.brand_traffic_channels(p_brand_id uuid, p_start date, p_end date, p_kind text default 'custom')
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
  v_has_key_events boolean;
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
  -- GA4 trimite keyEvents = 0 și când proprietatea nu are evenimente cheie: pe canal arătăm key events doar dacă
  -- raportul de evenimente cheie (sursa metricii ga4_key_events) are date în perioadă; altfel null, nu 0.
  v_has_key_events := exists (select 1 from public.web_key_events
                              where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end and key_events is not null);

  select coalesce(jsonb_agg(jsonb_build_object(
      'channel', c.channel, 'sessions', c.sessions,
      'share_pct', metrics.ratio(c.sessions, v_total, 100),
      'change_pct', metrics.change(c.sessions, p.sessions, 'count') -> 'relative_change',
      'engagement_rate', metrics.ratio(c.engaged, c.sessions, 100),
      'key_events', case when v_has_key_events then c.key_events end) order by c.sessions desc nulls last, c.channel), '[]'::jsonb)
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
