-- Listening și Analize pentru ecranele de brand (D-13). Toate SECURITY INVOKER: RLS-ul tabelelor rămâne autoritatea
-- (clientul vede doar analizele publicate, marcajele PV doar pe ale lui sau agency_admin pe toate). Zilele perioadei sunt
-- zile calendaristice în Europe/Bucharest (regula 9). Excepția E8 (aceleași condiții ca brand_metrics).

-- Mențiunile: pagină filtrată, cu ultimul marcaj de farmacovigilență vizibil apelantului.
create function public.brand_mentions(
  p_brand_id uuid, p_start date, p_end date, p_sentiment text default null, p_source text default null, p_page integer default 1, p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_total bigint;
  v_items jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if p_sentiment is not null and p_sentiment not in ('positive', 'neutral', 'negative', 'unreviewed') then
    raise exception 'Filtru de sentiment necunoscut' using errcode = '22023';
  end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 100 then
    raise exception 'Paginare invalidă' using errcode = '22023';
  end if;
  v_from := (p_start::timestamp) at time zone 'Europe/Bucharest';
  v_to := ((p_end + 1)::timestamp) at time zone 'Europe/Bucharest';

  select count(*) into v_total
  from public.mentions m
  where m.brand_id = p_brand_id and m.published_at >= v_from and m.published_at < v_to
    and (p_source is null or m.source_name = p_source)
    and (p_sentiment is null
         or (p_sentiment = 'unreviewed' and m.sentiment_reviewed_by is null)
         or (p_sentiment <> 'unreviewed' and m.sentiment_reviewed_by is not null and m.sentiment = p_sentiment));

  select coalesce(jsonb_agg(x.j order by x.published_at desc, x.native_id), '[]'::jsonb) into v_items
  from (
    select m.published_at, m.native_id, jsonb_build_object(
      'id', m.native_id, 'brand_id', m.brand_id, 'source_name', coalesce(m.source_name, 'necunoscută'), 'author', null,
      'published_at', m.published_at, 'text', coalesce(m.text, ''), 'url', m.url,
      -- Sentimentul apare doar după revizuirea umană; cel al furnizorului nu se arată ca etichetă (spec 2.7).
      'sentiment', case when m.sentiment_reviewed_by is not null and m.sentiment <> 'unknown' then m.sentiment end,
      'reviewed_by', case when m.sentiment_reviewed_by is not null then 'utilizator ' || left(m.sentiment_reviewed_by::text, 8) end,
      'pv_flag', (
        select jsonb_build_object('id', f.id, 'item', jsonb_build_object('kind', 'mention', 'id', f.entity_ref), 'flagged_at', f.flagged_at,
          'flagged_by', 'utilizator ' || left(f.flagged_by::text, 8), 'notified', f.status <> 'open',
          'status', case f.status when 'open' then 'pending' when 'notified' then 'notified' else 'acknowledged' end)
        from public.pv_flags f
        where f.brand_id = m.brand_id and f.entity_type = 'mention' and f.entity_ref = m.native_id
        order by f.flagged_at desc limit 1)
    ) as j
    from public.mentions m
    where m.brand_id = p_brand_id and m.published_at >= v_from and m.published_at < v_to
      and (p_source is null or m.source_name = p_source)
      and (p_sentiment is null
           or (p_sentiment = 'unreviewed' and m.sentiment_reviewed_by is null)
           or (p_sentiment <> 'unreviewed' and m.sentiment_reviewed_by is not null and m.sentiment = p_sentiment))
    order by m.published_at desc, m.native_id
    offset (p_page - 1) * p_page_size limit p_page_size
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', p_page, 'page_size', p_page_size);
end;
$$;

-- Distribuția sentimentului: doar mențiunile revizuite intră în total și procente; nerevizuitele se numără separat.
create function public.brand_mention_sentiment(p_brand_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  r record;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  select count(*) filter (where m.sentiment_reviewed_by is not null and m.sentiment in ('positive', 'neutral', 'negative')) as total,
         count(*) filter (where m.sentiment_reviewed_by is not null and m.sentiment = 'positive') as positive,
         count(*) filter (where m.sentiment_reviewed_by is not null and m.sentiment = 'neutral') as neutral,
         count(*) filter (where m.sentiment_reviewed_by is not null and m.sentiment = 'negative') as negative,
         count(*) filter (where m.sentiment_reviewed_by is null) as unreviewed,
         count(*) as all_rows
    into r
  from public.mentions m
  where m.brand_id = p_brand_id
    and m.published_at >= (p_start::timestamp) at time zone 'Europe/Bucharest'
    and m.published_at < ((p_end + 1)::timestamp) at time zone 'Europe/Bucharest';
  return jsonb_build_object(
    'connected', private.brand_source_connected(p_brand_id, 'planable_listening'),
    'total', r.total, 'positive', r.positive, 'neutral', r.neutral, 'negative', r.negative, 'unreviewed', r.unreviewed,
    'shares', jsonb_build_object(
      'positive', metrics.ratio(r.positive, r.total, 100), 'neutral', metrics.ratio(r.neutral, r.total, 100), 'negative', metrics.ratio(r.negative, r.total, 100)));
end;
$$;

-- Analizele brandului (RLS: clientul doar publicate; acțiunile doar cele agreate). Dovezile: referința instantaneului de la
-- publicare; pentru ciorne, perioada analizei cu comparația calculată de server.
create function public.brand_insights(p_brand_id uuid, p_start date, p_end date)
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
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'brand_id', i.brand_id, 'title', i.title, 'summary', i.summary,
      'author', jsonb_build_object('id', i.author_id, 'name', 'Utilizator ' || left(i.author_id::text, 8), 'role', 'Echipa agenției'),
      'period', jsonb_build_object('from', i.period_start, 'to', i.period_end),
      'status', i.status, 'limits', nullif(i.limits, ''),
      'updated_at', i.updated_at, 'published_at', i.published_at,
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
          'label', coalesce(d.name_ro, e.metric_key),
          'evidence_query', coalesce(
            (select s.result -> 'metric' -> 'evidence_query' from public.insight_snapshots s
             where s.insight_id = i.id and s.metric_key = e.metric_key order by s.computed_at desc limit 1),
            jsonb_build_object('metric_key', e.metric_key, 'version', coalesce(d.version, 0), 'brand_id', i.brand_id,
              'period', jsonb_build_object('start', i.period_start, 'end', i.period_end),
              'comparison_period', metrics.comparison_period(i.period_start, i.period_end, case when i.period_kind = 'mtd' then 'mtd' else 'custom' end))))
          order by e.created_at)
        from public.evidence_links e
        left join public.metric_definitions_current d on d.metric_key = e.metric_key
        where e.insight_id = i.id and e.kind = 'metric'), '[]'::jsonb),
      'actions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'title', a.title,
          'owner', jsonb_build_object('id', a.responsible_user_id, 'name', 'Utilizator ' || left(a.responsible_user_id::text, 8), 'role', 'Echipa agenției'),
          'due', a.due_date,
          'status', case a.status when 'proposed' then 'open' when 'agreed' then 'open' when 'in_progress' then 'in_progress'
                                  when 'done' then 'done' when 'measured' then 'done' else 'cancelled' end)
          order by a.created_at)
        from public.actions a where a.insight_id = i.id), '[]'::jsonb)
    ) order by coalesce(i.published_at, i.updated_at) desc)
    from public.insights i
    where i.brand_id = p_brand_id and i.period_end >= p_start and i.period_start <= p_end
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.brand_mentions(uuid, date, date, text, text, integer, integer) from public, anon;
revoke all on function public.brand_mention_sentiment(uuid, date, date) from public, anon;
revoke all on function public.brand_insights(uuid, date, date) from public, anon;
grant execute on function public.brand_mentions(uuid, date, date, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.brand_mention_sentiment(uuid, date, date) to authenticated, service_role;
grant execute on function public.brand_insights(uuid, date, date) to authenticated, service_role;
