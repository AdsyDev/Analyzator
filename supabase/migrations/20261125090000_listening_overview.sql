-- Listening după modelul Planable (deciziile AH din docs/decisions.md, cererea din 25 nov. 2026: „Fă A și B”, apoi topicurile
-- și „Top voices”).
--
-- 1. `mentions` păstrează acum autorul (nume și username, cum le trimite sursa) și interacțiunile mențiunii. Revine asupra
--    D-22: autorii pot fi persoane fizice, deci sunt date personale; le citesc doar cei cu acces la brand (RLS neschimbat).
-- 2. `listening_trackers`: ce cuvinte Listening ale brandului (tip „brand”) și ce topicuri (tip „topic”) a citit colectarea și
--    ce zile acoperă. O zi citită complet fără mențiuni e zero real; o zi necitită e lipsă (regula 8). Ca la competitori (Y-4),
--    clientul nu vede `sync_runs` (G-7), deci acoperirea stă într-un tabel citibil cu acces la brand.
-- 3. `topic_mentions`: mențiunile topicurilor (cuvintele de tip „topic”), fără text și fără autor (ca la competitori, Y-5):
--    doar rețeaua, linkul, momentul, sentimentul Planable, interacțiunile și limba (textul trece doar prin trigger).
-- 4. `brand_listening_overview`: tot ce arată ecranul Listening în afară de feed, calculat aici (regula 4): seria pe zi și pe
--    rețea, interacțiunile cu variația, sentimentul automat Planable (neverificat, separat de cel revizuit), vocile principale,
--    topicurile și comparația cu competitorii (mențiuni și share of voice din matricea de Competiție, ca valorile să fie
--    aceleași, plus sentimentul și rețelele fiecărui competitor).

-- 1. Autorul și interacțiunile mențiunilor brandului -----------------------------------------------------------------------------

alter table public.mentions
  add column author_name text check (length(author_name) between 1 and 256),
  add column author_username text check (length(author_username) between 1 and 256),
  add column engagement bigint check (engagement >= 0);
comment on column public.mentions.author_name is
  'Numele autorului, cum îl trimite sursa (deciziile AH). Poate fi o persoană fizică: dată personală, citită doar cu acces la brand.';
comment on column public.mentions.author_username is
  'Username-ul autorului, cum îl trimite sursa (deciziile AH). NULL când sursa nu îl dă.';
comment on column public.mentions.engagement is
  'Interacțiunile mențiunii raportate de sursă (Planable `engagement`). NULL = sursa nu le dă; nu înseamnă zero.';

-- 2. Ce a citit colectarea Listening a brandului --------------------------------------------------------------------------------

