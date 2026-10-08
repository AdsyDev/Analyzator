-- Analize, recomandări, acțiuni și farmacovigilență (spec cap. 21, brief cap. 6).
--
-- Tranzițiile de status NU sunt UPDATE-uri directe și NU sunt funcții RPC noi în `public` (garda A10/A11 le-ar interzice
-- utilizatorilor): fiecare tranziție e un rând inserat într-un tabel de tranziții (insight_transitions, action_transitions,
-- pv_flag_events), iar un trigger BEFORE INSERT SECURITY DEFINER din schema `private` verifică rolul, legalitatea
-- tranziției și aplică efectele (snapshot la publicare, înlocuirea versiunii vechi). Tabelele de tranziții sunt și jurnalul.
--
-- Clientul citește doar analizele `published`. O analiză publicată nu se mai editează: se înlocuiește cu o versiune nouă.

-- Utilitare -----------------------------------------------------------------------------------------------------------

create function private.agency_roles() returns public.membership_role[]
language sql immutable set search_path = ''
as $$ select array['agency_admin', 'strategist', 'account']::public.membership_role[] $$;

create function private.reviewer_roles() returns public.membership_role[]
language sql immutable set search_path = ''
as $$ select array['agency_admin', 'strategist']::public.membership_role[] $$;

-- insights ----------------------------------------------------------------------------------------------------------------

create table public.insights (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  brand_id         uuid not null,
  title            text not null check (length(trim(title)) between 1 and 300),
  period_start     date not null,
  period_end       date not null,
  period_kind      text not null default 'custom' check (period_kind in ('custom', 'week', 'month', 'year', 'mtd', 'ytd')),
  summary          text not null default '' check (length(summary) <= 20000),        -- constatarea
  interpretation   text not null default '' check (length(interpretation) <= 20000),
  limits           text not null default '' check (length(limits) <= 20000),
  status           text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'superseded')),
  author_id        uuid not null references auth.users (id) on delete restrict,
  version          integer not null default 1 check (version >= 1),
  supersedes_id    uuid,
  superseded_by_id uuid,
  submitted_at     timestamptz,
  published_at     timestamptz,
  published_by     uuid references auth.users (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (period_end >= period_start),
  check ((status in ('published', 'superseded')) = (published_at is not null)),
  check ((status = 'superseded') = (superseded_by_id is not null)),
  unique (tenant_id, brand_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, supersedes_id) references public.insights (tenant_id, brand_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, superseded_by_id) references public.insights (tenant_id, brand_id, id) on delete restrict
);
comment on table public.insights is
  'Analize ale agenției (spec cap. 21). Clientul citește doar `published`. O analiză publicată nu se editează; se înlocuiește (version, supersedes_id).';
create unique index insights_one_successor_idx on public.insights (supersedes_id) where supersedes_id is not null;
create index insights_brand_idx on public.insights (tenant_id, brand_id, status, period_end desc);

-- evidence_links: dovezi ca referințe la metrici și la înregistrări ---------------------------------------------------------

create table public.evidence_links (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  brand_id      uuid not null,
  insight_id    uuid not null,
  kind          text not null check (kind in ('metric', 'record')),
  metric_key    text check (metric_key ~ '^[a-z][a-z0-9_]*$'),
  options       jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  record_table  text check (record_table in ('mentions', 'ai_answers', 'social_posts', 'paid_daily', 'search_queries', 'web_daily', 'rank_observations')),
  record_id     text check (length(record_id) between 1 and 512),
  note          text check (length(note) <= 2000),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((kind = 'metric') = (metric_key is not null)),
  check ((kind = 'record') = (record_table is not null and record_id is not null)),
  check (kind = 'record' or (record_table is null and record_id is null)),
  check (kind = 'metric' or options = '{}'::jsonb),
  unique (tenant_id, brand_id, id),
  foreign key (tenant_id, brand_id, insight_id) references public.insights (tenant_id, brand_id, id) on delete cascade
);
create unique index evidence_links_metric_idx on public.evidence_links (insight_id, metric_key, md5(options::text)) where kind = 'metric';
create unique index evidence_links_record_idx on public.evidence_links (insight_id, record_table, record_id) where kind = 'record';
comment on table public.evidence_links is
  'Referințe: o metrică (metric_key + opțiuni, de ex. device pentru SEOmonitor) sau o înregistrare (tabel + ID). Se îngheață la publicare în insight_snapshots.';

-- insight_snapshots: valorile metricilor citate, înghețate la publicare ------------------------------------------------------

create table public.insight_snapshots (
  id                        bigint generated always as identity primary key,
  tenant_id                 uuid not null,
  brand_id                  uuid not null,
  insight_id                uuid not null,
  metric_key                text not null,
  metric_definition_version integer not null,
  options                   jsonb not null default '{}'::jsonb,
  period_start              date not null,
  period_end                date not null,
  period_kind               text not null,
  result                    jsonb not null check (jsonb_typeof(result) = 'object'),
  computed_at               timestamptz not null default now(),
  foreign key (tenant_id, brand_id, insight_id) references public.insights (tenant_id, brand_id, id) on delete restrict
);
create unique index insight_snapshots_unique_idx on public.insight_snapshots (insight_id, metric_key, md5(options::text));
comment on table public.insight_snapshots is
  'Rezultatul metrics.compute la momentul publicării (include metric, status, acoperire, avertismente). Imutabil: o analiză publicată rămâne reproductibilă.';

create trigger insight_snapshots_immutable before update or delete on public.insight_snapshots
  for each row execute function private.prevent_update();

-- recommendations ---------------------------------------------------------------------------------------------------------------

