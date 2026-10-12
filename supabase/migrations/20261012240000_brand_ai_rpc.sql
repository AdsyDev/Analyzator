-- AI Visibility pentru ecranul de brand (D-15). SECURITY INVOKER (RLS pe tabelele AI), ratele cu metrics.ratio/change.
-- Stări (spec 2.2): eroarea tehnică iese din numitor; refuzul valid rămâne la numitor, fără brand.
-- Engine-uri în UI: chatgpt (openai), gemini, perplexity, aio (google_ai_overview). Excepția E8.

create function private.ai_engine_db(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'chatgpt' then 'openai' when 'aio' then 'google_ai_overview' when 'gemini' then 'gemini' when 'perplexity' then 'perplexity' end;
$$;
create function private.ai_engine_ui(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'openai' then 'chatgpt' when 'google_ai_overview' then 'aio' when 'gemini' then 'gemini' when 'perplexity' then 'perplexity' end;
$$;
revoke all on function private.ai_engine_db(text) from public, anon;
revoke all on function private.ai_engine_ui(text) from public, anon;
grant execute on function private.ai_engine_db(text) to authenticated, service_role;
grant execute on function private.ai_engine_ui(text) to authenticated, service_role;

-- Verificările comune: acces, perioadă, filtre.
create function private.ai_check(p_brand_id uuid, p_start date, p_end date, p_engine text, p_group text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if p_engine is not null and private.ai_engine_db(p_engine) is null then
    raise exception 'Engine necunoscut: %', p_engine using errcode = '22023';
  end if;
  if p_group is not null and length(p_group) > 300 then
    raise exception 'Grup invalid' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.ai_check(uuid, date, date, text, text) from public, anon;
grant execute on function private.ai_check(uuid, date, date, text, text) to authenticated, service_role;

-- Răspunsurile din perioadă, cu filtrele ecranului; grupul se alege după nume (filtrul din URL).
create function private.ai_scope(p_brand_id uuid, p_start date, p_end date, p_engine text, p_group text)
returns table (id uuid, tenant_id uuid, engine text, keyword_id text, device text, crawl_at date, status text, group_id text, group_name text, content text)
language sql stable set search_path = '' as $$
  select a.id, a.tenant_id, a.engine, a.keyword_id, a.device, a.crawl_at, a.status, a.attributed_group_id,
         coalesce((select g.name from public.keyword_groups g where g.brand_id = a.brand_id and g.group_id = a.attributed_group_id order by g.collected_at desc limit 1), a.attributed_group_id),
         a.content
  from public.ai_answers a
  where a.brand_id = p_brand_id and a.crawl_at between p_start and p_end
    and (p_engine is null or a.engine = private.ai_engine_db(p_engine))
    and (p_group is null or exists (select 1 from public.keyword_groups g where g.brand_id = a.brand_id and g.group_id = a.attributed_group_id and g.name = p_group));
$$;
revoke all on function private.ai_scope(uuid, date, date, text, text) from public, anon;
grant execute on function private.ai_scope(uuid, date, date, text, text) to authenticated, service_role;

create function public.brand_ai_engines(p_brand_id uuid, p_start date, p_end date, p_kind text default 'custom', p_group text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_cmp jsonb;
begin
  perform private.ai_check(p_brand_id, p_start, p_end, null, p_group);
  if not private.brand_source_connected(p_brand_id, 'seomonitor') then return jsonb_build_object('connected', false); end if;
  v_cmp := metrics.comparison_period(p_start, p_end, coalesce(p_kind, 'custom'));
  return jsonb_build_object('connected', true, 'engines', coalesce((
    select jsonb_agg(jsonb_build_object(
      'engine', private.ai_engine_ui(e.engine),
      'mention_rate', metrics.ratio(c.present, c.valid, 100),
      'delta_pp', metrics.change(metrics.ratio(c.present, c.valid, 100), metrics.ratio(p.present, p.valid, 100), 'percent') -> 'absolute_change',
      'valid_answers', coalesce(c.valid, 0), 'total_answers', coalesce(c.total, 0),
      'status', case when coalesce(c.valid, 0) = 0 then 'unavailable' when c.valid < 50 then 'insufficient_sample' when c.errors > 0 then 'partial' else 'ok' end)
      order by e.ord)
    from (values ('openai', 1), ('gemini', 2), ('perplexity', 3), ('google_ai_overview', 4)) e (engine, ord)
    left join (select s.engine, count(*) as total, count(*) filter (where s.status <> 'technical_error') as valid,
                      count(*) filter (where s.status = 'brand_present') as present, count(*) filter (where s.status = 'technical_error') as errors
               from private.ai_scope(p_brand_id, p_start, p_end, null, p_group) s group by s.engine) c on c.engine = e.engine
    left join (select s.engine, count(*) filter (where s.status <> 'technical_error') as valid, count(*) filter (where s.status = 'brand_present') as present
               from private.ai_scope(p_brand_id, (v_cmp ->> 'start')::date, (v_cmp ->> 'end')::date, null, p_group) s group by s.engine) p on p.engine = e.engine
    where c.engine is not null), '[]'::jsonb));
end;
$$;

create function public.brand_ai_trends(p_brand_id uuid, p_start date, p_end date, p_engine text default null, p_group text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.ai_check(p_brand_id, p_start, p_end, p_engine, p_group);
  if not private.brand_source_connected(p_brand_id, 'seomonitor') then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'trends', coalesce((
    select jsonb_agg(jsonb_build_object('engine', private.ai_engine_ui(e.engine), 'status', case when exists (select 1 from private.ai_scope(p_brand_id, p_start, p_end, private.ai_engine_ui(e.engine), p_group) where status <> 'technical_error') then 'ok' else 'unavailable' end,
      'points', (select jsonb_agg(jsonb_build_object('date', d.day, 'value', metrics.ratio(t.present, t.valid, 100)) order by d.day)
                 from generate_series(p_start, p_end, interval '1 day') g (ts) cross join lateral (select g.ts::date as day) d
                 left join (select s.crawl_at, count(*) filter (where s.status <> 'technical_error') as valid, count(*) filter (where s.status = 'brand_present') as present
                            from private.ai_scope(p_brand_id, p_start, p_end, private.ai_engine_ui(e.engine), p_group) s group by s.crawl_at) t on t.crawl_at = d.day))
      order by e.ord)
    from (values ('openai', 1), ('gemini', 2), ('perplexity', 3), ('google_ai_overview', 4)) e (engine, ord)
    where (p_engine is null or e.engine = private.ai_engine_db(p_engine))
      and exists (select 1 from private.ai_scope(p_brand_id, p_start, p_end, private.ai_engine_ui(e.engine), p_group))), '[]'::jsonb));
end;
$$;

-- Matricea topic × entitate: rata de menționare a brandului (din răspunsuri) și a competitorilor din setul în vigoare la
-- sfârșitul perioadei (din observațiile de competiție). Sub 20 de răspunsuri valide pe topic: „eșantion insuficient” (spec cap. 10).
create function public.brand_ai_topic_matrix(p_brand_id uuid, p_start date, p_end date, p_engine text default null, p_group text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_brand record; v_set uuid;
begin
  perform private.ai_check(p_brand_id, p_start, p_end, p_engine, p_group);
  if not private.brand_source_connected(p_brand_id, 'seomonitor') then return jsonb_build_object('connected', false); end if;
  select b.id, b.name, b.tenant_id into v_brand from public.brands b where b.id = p_brand_id;
  select cs.id into v_set from public.competitor_sets cs where cs.brand_id = p_brand_id and cs.effective_from <= p_end order by cs.effective_from desc limit 1;
  return jsonb_build_object('connected', true,
    'entities', jsonb_build_array(jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'kind', 'brand', 'label', v_brand.name))
      || coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'kind', 'competitor', 'label', 'C' || row_number) order by row_number)
                   from (select m.*, row_number() over (order by m.sort_order, m.name) from public.competitor_set_members m where m.competitor_set_id = v_set) m), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('topic', t.group_name, 'group', t.group_name, 'n', t.valid, 'coverage', metrics.ratio(t.valid, t.total)) order by t.group_name)
                        from (select s.group_name, count(*) as total, count(*) filter (where s.status <> 'technical_error') as valid from private.ai_scope(p_brand_id, p_start, p_end, p_engine, p_group) s group by s.group_name) t), '[]'::jsonb),
    'cells', coalesce((
      select jsonb_object_agg(t.group_name, t.cells) from (
        select s.group_name,
          jsonb_build_object(p_brand_id::text, jsonb_build_object(
              'numerator', count(*) filter (where s.status = 'brand_present'), 'denominator', count(*) filter (where s.status <> 'technical_error'),
              'value', metrics.ratio(count(*) filter (where s.status = 'brand_present'), count(*) filter (where s.status <> 'technical_error'), 100),
              'status', case when count(*) filter (where s.status <> 'technical_error') = 0 then 'unavailable' when count(*) filter (where s.status <> 'technical_error') < 20 then 'insufficient_sample' else 'ok' end))
          || coalesce((
            select jsonb_object_agg(m.id::text, jsonb_build_object('numerator', x.present, 'denominator', x.valid, 'value', metrics.ratio(x.present, x.valid, 100),
                     'status', case when coalesce(x.valid, 0) = 0 then 'unavailable' when x.valid < 20 then 'insufficient_sample' else 'ok' end))
            from public.competitor_set_members m
            left join lateral (
              select count(*) filter (where o.present) as present, count(*) as valid
              from public.ai_brand_observations o
              join private.ai_scope(p_brand_id, p_start, p_end, p_engine, p_group) s2 on s2.engine = o.engine and s2.keyword_id = o.keyword_id and s2.device = o.device and s2.crawl_at = o.crawl_at
              where o.brand_id = p_brand_id and o.observed_domain = m.domain and o.status <> 'technical_error' and s2.group_name = s.group_name
            ) x on true
            where m.competitor_set_id = v_set), '{}'::jsonb) as cells
        from private.ai_scope(p_brand_id, p_start, p_end, p_engine, p_group) s group by s.group_name) t), '{}'::jsonb));
