-- SEOmonitor API 3.0: maparea grupurilor pe branduri, keywords, ranks, visibility și AI Search / AI Overview.
-- Contract: docs/contracts/seomonitor.md. Documentația sursă: https://api-docs.seomonitor.com (citită 2026-10-08).
--
-- Reguli: rank absent = NULL (nu 100); keyword arhivat, rank absent și grup schimbat sunt stări distincte;
-- un grup nemapat intră în coada de verificare; un grup multi-brand nu se atribuie automat niciunui brand.
-- Proveniență pe fiecare observație: source_id, sync_run_id, collected_at, collection_method, payload_hash,
-- window_days, schema_version.

-- sync_runs: acoperirea raportată de conector (reportCoverage) ------------------------------
alter table public.sync_runs add column coverage jsonb;
comment on column public.sync_runs.coverage is
  'reportCoverage: { dataset: { expected_days, covered_days, coverage } } pentru perioada run-ului.';

-- Maparea grupurilor SEOmonitor → brand (configurare de agenție, versionată) -----------------

create table public.seomonitor_group_mappings (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  source_id             uuid not null,
  campaign_id           text not null check (campaign_id ~ '^[0-9]+$'),
  group_id              text not null check (group_id ~ '^-?[0-9]+$'),
  version               integer not null check (version > 0),
  effective_from        date not null,
  mapping_kind          text not null check (mapping_kind in ('brand', 'multi_brand', 'excluded')),
  brand_id              uuid,
  brand_type            text check (brand_type in ('branded', 'nonbranded')),
  is_primary_visibility boolean not null default false,
  note                  text,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (tenant_id, source_id, campaign_id, group_id, version),
  check ((mapping_kind = 'brand') = (brand_id is not null)),
  check (mapping_kind = 'brand' or brand_type is null),
  check (mapping_kind = 'brand' or not is_primary_visibility),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

comment on table public.seomonitor_group_mappings is
  'Grup SEOmonitor → brand. Versiuni imutabile; versiunea curentă = cea mai mare cu effective_from <= ziua. '
  'multi_brand: rezultatele nu se atribuie automat; excluded: grupul e ignorat intenționat.';

-- O singură grupă de visibility principală per brand, per versiune curentă se verifică în conector.
create index seomonitor_group_mappings_lookup_idx
  on public.seomonitor_group_mappings (tenant_id, source_id, campaign_id, group_id, version desc);

create trigger seomonitor_group_mappings_immutable
  before update or delete on public.seomonitor_group_mappings
  for each row execute function private.prevent_update();

create trigger seomonitor_group_mappings_audit after insert on public.seomonitor_group_mappings
  for each row execute function private.audit_row();

-- Coada de verificare: grupuri nemapate sau multi-brand. Scrisă de worker; rezolvată prin mapare nouă.
create table public.seomonitor_mapping_queue (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  source_id     uuid not null,
  campaign_id   text not null,
  group_id      text not null,
  group_name    text,
  group_type    text,
  reason        text not null check (reason in ('unmapped', 'multi_brand', 'mapped_group_missing')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  sync_run_id   uuid references public.sync_runs (id) on delete set null,
  unique (tenant_id, source_id, campaign_id, group_id, reason),
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

-- Grupuri de keywords atribuite unui brand -----------------------------------------------------

create table public.keyword_groups (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  brand_id        uuid not null,
  source_id       uuid not null,
  campaign_id     text not null,
  group_id        text not null,
  parent_group_id text,
  name            text not null,
  group_type      text not null check (group_type in ('group', 'folder', 'smart')),
  brand_type      text check (brand_type in ('branded', 'nonbranded')),
  mapping_version integer not null,
  sync_run_id     uuid references public.sync_runs (id) on delete set null,
  collected_at    timestamptz not null,
  collection_method text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash    text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version  text not null,
  updated_at      timestamptz not null default now(),
  unique (tenant_id, brand_id, source_id, campaign_id, group_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

-- Keywords ---------------------------------------------------------------------------------------
-- status: active | archived (keyword șters din SEOmonitor). group_ids_changed_at: grup schimbat.

create table public.keywords (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  brand_id             uuid not null,
  source_id            uuid not null,
  campaign_id          text not null,
  keyword_id           text not null check (keyword_id ~ '^[0-9]+$'),
  keyword              text not null,
  main_keyword_id      text,
  search_intent        text,
  labels               text,
  is_branded           boolean,
  search_volume        bigint check (search_volume >= 0),
  group_ids            text[] not null default '{}',
  group_ids_changed_at timestamptz,
  previous_group_ids   text[],
  status               text not null default 'active' check (status in ('active', 'archived')),
  archived_detected_at timestamptz,
  last_updated         date,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version       text not null,
  updated_at           timestamptz not null default now(),
  unique (tenant_id, brand_id, source_id, keyword_id),
  check ((status = 'archived') = (archived_detected_at is not null)),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

-- Grupul schimbat se marchează automat; arhivarea nu se pierde la un upsert ulterior „active".
create function private.keywords_track_changes() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.group_ids is distinct from old.group_ids and old.group_ids <> '{}' and new.group_ids <> '{}' then
      new.previous_group_ids := old.group_ids;
      new.group_ids_changed_at := now();
    elsif new.group_ids = '{}' and old.group_ids <> '{}' then
      -- Listarea arhivelor nu aduce grupuri: păstrăm ultimele cunoscute.
      new.group_ids := old.group_ids;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.keywords_track_changes() from public, anon, authenticated;

create trigger keywords_track_changes before update on public.keywords
  for each row execute function private.keywords_track_changes();

-- Rankuri zilnice ----------------------------------------------------------------------------------
-- rank NULL cu rank_status: not_ranked (lipsă în payload), at_tracking_limit (valoare >= poziția maximă
-- urmărită, ambiguă: posibil „nu se clasează"), invalid. rank_original = valoarea exactă primită.

create table public.rank_observations (
  id                  bigint generated always as identity primary key,
  tenant_id           uuid not null,
  brand_id            uuid not null,
  source_id           uuid not null,
  campaign_id         text not null,
  keyword_id          text not null,
  device              text not null check (device in ('desktop', 'mobile')),
  date                date not null,
  domain              text not null check (domain ~ '^[a-z0-9.-]+$'),
  url                 text,
  rank                integer check (rank >= 1),
  rank_status         text not null check (rank_status in ('ranked', 'not_ranked', 'at_tracking_limit', 'invalid')),
  rank_original       text,
  search_volume       bigint check (search_volume >= 0),
  keyword_status      text not null check (keyword_status in ('active', 'archived')),
  attributed_group_id text not null,
  mapping_version     integer not null,
  sync_run_id         uuid references public.sync_runs (id) on delete set null,
  collected_at        timestamptz not null,
  collection_method   text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash        text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days         smallint not null default 1 check (window_days between 1 and 366),
  schema_version      text not null,
  updated_at          timestamptz not null default now(),
  unique (tenant_id, brand_id, keyword_id, device, date, domain),
  check ((rank is not null) = (rank_status = 'ranked')),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
create index rank_observations_brand_date_idx on public.rank_observations (tenant_id, brand_id, date, device);

-- Visibility zilnică pe grupuri ---------------------------------------------------------------------
-- Unitatea NECONFIRMATĂ: documentația arată 0.53 (groups/daily-visibility) și 53.3 (campaigns/tracked).

create table public.seomonitor_group_visibility_daily (
  id                  bigint generated always as identity primary key,
  tenant_id           uuid not null,
  brand_id            uuid not null,
  source_id           uuid not null,
  campaign_id         text not null,
  group_id            text not null,
  date                date not null,
  device              text not null check (device in ('desktop', 'mobile')),
  domain              text not null check (domain ~ '^[a-z0-9.-]+$'),
  visibility          numeric check (visibility >= 0),
  visibility_original text,
  avg_rank            numeric check (avg_rank >= 0),
  is_primary          boolean not null,
  mapping_version     integer not null,
  sync_run_id         uuid references public.sync_runs (id) on delete set null,
  collected_at        timestamptz not null,
  collection_method   text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash        text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days         smallint not null default 1 check (window_days between 1 and 366),
  schema_version      text not null,
  updated_at          timestamptz not null default now(),
  unique (tenant_id, brand_id, campaign_id, group_id, date, device, domain),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

-- Răspunsuri AI (AI Search per motor și Google AI Overview) -----------------------------------------
-- status: technical_error | refusal | brand_absent | brand_present (trei stări distincte de absență).
-- refusal e rezervat: documentația nu expune un semnal de refuz; nu se atribuie automat.

create table public.ai_answers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  brand_id          uuid not null,
  source_id         uuid not null,
  campaign_id       text not null,
  engine            text not null check (engine in ('openai', 'gemini', 'perplexity', 'google_ai_overview', 'unknown')),
  surface           text not null check (surface in ('ai_search', 'ai_overview')),
  device            text not null default 'none' check (device in ('none', 'desktop', 'mobile')),
  keyword_id        text not null,
  crawl_at          date not null,
  era               text check (era in ('keyword', 'question')),
  content           text,
  content_format    text check (content_format in ('markdown', 'html', 'text')),
  citations         jsonb not null default '[]' check (jsonb_typeof(citations) = 'array'),
  my_brand_present  boolean,
  any_brand_present boolean,
  rank              integer check (rank >= 1),
  rank_original     text,
  sentiment         text check (sentiment in ('positive', 'neutral', 'negative')),
  status            text not null check (status in ('technical_error', 'refusal', 'brand_absent', 'brand_present')),
  attributed_group_id text not null,
  mapping_version   integer not null,
  sync_run_id       uuid references public.sync_runs (id) on delete set null,
  collected_at      timestamptz not null,
  collection_method text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash      text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days       smallint not null default 1 check (window_days between 1 and 366),
  schema_version    text not null,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, brand_id, engine, keyword_id, crawl_at, device),
  unique (tenant_id, brand_id, id),
  check (status <> 'brand_present' or my_brand_present is true),
  check (status <> 'brand_absent' or my_brand_present is false),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
create index ai_answers_brand_crawl_idx on public.ai_answers (tenant_id, brand_id, crawl_at, engine);

-- Originalul (HTML brut al snapshotului) separat, doar pentru audit de agenție.
create table public.ai_answer_originals (
  answer_id    uuid primary key,
  tenant_id    uuid not null,
  brand_id     uuid not null,
  raw_content  text,
  raw_format   text,
  collected_at timestamptz not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  updated_at   timestamptz not null default now(),
  foreign key (tenant_id, brand_id, answer_id) references public.ai_answers (tenant_id, brand_id, id) on delete cascade
);

create table public.ai_brand_observations (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null,
  brand_id          uuid not null,
  source_id         uuid not null,
  campaign_id       text not null,
  engine            text not null check (engine in ('openai', 'gemini', 'perplexity', 'google_ai_overview', 'unknown')),
  device            text not null default 'none' check (device in ('none', 'desktop', 'mobile')),
  keyword_id        text not null,
  crawl_at          date not null,
  observed_domain   text not null,
  is_own_brand      boolean not null,
  present           boolean,
  any_brand_present boolean,
  rank              integer check (rank >= 1),
  rank_original     text,
  rank_trend        integer,
  sentiment         text check (sentiment in ('positive', 'neutral', 'negative')),
  status            text not null check (status in ('technical_error', 'refusal', 'brand_absent', 'brand_present')),
  attributed_group_id text not null,
  mapping_version   integer not null,
  sync_run_id       uuid references public.sync_runs (id) on delete set null,
  collected_at      timestamptz not null,
  collection_method text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash      text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days       smallint not null default 1 check (window_days between 1 and 366),
  schema_version    text not null,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, brand_id, engine, keyword_id, crawl_at, device, observed_domain),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

create table public.ai_citations (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null,
  brand_id          uuid not null,
  source_id         uuid not null,
  engine            text not null check (engine in ('openai', 'gemini', 'perplexity', 'google_ai_overview', 'unknown')),
  device            text not null default 'none' check (device in ('none', 'desktop', 'mobile')),
  keyword_id        text not null,
  crawl_at          date not null,
  url               text not null check (url ~* '^https?://'),
  position          integer not null check (position >= 1),
  is_own_domain     boolean not null,
  sync_run_id       uuid references public.sync_runs (id) on delete set null,
  collected_at      timestamptz not null,
  collection_method text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash      text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version    text not null,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, brand_id, engine, keyword_id, crawl_at, device, url),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

create table public.seomonitor_ai_visibility_daily (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null,
  brand_id          uuid not null,
  source_id         uuid not null,
  campaign_id       text not null,
  group_id          text not null,
  date              date not null,
  engine            text not null check (engine in ('openai', 'gemini', 'perplexity', 'unknown')),
  metric            text not null check (metric in ('brand_mentions', 'site_citations')),
  value             numeric check (value >= 0),
  value_original    text,
  mapping_version   integer not null,
  sync_run_id       uuid references public.sync_runs (id) on delete set null,
  collected_at      timestamptz not null,
  collection_method text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash      text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days       smallint not null default 1 check (window_days between 1 and 366),
  schema_version    text not null,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, brand_id, campaign_id, group_id, date, engine, metric),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

create table public.seomonitor_ai_engine_stats (
  id                     bigint generated always as identity primary key,
  tenant_id              uuid not null,
  brand_id               uuid not null,
  source_id              uuid not null,
  campaign_id            text not null,
  group_id               text not null,
  engine                 text not null,
  period_start           date not null,
  period_end             date not null,
  enabled                boolean,
  last_crawl_date        date,
  presence_rate          numeric,
  presence_trend         numeric,
  source_citations       numeric,
  source_citations_trend numeric,
  avg_position           numeric,
  avg_position_trend     numeric,
  sentiment_positive     numeric,
  sentiment_neutral      numeric,
  sentiment_negative     numeric,
  missing_data           boolean,
  missing_data_reason    text,
  calculated_from        date,
  mapping_version        integer not null,
  sync_run_id            uuid references public.sync_runs (id) on delete set null,
  collected_at           timestamptz not null,
  collection_method      text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash           text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version         text not null,
  updated_at             timestamptz not null default now(),
  unique (tenant_id, brand_id, campaign_id, group_id, engine, period_start, period_end),
  check (period_end >= period_start),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

-- updated_at --------------------------------------------------------------------------------------
create trigger keyword_groups_updated_at before update on public.keyword_groups for each row execute function private.set_updated_at();
create trigger keywords_updated_at before update on public.keywords for each row execute function private.set_updated_at();
create trigger rank_observations_updated_at before update on public.rank_observations for each row execute function private.set_updated_at();
create trigger seomonitor_group_visibility_daily_updated_at before update on public.seomonitor_group_visibility_daily for each row execute function private.set_updated_at();
create trigger ai_answers_updated_at before update on public.ai_answers for each row execute function private.set_updated_at();
create trigger ai_answer_originals_updated_at before update on public.ai_answer_originals for each row execute function private.set_updated_at();
create trigger ai_brand_observations_updated_at before update on public.ai_brand_observations for each row execute function private.set_updated_at();
create trigger ai_citations_updated_at before update on public.ai_citations for each row execute function private.set_updated_at();
create trigger seomonitor_ai_visibility_daily_updated_at before update on public.seomonitor_ai_visibility_daily for each row execute function private.set_updated_at();
create trigger seomonitor_ai_engine_stats_updated_at before update on public.seomonitor_ai_engine_stats for each row execute function private.set_updated_at();

-- RLS ---------------------------------------------------------------------------------------------

-- Tabele de metrici: citire cu acces la brand (inclusiv client), scriere doar service role.
do $$
declare
  t text;
begin
  foreach t in array array['keyword_groups', 'keywords', 'rank_observations', 'seomonitor_group_visibility_daily',
                           'ai_answers', 'ai_brand_observations', 'ai_citations', 'seomonitor_ai_visibility_daily',
                           'seomonitor_ai_engine_stats']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.has_brand_access(brand_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (false)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (false)', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (false)', t || '_delete', t);
  end loop;
end;
$$;

-- Originalele răspunsurilor AI: doar rolurile de agenție cu acces la brand (HTML extern nesanitizat).
grant select on public.ai_answer_originals to authenticated;
alter table public.ai_answer_originals enable row level security;
create policy ai_answer_originals_select on public.ai_answer_originals for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy ai_answer_originals_insert on public.ai_answer_originals for insert to authenticated with check (false);
create policy ai_answer_originals_update on public.ai_answer_originals for update to authenticated using (false);
create policy ai_answer_originals_delete on public.ai_answer_originals for delete to authenticated using (false);

-- Maparea: rolurile de agenție citesc; agency_admin creează versiuni noi; nimic nu se modifică.
grant select, insert on public.seomonitor_group_mappings to authenticated;
alter table public.seomonitor_group_mappings enable row level security;
create policy seomonitor_group_mappings_select on public.seomonitor_group_mappings for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy seomonitor_group_mappings_insert on public.seomonitor_group_mappings for insert to authenticated
  with check (
    private.has_role(tenant_id, array['agency_admin']::public.membership_role[])
    and created_by = (select auth.uid())
  );
create policy seomonitor_group_mappings_update on public.seomonitor_group_mappings for update to authenticated using (false);
create policy seomonitor_group_mappings_delete on public.seomonitor_group_mappings for delete to authenticated using (false);

-- Coada de verificare: rolurile de agenție citesc; scrie doar worker-ul.
grant select on public.seomonitor_mapping_queue to authenticated;
alter table public.seomonitor_mapping_queue enable row level security;
create policy seomonitor_mapping_queue_select on public.seomonitor_mapping_queue for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy seomonitor_mapping_queue_insert on public.seomonitor_mapping_queue for insert to authenticated with check (false);
create policy seomonitor_mapping_queue_update on public.seomonitor_mapping_queue for update to authenticated using (false);
create policy seomonitor_mapping_queue_delete on public.seomonitor_mapping_queue for delete to authenticated using (false);

-- Observații pentru metrics.compute (security_invoker: RLS-ul tabelelor se aplică cititorului) --------
-- device: registrul are o singură cheie per metrică; dispozitivul se alege la citire (dashboard_configs).
create view public.seomonitor_metric_observations
with (security_invoker = true) as
-- Visibility: doar grupul principal al brandului; fiecare observație zilnică acoperă o zi (weight = window_days).
select v.tenant_id, v.brand_id, v.date, v.device, m.metric_key, v.visibility as value, v.window_days::numeric as weight
from public.seomonitor_group_visibility_daily v
cross join (values ('seomonitor_visibility'), ('seomonitor_visibility_latest')) as m (metric_key)
where v.is_primary
union all
-- Top 3 / Top 10: numărul de keywords cu rank 1–3 / 1–10 în ziua respectivă. Rank absent (NULL) nu contează.
select r.tenant_id, r.brand_id, r.date, r.device, m.metric_key,
       count(distinct r.keyword_id) filter (where r.rank between 1 and m.max_rank)::numeric as value,
       null::numeric as weight
from public.rank_observations r
cross join (values ('seomonitor_keywords_top3', 3), ('seomonitor_keywords_top10', 10)) as m (metric_key, max_rank)
group by r.tenant_id, r.brand_id, r.date, r.device, m.metric_key;

grant select on public.seomonitor_metric_observations to authenticated;

-- Stările AI pentru metrics.classify_ai_answer / metrics.ai_rate_inputs.
create view public.seomonitor_ai_answer_states
with (security_invoker = true) as
select a.tenant_id, a.brand_id, a.engine, a.surface, a.device, a.keyword_id, a.crawl_at, a.status,
       (a.status <> 'technical_error') as collection_ok,
       (a.status = 'refusal') as engine_refused,
       case a.status when 'brand_present' then true when 'brand_absent' then false when 'refusal' then false end as brand_present
from public.ai_answers a;

grant select on public.seomonitor_ai_answer_states to authenticated;