create table public.recommendations (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null,
  brand_id               uuid not null,
  insight_id             uuid not null,
  problem                text not null check (length(trim(problem)) between 1 and 5000),
  action                 text not null check (length(trim(action)) between 1 and 5000),
  expected_benefit       text not null check (length(trim(expected_benefit)) between 1 and 5000),
  verification_metric_key text check (verification_metric_key ~ '^[a-z][a-z0-9_]*$'),
  priority               smallint not null check (priority between 1 and 3),  -- scară 1–3, fără zecimale (spec 2.8)
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (tenant_id, brand_id, id),
  foreign key (tenant_id, brand_id, insight_id) references public.insights (tenant_id, brand_id, id) on delete cascade
);
create index recommendations_insight_idx on public.recommendations (tenant_id, brand_id, insight_id);

-- actions ----------------------------------------------------------------------------------------------------------------------------

create table public.actions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  brand_id            uuid not null,
  insight_id          uuid not null,
  recommendation_id   uuid,
  title               text not null check (length(trim(title)) between 1 and 300),
  description         text check (length(description) <= 5000),
  responsible_user_id uuid not null,
  due_date            date,
  status              text not null default 'proposed' check (status in ('proposed', 'agreed', 'in_progress', 'done', 'measured', 'cancelled')),
  status_reason       text check (length(status_reason) <= 2000),
  implemented_at      date,
  result_note         text check (length(result_note) <= 5000),
  created_by          uuid not null references auth.users (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (status <> 'cancelled' or status_reason is not null),
  check (status <> 'measured' or result_note is not null),
  check (status not in ('done', 'measured') or implemented_at is not null),
  unique (tenant_id, brand_id, id),
  foreign key (tenant_id, brand_id, insight_id) references public.insights (tenant_id, brand_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, recommendation_id) references public.recommendations (tenant_id, brand_id, id) on delete set null (recommendation_id),
  foreign key (tenant_id, responsible_user_id) references public.memberships (tenant_id, user_id) on delete restrict
);
create index actions_brand_idx on public.actions (tenant_id, brand_id, status, due_date);

-- Tabele de tranziții (jurnalul de status) -------------------------------------------------------------------------------------------

create table public.insight_transitions (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  brand_id    uuid not null,
  insight_id  uuid not null,
  from_status text not null,
  to_status   text not null check (to_status in ('draft', 'in_review', 'published')),
  actor_id    uuid not null references auth.users (id) on delete restrict,
  reason      text check (length(reason) <= 2000),
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, brand_id, insight_id) references public.insights (tenant_id, brand_id, id) on delete restrict
);
create index insight_transitions_idx on public.insight_transitions (tenant_id, brand_id, insight_id, occurred_at);

create table public.action_transitions (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null,
  brand_id       uuid not null,
  action_id      uuid not null,
  from_status    text not null,
  to_status      text not null check (to_status in ('agreed', 'in_progress', 'done', 'measured', 'cancelled')),
  actor_id       uuid not null references auth.users (id) on delete restrict,
  reason         text check (length(reason) <= 2000),
  result_note    text check (length(result_note) <= 5000),
  implemented_at date,
  occurred_at    timestamptz not null default now(),
  foreign key (tenant_id, brand_id, action_id) references public.actions (tenant_id, brand_id, id) on delete restrict
);
create index action_transitions_idx on public.action_transitions (tenant_id, brand_id, action_id, occurred_at);

-- Farmacovigilență ---------------------------------------------------------------------------------------------------------------------

create table public.pv_contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  email       text not null check (email ~ '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$' and length(email) <= 254),
  name        text check (length(name) <= 200),
  active      boolean not null default true,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index pv_contacts_email_idx on public.pv_contacts (tenant_id, lower(email));
comment on table public.pv_contacts is 'Lista internă de contacte pentru notificările de farmacovigilență, configurată de agenție (agency_admin).';

create table public.pv_flags (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  brand_id        uuid not null,
  entity_type     text not null check (entity_type in ('mention', 'review', 'ai_answer')),
  entity_ref      text not null check (length(entity_ref) between 1 and 512),
  link            text check (length(link) <= 2048),
  text_snapshot   text not null check (length(text_snapshot) <= 50000),
  snapshot_source text not null check (snapshot_source in ('entity', 'user_provided')),
  status          text not null default 'open' check (status in ('open', 'notified', 'transmitted', 'closed')),
  note            text check (length(note) <= 2000),
  flagged_by      uuid not null references auth.users (id) on delete restrict,
  flagged_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, brand_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
create index pv_flags_brand_idx on public.pv_flags (tenant_id, brand_id, status, flagged_at desc);
comment on table public.pv_flags is
  'Marcaje pentru farmacovigilență. Analyzator nu stabilește dacă este reacție adversă. Snapshotul textului vine din entitate (mențiune, răspuns AI), nu de la utilizator; doar la reviewuri (fără tabel încă) textul e furnizat de utilizator. Invizibil pentru client.';

create table public.pv_flag_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  brand_id    uuid not null,
  flag_id     uuid not null,
  event_type  text not null check (event_type in ('marked', 'notification_sent', 'notification_failed', 'no_contacts', 'transmitted', 'closed', 'note')),
  actor_id    uuid references auth.users (id) on delete set null,
  note        text check (length(note) <= 2000),
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, brand_id, flag_id) references public.pv_flags (tenant_id, brand_id, id) on delete restrict
);
create index pv_flag_events_idx on public.pv_flag_events (tenant_id, brand_id, flag_id, occurred_at);
comment on table public.pv_flag_events is 'Jurnalul de farmacovigilență: append-only, vizibil agency_admin.';