end;
$$;

create function public.brand_ai_cited_sources(p_brand_id uuid, p_start date, p_end date, p_engine text default null, p_group text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.ai_check(p_brand_id, p_start, p_end, p_engine, p_group);
  if not private.brand_source_connected(p_brand_id, 'seomonitor') then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'sources', coalesce((
    select jsonb_agg(jsonb_build_object('domain', d.domain, 'kind', case when d.owned then 'owned' else 'third_party' end, 'count', d.n, 'brand_id', case when d.owned then p_brand_id end)
             order by d.n desc, d.domain)
    from (
      select lower(regexp_replace(substring(c.url from '^[a-z]+://([^/?#]+)'), '^www\.', '')) as domain, bool_or(c.is_own_domain) as owned,
             count(distinct (c.engine, c.keyword_id, c.crawl_at, c.device)) as n
      from public.ai_citations c
      join private.ai_scope(p_brand_id, p_start, p_end, p_engine, p_group) s on s.engine = c.engine and s.keyword_id = c.keyword_id and s.crawl_at = c.crawl_at and s.device = c.device
      where c.brand_id = p_brand_id and s.status <> 'technical_error'
      group by 1
      order by 3 desc limit 200
    ) d where d.domain is not null), '[]'::jsonb));
end;
$$;

