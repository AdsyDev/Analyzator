-- Răspunsul clientului la recomandări și comentariile pe analizele publicate (deciziile S din docs/decisions.md).
-- Cu rolul de client existent (`client_viewer`), fără un rol nou: decizia proprietarului produsului din 11 nov. 2026.
--
-- 1. `recommendation_responses`: clientul acceptă o recomandare sau cere o ajustare (cu motiv). Jurnal: fiecare răspuns e un
--    rând nou; ultimul e cel în vigoare.
-- 2. `insight_comments`: discuția de pe o analiză publicată, între client și echipă.
-- 3. `brand_insights` întoarce ultimul răspuns pe fiecare recomandare și comentariile analizei.
--
-- Ambele tabele sunt doar de adăugare: nu se editează și nu se șterg. Se scrie doar pe analize `published`. Tranzițiile
-- analizelor și ale acțiunilor nu se schimbă: acceptarea clientului nu mută singură nicio acțiune.

-- 1. Răspunsul clientului la o recomandare --------------------------------------------------------------------------------------

create table public.recommendation_responses (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  brand_id           uuid not null,
  insight_id         uuid not null,
  recommendation_id  uuid not null,
  response           text not null check (response in ('accepted', 'adjustment_requested')),
  -- Obligatoriu la cererea de ajustare: fără el, echipa nu știe ce să ajusteze.
  comment            text check (comment is null or length(trim(comment)) between 1 and 2000),
  user_id            uuid not null,
  created_at         timestamptz not null default now(),
  check (response <> 'adjustment_requested' or comment is not null),
  foreign key (tenant_id, brand_id, insight_id) references public.insights (tenant_id, brand_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, recommendation_id) references public.recommendations (tenant_id, brand_id, id) on delete restrict
);
comment on table public.recommendation_responses is
  'Răspunsul clientului la o recomandare dintr-o analiză publicată: acceptată sau ajustare cerută, cu motiv. Doar de adăugare; ultimul rând e răspunsul în vigoare.';
create index recommendation_responses_recommendation_idx on public.recommendation_responses (recommendation_id, created_at desc);
create index recommendation_responses_brand_idx on public.recommendation_responses (tenant_id, brand_id);

create function private.recommendation_responses_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rec record;
begin
  select r.tenant_id, r.brand_id, r.insight_id, i.status into v_rec
  from public.recommendations r join public.insights i on i.id = r.insight_id
  where r.id = new.recommendation_id;
  -- Același mesaj pentru „nu există”, „nu e publicată” și „fără acces”: nu confirmăm existența recomandării.
  if not found or v_uid is null or v_rec.status <> 'published' or not private.has_brand_access(v_rec.brand_id) then
    raise exception 'Recomandare inexistentă sau fără acces' using errcode = '42501';
  end if;
  -- Răspunsul e al clientului: echipa agenției nu acceptă în numele lui.
  if not private.has_brand_role(v_rec.brand_id, array['client_viewer']::public.membership_role[]) then
    raise exception 'Doar clientul răspunde la o recomandare' using errcode = '42501';
  end if;
  new.comment := nullif(trim(coalesce(new.comment, '')), '');
  if new.response = 'adjustment_requested' and new.comment is null then
    raise exception 'Scrie ce ajustare ceri' using errcode = '23514';
  end if;
  -- Clientul trimite doar recomandarea, răspunsul și motivul; restul vine din recomandare și din sesiune.
  new.tenant_id := v_rec.tenant_id;
  new.brand_id := v_rec.brand_id;
  new.insight_id := v_rec.insight_id;
  new.user_id := v_uid;
  new.created_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.recommendation_responses_before_insert() from public, anon, authenticated;
create trigger recommendation_responses_before_insert before insert on public.recommendation_responses
  for each row execute function private.recommendation_responses_before_insert();
create trigger recommendation_responses_immutable before update or delete on public.recommendation_responses
  for each row execute function private.prevent_update();

-- 2. Comentarii pe analiza publicată --------------------------------------------------------------------------------------------

create table public.insight_comments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  brand_id     uuid not null,
  insight_id   uuid not null,
  author_id    uuid not null,
  -- Cine a scris, la momentul scrierii: clientul sau echipa agenției. Numele nu se arată în interfață (E10).
  author_role  text not null check (author_role in ('client', 'agency')),
  body         text not null check (length(trim(body)) between 1 and 2000),
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, brand_id, insight_id) references public.insights (tenant_id, brand_id, id) on delete restrict
);
comment on table public.insight_comments is
  'Comentariile clientului și ale echipei pe o analiză publicată. Doar de adăugare.';