create table public.pv_notifications (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  brand_id            uuid not null,
  flag_id             uuid not null unique,
  status              text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts            integer not null default 0 check (attempts >= 0),
  last_error          text check (length(last_error) <= 500),
  recipients          text[],
  provider_message_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz,
  check ((status = 'sent') = (sent_at is not null)),
  foreign key (tenant_id, brand_id, flag_id) references public.pv_flags (tenant_id, brand_id, id) on delete restrict
);
create index pv_notifications_status_idx on public.pv_notifications (status, created_at);
comment on table public.pv_notifications is
  'Coada de notificări: un rând per marcaj, creat la marcare, cu status `pending`. Trimisă prin Resend când secretul există; niciodată pierdută. Destinatarii se rezolvă la trimitere din pv_contacts active.';

create trigger insights_updated_at before update on public.insights for each row execute function private.set_updated_at();
create trigger recommendations_updated_at before update on public.recommendations for each row execute function private.set_updated_at();
create trigger actions_updated_at before update on public.actions for each row execute function private.set_updated_at();
create trigger pv_contacts_updated_at before update on public.pv_contacts for each row execute function private.set_updated_at();
create trigger pv_flags_updated_at before update on public.pv_flags for each row execute function private.set_updated_at();
create trigger pv_notifications_updated_at before update on public.pv_notifications for each row execute function private.set_updated_at();

-- Instantaneu de metrică la publicare ---------------------------------------------------------------------------------------------------
-- Adună observațiile din view-ul sursei, pentru perioada cerută și cea de comparație, și apelează metrics.compute.
-- SECURITY INVOKER, fără EXECUTE pentru clienți: o apelează doar trigger-ul SECURITY DEFINER de publicare (cu drepturile
-- owner-ului), după verificarea rolului. Filtrează explicit pe tenant și brand. Garda A10 interzice funcții DEFINER care întorc date.

create function private.compute_metric_snapshot(
  p_tenant_id uuid, p_brand_id uuid, p_metric_key text, p_start date, p_end date, p_kind text, p_options jsonb
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_def        jsonb;
  v_source     text;
  v_agg        text;
  v_view       text;
  v_device     text := p_options ->> 'device';
  v_connected  boolean;
  v_query_ok   boolean;
  v_cmp        jsonb;
  v_cur_obs    jsonb;
  v_cmp_obs    jsonb;
  v_cur_days   integer;
  v_cmp_days   integer;
  v_cur_asof   date;
  v_cmp_asof   date;
  v_as_of      date := (now() at time zone 'Europe/Bucharest')::date;
begin
  select to_jsonb(d) into v_def from public.metric_definitions_current d where d.metric_key = p_metric_key;
  if v_def is null then
    raise exception 'Metrică necunoscută sau retrasă: %', p_metric_key using errcode = '22023';
  end if;
  v_source := v_def ->> 'primary_source';
  v_agg := v_def ->> 'aggregation';

  v_view := case
    when p_metric_key = 'ga4_active_users' then 'web_active_users_observations'
    when p_metric_key like 'ga4\_%' then 'web_metric_observations'
    when p_metric_key like 'gsc\_%' then 'search_metric_observations'
    when p_metric_key like 'clarity\_%' then 'clarity_metric_observations'
    when p_metric_key like 'seomonitor\_%' then 'seomonitor_metric_observations'
    when p_metric_key ~ '^(google|meta|tiktok)_ads_' then 'paid_metric_observations'
    when p_metric_key = 'mentions_count' then 'mentions_metric_observations'
  end;
  if v_view is null then
    raise exception 'Metrica % nu are încă o sursă de observații pentru analize', p_metric_key using errcode = '22023';
  end if;
  if p_metric_key like 'seomonitor\_%' and coalesce(v_device, '') not in ('desktop', 'mobile') then
    raise exception 'Metrica % cere opțiunea device (desktop sau mobile)', p_metric_key using errcode = '22023';
  end if;

  v_cmp := metrics.comparison_period(p_start, p_end, p_kind);

  -- Conexiunea: sursă API activă sau import CSV confirmat; query_ok = ultima sincronizare nu a eșuat.
  v_connected := case
    when v_source in ('ga4', 'gsc', 'clarity') then exists (
      select 1 from public.source_connections c
      where c.tenant_id = p_tenant_id and c.brand_id = p_brand_id and c.provider = v_source and c.status = 'active')
    when v_source = 'seomonitor' then exists (
      select 1 from public.source_connections c
      where c.tenant_id = p_tenant_id and c.provider = 'seomonitor' and c.status = 'active')
    else exists (
      select 1 from public.import_batches b
      where b.tenant_id = p_tenant_id and b.brand_id = p_brand_id and b.source = v_source and b.status = 'imported')
  end;
  v_query_ok := coalesce((
    select s.status <> 'failed' from public.sync_runs s
    where s.tenant_id = p_tenant_id and s.brand_id = p_brand_id and s.source = v_source
    order by s.created_at desc limit 1), true);

  select o.obs, o.days, o.as_of into v_cur_obs, v_cur_days, v_cur_asof
  from private.metric_observations(v_view, v_agg, p_tenant_id, p_brand_id, p_metric_key, p_start, p_end, v_device) o;
  select o.obs, o.days, o.as_of into v_cmp_obs, v_cmp_days, v_cmp_asof
  from private.metric_observations(v_view, v_agg, p_tenant_id, p_brand_id, p_metric_key,
                                   (v_cmp ->> 'start')::date, (v_cmp ->> 'end')::date, v_device) o;

  return metrics.compute(jsonb_build_object(
    'definition', v_def,
    'brand_id', p_brand_id,
    'as_of_date', v_as_of,
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'kind', p_kind),
    'connection', jsonb_build_object('connected', v_connected, 'query_ok', v_query_ok),
    'current', jsonb_build_object('observations', v_cur_obs, 'confirmed_days', v_cur_days, 'data_as_of', v_cur_asof),
    'comparison', jsonb_build_object('observations', v_cmp_obs, 'confirmed_days', v_cmp_days, 'data_as_of', v_cmp_asof)
  ));
