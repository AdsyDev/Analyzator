-- Etapa 4, a doua felie (deciziile O din docs/decisions.md): analize generate de AdSy AI, cu status și revizuire.
--
-- AdSy AI scrie doar CIORNE în `insights`. Ciorna trece prin același flux ca una scrisă de om: trimisă la review de echipă și
-- publicată de strategist sau agency_admin. Nimic generat nu ajunge la client fără publicarea făcută de un om.
--
-- 1. `insights.origin` și `insights.ai_request_id`: proveniența. O ciornă marcată `adsy_ai` trebuie să indice o cerere reușită
--    din `ai_requests`, a aceluiași utilizator, brand și perioadă. Marcajul nu se schimbă și se moștenește la versiunea nouă.
-- 2. `brand_insights` întoarce proveniența și ascunde analizele generate când afișarea e oprită (politică sau preferință).
-- 3. `brand_ai_settings` spune în plus dacă utilizatorul poate cere o ciornă (`can_generate`).

-- 1. Proveniența ------------------------------------------------------------------------------------------------------------

alter table public.insights
  add column origin text not null default 'human' check (origin in ('human', 'adsy_ai')),
  add column ai_request_id uuid references public.ai_requests (id) on delete restrict,
  add constraint insights_origin_request_check check ((origin = 'adsy_ai') = (ai_request_id is not null));
comment on column public.insights.origin is
  'Proveniența textului: `human` (scris de echipă) sau `adsy_ai` (ciornă generată, apoi revizuită de echipă). Nu se schimbă după inserare.';
comment on column public.insights.ai_request_id is
  'Cererea din `ai_requests` care a produs ciorna. O cerere produce cel mult o ciornă; versiunile ei de înlocuire o moștenesc.';

-- O cerere reușită produce o singură ciornă. Versiunile de înlocuire (supersedes_id) poartă aceeași cerere.
create unique index insights_ai_request_once_idx on public.insights (ai_request_id) where ai_request_id is not null and supersedes_id is null;

grant insert (origin, ai_request_id) on public.insights to authenticated;

create or replace function private.insights_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.insights%rowtype;
  v_req public.ai_requests%rowtype;
begin
  new.status := 'draft';
  new.published_at := null;
  new.published_by := null;
  new.submitted_at := null;
  new.superseded_by_id := null;
  new.version := 1;

  if new.supersedes_id is not null then
    select * into v_old from public.insights where id = new.supersedes_id and tenant_id = new.tenant_id and brand_id = new.brand_id;
    if not found or v_old.status <> 'published' then
      raise exception 'Se poate înlocui doar o analiză publicată din același brand' using errcode = '22023';
    end if;
    if exists (select 1 from public.insights where supersedes_id = new.supersedes_id) then
      raise exception 'Analiza are deja o versiune de înlocuire în lucru' using errcode = '23505';
    end if;
    new.version := v_old.version + 1;
    -- Versiunea nouă a unei analize generate rămâne marcată ca generată: eticheta nu se pierde prin înlocuire.
    new.origin := v_old.origin;
    new.ai_request_id := v_old.ai_request_id;
    return new;
  end if;

  if new.origin = 'adsy_ai' then
    -- Marcajul trebuie să indice o cerere de generare reușită, a aceluiași utilizator, pe același brand și aceeași perioadă.
    select * into v_req from public.ai_requests r
    where r.id = new.ai_request_id and r.tenant_id = new.tenant_id and r.brand_id = new.brand_id;
    if not found or v_req.task <> 'generate_insight' or v_req.status <> 'ok' or v_req.user_id is distinct from new.author_id
       or v_req.period_start <> new.period_start or v_req.period_end <> new.period_end then
      raise exception 'Ciorna generată nu corespunde unei cereri AdSy AI reușite' using errcode = '42501';
    end if;
  else
    new.ai_request_id := null;
  end if;
  return new;
end;
$$;

