-- Concurența pentru ecranul de brand (D-16, spec cap. 20). SECURITY INVOKER (E8).
-- Aceleași definiții, surse și intervale pentru brand și competitorii setului în vigoare la sfârșitul perioadei.
-- Ce sursa nu oferă pentru competitori rămâne N/A cu motiv, nu zero:
-- - AI: complet (prezențe și citări în aceleași răspunsuri SEOmonitor, aceleași engine-uri și întrebări);
-- - SEO: pozițiile organice și visibility-ul competitorilor nu sunt colectate;
-- - Listening și social public: mențiunile și conturile competitorilor nu sunt colectate.

-- Celula unei metrici din registru pentru brand (aceeași poartă ca KPI-urile).
create function private.competition_registry_cell(p_tenant uuid, p_brand_id uuid, p_key text, p_start date, p_end date, p_kind text, p_options jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare r jsonb;
begin
  r := private.compute_metric_snapshot(p_tenant, p_brand_id, p_key, p_start, p_end, p_kind, p_options) -> 'metric';
  return jsonb_build_object('value', r -> 'value', 'unit', r ->> 'unit', 'status', r ->> 'status', 'coverage', r -> 'coverage', 'reason', null);
exception when sqlstate '22023' then
  return jsonb_build_object('value', null, 'unit', 'count', 'status', 'not_connected', 'coverage', null, 'reason', 'Metrica nu are încă sursă de observații.');
end;
$$;
revoke all on function private.competition_registry_cell(uuid, uuid, text, date, date, text, jsonb) from public, anon;
grant execute on function private.competition_registry_cell(uuid, uuid, text, date, date, text, jsonb) to authenticated, service_role;

create function public.brand_competition(p_brand_id uuid, p_start date, p_end date, p_kind text default 'custom')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_brand   record;
  v_set     record;
  v_ai      boolean;
  v_na      jsonb;
  v_ai_cells jsonb := '{}'::jsonb;
  v_cit_cells jsonb := '{}'::jsonb;
  v_rec_cells jsonb := '{}'::jsonb;
  v_valid   bigint;
  m         record;
  v_num     bigint;
  v_cit     bigint;
  v_status  text;
  v_entities jsonb;
  v_seo_top  jsonb;
  v_seo_vis  jsonb;
  v_listen   jsonb;
  v_social   jsonb;
begin
  perform private.ai_check(p_brand_id, p_start, p_end, null, null);
  if coalesce(p_kind, '') not in ('custom', 'mtd') then raise exception 'Tip de perioadă necunoscut: %', p_kind using errcode = '22023'; end if;
  select b.id, b.name, b.tenant_id into v_brand from public.brands b where b.id = p_brand_id;
  select cs.id, cs.version, cs.effective_from into v_set from public.competitor_sets cs
  where cs.brand_id = p_brand_id and cs.effective_from <= p_end order by cs.effective_from desc limit 1;
  if v_set.id is null then
    return jsonb_build_object('has_set', false);
  end if;

  select jsonb_build_array(jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'kind', 'brand', 'label', v_brand.name))
         || coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', 'competitor', 'label', 'C' || x.rn) order by x.rn), '[]'::jsonb)
    into v_entities
  from (select mm.id, mm.name, row_number() over (order by mm.sort_order, mm.name) as rn from public.competitor_set_members mm where mm.competitor_set_id = v_set.id) x;

  -- AI: același numitor (răspunsurile valide ale brandului) pentru toate cele patru entități.
  v_ai := private.brand_source_connected(p_brand_id, 'seomonitor');
  select count(*) filter (where s.status <> 'technical_error') into v_valid from private.ai_scope(p_brand_id, p_start, p_end, null, null) s;
  v_status := case when not v_ai then 'not_connected' when coalesce(v_valid, 0) = 0 then 'unavailable' when v_valid < 50 then 'insufficient_sample' else 'ok' end;

  -- Brandul.
  select count(*) filter (where s.status = 'brand_present'),
         count(*) filter (where s.status <> 'technical_error' and exists (
           select 1 from public.ai_citations c where c.brand_id = p_brand_id and c.engine = s.engine and c.keyword_id = s.keyword_id
             and c.crawl_at = s.crawl_at and c.device = s.device and c.is_own_domain))
    into v_num, v_cit from private.ai_scope(p_brand_id, p_start, p_end, null, null) s;
  v_ai_cells := v_ai_cells || jsonb_build_object(p_brand_id::text, jsonb_build_object('value', case when v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_num, v_valid, 100) end, 'unit', 'percent', 'status', v_status, 'coverage', null, 'reason', null));
  v_cit_cells := v_cit_cells || jsonb_build_object(p_brand_id::text, jsonb_build_object('value', case when v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_cit, v_valid, 100) end, 'unit', 'percent', 'status', v_status, 'coverage', null, 'reason', null));

  -- Competitorii: prezențe din observațiile de competiție, citări pe domeniul lor, în aceleași răspunsuri valide.
  for m in select mm.id, mm.domain from public.competitor_set_members mm where mm.competitor_set_id = v_set.id loop
    select count(distinct (o.engine, o.keyword_id, o.crawl_at, o.device)) into v_num
    from public.ai_brand_observations o
    join private.ai_scope(p_brand_id, p_start, p_end, null, null) s on s.engine = o.engine and s.keyword_id = o.keyword_id and s.crawl_at = o.crawl_at and s.device = o.device
    where o.brand_id = p_brand_id and m.domain is not null and o.observed_domain = m.domain and o.present and s.status <> 'technical_error';
    select count(distinct (c.engine, c.keyword_id, c.crawl_at, c.device)) into v_cit
    from public.ai_citations c
    join private.ai_scope(p_brand_id, p_start, p_end, null, null) s on s.engine = c.engine and s.keyword_id = c.keyword_id and s.crawl_at = c.crawl_at and s.device = c.device
    where c.brand_id = p_brand_id and m.domain is not null and s.status <> 'technical_error'
      and lower(regexp_replace(substring(c.url from '^[a-z]+://([^/?#]+)'), '^www\.', '')) in (m.domain, 'www.' || m.domain)
         or (c.brand_id = p_brand_id and m.domain is not null and s.status <> 'technical_error' and lower(substring(c.url from '^[a-z]+://([^/?#]+)')) like '%.' || m.domain);
    v_ai_cells := v_ai_cells || jsonb_build_object(m.id::text, jsonb_build_object(
      'value', case when m.domain is null or v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_num, v_valid, 100) end,
      'unit', 'percent', 'status', case when m.domain is null then 'unavailable' else v_status end, 'coverage', null,
      'reason', case when m.domain is null then 'Competitorul nu are domeniu în setul de competitori.' end));
    v_cit_cells := v_cit_cells || jsonb_build_object(m.id::text, jsonb_build_object(
      'value', case when m.domain is null or v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_cit, v_valid, 100) end,
      'unit', 'percent', 'status', case when m.domain is null then 'unavailable' else v_status end, 'coverage', null,
      'reason', case when m.domain is null then 'Competitorul nu are domeniu în setul de competitori.' end));
  end loop;

  -- Rânduri fără date pentru o parte din entități: N/A cu motiv.
  v_na := jsonb_build_object('value', null, 'unit', 'percent', 'status', 'unavailable', 'coverage', null);
  select jsonb_object_agg(e ->> 'id', v_na || jsonb_build_object('reason', 'SEOmonitor nu marchează recomandarea explicită a unui brand.'))
    into v_rec_cells from jsonb_array_elements(v_entities) e;

  v_seo_top := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'seomonitor_keywords_top10', p_start, p_end, p_kind, '{"device": "desktop"}');
  v_seo_vis := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'seomonitor_visibility_latest', p_start, p_end, p_kind, '{"device": "desktop"}');
  v_listen := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'mentions_count', p_start, p_end, p_kind, '{}');
  v_social := jsonb_build_object('value', (select metrics.ratio(count(*)::numeric, greatest((p_end - p_start + 1)::numeric / 7, 1)) from public.social_posts sp
                                           where sp.brand_id = p_brand_id and sp.published_at >= (p_start::timestamp at time zone 'Europe/Bucharest')
                                             and sp.published_at < ((p_end + 1)::timestamp at time zone 'Europe/Bucharest')),
                                 'unit', 'count', 'coverage', null, 'reason', null,
                                 'status', case when private.brand_source_connected(p_brand_id, 'planable_analytics') then 'ok' else 'not_connected' end);
  if v_social ->> 'status' = 'not_connected' then v_social := v_social || jsonb_build_object('value', null); end if;

  return jsonb_build_object('has_set', true, 'entities', v_entities, 'set_version', v_set.version, 'effective_from', v_set.effective_from,
    'data_as_of', (select max(s.crawl_at) from private.ai_scope(p_brand_id, p_start, p_end, null, null) s),
    'groups', jsonb_build_array(
      jsonb_build_object('dimension', 'ai', 'title', 'AI Visibility', 'source', 'SEOmonitor (AI Search și AI Overview)', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'ai_mention_rate', 'label', 'Mention Rate', 'direction', 'higher_is_better',
          'definition', '100 × răspunsuri valide în care apare entitatea / răspunsuri valide (aceleași întrebări și engine-uri pentru toți).', 'cells', v_ai_cells),
        jsonb_build_object('key', 'ai_citation_rate', 'label', 'Rată de citare', 'direction', 'higher_is_better',
          'definition', '100 × răspunsuri valide care citează domeniul entității / răspunsuri valide.', 'cells', v_cit_cells),
        jsonb_build_object('key', 'ai_recommendation_rate', 'label', 'Recommendation Rate', 'direction', 'higher_is_better',
          'definition', '100 × răspunsuri valide care recomandă explicit entitatea / răspunsuri valide.', 'cells', v_rec_cells))),
      jsonb_build_object('dimension', 'seo', 'title', 'SEO', 'source', 'SEOmonitor', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'seomonitor_keywords_top10', 'label', 'Keywords în Top 10 (desktop)', 'direction', 'higher_is_better',
          'definition', 'Keywords urmărite cu poziția 1–10 la ultima observație.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_seo_top else v_na || jsonb_build_object('unit', 'count', 'reason', 'Pozițiile organice ale competitorilor nu sunt colectate.') end) from jsonb_array_elements(v_entities) e)),
        jsonb_build_object('key', 'seomonitor_visibility_latest', 'label', 'Visibility (desktop)', 'direction', 'higher_is_better',
          'definition', 'Visibility raportată de SEOmonitor, ultima observație.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_seo_vis else v_na || jsonb_build_object('unit', 'score', 'reason', 'Visibility-ul competitorilor nu e colectat.') end) from jsonb_array_elements(v_entities) e)))),
      jsonb_build_object('dimension', 'social', 'title', 'Social public', 'source', 'Planable', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'social_cadence', 'label', 'Postări pe săptămână', 'direction', 'neutral',
          'definition', 'Postări publicate în perioadă / numărul de săptămâni ale perioadei.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_social else v_na || jsonb_build_object('unit', 'count', 'reason', 'Conturile sociale ale competitorilor nu sunt colectate.') end) from jsonb_array_elements(v_entities) e)))),
      jsonb_build_object('dimension', 'listening', 'title', 'Listening', 'source', 'Planable Listening', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'mentions_count', 'label', 'Mențiuni', 'direction', 'neutral',
          'definition', 'Mențiuni distincte publicate în perioadă.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_listen else v_na || jsonb_build_object('unit', 'count', 'reason', 'Mențiunile competitorilor nu sunt colectate (cuvintele de tip „competitor” din Planable nu intră încă).') end) from jsonb_array_elements(v_entities) e))))
    ));
end;
$$;

-- „Unde apare concurența și noi lipsim” (AI): întrebările din perioadă în care, la ultima colectare validă pe engine,
-- cel puțin un competitor din set e prezent, iar brandul lipsește.
create function public.brand_competition_gaps(p_brand_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_set uuid;
begin
  perform private.ai_check(p_brand_id, p_start, p_end, null, null);
  select cs.id into v_set from public.competitor_sets cs where cs.brand_id = p_brand_id and cs.effective_from <= p_end order by cs.effective_from desc limit 1;
  if v_set is null then return jsonb_build_object('has_set', false); end if;
  if not private.brand_source_connected(p_brand_id, 'seomonitor') then return jsonb_build_object('has_set', true, 'connected', false); end if;
  return jsonb_build_object('has_set', true, 'connected', true, 'gaps', coalesce((
    with last_answer as (
      select distinct on (s.keyword_id, s.engine) s.* from private.ai_scope(p_brand_id, p_start, p_end, null, null) s
      where s.status <> 'technical_error' order by s.keyword_id, s.engine, s.crawl_at desc
    ),
    present as (
      select l.keyword_id, l.engine, l.status, mm.id as member_id, mm.name, 'C' || x.rn as label
      from last_answer l
      join public.ai_brand_observations o on o.brand_id = p_brand_id and o.engine = l.engine and o.keyword_id = l.keyword_id and o.crawl_at = l.crawl_at and o.device = l.device and o.present
      join public.competitor_set_members mm on mm.competitor_set_id = v_set and mm.domain = o.observed_domain
      join (select id, row_number() over (order by sort_order, name) as rn from public.competitor_set_members where competitor_set_id = v_set) x on x.id = mm.id
      where l.status <> 'brand_present'
    )
    select jsonb_agg(jsonb_build_object(
      'id', p.keyword_id || ':' || p.engine, 'dimension', 'ai',
      'subject', coalesce((select k.keyword from public.keywords k where k.brand_id = p_brand_id and k.keyword_id = p.keyword_id limit 1), p.keyword_id)
                 || ' (' || case private.ai_engine_ui(p.engine) when 'chatgpt' then 'ChatGPT' when 'gemini' then 'Gemini' when 'perplexity' then 'Perplexity' else 'AI Overview' end || ')',
      'competitors', p.competitors,
      'brand', case p.status when 'refusal' then 'Motorul a refuzat răspunsul' else 'Absent din ultimul răspuns' end) order by p.keyword_id, p.engine)
    from (select keyword_id, engine, min(status) as status, jsonb_agg(jsonb_build_object('label', label, 'name', name, 'detail', 'Prezent în ultimul răspuns') order by label) as competitors
          from present group by keyword_id, engine) p
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.brand_competition(uuid, date, date, text) from public, anon;
revoke all on function public.brand_competition_gaps(uuid, date, date) from public, anon;
grant execute on function public.brand_competition(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.brand_competition_gaps(uuid, date, date) to authenticated, service_role;