end;
$$;

-- Observațiile unei metrici pentru un interval, în forma cerută de metrics.aggregate; zile confirmate = zile cu valoare.
create function private.metric_observations(
  p_view text, p_agg text, p_tenant_id uuid, p_brand_id uuid, p_metric_key text, p_start date, p_end date, p_device text
) returns table (obs jsonb, days integer, as_of date)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_filter text := 'tenant_id = $1 and brand_id = $2 and metric_key = $3';
  v_device_filter text := case when p_device is null then '' else ' and device = $6' end;
begin
  if p_view not in ('web_metric_observations', 'web_active_users_observations', 'search_metric_observations',
                    'clarity_metric_observations', 'seomonitor_metric_observations', 'paid_metric_observations',
                    'mentions_metric_observations') then
    raise exception 'View de observații necunoscut: %', p_view using errcode = '22023';
  end if;

  if p_agg = 'interval_report_only' then
    return query execute format(
      $q$select coalesce(jsonb_agg(jsonb_build_object('start', start, 'end', "end", 'value', value)), '[]'::jsonb),
                coalesce(max(($5 - $4 + 1)) filter (where value is not null), 0)::integer,
                max("end") filter (where value is not null)
         from public.%I where %s and start = $4 and "end" = $5$q$, p_view, v_filter)
      using p_tenant_id, p_brand_id, p_metric_key, p_start, p_end, p_device;
    return;
  end if;

  return query execute format(
    $q$select coalesce(jsonb_agg(jsonb_build_object('date', date, %s) order by date), '[]'::jsonb),
              count(distinct date) filter (where %s)::integer,
              max(date) filter (where %s)
       from public.%I where %s and date between $4 and $5%s$q$,
    case p_agg
      when 'ratio' then $s$'numerator', numerator, 'denominator', denominator$s$
      when 'weighted_mean' then $s$'value', value, 'weight', weight$s$
      else $s$'value', value$s$ end,
    case p_agg when 'ratio' then 'numerator is not null and denominator is not null' else 'value is not null' end,
    case p_agg when 'ratio' then 'numerator is not null and denominator is not null' else 'value is not null' end,
    p_view, v_filter, v_device_filter)
    using p_tenant_id, p_brand_id, p_metric_key, p_start, p_end, p_device;
end;
$$;

-- Garduri și triggere -------------------------------------------------------------------------------------------------------------------

-- insights: status doar prin insight_transitions; analiza publicată nu se editează.
create function private.insights_guard() returns trigger
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

create trigger insights_guard before update or delete on public.insights
  for each row execute function private.insights_guard();

-- insights: validări la inserare (versiune nouă = înlocuirea unei analize publicate) + copierea dovezilor și recomandărilor.
create function private.insights_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.insights%rowtype;
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
  end if;
  return new;
end;
$$;

create function private.insights_after_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.supersedes_id is not null then
    insert into public.evidence_links (tenant_id, brand_id, insight_id, kind, metric_key, options, record_table, record_id, note, created_by)
    select e.tenant_id, e.brand_id, new.id, e.kind, e.metric_key, e.options, e.record_table, e.record_id, e.note, new.author_id
    from public.evidence_links e where e.insight_id = new.supersedes_id;
    insert into public.recommendations (tenant_id, brand_id, insight_id, problem, action, expected_benefit, verification_metric_key, priority, created_by)
    select r.tenant_id, r.brand_id, new.id, r.problem, r.action, r.expected_benefit, r.verification_metric_key, r.priority, new.author_id
    from public.recommendations r where r.insight_id = new.supersedes_id;
  end if;
  return null;
end;
$$;

create trigger insights_before_insert before insert on public.insights
  for each row execute function private.insights_before_insert();
create trigger insights_after_insert after insert on public.insights
  for each row execute function private.insights_after_insert();

-- evidence_links și recommendations: se modifică doar cât analiza e în draft.
create function private.require_draft_parent() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_status text;
begin
  select status into v_status from public.insights where id = (v_row ->> 'insight_id')::uuid;
  if v_status is distinct from 'draft' then
    raise exception 'Dovezile și recomandările se modifică doar cât analiza e în draft (acum: %)', coalesce(v_status, 'inexistentă') using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;
  return coalesce(new, old);
end;
$$;

create function private.evidence_links_validate() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'metric' and new.metric_key is not null then
    if not exists (select 1 from public.metric_definitions_current where metric_key = new.metric_key) then
      raise exception 'Metrică necunoscută sau retrasă: %', new.metric_key using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(new.options) k where k <> 'device') then
      raise exception 'Opțiuni nepermise pentru dovadă (doar device)' using errcode = '22023';
    end if;
    if new.options ? 'device' and new.options ->> 'device' not in ('desktop', 'mobile') then
      raise exception 'device trebuie să fie desktop sau mobile' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger evidence_links_draft before insert or update or delete on public.evidence_links
  for each row execute function private.require_draft_parent();
create trigger evidence_links_validate before insert or update on public.evidence_links
  for each row execute function private.evidence_links_validate();
create trigger recommendations_draft before insert or update or delete on public.recommendations
  for each row execute function private.require_draft_parent();

-- insight_transitions: legalitatea, rolul și efectele (snapshot, înlocuirea versiunii vechi) -----------------------------------------------

create function private.apply_insight_transition() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_i       public.insights%rowtype;
  v_missing text[] := '{}';
  v_ev      record;