create or replace function private.insights_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_flag boolean := coalesce(current_setting('analyzator.transition', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'O analiză % nu se șterge; istoricul se păstrează', old.status using errcode = '42501';
    end if;
    return old;
  end if;

  if new.tenant_id is distinct from old.tenant_id or new.brand_id is distinct from old.brand_id
     or new.author_id is distinct from old.author_id or new.version is distinct from old.version
     or new.supersedes_id is distinct from old.supersedes_id or new.created_at is distinct from old.created_at then
    raise exception 'tenant_id, brand_id, author_id, version și supersedes_id nu se modifică' using errcode = '42501';
  end if;
  -- Proveniența nu se rescrie: o ciornă generată rămâne marcată și după editare, review și publicare.
  if new.origin is distinct from old.origin or new.ai_request_id is distinct from old.ai_request_id then
    raise exception 'Proveniența unei analize nu se modifică' using errcode = '42501';
  end if;

  if old.status in ('published', 'superseded') then
    if v_flag and old.status = 'published' and new.status = 'superseded'
       and new.title = old.title and new.summary = old.summary and new.interpretation = old.interpretation
       and new.limits = old.limits and new.period_start = old.period_start and new.period_end = old.period_end
       and new.period_kind = old.period_kind and new.published_at is not distinct from old.published_at then
      return new;
    end if;
    raise exception 'O analiză publicată nu se mai editează; creează o versiune nouă (insert cu supersedes_id)' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not v_flag then
    raise exception 'Statusul se schimbă doar prin insight_transitions' using errcode = '42501';
  end if;
  if old.status = 'in_review' and not v_flag then
    raise exception 'O analiză în review nu se editează; returnează-o la draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 2. brand_insights: proveniența și controlul „afișare” ----------------------------------------------------------------------

create or replace function public.brand_insights(p_brand_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_display boolean;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  -- Afișarea conținutului generat: politica brandului ȘI preferința utilizatorului (ca în brand_ai_settings). Fără politică,
  -- afișarea e oprită. E un control de prezentare, nu de acces: analiza publicată rămâne a brandului.
  v_display := coalesce((select p.display_enabled from public.ai_brand_policies p where p.brand_id = p_brand_id), false)
           and coalesce((select u.display_enabled from public.ai_user_preferences u where u.brand_id = p_brand_id and u.user_id = (select auth.uid())), true);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'brand_id', i.brand_id, 'title', i.title, 'summary', i.summary,
      'interpretation', i.interpretation, 'version', i.version, 'supersedes_id', i.supersedes_id,
      'origin', i.origin,
      'author', jsonb_build_object('id', i.author_id, 'name', 'Utilizator ' || left(i.author_id::text, 8), 'role', 'Echipa agenției'),
      'period', jsonb_build_object('from', i.period_start, 'to', i.period_end),
      'status', i.status, 'limits', nullif(i.limits, ''),
      'updated_at', i.updated_at, 'published_at', i.published_at,
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
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
      'recommendations', coalesce((
        select jsonb_agg(jsonb_build_object('id', r.id, 'problem', r.problem, 'action', r.action, 'expected_benefit', r.expected_benefit, 'priority', r.priority)
          order by r.priority, r.created_at)
        from public.recommendations r where r.insight_id = i.id), '[]'::jsonb),
      'actions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'title', a.title,
          'owner', jsonb_build_object('id', a.responsible_user_id, 'name', 'Utilizator ' || left(a.responsible_user_id::text, 8), 'role', 'Echipa agenției'),
          'due', a.due_date,
          'status', case a.status when 'proposed' then 'open' when 'agreed' then 'open' when 'in_progress' then 'in_progress'
                                  when 'done' then 'done' when 'measured' then 'done' else 'cancelled' end,
          'stage', a.status,
          'effort', a.effort,
          'tracked_metric', case when a.tracked_metric_key is null then null
                                 else jsonb_build_object('metric_key', a.tracked_metric_key, 'label', coalesce(t.name_ro, a.tracked_metric_key)) end,
          'result_note', a.result_note)
          order by a.created_at)
        from public.actions a
        left join public.metric_definitions_current t on t.metric_key = a.tracked_metric_key
        where a.insight_id = i.id), '[]'::jsonb)
    ) order by coalesce(i.published_at, i.updated_at) desc)
    from public.insights i
    where i.brand_id = p_brand_id and i.period_end >= p_start and i.period_start <= p_end
      and (i.origin = 'human' or v_display)
  ), '[]'::jsonb);
end;
$$;

comment on function public.brand_insights(uuid, date, date) is
  'Analizele brandului care se suprapun cu perioada, cu dovezi, recomandări, acțiuni și proveniență. Analizele generate de AdSy AI apar doar cu afișarea pornită (politică și preferință). SECURITY INVOKER; verifică has_brand_access (E8).';

-- 3. brand_ai_settings: cine poate cere o ciornă ------------------------------------------------------------------------------

create or replace function public.brand_ai_settings(p_brand_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_policy record;
  v_pref record;
  v_admin boolean;
  v_month_start timestamptz;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;

  select p.chat_enabled, p.generation_enabled, p.display_enabled, p.monthly_token_cap, p.updated_at into v_policy
  from public.ai_brand_policies p where p.brand_id = p_brand_id;
  select u.chat_enabled, u.display_enabled into v_pref
  from public.ai_user_preferences u where u.brand_id = p_brand_id and u.user_id = (select auth.uid());
  v_admin := private.has_brand_role(p_brand_id, array['agency_admin']::public.membership_role[]);
  -- Luna calendaristică în Europe/Bucharest (regula 9).
  v_month_start := date_trunc('month', now() at time zone 'Europe/Bucharest') at time zone 'Europe/Bucharest';

  return jsonb_build_object(
    'tenant_id', (select b.tenant_id from public.brands b where b.id = p_brand_id),
    -- Fără politică salvată, toate cele trei sunt oprite.
    'policy', jsonb_build_object(
      'chat', coalesce(v_policy.chat_enabled, false),
      'generation', coalesce(v_policy.generation_enabled, false),
      'display', coalesce(v_policy.display_enabled, false),
      'monthly_token_cap', v_policy.monthly_token_cap,
      'updated_at', v_policy.updated_at),
    -- Fără preferință salvată, utilizatorul nu a oprit nimic.
    'preference', jsonb_build_object('chat', coalesce(v_pref.chat_enabled, true), 'display', coalesce(v_pref.display_enabled, true)),
    -- Politica brandului bate preferința: preferința poate doar să restrângă. Generarea nu are preferință personală.
    'effective', jsonb_build_object(
      'chat', coalesce(v_policy.chat_enabled, false) and coalesce(v_pref.chat_enabled, true),
      'generation', coalesce(v_policy.generation_enabled, false),
      'display', coalesce(v_policy.display_enabled, false) and coalesce(v_pref.display_enabled, true)),
    'can_edit_policy', v_admin,
    -- Ciornele le scriu aceleași roluri care scriu analize (RLS pe insights); clientul nu poate cere una.
    'can_generate', private.has_brand_role(p_brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]),
    -- Consumul lunii îl vede doar cine vede toate cererile brandului (agency_admin); altfel ar fi doar consumul propriu.
    'month_tokens', case when v_admin then
      (select coalesce(sum(r.total_tokens), 0) from public.ai_requests r where r.brand_id = p_brand_id and r.created_at >= v_month_start) end);
end;
$$;