-- Stările din UI: SEOmonitor nu dă recomandarea explicită, deci prezența e „mentioned”, nu „recommended”.
create function private.ai_outcome(p_status text) returns text language sql immutable set search_path = '' as $$
  select case p_status when 'brand_present' then 'mentioned' when 'brand_absent' then 'not_mentioned' when 'refusal' then 'refused' else 'error' end;
$$;
revoke all on function private.ai_outcome(text) from public, anon;
grant execute on function private.ai_outcome(text) to authenticated, service_role;

create function public.brand_ai_answers(p_brand_id uuid, p_start date, p_end date, p_engine text default null, p_group text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.ai_check(p_brand_id, p_start, p_end, p_engine, p_group);
  if p_page < 1 or p_page_size < 1 or p_page_size > 100 then raise exception 'Paginare invalidă' using errcode = '22023'; end if;
  if not private.brand_source_connected(p_brand_id, 'seomonitor') then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'page', p_page, 'page_size', p_page_size,
    'total', (select count(*) from private.ai_scope(p_brand_id, p_start, p_end, p_engine, p_group)),
    'items', coalesce((
      select jsonb_agg(x.j order by x.crawl_at desc, x.id) from (
        select s.crawl_at, s.id, jsonb_build_object(
          'id', s.id, 'engine', private.ai_engine_ui(s.engine), 'group', s.group_name,
          'question', coalesce((select k.keyword from public.keywords k where k.brand_id = p_brand_id and k.keyword_id = s.keyword_id limit 1), s.keyword_id),
          'collected_at', (s.crawl_at::timestamp at time zone 'Europe/Bucharest'), 'outcome', private.ai_outcome(s.status),
          'pv_flag', (select jsonb_build_object('id', f.id, 'item', jsonb_build_object('kind', 'ai_answer', 'id', f.entity_ref), 'flagged_at', f.flagged_at,
                        'flagged_by', 'utilizator ' || left(f.flagged_by::text, 8), 'notified', f.status <> 'open',
                        'status', case f.status when 'open' then 'pending' when 'notified' then 'notified' else 'acknowledged' end)
                      from public.pv_flags f where f.brand_id = p_brand_id and f.entity_type = 'ai_answer' and f.entity_ref = s.id::text order by f.flagged_at desc limit 1)) as j
        from private.ai_scope(p_brand_id, p_start, p_end, p_engine, p_group) s
        where private.ai_engine_ui(s.engine) is not null
        order by s.crawl_at desc, s.id offset (p_page - 1) * p_page_size limit p_page_size) x), '[]'::jsonb));