begin
  select * into v_i from public.insights where id = new.insight_id for update;
  -- Același mesaj pentru „nu există” și „fără acces”: nu confirmăm existența analizei.
  if not found or v_uid is null or not private.has_brand_role(v_i.brand_id, private.agency_roles()) then
    raise exception 'Analiză inexistentă sau fără acces' using errcode = '42501';
  end if;

  new.tenant_id := v_i.tenant_id;
  new.brand_id := v_i.brand_id;
  new.from_status := v_i.status;
  new.actor_id := v_uid;
  new.occurred_at := now();

  if v_i.status = 'draft' and new.to_status = 'in_review' then
    if length(trim(v_i.title)) = 0 then v_missing := array_append(v_missing, 'titlu'::text); end if;
    if length(trim(v_i.summary)) = 0 then v_missing := array_append(v_missing, 'constatare'::text); end if;
    if length(trim(v_i.interpretation)) = 0 then v_missing := array_append(v_missing, 'interpretare'::text); end if;
    if length(trim(v_i.limits)) = 0 then v_missing := array_append(v_missing, 'limite'::text); end if;
    if not exists (select 1 from public.evidence_links where insight_id = v_i.id) then v_missing := array_append(v_missing, 'dovezi'::text); end if;
    if array_length(v_missing, 1) > 0 then
      raise exception 'Analiza nu poate fi trimisă la review; lipsesc: %', array_to_string(v_missing, ', ') using errcode = '23514';
    end if;
    perform set_config('analyzator.transition', 'on', true);
    update public.insights set status = 'in_review', submitted_at = now() where id = v_i.id;

  elsif v_i.status = 'in_review' and new.to_status = 'draft' then
    if not private.has_brand_role(v_i.brand_id, private.reviewer_roles()) then
      raise exception 'Doar strategist sau agency_admin poate returna o analiză la draft' using errcode = '42501';
    end if;
    if new.reason is null or length(trim(new.reason)) = 0 then
      raise exception 'Returnarea la draft cere un motiv' using errcode = '23514';
    end if;
    perform set_config('analyzator.transition', 'on', true);
    update public.insights set status = 'draft', submitted_at = null where id = v_i.id;

  elsif v_i.status = 'in_review' and new.to_status = 'published' then
    if not private.has_brand_role(v_i.brand_id, private.reviewer_roles()) then
      raise exception 'Doar strategist sau agency_admin poate publica' using errcode = '42501';
    end if;
    perform set_config('analyzator.transition', 'on', true);

    -- Înlocuirea: versiunea veche trebuie să fie încă publicată.
    if v_i.supersedes_id is not null then
      perform 1 from public.insights where id = v_i.supersedes_id and status = 'published' for update;
      if not found then
        raise exception 'Versiunea înlocuită nu mai e publicată' using errcode = '40001';
      end if;
    end if;

    -- Instantaneul metricilor citate, calculat acum prin metrics.compute și înghețat.
    for v_ev in
      select distinct metric_key, options from public.evidence_links where insight_id = v_i.id and kind = 'metric'
    loop
      insert into public.insight_snapshots
        (tenant_id, brand_id, insight_id, metric_key, metric_definition_version, options, period_start, period_end, period_kind, result)
      select v_i.tenant_id, v_i.brand_id, v_i.id, v_ev.metric_key, (s ->> 'metric_definition_version')::integer, v_ev.options,
             v_i.period_start, v_i.period_end, v_i.period_kind, s
      from (select private.compute_metric_snapshot(v_i.tenant_id, v_i.brand_id, v_ev.metric_key, v_i.period_start, v_i.period_end, v_i.period_kind, v_ev.options) as s) x;
    end loop;

    update public.insights set status = 'published', published_at = now(), published_by = v_uid where id = v_i.id;
    if v_i.supersedes_id is not null then
      update public.insights set status = 'superseded', superseded_by_id = v_i.id where id = v_i.supersedes_id;
    end if;

  else
    raise exception 'Tranziție nepermisă: % → %', v_i.status, new.to_status using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger insight_transitions_apply before insert on public.insight_transitions
  for each row execute function private.apply_insight_transition();
create trigger insight_transitions_immutable before update or delete on public.insight_transitions
  for each row execute function private.prevent_update();

-- actions: responsabil din agenție; câmpuri înghețate la final; tranziții -------------------------------------------------------------------

create function private.actions_before_write() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.status_reason := null;
    new.implemented_at := null;
    new.result_note := null;
    new.created_by := (select auth.uid());
    select status into v_status from public.insights where id = new.insight_id;
    if v_status = 'superseded' then
      raise exception 'Nu se adaugă acțiuni la o analiză înlocuită' using errcode = '22023';
    end if;
  else
    if old.status in ('measured', 'cancelled') then
      raise exception 'O acțiune % nu se mai modifică', old.status using errcode = '42501';
    end if;
    if new.status is distinct from old.status and coalesce(current_setting('analyzator.transition', true), '') <> 'on' then
      raise exception 'Statusul se schimbă doar prin action_transitions' using errcode = '42501';
    end if;
    if new.tenant_id is distinct from old.tenant_id or new.brand_id is distinct from old.brand_id
       or new.insight_id is distinct from old.insight_id or new.created_by is distinct from old.created_by then
      raise exception 'tenant_id, brand_id, insight_id și created_by nu se modifică' using errcode = '42501';
    end if;
  end if;

  -- Responsabilul trebuie să fie din agenție (rol agency_admin, strategist sau account), activ în tenant.
  if tg_op = 'INSERT' or new.responsible_user_id is distinct from old.responsible_user_id then
    if not exists (
      select 1 from public.memberships m
      where m.tenant_id = new.tenant_id and m.user_id = new.responsible_user_id and m.revoked_at is null
        and m.role = any (private.agency_roles())) then
      raise exception 'Responsabilul trebuie să fie un membru activ al agenției' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger actions_before_write before insert or update on public.actions
  for each row execute function private.actions_before_write();