create table public.listening_trackers (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null,
  brand_id      uuid not null,
  -- brand: un cuvânt de tip „brand” (mențiunile în `mentions`); topic: un cuvânt de tip „topic” (în `topic_mentions`).
  kind          text not null check (kind in ('brand', 'topic')),
  keyword_id    text not null check (length(keyword_id) between 1 and 128),
  label         text not null check (length(btrim(label)) between 1 and 200),
  -- Zilele (fusul workspace-ului) pe care colectarea le-a citit pentru acest cuvânt.
  covered_from  date not null,
  covered_to    date not null,
  -- false = ultima rulare nu a citit tot (eroare sau paginare întreruptă) pentru acest cuvânt.
  complete      boolean not null,
  last_seen_at  timestamptz not null,
  source_id     uuid not null,
  sync_run_id   uuid references public.sync_runs (id) on delete set null,
  updated_at    timestamptz not null default now(),
  check (covered_from <= covered_to),
  unique (tenant_id, brand_id, kind, keyword_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.listening_trackers is
  'Cuvintele Listening ale brandului (tip brand) și topicurile (tip topic) citite de colectare, cu zilele acoperite. Scris doar de worker.';
create trigger listening_trackers_updated_at before update on public.listening_trackers
  for each row execute function private.set_updated_at();

-- 3. Mențiunile topicurilor --------------------------------------------------------------------------------------------------------

create table public.topic_mentions (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null,
  brand_id          uuid not null,
  keyword_id        text not null check (length(keyword_id) between 1 and 128),
  -- Ca la `mentions`: h: + hash-ul URL-ului; s: + hash-ul identității pentru mențiunile fără link.
  native_id         text not null check (native_id ~ '^[hs]:[0-9a-f]{32}$'),
  platform          text check (length(platform) between 1 and 256),
  url               text check (url ~ '^https?://' and length(url) <= 2048),
  published_at      timestamptz not null,
  -- Sentimentul dat de Planable, păstrat ca atare (automat, nerevizuit).
  sentiment         text not null default 'unknown' check (sentiment in ('positive', 'neutral', 'negative', 'unknown')),
  engagement        bigint check (engagement >= 0),
  language_detected text check (language_detected in ('ro', 'other')),
  -- Doar intrare, ca la `competitor_mentions` (deciziile AF): triggerul stabilește limba și golește coloana.
  language_text     text,
  source_id         uuid not null,
  sync_run_id       uuid references public.sync_runs (id) on delete set null,
  collected_at      timestamptz not null,
  payload_hash      text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version    text not null,
  updated_at        timestamptz not null default now(),
  check ((url is null) = (native_id like 's:%')),
  constraint topic_mentions_text_not_stored check (language_text is null),
  unique (tenant_id, brand_id, keyword_id, native_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.topic_mentions is
  'Mențiunile cuvintelor de tip „topic” din Planable Listening, pe cuvânt. Fără text și fără autor (minimizare). Scris doar de worker.';
create index topic_mentions_brand_published_idx on public.topic_mentions (tenant_id, brand_id, published_at);
create trigger topic_mentions_updated_at before update on public.topic_mentions
  for each row execute function private.set_updated_at();
-- Aceeași funcție ca la competitori: lucrează pe coloanele `language_text` / `language_detected`, nu pe numele tabelului.
create trigger topic_mentions_language before insert or update on public.topic_mentions
  for each row execute function private.competitor_mention_language();

-- RLS: citire cu acces la brand, scriere doar service role (ca tabelele competitorilor).
alter table public.listening_trackers enable row level security;
alter table public.topic_mentions enable row level security;
revoke all on public.listening_trackers, public.topic_mentions from public, anon, authenticated;
grant select on public.listening_trackers, public.topic_mentions to authenticated;
grant all on public.listening_trackers, public.topic_mentions to service_role;

create policy listening_trackers_select on public.listening_trackers for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy listening_trackers_insert on public.listening_trackers for insert to authenticated with check (false);
create policy listening_trackers_update on public.listening_trackers for update to authenticated using (false);
create policy listening_trackers_delete on public.listening_trackers for delete to authenticated using (false);

create policy topic_mentions_select on public.topic_mentions for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy topic_mentions_insert on public.topic_mentions for insert to authenticated with check (false);
create policy topic_mentions_update on public.topic_mentions for update to authenticated using (false);
create policy topic_mentions_delete on public.topic_mentions for delete to authenticated using (false);

-- 4. Ecranul Listening ---------------------------------------------------------------------------------------------------------

create function public.brand_listening_overview(p_brand_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from      timestamptz;
  v_to        timestamptz;
  v_days      date[];
  v_confirmed boolean[];
  v_period    integer;
  v_brand     jsonb;
  v_cmp       jsonb;
  v_prev      jsonb;
  v_topics    jsonb;
  v_matrix    jsonb;
  v_rows      jsonb;
  v_set       record;
  v_entities  jsonb := '[]'::jsonb;
  v_counts    jsonb := '{}'::jsonb;
  v_mem       record;
  v_words     text[];
  v_ids       text[];
  v_sov_brand jsonb;
  v_comp      jsonb := null;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  v_from := (p_start::timestamp) at time zone 'Europe/Bucharest';
  v_to := ((p_end + 1)::timestamp) at time zone 'Europe/Bucharest';
  v_period := p_end - p_start + 1;

  -- Zilele confirmate: cel puțin un cuvânt de tip „brand” le-a citit și toate cuvintele care le-au citit au fost complete.
  -- Într-o zi confirmată fără mențiuni, valoarea e 0; într-una neconfirmată, lipsă (null), nu zero.
  select array_agg(d.day order by d.day),
         array_agg(exists (select 1 from public.listening_trackers t
                           where t.brand_id = p_brand_id and t.kind = 'brand' and d.day between t.covered_from and t.covered_to)
                   and not exists (select 1 from public.listening_trackers t
                                   where t.brand_id = p_brand_id and t.kind = 'brand' and d.day between t.covered_from and t.covered_to
                                     and not t.complete)
                   order by d.day)
    into v_days, v_confirmed
  from (select g::date as day from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') g) d;

  -- Mențiunile brandului din perioadă, cu aceeași regulă ca indicatorul „Mențiuni” (mentions_count v2): toate, în afară de cele
  -- clar în altă limbă decât româna. Sentimentul automat și vocile principale folosesc doar autorii externi (D-22).
  with base as (
    select (m.published_at at time zone 'Europe/Bucharest')::date as day,
           coalesce(nullif(btrim(m.source_name), ''), 'necunoscută') as platform,
           m.sentiment, m.author_is_owned, m.author_name, m.author_username, m.engagement
    from public.mentions m
    where m.brand_id = p_brand_id and m.published_at >= v_from and m.published_at < v_to
      and not metrics.mention_other_language(m.language, m.language_detected)
  ),
  days as (
    select x.d, x.ok, x.i from unnest(v_days, v_confirmed) with ordinality as x(d, ok, i)
  ),
  per_day as (
    select b.day, b.platform, count(*) as n from base b group by b.day, b.platform
  ),
  plats as (
    select b.platform, count(*) as n from base b group by b.platform
  ),
  sent as (
    select count(*) filter (where b.author_is_owned is not true and b.sentiment = 'positive') as pos,
           count(*) filter (where b.author_is_owned is not true and b.sentiment = 'neutral') as neu,
           count(*) filter (where b.author_is_owned is not true and b.sentiment = 'negative') as neg,
           count(*) filter (where b.author_is_owned is not true and b.sentiment = 'unknown') as unk,
           count(*) filter (where b.author_is_owned is true) as owned
    from base b
  ),
  voices as (
    select b.platform,
           coalesce(nullif(lower(btrim(b.author_username)), ''), lower(btrim(b.author_name))) as k,
           max(b.author_name) as name, max(b.author_username) as username,
           count(*) as mentions, sum(b.engagement) as engagement
    from base b
    where b.author_is_owned is not true
      and coalesce(nullif(btrim(b.author_username), ''), nullif(btrim(b.author_name), '')) is not null
    group by 1, 2
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'series', (select coalesce(jsonb_agg(case when coalesce(s.n, 0) > 0 then s.n when days.ok then 0 end order by days.i), '[]'::jsonb)
               from days left join (select pd.day, sum(pd.n) as n from per_day pd group by pd.day) s on s.day = days.d),
    'platforms', (select coalesce(jsonb_agg(jsonb_build_object(
                     'platform', p.platform, 'mentions', p.n, 'share', metrics.ratio(p.n, (select count(*) from base), 100),
                     'values', (select jsonb_agg(case when coalesce(pd.n, 0) > 0 then pd.n when days.ok then 0 end order by days.i)
                                from days left join per_day pd on pd.day = days.d and pd.platform = p.platform))
                   order by p.n desc, p.platform), '[]'::jsonb)
                  from plats p),
    'engagement', (select jsonb_build_object('value', sum(b.engagement), 'mentions_with_value', count(b.engagement), 'mentions', count(*)) from base b),
    'auto_sentiment', (select jsonb_build_object(
                         'total', s.pos + s.neu + s.neg, 'positive', s.pos, 'neutral', s.neu, 'negative', s.neg, 'unknown', s.unk,
                         'owned_excluded', s.owned,
                         'shares', jsonb_build_object('positive', metrics.ratio(s.pos, s.pos + s.neu + s.neg, 100),
                                                      'neutral', metrics.ratio(s.neu, s.pos + s.neu + s.neg, 100),
                                                      'negative', metrics.ratio(s.neg, s.pos + s.neu + s.neg, 100)),
                         'net', metrics.ratio(s.pos - s.neg, s.pos + s.neu + s.neg, 100))
                       from sent s),
    'top_voices', (select coalesce(jsonb_agg(jsonb_build_object('name', v.name, 'username', v.username, 'platform', v.platform,
                                                                'mentions', v.mentions, 'engagement', v.engagement)
                                             order by v.mentions desc, v.engagement desc nulls last, v.k), '[]'::jsonb)
                   from (select * from voices order by mentions desc, engagement desc nulls last, k limit 10) v),
    'voices_basis', (select jsonb_build_object(
                       'external', count(*) filter (where b.author_is_owned is not true),
                       'with_author', count(*) filter (where b.author_is_owned is not true
                                                         and coalesce(nullif(btrim(b.author_username), ''), nullif(btrim(b.author_name), '')) is not null))
                     from base b),
    'platform_counts', (select coalesce(jsonb_object_agg(p.platform, p.n), '{}'::jsonb) from plats p)
  ) into v_brand;

  -- Interacțiunile perioadei anterioare de aceeași lungime, pe aceeași regulă, pentru variație. Fără nicio valoare raportată
  -- în perioada anterioară (de exemplu, înainte să fie colectate), variația lipsește.
  v_cmp := metrics.comparison_period(p_start, p_end, 'custom');
  select jsonb_build_object('start', v_cmp ->> 'start', 'end', v_cmp ->> 'end', 'value', sum(m.engagement))
    into v_prev
  from public.mentions m
  where m.brand_id = p_brand_id
    and m.published_at >= ((v_cmp ->> 'start')::date::timestamp at time zone 'Europe/Bucharest')
    and m.published_at < ((((v_cmp ->> 'end')::date) + 1)::timestamp at time zone 'Europe/Bucharest')
    and not metrics.mention_other_language(m.language, m.language_detected);
  v_brand := jsonb_set(v_brand, '{engagement}', (v_brand -> 'engagement') || jsonb_build_object(
    'comparison', v_prev,
    'change', metrics.change((v_brand -> 'engagement' ->> 'value')::numeric, (v_prev ->> 'value')::numeric, 'count')));

  -- Topicurile citite în perioadă (cel puțin o zi acoperită): mențiunile, acoperirea, sentimentul automat și rețelele.
  select coalesce(jsonb_agg(t.j order by t.n desc nulls last, t.label), '[]'::jsonb) into v_topics
  from (
    select tr.label, c.n, jsonb_build_object(
      'id', tr.keyword_id, 'label', tr.label,
      'mentions', c.n,
      'status', case when cov.days < v_period or not tr.complete then 'partial' else 'ok' end,
      'coverage', round(cov.days::numeric / v_period, 4),
      'reason', case
        when cov.days < v_period then 'Topicul e colectat doar pentru ' || to_char(tr.covered_from, 'DD.MM.YYYY') || ' – ' || to_char(tr.covered_to, 'DD.MM.YYYY') || '.'
        when not tr.complete then 'Ultima colectare nu a citit toate mențiunile topicului.'
      end,
      'engagement', c.eng,
      'sentiment', jsonb_build_object(
        'total', c.pos + c.neu + c.neg, 'positive', c.pos, 'neutral', c.neu, 'negative', c.neg, 'unknown', c.unk,
        'shares', jsonb_build_object('positive', metrics.ratio(c.pos, c.pos + c.neu + c.neg, 100),
                                     'neutral', metrics.ratio(c.neu, c.pos + c.neu + c.neg, 100),
                                     'negative', metrics.ratio(c.neg, c.pos + c.neu + c.neg, 100)),
        'net', metrics.ratio(c.pos - c.neg, c.pos + c.neu + c.neg, 100)),
      'platforms', (select coalesce(jsonb_agg(jsonb_build_object('platform', p.platform, 'mentions', p.n) order by p.n desc, p.platform), '[]'::jsonb)
                    from (select coalesce(nullif(btrim(tm.platform), ''), 'necunoscută') as platform, count(*) as n
                          from public.topic_mentions tm
                          where tm.brand_id = p_brand_id and tm.keyword_id = tr.keyword_id
                            and tm.published_at >= v_from and tm.published_at < v_to
                            and not metrics.mention_other_language(null, tm.language_detected)
                          group by 1) p)
    ) as j
    from public.listening_trackers tr
    cross join lateral (select greatest(0, least(p_end, tr.covered_to) - greatest(p_start, tr.covered_from) + 1) as days) cov
    cross join lateral (
      select count(*) as n,
             count(*) filter (where tm.sentiment = 'positive') as pos, count(*) filter (where tm.sentiment = 'neutral') as neu,
             count(*) filter (where tm.sentiment = 'negative') as neg, count(*) filter (where tm.sentiment = 'unknown') as unk,
             sum(tm.engagement) as eng
      from public.topic_mentions tm
      where tm.brand_id = p_brand_id and tm.keyword_id = tr.keyword_id
        and tm.published_at >= v_from and tm.published_at < v_to
        and not metrics.mention_other_language(null, tm.language_detected)
    ) c
    where tr.brand_id = p_brand_id and tr.kind = 'topic' and cov.days > 0
  ) t;

  -- Competiția: mențiunile și share of voice vin din matricea de Competiție (aceleași valori, stări și motive). Aici se adaugă
  -- sentimentul automat și rețelele, pe aceeași atribuire a cuvintelor (lista competitorului sau, la lista goală, numele lui).
  v_matrix := public.brand_competition(p_brand_id, p_start, p_end, 'custom');
  if coalesce((v_matrix ->> 'has_set')::boolean, false) then
    select g -> 'rows' into v_rows from jsonb_array_elements(v_matrix -> 'groups') g where g ->> 'dimension' = 'listening';
    select cs.id, cs.version, cs.effective_from into v_set from public.competitor_sets cs
    where cs.brand_id = p_brand_id and cs.effective_from <= p_end order by cs.effective_from desc limit 1;

    v_counts := jsonb_build_object(p_brand_id::text, v_brand -> 'platform_counts');
    for v_mem in select mm.id, mm.name, mm.listening_keywords from public.competitor_set_members mm where mm.competitor_set_id = v_set.id loop
      v_words := case when cardinality(v_mem.listening_keywords) > 0 then v_mem.listening_keywords else array[v_mem.name] end;
      select coalesce(array_agg(t.external_id), '{}') into v_ids
      from public.competitor_trackers t
      where t.brand_id = p_brand_id and t.source = 'planable_listening'
        and lower(btrim(t.label)) in (select lower(btrim(w)) from unnest(v_words) w);
      with cm as (
        -- O mențiune găsită de două cuvinte ale aceluiași competitor se numără o dată (ca în matrice).
        select distinct on (c.native_id) c.native_id, coalesce(nullif(btrim(c.platform), ''), 'necunoscută') as platform, c.sentiment
        from public.competitor_mentions c
        where c.brand_id = p_brand_id and c.keyword_id = any (v_ids) and c.published_at >= v_from and c.published_at < v_to
          and not metrics.mention_other_language(null, c.language_detected)
        order by c.native_id, c.keyword_id
      )
      select jsonb_build_object(
        'id', v_mem.id,
        'sentiment', (select jsonb_build_object(
                        'total', s.pos + s.neu + s.neg, 'positive', s.pos, 'neutral', s.neu, 'negative', s.neg, 'unknown', s.unk,
                        'owned_excluded', 0,
                        'shares', jsonb_build_object('positive', metrics.ratio(s.pos, s.pos + s.neu + s.neg, 100),
                                                     'neutral', metrics.ratio(s.neu, s.pos + s.neu + s.neg, 100),
                                                     'negative', metrics.ratio(s.neg, s.pos + s.neu + s.neg, 100)),
                        'net', metrics.ratio(s.pos - s.neg, s.pos + s.neu + s.neg, 100))
                      from (select count(*) filter (where cm.sentiment = 'positive') as pos, count(*) filter (where cm.sentiment = 'neutral') as neu,
                                   count(*) filter (where cm.sentiment = 'negative') as neg, count(*) filter (where cm.sentiment = 'unknown') as unk
                            from cm) s),
        'platform_counts', (select coalesce(jsonb_object_agg(p.platform, p.n), '{}'::jsonb)
                            from (select cm.platform, count(*) as n from cm group by cm.platform) p),
        'tracked', cardinality(v_ids) > 0)
        into v_comp;
      v_entities := v_entities || jsonb_build_array(v_comp);
      v_counts := v_counts || jsonb_build_object(v_mem.id::text, v_comp -> 'platform_counts');
    end loop;

    v_sov_brand := (select r -> 'cells' -> p_brand_id::text from jsonb_array_elements(v_rows) r where r ->> 'key' = 'mentions_sov');
    v_comp := jsonb_build_object(
      'set_version', v_matrix -> 'set_version',
      'effective_from', v_matrix -> 'effective_from',
      'entities', (
        select jsonb_agg(jsonb_build_object(
                 'id', e ->> 'id', 'name', e ->> 'name', 'label', e ->> 'label', 'kind', e ->> 'kind',
                 'mentions', (select r -> 'cells' -> (e ->> 'id') from jsonb_array_elements(v_rows) r where r ->> 'key' = 'mentions_count'),
                 'share_of_voice', (select r -> 'cells' -> (e ->> 'id') from jsonb_array_elements(v_rows) r where r ->> 'key' = 'mentions_sov'),
                 'sentiment', case when e ->> 'kind' = 'brand' then v_brand -> 'auto_sentiment'
                                   else (select x -> 'sentiment' from jsonb_array_elements(v_entities) x where x ->> 'id' = e ->> 'id') end,
                 'tracked', case when e ->> 'kind' = 'brand' then true
                                 else coalesce((select (x ->> 'tracked')::boolean from jsonb_array_elements(v_entities) x where x ->> 'id' = e ->> 'id'), false) end)
               order by o)
        from jsonb_array_elements(v_matrix -> 'entities') with ordinality as z(e, o)),
      -- Pe rețea: mențiunile fiecărei entități și cota brandului. Cota se dă doar când share of voice-ul are valoare (toți
      -- competitorii compleți), ca să nu se împartă la un total incomplet.
      'platforms', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'platform', p.platform,
                 'counts', p.counts,
                 'total', p.total,
                 'brand_share', case when jsonb_typeof(v_sov_brand -> 'value') = 'number'
                                     then metrics.ratio(coalesce((p.counts ->> p_brand_id::text)::numeric, 0), p.total, 100) end)
               order by p.total desc, p.platform), '[]'::jsonb)
        from (
          select k.platform,
                 jsonb_object_agg(c.key, coalesce((c.value ->> k.platform)::numeric, 0)) as counts,
                 sum(coalesce((c.value ->> k.platform)::numeric, 0)) as total
          from (select distinct jsonb_object_keys(c2.value) as platform from jsonb_each(v_counts) c2) k
          cross join jsonb_each(v_counts) c
          group by k.platform
        ) p)
    );
  else
    v_comp := null;
  end if;

  return jsonb_build_object(
    'connected', private.brand_source_connected(p_brand_id, 'planable_listening'),
    'days', to_jsonb(v_days),
    'total', v_brand -> 'total',
    'series', v_brand -> 'series',
    'platforms', v_brand -> 'platforms',
    'engagement', v_brand -> 'engagement',
    'auto_sentiment', v_brand -> 'auto_sentiment',
    'top_voices', v_brand -> 'top_voices',
    'voices_basis', v_brand -> 'voices_basis',
    'topics', v_topics,
    'topics_tracked', exists (select 1 from public.listening_trackers t where t.brand_id = p_brand_id and t.kind = 'topic'),
    'competition', v_comp);
end;
$$;

revoke all on function public.brand_listening_overview(uuid, date, date) from public, anon;
grant execute on function public.brand_listening_overview(uuid, date, date) to authenticated, service_role;
comment on function public.brand_listening_overview(uuid, date, date) is
  'Ecranul Listening (deciziile AH): seria pe zi și rețea, interacțiunile, sentimentul automat Planable, vocile principale, topicurile '
  'și comparația cu competitorii. SECURITY INVOKER; verifică has_brand_access (E8).';

-- 5. Feed-ul: autorul mențiunii, cum îl trimite sursa (numele, altfel username-ul). Până acum era mereu NULL (D-22). --------------

do $$
declare
  v_def text;
  v_old constant text := $q$'source_name', coalesce(m.source_name, 'necunoscută'), 'author', null,$q$;
  v_new constant text := $q$'source_name', coalesce(m.source_name, 'necunoscută'), 'author', coalesce(m.author_name, m.author_username),$q$;
begin
  select pg_get_functiondef('public.brand_mentions(uuid, date, date, text, text, integer, integer, text, text)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'brand_mentions nu mai are câmpul author așteptat';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