end;
$$;

-- Detaliul unui răspuns: textul sanitizat de conector (fără evidențierea brandurilor: sursa nu dă pozițiile lor în text),
-- citările în ordinea din răspuns și entitățile prezente (brandul și competitorii din set observați în același răspuns).
create function public.brand_ai_answer(p_brand_id uuid, p_answer_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare a record; v_set uuid;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  select x.*, coalesce((select g.name from public.keyword_groups g where g.brand_id = x.brand_id and g.group_id = x.attributed_group_id order by g.collected_at desc limit 1), x.attributed_group_id) as group_name
    into a from public.ai_answers x where x.id = p_answer_id and x.brand_id = p_brand_id;
  if a.id is null then return null; end if;
  select cs.id into v_set from public.competitor_sets cs where cs.brand_id = p_brand_id and cs.effective_from <= a.crawl_at order by cs.effective_from desc limit 1;
  return jsonb_build_object(
    'id', a.id, 'engine', private.ai_engine_ui(a.engine), 'group', a.group_name,
    'question', coalesce((select k.keyword from public.keywords k where k.brand_id = p_brand_id and k.keyword_id = a.keyword_id limit 1), a.keyword_id),
    'collected_at', (a.crawl_at::timestamp at time zone 'Europe/Bucharest'), 'outcome', private.ai_outcome(a.status), 'pv_flag', null,
    'collection_note', case when a.status in ('technical_error', 'refusal') then null
                            else 'SEOmonitor marchează prezența brandului, nu recomandarea explicită sau pozițiile brandurilor în text: textul apare fără evidențieri.' end,
    'segments', case when a.status in ('technical_error', 'refusal') or coalesce(a.content, '') = '' then '[]'::jsonb
                     else jsonb_build_array(jsonb_build_object('kind', 'text', 'text', a.content)) end,
    'citations', coalesce((select jsonb_agg(jsonb_build_object('n', c.position, 'domain', lower(regexp_replace(substring(c.url from '^[a-z]+://([^/?#]+)'), '^www\.', '')),
                                   'title', lower(regexp_replace(substring(c.url from '^[a-z]+://([^/?#]+)'), '^www\.', '')), 'url', c.url, 'owned', c.is_own_domain) order by c.position)
                           from public.ai_citations c where c.brand_id = p_brand_id and c.engine = a.engine and c.keyword_id = a.keyword_id and c.crawl_at = a.crawl_at and c.device = a.device), '[]'::jsonb),
    'entities_present', (case when a.status = 'brand_present' then jsonb_build_array(p_brand_id) else '[]'::jsonb end)
      || coalesce((select jsonb_agg(distinct m.id) from public.ai_brand_observations o join public.competitor_set_members m on m.competitor_set_id = v_set and m.domain = o.observed_domain
                   where o.brand_id = p_brand_id and o.engine = a.engine and o.keyword_id = a.keyword_id and o.crawl_at = a.crawl_at and o.device = a.device and o.present), '[]'::jsonb),
    'entities_recommended', '[]'::jsonb);
end;
$$;

revoke all on function public.brand_ai_engines(uuid, date, date, text, text) from public, anon;
revoke all on function public.brand_ai_trends(uuid, date, date, text, text) from public, anon;
revoke all on function public.brand_ai_topic_matrix(uuid, date, date, text, text) from public, anon;
revoke all on function public.brand_ai_cited_sources(uuid, date, date, text, text) from public, anon;
revoke all on function public.brand_ai_answers(uuid, date, date, text, text, integer, integer) from public, anon;
revoke all on function public.brand_ai_answer(uuid, uuid) from public, anon;
grant execute on function public.brand_ai_engines(uuid, date, date, text, text) to authenticated, service_role;
grant execute on function public.brand_ai_trends(uuid, date, date, text, text) to authenticated, service_role;
grant execute on function public.brand_ai_topic_matrix(uuid, date, date, text, text) to authenticated, service_role;
grant execute on function public.brand_ai_cited_sources(uuid, date, date, text, text) to authenticated, service_role;
grant execute on function public.brand_ai_answers(uuid, date, date, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.brand_ai_answer(uuid, uuid) to authenticated, service_role;