create function private.apply_action_transition() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_a   public.actions%rowtype;
  v_ok  boolean;
  v_implemented date;
begin
  select * into v_a from public.actions where id = new.action_id for update;
  if not found or v_uid is null or not private.has_brand_role(v_a.brand_id, private.agency_roles()) then
    raise exception 'Acțiune inexistentă sau fără acces' using errcode = '42501';
  end if;

  new.tenant_id := v_a.tenant_id;
  new.brand_id := v_a.brand_id;
  new.from_status := v_a.status;
  new.actor_id := v_uid;
  new.occurred_at := now();

  v_ok := (v_a.status, new.to_status) in (
    ('proposed', 'agreed'), ('proposed', 'cancelled'),
    ('agreed', 'in_progress'), ('agreed', 'cancelled'),
    ('in_progress', 'done'), ('in_progress', 'cancelled'),
    ('done', 'measured'));
  if not v_ok then
    raise exception 'Tranziție nepermisă: % → %', v_a.status, new.to_status using errcode = '23514';
  end if;
  if new.to_status = 'cancelled' and (new.reason is null or length(trim(new.reason)) = 0) then
    raise exception 'Anularea cere un motiv' using errcode = '23514';
  end if;
  if new.to_status = 'measured' and (new.result_note is null or length(trim(new.result_note)) = 0) then
    raise exception 'Starea measured cere rezultatul urmărit (result_note)' using errcode = '23514';
  end if;
  v_implemented := case when new.to_status = 'done' then coalesce(new.implemented_at, (now() at time zone 'Europe/Bucharest')::date) end;
  if v_implemented is not null and v_implemented > (now() at time zone 'Europe/Bucharest')::date then
    raise exception 'Data implementării nu poate fi în viitor' using errcode = '23514';
  end if;
  new.implemented_at := v_implemented;

  perform set_config('analyzator.transition', 'on', true);
  update public.actions
  set status = new.to_status,
      status_reason = case when new.to_status = 'cancelled' then new.reason else status_reason end,
      implemented_at = coalesce(v_implemented, implemented_at),
      result_note = case when new.to_status = 'measured' then new.result_note else result_note end
  where id = v_a.id;
  return new;
end;
$$;

create trigger action_transitions_apply before insert on public.action_transitions
  for each row execute function private.apply_action_transition();
create trigger action_transitions_immutable before update or delete on public.action_transitions
  for each row execute function private.prevent_update();

-- Farmacovigilență: marcare, notificare în coadă, jurnal --------------------------------------------------------------------------------------

create function private.pv_flags_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_text text;
  v_link text;
begin
  select tenant_id into v_tenant from public.brands where id = new.brand_id;
  if v_tenant is null or v_uid is null or not private.has_brand_role(new.brand_id, private.agency_roles()) then
    raise exception 'Brand inexistent sau fără acces' using errcode = '42501';
  end if;
  new.tenant_id := v_tenant;
  new.flagged_by := v_uid;
  new.flagged_at := now();
  new.status := 'open';

  if new.entity_type = 'mention' then
    select coalesce(nullif(m.text, ''), '(mențiune fără text în sursă)'), m.url into v_text, v_link
    from public.mentions m where m.tenant_id = v_tenant and m.brand_id = new.brand_id and m.native_id = new.entity_ref;
    if v_text is null then
      raise exception 'Mențiunea nu există în acest brand' using errcode = '23503';
    end if;
    new.text_snapshot := v_text;
    new.link := v_link;
    new.snapshot_source := 'entity';
  elsif new.entity_type = 'ai_answer' then
    if new.entity_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'entity_ref pentru ai_answer trebuie să fie ID-ul răspunsului (uuid)' using errcode = '22023';
    end if;
    select coalesce(nullif(a.content, ''), '(răspuns fără conținut text)') into v_text
    from public.ai_answers a where a.tenant_id = v_tenant and a.brand_id = new.brand_id and a.id = new.entity_ref::uuid;
    if v_text is null then
      raise exception 'Răspunsul AI nu există în acest brand' using errcode = '23503';
    end if;
    new.text_snapshot := v_text;
    new.snapshot_source := 'entity';
  else
    -- reviewuri: nu există încă tabel; textul și linkul vin de la utilizator și sunt etichetate ca atare.
    if new.text_snapshot is null or length(trim(new.text_snapshot)) = 0 then
      raise exception 'Pentru review, textul (snapshot) trebuie furnizat' using errcode = '23514';
    end if;
    new.snapshot_source := 'user_provided';
  end if;
  return new;
end;
$$;

create function private.pv_flags_after_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('analyzator.pv_system', 'marked', true);
  insert into public.pv_flag_events (tenant_id, brand_id, flag_id, event_type, actor_id) values (new.tenant_id, new.brand_id, new.id, 'marked', new.flagged_by);
  perform set_config('analyzator.pv_system', '', true);
  -- Notificarea intră mereu în coadă (pending); trimiterea o face worker-ul când secretul de e-mail există.
  insert into public.pv_notifications (tenant_id, brand_id, flag_id) values (new.tenant_id, new.brand_id, new.id);
  return null;
end;
$$;

create trigger pv_flags_before_insert before insert on public.pv_flags
  for each row execute function private.pv_flags_before_insert();
create trigger pv_flags_after_insert after insert on public.pv_flags
  for each row execute function private.pv_flags_after_insert();

