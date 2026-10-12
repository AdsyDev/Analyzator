-- „Cont propriu” în Listening (D-22). Planable Listening prinde și postările proprii ale brandului (după cuvântul urmărit);
-- conectorul compară autorul mențiunii cu paginile Planable ale workspace-ului și salvează doar rezultatul (nu numele
-- autorilor: pot fi persoane fizice). true = cont propriu, false = autor extern, null = necunoscut (de ex. import CSV).
-- Feed-ul le arată cu filtru de autor; distribuția sentimentului le exclude.

alter table public.mentions add column author_is_owned boolean;
comment on column public.mentions.author_is_owned is
  'true = autorul e o pagină proprie a brandului (Planable), false = extern, null = necunoscut. Nu se păstrează numele autorului.';

drop function public.brand_mentions(uuid, date, date, text, text, integer, integer);

create function public.brand_mentions(
  p_brand_id uuid, p_start date, p_end date, p_sentiment text default null, p_source text default null, p_page integer default 1, p_page_size integer default 20,
  p_author text default 'all'
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
  if coalesce(p_author, 'all') not in ('all', 'external', 'owned') then
    raise exception 'Filtru de autor necunoscut' using errcode = '22023';
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
    and (coalesce(p_author, 'all') = 'all'
         or (p_author = 'owned' and m.author_is_owned is true)
         or (p_author = 'external' and m.author_is_owned is not true))
    and (p_sentiment is null
         or (p_sentiment = 'unreviewed' and m.sentiment_reviewed_by is null)
         or (p_sentiment <> 'unreviewed' and m.sentiment_reviewed_by is not null and m.sentiment = p_sentiment));

  select coalesce(jsonb_agg(x.j order by x.published_at desc, x.native_id), '[]'::jsonb) into v_items
  from (
    select m.published_at, m.native_id, jsonb_build_object(
      'id', m.native_id, 'brand_id', m.brand_id, 'source_name', coalesce(m.source_name, 'necunoscută'), 'author', null,
      'published_at', m.published_at, 'text', coalesce(m.text, ''), 'url', m.url,
      -- „Cont propriu” (D-22): true / false / null (necunoscut).
      'owned_account', m.author_is_owned,
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
      and (coalesce(p_author, 'all') = 'all'
           or (p_author = 'owned' and m.author_is_owned is true)
           or (p_author = 'external' and m.author_is_owned is not true))
      and (p_sentiment is null
           or (p_sentiment = 'unreviewed' and m.sentiment_reviewed_by is null)
           or (p_sentiment <> 'unreviewed' and m.sentiment_reviewed_by is not null and m.sentiment = p_sentiment))
    order by m.published_at desc, m.native_id
    offset (p_page - 1) * p_page_size limit p_page_size
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', p_page, 'page_size', p_page_size);
end;
$$;


create or replace function public.brand_mention_sentiment(p_brand_id uuid, p_start date, p_end date)
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
  -- Conturile proprii nu intră în distribuție (D-22): sentimentul arată ce spun alții despre brand.
  select count(*) filter (where m.author_is_owned is not true and m.sentiment_reviewed_by is not null and m.sentiment in ('positive', 'neutral', 'negative')) as total,
         count(*) filter (where m.author_is_owned is not true and m.sentiment_reviewed_by is not null and m.sentiment = 'positive') as positive,
         count(*) filter (where m.author_is_owned is not true and m.sentiment_reviewed_by is not null and m.sentiment = 'neutral') as neutral,
         count(*) filter (where m.author_is_owned is not true and m.sentiment_reviewed_by is not null and m.sentiment = 'negative') as negative,
         count(*) filter (where m.author_is_owned is not true and m.sentiment_reviewed_by is null) as unreviewed,
         count(*) as all_rows,
         count(*) filter (where m.author_is_owned is true) as owned
    into r
  from public.mentions m
  where m.brand_id = p_brand_id
    and m.published_at >= (p_start::timestamp) at time zone 'Europe/Bucharest'
    and m.published_at < ((p_end + 1)::timestamp) at time zone 'Europe/Bucharest';
  return jsonb_build_object(
    'connected', private.brand_source_connected(p_brand_id, 'planable_listening'),
    'total', r.total, 'positive', r.positive, 'neutral', r.neutral, 'negative', r.negative, 'unreviewed', r.unreviewed,
    'owned_excluded', r.owned,
    'shares', jsonb_build_object(
      'positive', metrics.ratio(r.positive, r.total, 100), 'neutral', metrics.ratio(r.neutral, r.total, 100), 'negative', metrics.ratio(r.negative, r.total, 100)));
end;
$$;


revoke all on function public.brand_mentions(uuid, date, date, text, text, integer, integer, text) from public, anon;
grant execute on function public.brand_mentions(uuid, date, date, text, text, integer, integer, text) to authenticated, service_role;
