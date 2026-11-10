-- Etapa 2 din propunerea „Specificația dashboardurilor pentru clienți” (10 nov. 2026), deciziile G din docs/decisions.md.
--
-- 1. `brand_metric_evidence`: observațiile din spatele unei metrici, pentru EvidenceDrawer („din fiecare indicator,
--    clientul ajunge la sursa concluziei”). Aceeași poartă ca `brand_metrics` (E8): SECURITY INVOKER, verifică în corp
--    `has_brand_access`, citește aceleași view-uri de observații, prin aceeași funcție. Nu calculează nimic.
-- 2. `actions.effort` și `actions.tracked_metric_key`: efortul estimat și indicatorul urmărit ale unei acțiuni
--    („Prioritățile următoare”). `brand_insights` le întoarce împreună cu textele necesare editorului de analize.

-- 1. Dovezile unei metrici ---------------------------------------------------------------------------------------------

create function public.brand_metric_evidence(
  p_brand_id uuid, p_metric_key text, p_start date, p_end date, p_device text default null, p_limit integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_def    jsonb;
  v_view   text;
  v_agg    text;
  v_obs    jsonb;
  v_device text := case when p_device in ('desktop', 'mobile') then p_device end;
  v_limit  integer := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_base   jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_metric_key is null or p_metric_key !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Cheie de metrică invalidă' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  select b.tenant_id into v_tenant from public.brands b where b.id = p_brand_id;

  select to_jsonb(d) into v_def from public.metric_definitions_current d where d.metric_key = p_metric_key;
  v_view := case
    when p_metric_key = 'ga4_active_users' then 'web_active_users_observations'
    when p_metric_key like 'ga4\_%' then 'web_metric_observations'
    when p_metric_key like 'gsc\_%' then 'search_metric_observations'
    when p_metric_key like 'clarity\_%' then 'clarity_metric_observations'
    when p_metric_key like 'seomonitor\_%' then 'seomonitor_metric_observations'
    when p_metric_key ~ '^(google|meta|tiktok)_ads_' then 'paid_metric_observations'
    when p_metric_key = 'mentions_count' then 'mentions_metric_observations'
    when p_metric_key like 'ai\_%' then 'ai_metric_observations'
  end;
  v_agg := v_def ->> 'aggregation';
  v_base := jsonb_build_object('metric_key', p_metric_key, 'version', coalesce((v_def ->> 'version')::integer, 0), 'aggregation', v_agg,
    'unit', v_def ->> 'unit', 'source', v_def ->> 'primary_source', 'total_records', 0, 'records', '[]'::jsonb);

  -- Aceleași stări ca la serii: metrică fără definiție sau fără sursă de observații, apoi sursă neconectată.
  if v_def is null or v_view is null or not private.brand_source_connected(p_brand_id, v_def ->> 'primary_source') then
    return v_base || jsonb_build_object('status', 'not_connected');
  end if;

  select o.obs into v_obs
  from private.metric_observations(v_view, v_agg, v_tenant, p_brand_id, p_metric_key, p_start, p_end,
    case when p_metric_key like 'seomonitor\_%' then coalesce(v_device, 'desktop') end) o;
  v_obs := coalesce(v_obs, '[]'::jsonb);

  return v_base || jsonb_build_object(
    'status', case when jsonb_array_length(v_obs) = 0 then 'unavailable' else 'ok' end,
    'total_records', jsonb_array_length(v_obs),
    -- Cele mai recente observații întâi; raportul pe interval are `end` în loc de `date`.
    'records', coalesce((
      select jsonb_agg(e.obs order by e.day desc)
      from (
        select x.obs, coalesce(x.obs ->> 'date', x.obs ->> 'end') as day
        from jsonb_array_elements(v_obs) x (obs)
        order by coalesce(x.obs ->> 'date', x.obs ->> 'end') desc
        limit v_limit
      ) e), '[]'::jsonb));
end;
$$;

revoke all on function public.brand_metric_evidence(uuid, text, date, date, text, integer) from public, anon;
grant execute on function public.brand_metric_evidence(uuid, text, date, date, text, integer) to authenticated, service_role;
comment on function public.brand_metric_evidence(uuid, text, date, date, text, integer) is
  'Observațiile din spatele unei metrici (cele mai recente p_limit, maximum 100) și numărul lor total. SECURITY INVOKER; verifică has_brand_access (E8).';

-- 2. Planul unei acțiuni: efort și indicator urmărit ------------------------------------------------------------------------

alter table public.actions
  add column effort text check (effort is null or length(trim(effort)) between 1 and 120),
  add column tracked_metric_key text check (tracked_metric_key is null or tracked_metric_key ~ '^[a-z][a-z0-9_]*$');
comment on column public.actions.effort is 'Efortul estimat, în text scurt (de ex. „2 zile”). Nu e o metrică și nu se agregă.';
comment on column public.actions.tracked_metric_key is 'Indicatorul din registru urmărit după implementare; verificat la scriere.';

-- Indicatorul urmărit trebuie să existe în registru (versiunea curentă, neretrasă): fără chei inventate.
create function private.actions_tracked_metric() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tracked_metric_key is not null
     and (tg_op = 'INSERT' or new.tracked_metric_key is distinct from old.tracked_metric_key)
     and not exists (select 1 from public.metric_definitions_current d where d.metric_key = new.tracked_metric_key) then
    raise exception 'Indicatorul urmărit nu există în registrul de metrici: %', new.tracked_metric_key using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.actions_tracked_metric() from public, anon, authenticated;

create trigger actions_tracked_metric before insert or update on public.actions
  for each row execute function private.actions_tracked_metric();

grant insert (effort, tracked_metric_key) on public.actions to authenticated;
grant update (effort, tracked_metric_key) on public.actions to authenticated;

-- `brand_insights`: aceleași rânduri și aceeași poartă; în plus textele analizei, recomandările și planul acțiunilor.
-- Clientul primește în continuare doar ce permite RLS (analize publicate, acțiuni agreate sau mai departe).
create or replace function public.brand_insights(p_brand_id uuid, p_start date, p_end date)
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
      'interpretation', i.interpretation, 'version', i.version, 'supersedes_id', i.supersedes_id,
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
  ), '[]'::jsonb);
end;
$$;