-- pv_flags: statusul se schimbă doar prin pv_flag_events (sau service role, pentru `notified`).
create function private.pv_flags_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Marcajele de farmacovigilență nu se șterg' using errcode = '42501';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.brand_id is distinct from old.brand_id
     or new.entity_type is distinct from old.entity_type or new.entity_ref is distinct from old.entity_ref
     or new.text_snapshot is distinct from old.text_snapshot or new.link is distinct from old.link
     or new.flagged_by is distinct from old.flagged_by or new.flagged_at is distinct from old.flagged_at then
    raise exception 'Marcajul de farmacovigilență e imutabil (snapshot, link, autor, dată)' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and coalesce(current_setting('analyzator.transition', true), '') <> 'on'
     and coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Statusul se schimbă doar prin pv_flag_events' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger pv_flags_guard before update or delete on public.pv_flags
  for each row execute function private.pv_flags_guard();

-- pv_flag_events: evenimente de sistem (service role) și acțiuni ale agency_admin (transmitted, closed, note).
create function private.apply_pv_flag_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := coalesce((select auth.role()), '');
  v_f public.pv_flags%rowtype;
  v_next text;
begin
  select * into v_f from public.pv_flags where id = new.flag_id for update;
  if not found then
    raise exception 'Marcaj inexistent' using errcode = '23503';
  end if;
  new.tenant_id := v_f.tenant_id;
  new.brand_id := v_f.brand_id;
  new.occurred_at := now();

  -- Evenimentul `marked` îl scrie doar trigger-ul de marcare (flag local de tranzacție).
  if new.event_type = 'marked' then
    if coalesce(current_setting('analyzator.pv_system', true), '') <> 'marked' then
      raise exception 'Evenimentul marked îl scrie sistemul la marcare' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_role = 'service_role' then
    -- evenimentele de sistem ale trimiterii
    if new.event_type not in ('notification_sent', 'notification_failed', 'no_contacts', 'note') then
      raise exception 'Evenimentul % nu poate fi scris de sistem', new.event_type using errcode = '42501';
    end if;
    if new.event_type = 'notification_sent' and v_f.status = 'open' then
      perform set_config('analyzator.transition', 'on', true);
      update public.pv_flags set status = 'notified' where id = v_f.id;
    end if;
    return new;
  end if;

  -- acțiuni ale utilizatorilor: doar agency_admin al tenantului
  if v_uid is null or not private.has_role(v_f.tenant_id, array['agency_admin']::public.membership_role[]) then
    raise exception 'Doar agency_admin poate scrie în jurnalul de farmacovigilență' using errcode = '42501';
  end if;
  new.actor_id := v_uid;
  if new.event_type not in ('transmitted', 'closed', 'note') then
    raise exception 'Evenimentul % îl scrie sistemul', new.event_type using errcode = '42501';
  end if;

  if new.event_type = 'transmitted' then
    if v_f.status not in ('open', 'notified') then
      raise exception 'Tranziție nepermisă: % → transmitted', v_f.status using errcode = '23514';
    end if;
    v_next := 'transmitted';
  elsif new.event_type = 'closed' then
    if v_f.status <> 'transmitted' then
      raise exception 'Un marcaj se închide doar după transmitere (acum: %)', v_f.status using errcode = '23514';
    end if;
    v_next := 'closed';
  end if;

  if v_next is not null then
    perform set_config('analyzator.transition', 'on', true);
    update public.pv_flags set status = v_next where id = v_f.id;
  end if;
  return new;
end;
$$;

create trigger pv_flag_events_apply before insert on public.pv_flag_events
  for each row execute function private.apply_pv_flag_event();
create trigger pv_flag_events_immutable before update or delete on public.pv_flag_events
  for each row execute function private.prevent_update();

-- Audit (fără pv_flags: textul sensibil nu se duplică în audit_events; jurnalul PV e pv_flag_events) -----------------------------------------------

create trigger insights_audit after insert or update on public.insights for each row execute function private.audit_row();
create trigger recommendations_audit after insert or update or delete on public.recommendations for each row execute function private.audit_row();
create trigger actions_audit after insert or update on public.actions for each row execute function private.audit_row();
create trigger pv_contacts_audit after insert or update or delete on public.pv_contacts for each row execute function private.audit_row();

-- Funcțiile din `private` nu sunt executabile de clienți; excepție: cele 4 funcții de autorizare folosite în politici
-- (garda A10 verifică lista exactă). Trigger-ele rulează cu drepturile owner-ului, deci nu cer EXECUTE.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_role(uuid, public.membership_role[]),
  private.has_brand_role(uuid, public.membership_role[]),
  private.has_brand_access(uuid),
  private.can_see_tenant(uuid)
to authenticated;
grant execute on function private.user_can_import(uuid, uuid) to service_role;

-- RLS ------------------------------------------------------------------------------------------------------------------------------------------------

grant select on public.insights, public.evidence_links, public.insight_snapshots, public.recommendations, public.actions,
  public.insight_transitions, public.action_transitions, public.pv_contacts, public.pv_flags, public.pv_flag_events, public.pv_notifications
  to authenticated;
grant insert (tenant_id, brand_id, title, period_start, period_end, period_kind, summary, interpretation, limits, author_id, supersedes_id)
  on public.insights to authenticated;