create index insight_comments_insight_idx on public.insight_comments (insight_id, created_at);
create index insight_comments_brand_idx on public.insight_comments (tenant_id, brand_id);

create function private.insight_comments_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_i record;
begin
  select i.tenant_id, i.brand_id, i.status into v_i from public.insights i where i.id = new.insight_id;
  if not found or v_uid is null or v_i.status <> 'published' or not private.has_brand_access(v_i.brand_id) then
    raise exception 'Analiză inexistentă sau fără acces' using errcode = '42501';
  end if;
  new.body := trim(coalesce(new.body, ''));
  new.tenant_id := v_i.tenant_id;
  new.brand_id := v_i.brand_id;
  new.author_id := v_uid;
  new.author_role := case when private.has_brand_role(v_i.brand_id, private.agency_roles()) then 'agency' else 'client' end;
  new.created_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.insight_comments_before_insert() from public, anon, authenticated;
create trigger insight_comments_before_insert before insert on public.insight_comments
  for each row execute function private.insight_comments_before_insert();
create trigger insight_comments_immutable before update or delete on public.insight_comments
  for each row execute function private.prevent_update();

-- Drepturi și RLS ----------------------------------------------------------------------------------------------------------------

alter table public.recommendation_responses enable row level security;
alter table public.insight_comments enable row level security;
revoke all on public.recommendation_responses, public.insight_comments from public, anon, authenticated;
grant select on public.recommendation_responses, public.insight_comments to authenticated;
grant insert (recommendation_id, response, comment) on public.recommendation_responses to authenticated;
grant insert (insight_id, body) on public.insight_comments to authenticated;
grant all on public.recommendation_responses, public.insight_comments to service_role;

-- Citire: echipa agenției, mereu; clientul, cât analiza e publicată (ca analiza însăși).
create policy recommendation_responses_select on public.recommendation_responses for select to authenticated
  using (brand_id in (select private.accessible_brand_ids())
         and (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
              or exists (select 1 from public.insights i where i.id = insight_id and i.status = 'published')));
-- WITH CHECK rulează după triggerul BEFORE INSERT, care completează brandul și utilizatorul.
create policy recommendation_responses_insert on public.recommendation_responses for insert to authenticated
  with check (user_id = (select auth.uid()) and private.has_brand_role(brand_id, array['client_viewer']::public.membership_role[]));
create policy recommendation_responses_update on public.recommendation_responses for update to authenticated using (false);
create policy recommendation_responses_delete on public.recommendation_responses for delete to authenticated using (false);

create policy insight_comments_select on public.insight_comments for select to authenticated
  using (brand_id in (select private.accessible_brand_ids())
         and (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
              or exists (select 1 from public.insights i where i.id = insight_id and i.status = 'published')));
create policy insight_comments_insert on public.insight_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.has_brand_access(brand_id));
create policy insight_comments_update on public.insight_comments for update to authenticated using (false);
create policy insight_comments_delete on public.insight_comments for delete to authenticated using (false);

-- 3. brand_insights: ultimul răspuns pe recomandare și comentariile analizei ---------------------------------------------------

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
        select jsonb_agg(jsonb_build_object('id', r.id, 'problem', r.problem, 'action', r.action, 'expected_benefit', r.expected_benefit, 'priority', r.priority,
            -- Ultimul răspuns al clientului la recomandare; istoricul rămâne în tabel. NULL = clientul nu a răspuns încă.
            'client_response', (
              select jsonb_build_object('response', x.response, 'comment', x.comment, 'at', x.created_at,
                'by', 'Utilizator ' || left(x.user_id::text, 8), 'own', x.user_id = (select auth.uid()))
              from public.recommendation_responses x where x.recommendation_id = r.id
              order by x.created_at desc, x.id desc limit 1))
          order by r.priority, r.created_at)
        from public.recommendations r where r.insight_id = i.id), '[]'::jsonb),
      -- Discuția de pe analiza publicată, în ordinea scrierii. Numele nu se arată (E10): doar cine e, client sau echipă.
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'body', c.body, 'created_at', c.created_at, 'author_role', c.author_role,
          'author', 'Utilizator ' || left(c.author_id::text, 8), 'own', c.author_id = (select auth.uid()))
          order by c.created_at, c.id)
        from public.insight_comments c where c.insight_id = i.id), '[]'::jsonb),
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
  'Analizele brandului care se suprapun cu perioada, cu dovezi, recomandări (și ultimul răspuns al clientului), comentarii, acțiuni și proveniență. Analizele generate de AdSy AI apar doar cu afișarea pornită. SECURITY INVOKER; verifică has_brand_access (E8).';