grant update (title, period_start, period_end, period_kind, summary, interpretation, limits) on public.insights to authenticated;
grant delete on public.insights to authenticated;
grant insert (tenant_id, brand_id, insight_id, kind, metric_key, options, record_table, record_id, note) on public.evidence_links to authenticated;
grant update (note) on public.evidence_links to authenticated;
grant delete on public.evidence_links to authenticated;
grant insert (tenant_id, brand_id, insight_id, problem, action, expected_benefit, verification_metric_key, priority) on public.recommendations to authenticated;
grant update (problem, action, expected_benefit, verification_metric_key, priority) on public.recommendations to authenticated;
grant delete on public.recommendations to authenticated;
grant insert (tenant_id, brand_id, insight_id, recommendation_id, title, description, responsible_user_id, due_date) on public.actions to authenticated;
grant update (recommendation_id, title, description, responsible_user_id, due_date) on public.actions to authenticated;
grant insert (insight_id, to_status, reason) on public.insight_transitions to authenticated;
grant insert (action_id, to_status, reason, result_note, implemented_at) on public.action_transitions to authenticated;
grant insert (email, name, tenant_id) on public.pv_contacts to authenticated;
grant update (email, name, active) on public.pv_contacts to authenticated;
grant delete on public.pv_contacts to authenticated;
grant insert (brand_id, entity_type, entity_ref, text_snapshot, link, note) on public.pv_flags to authenticated;
grant insert (flag_id, event_type, note) on public.pv_flag_events to authenticated;

alter table public.insights            enable row level security;
alter table public.evidence_links      enable row level security;
alter table public.insight_snapshots   enable row level security;
alter table public.recommendations     enable row level security;
alter table public.actions             enable row level security;
alter table public.insight_transitions enable row level security;
alter table public.action_transitions  enable row level security;
alter table public.pv_contacts         enable row level security;
alter table public.pv_flags            enable row level security;
alter table public.pv_flag_events      enable row level security;
alter table public.pv_notifications    enable row level security;

-- insights: clientul citește doar `published`; agenția, tot ce ține de brandurile ei.
create policy insights_select on public.insights for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]) or (status = 'published' and private.has_brand_access(brand_id)));
create policy insights_insert on public.insights for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]) and author_id = (select auth.uid()));
create policy insights_update on public.insights for update to authenticated
  using (status = 'draft' and private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]))
  with check (status = 'draft' and private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy insights_delete on public.insights for delete to authenticated
  using (status = 'draft' and private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
         and (author_id = (select auth.uid()) or private.has_role(tenant_id, array['agency_admin']::public.membership_role[])));

-- evidence_links, recommendations, insight_snapshots: aceeași vizibilitate ca analiza-părinte.
create policy evidence_links_select on public.evidence_links for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
         or (private.has_brand_access(brand_id) and exists (select 1 from public.insights i where i.id = insight_id and i.status = 'published')));
create policy evidence_links_insert on public.evidence_links for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy evidence_links_update on public.evidence_links for update to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])) with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy evidence_links_delete on public.evidence_links for delete to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));

create policy recommendations_select on public.recommendations for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
         or (private.has_brand_access(brand_id) and exists (select 1 from public.insights i where i.id = insight_id and i.status = 'published')));
create policy recommendations_insert on public.recommendations for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy recommendations_update on public.recommendations for update to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])) with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy recommendations_delete on public.recommendations for delete to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));

create policy insight_snapshots_select on public.insight_snapshots for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
         or (private.has_brand_access(brand_id) and exists (select 1 from public.insights i where i.id = insight_id and i.status = 'published')));
create policy insight_snapshots_insert on public.insight_snapshots for insert to authenticated with check (false);
create policy insight_snapshots_update on public.insight_snapshots for update to authenticated using (false);
create policy insight_snapshots_delete on public.insight_snapshots for delete to authenticated using (false);

-- actions: clientul vede acțiunile agreate (nu propunerile interne și nu pe cele anulate) ale analizelor publicate.
create policy actions_select on public.actions for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
         or (private.has_brand_access(brand_id) and status in ('agreed', 'in_progress', 'done', 'measured')
             and exists (select 1 from public.insights i where i.id = insight_id and i.status = 'published')));
create policy actions_insert on public.actions for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy actions_update on public.actions for update to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])) with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy actions_delete on public.actions for delete to authenticated using (false);

-- tranziții: citire pentru agenție; inserarea declanșează trigger-ul care verifică rolul.
create policy insight_transitions_select on public.insight_transitions for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
-- WITH CHECK rulează după trigger-ul BEFORE INSERT, care completează brand_id din analiză.
create policy insight_transitions_insert on public.insight_transitions for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy insight_transitions_update on public.insight_transitions for update to authenticated using (false);
create policy insight_transitions_delete on public.insight_transitions for delete to authenticated using (false);

create policy action_transitions_select on public.action_transitions for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy action_transitions_insert on public.action_transitions for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy action_transitions_update on public.action_transitions for update to authenticated using (false);
create policy action_transitions_delete on public.action_transitions for delete to authenticated using (false);

-- farmacovigilență: contactele, marcajele și jurnalul sunt ale agenției; clientul nu le vede.
create policy pv_contacts_select on public.pv_contacts for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy pv_contacts_insert on public.pv_contacts for insert to authenticated
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy pv_contacts_update on public.pv_contacts for update to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]))
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy pv_contacts_delete on public.pv_contacts for delete to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));

create policy pv_flags_select on public.pv_flags for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[])
         or (flagged_by = (select auth.uid()) and private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])));
create policy pv_flags_insert on public.pv_flags for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy pv_flags_update on public.pv_flags for update to authenticated using (false);
create policy pv_flags_delete on public.pv_flags for delete to authenticated using (false);

create policy pv_flag_events_select on public.pv_flag_events for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy pv_flag_events_insert on public.pv_flag_events for insert to authenticated
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy pv_flag_events_update on public.pv_flag_events for update to authenticated using (false);
create policy pv_flag_events_delete on public.pv_flag_events for delete to authenticated using (false);

create policy pv_notifications_select on public.pv_notifications for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy pv_notifications_insert on public.pv_notifications for insert to authenticated with check (false);
create policy pv_notifications_update on public.pv_notifications for update to authenticated using (false);
create policy pv_notifications_delete on public.pv_notifications for delete to authenticated using (false);
