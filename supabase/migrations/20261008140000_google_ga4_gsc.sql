-- GA4 Data API și Search Console API: tabele tipizate, proveniență, RLS, view-uri de observații pentru metrics.compute.
-- Contract: docs/contracts/google.md. Documentația sursă: vezi acolo (citită 2026-10-08).
--
-- Conexiuni (source_connections):
--   provider 'google_service_account' · brand_id NULL · un singur JSON de service account per tenant (în Vault)
--   provider 'ga4'                    · per brand · external_account_id = property ID GA4 (numeric) · timezone = fusul proprietății
--   provider 'gsc'                    · per brand · external_account_id = site_url (https://… sau sc-domain:…)
-- Conexiunile ga4/gsc nu au token propriu (credential_status = missing); conectorul folosește credențialul tenantului.
--
-- O metrică absentă din payload = NULL, nu 0. Un zi fără rânduri în răspuns nu e o zi cu zero: e o zi neconfirmată.

-- Rândurile cu text lung (landing page, query, page) intră în cheia unică prin md5, ca indexul să rămână sub
-- limita btree; md5-ul e verificat de CHECK, deci nu poate fi trimis greșit.

-- web_daily: GA4 pe zi × canal × sursă/medium × landing page --------------------------------------------

create table public.web_daily (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  date                 date not null,
  channel_group        text not null check (length(channel_group) between 1 and 256),
  source_medium        text not null check (length(source_medium) between 1 and 512),
  landing_page         text not null check (length(landing_page) between 1 and 4096),
  landing_page_md5     text not null check (landing_page_md5 = md5(landing_page)),

  sessions             bigint check (sessions >= 0),
  engaged_sessions     bigint check (engaged_sessions >= 0),
  key_events           numeric check (key_events >= 0),
  -- NU se însumează: același utilizator activ în mai multe rânduri sau zile. Metrica „utilizatori activi” vine din
  -- web_active_users_interval (raport pe intervalul întreg). Păstrat pentru audit, nu intră în niciun view de observații.
  active_users_not_additive bigint check (active_users_not_additive >= 0),

  source_id            uuid not null,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days          smallint not null default 1 check (window_days between 1 and 366),
  source_timezone      text not null,
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, date, channel_group, source_medium, landing_page_md5),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.web_daily is
  'GA4 runReport pe zi × sessionDefaultChannelGroup × sessionSourceMedium × landingPagePlusQueryString. '
  'Data în fusul proprietății GA4 (source_timezone). Zilele fără rânduri sunt neconfirmate, nu zero.';
create index web_daily_brand_date_idx on public.web_daily (tenant_id, brand_id, date);

-- web_key_events: key events pe zi × eventName ----------------------------------------------------------

create table public.web_key_events (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  date                 date not null,
  event_name           text not null check (length(event_name) between 1 and 256),
  key_events           numeric check (key_events >= 0),

  source_id            uuid not null,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days          smallint not null default 1 check (window_days between 1 and 366),
  source_timezone      text not null,
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, date, event_name),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.web_key_events is
  'GA4 keyEvents pe zi × eventName. Sursa metricii ga4_key_events (totalul zilei nu depinde de dimensiunile de landing page).';
create index web_key_events_brand_date_idx on public.web_key_events (tenant_id, brand_id, date);

-- web_active_users_interval: utilizatori activi pe EXACT intervalul cerut (fără dimensiunea date) ---------

create table public.web_active_users_interval (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  interval_start       date not null,
  interval_end         date not null,
  active_users         bigint check (active_users >= 0),

  source_id            uuid not null,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  source_timezone      text not null,
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  check (interval_end >= interval_start),
  unique (tenant_id, brand_id, interval_start, interval_end),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.web_active_users_interval is
  'GA4 activeUsers per interval cerut, fără dimensiunea date. Nu se însumează și nu se derivă din web_daily.';
create index web_active_users_interval_brand_idx on public.web_active_users_interval (tenant_id, brand_id, interval_start, interval_end);

-- search_daily: totaluri GSC pe zi × device ----------------------------------------------------------------

create table public.search_daily (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  date                 date not null,
  device               text not null check (device in ('DESKTOP', 'MOBILE', 'TABLET')),
  clicks               numeric check (clicks >= 0),
  impressions          numeric check (impressions >= 0),
  ctr_reported         numeric check (ctr_reported between 0 and 1),  -- doar pentru reconciliere; CTR-ul se recalculează
  position             numeric check (position >= 0),                 -- poziția medie GSC (nu rankul SEOmonitor)

  source_id            uuid not null,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days          smallint not null default 1 check (window_days between 1 and 366),
  source_timezone      text not null,
  data_state           text not null check (data_state in ('final', 'all')),
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, date, device),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.search_daily is
  'Search Console Analytics pe date × device, fără query: include și interogările anonimizate. Datele sunt în PT (America/Los_Angeles).';
create index search_daily_brand_date_idx on public.search_daily (tenant_id, brand_id, date);

-- search_queries: detalii pe query × pagină (separat de totaluri: GSC exclude interogările anonimizate) ---------

create table public.search_queries (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  date                 date not null,
  device               text not null check (device in ('DESKTOP', 'MOBILE', 'TABLET')),
  query                text not null check (length(query) between 1 and 4096),
  query_md5            text not null check (query_md5 = md5(query)),
  page                 text not null check (length(page) between 1 and 4096),
  page_md5             text not null check (page_md5 = md5(page)),
  clicks               numeric check (clicks >= 0),
  impressions          numeric check (impressions >= 0),
  ctr_reported         numeric check (ctr_reported between 0 and 1),
  position             numeric check (position >= 0),

  source_id            uuid not null,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days          smallint not null default 1 check (window_days between 1 and 366),
  source_timezone      text not null,
  data_state           text not null check (data_state in ('final', 'all')),
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, date, device, query_md5, page_md5),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.search_queries is
  'Search Console Analytics pe date × device × query × page. Nu însumează la totalul zilei (interogările anonimizate lipsesc). '
  'Nu intră în metricile de total.';
create index search_queries_brand_date_idx on public.search_queries (tenant_id, brand_id, date);

-- source_reconciliations: totalul nostru vs totalul raportat de sursă ------------------------------------------

create table public.source_reconciliations (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  source               text not null check (source in ('ga4', 'gsc')),
  metric               text not null check (length(metric) between 1 and 64),
  period_start         date not null,
  period_end           date not null,
  source_timezone      text not null,
  property_ref         text not null,
  our_total            numeric,
  source_total         numeric,
  difference           numeric,
  difference_pct       numeric,
  status               text not null check (status in ('match', 'within_tolerance', 'mismatch', 'incomparable')),
  tolerance_pct        numeric not null check (tolerance_pct >= 0),
  reason               text,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  checked_at           timestamptz not null,
  check (period_end >= period_start),
  unique (tenant_id, brand_id, source, metric, period_start, period_end, property_ref),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
comment on table public.source_reconciliations is
  'Reconcilierea totalului nostru cu totalul raportat de sursă pe același interval, fus orar și proprietate. '
  'incomparable = intervalul, fusul sau proprietatea nu coincid sau lipsește unul dintre totaluri.';
create index source_reconciliations_brand_idx on public.source_reconciliations (tenant_id, brand_id, period_start);

-- Triggere updated_at ------------------------------------------------------------------------------------------

create trigger web_daily_updated_at before update on public.web_daily for each row execute function private.set_updated_at();
create trigger web_key_events_updated_at before update on public.web_key_events for each row execute function private.set_updated_at();
create trigger web_active_users_interval_updated_at before update on public.web_active_users_interval for each row execute function private.set_updated_at();
create trigger search_daily_updated_at before update on public.search_daily for each row execute function private.set_updated_at();
create trigger search_queries_updated_at before update on public.search_queries for each row execute function private.set_updated_at();

-- RLS: citire pentru oricine are acces la brand (inclusiv client), scriere doar prin service role ----------------

grant select on public.web_daily, public.web_key_events, public.web_active_users_interval,
  public.search_daily, public.search_queries, public.source_reconciliations to authenticated;

alter table public.web_daily                  enable row level security;
alter table public.web_key_events             enable row level security;
alter table public.web_active_users_interval  enable row level security;
alter table public.search_daily               enable row level security;
alter table public.search_queries             enable row level security;
alter table public.source_reconciliations     enable row level security;

create policy web_daily_select on public.web_daily for select to authenticated using (private.has_brand_access(brand_id));
create policy web_daily_insert on public.web_daily for insert to authenticated with check (false);
create policy web_daily_update on public.web_daily for update to authenticated using (false);
create policy web_daily_delete on public.web_daily for delete to authenticated using (false);

create policy web_key_events_select on public.web_key_events for select to authenticated using (private.has_brand_access(brand_id));
create policy web_key_events_insert on public.web_key_events for insert to authenticated with check (false);
create policy web_key_events_update on public.web_key_events for update to authenticated using (false);
create policy web_key_events_delete on public.web_key_events for delete to authenticated using (false);

create policy web_active_users_interval_select on public.web_active_users_interval for select to authenticated using (private.has_brand_access(brand_id));
create policy web_active_users_interval_insert on public.web_active_users_interval for insert to authenticated with check (false);
create policy web_active_users_interval_update on public.web_active_users_interval for update to authenticated using (false);
create policy web_active_users_interval_delete on public.web_active_users_interval for delete to authenticated using (false);

create policy search_daily_select on public.search_daily for select to authenticated using (private.has_brand_access(brand_id));
create policy search_daily_insert on public.search_daily for insert to authenticated with check (false);
create policy search_daily_update on public.search_daily for update to authenticated using (false);
create policy search_daily_delete on public.search_daily for delete to authenticated using (false);

create policy search_queries_select on public.search_queries for select to authenticated using (private.has_brand_access(brand_id));
create policy search_queries_insert on public.search_queries for insert to authenticated with check (false);
create policy search_queries_update on public.search_queries for update to authenticated using (false);
create policy search_queries_delete on public.search_queries for delete to authenticated using (false);

-- Reconcilierile sunt informație operațională: doar rolurile de agenție cu acces la brand.
create policy source_reconciliations_select on public.source_reconciliations for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy source_reconciliations_insert on public.source_reconciliations for insert to authenticated with check (false);
create policy source_reconciliations_update on public.source_reconciliations for update to authenticated using (false);
create policy source_reconciliations_delete on public.source_reconciliations for delete to authenticated using (false);

-- View-uri de observații pentru metrics.compute -----------------------------------------------------------------
-- Aceeași formă ca la Clarity/SEOmonitor, plus numerator/denominator pentru rate.
-- security_invoker: RLS-ul tabelelor se aplică celui care citește.

-- sessions, engaged sessions: suma rândurilor zilei; NULL dacă toate sunt NULL (nu 0).
-- key events: din web_key_events (totalul zilei, independent de dimensiunile de landing page).
create view public.web_metric_observations
with (security_invoker = true) as
select d.tenant_id, d.brand_id, d.date, m.metric_key,
       sum(case m.metric_key when 'ga4_sessions' then d.sessions else d.engaged_sessions end)::numeric as value,
       null::numeric as weight, null::numeric as numerator, null::numeric as denominator,
       max(d.collected_at) as collected_at
from public.web_daily d
cross join (values ('ga4_sessions'), ('ga4_engaged_sessions')) as m (metric_key)
where d.window_days = 1
group by d.tenant_id, d.brand_id, d.date, m.metric_key
union all
select k.tenant_id, k.brand_id, k.date, 'ga4_key_events', sum(k.key_events), null, null, null, max(k.collected_at)
from public.web_key_events k
where k.window_days = 1
group by k.tenant_id, k.brand_id, k.date;

grant select on public.web_metric_observations to authenticated;

-- Utilizatori activi: o observație per interval cerut (interval_report_only).
create view public.web_active_users_observations
with (security_invoker = true) as
select a.tenant_id, a.brand_id, 'ga4_active_users'::text as metric_key,
       a.interval_start as start, a.interval_end as "end", a.active_users::numeric as value, a.collected_at
from public.web_active_users_interval a;

grant select on public.web_active_users_observations to authenticated;

-- clicks, impressions: suma device-urilor zilei. CTR: ratio din clicks și impressions agregate (niciodată media ratelor).
-- Poziția: media ponderată cu impressions (zi: ponderat pe device-uri, apoi ponderat pe zile de motor).
create view public.search_metric_observations
with (security_invoker = true) as
select s.tenant_id, s.brand_id, s.date, 'gsc_clicks'::text as metric_key,
       sum(s.clicks) as value, null::numeric as weight, null::numeric as numerator, null::numeric as denominator,
       max(s.collected_at) as collected_at
from public.search_daily s where s.window_days = 1 group by s.tenant_id, s.brand_id, s.date
union all
select s.tenant_id, s.brand_id, s.date, 'gsc_impressions', sum(s.impressions), null, null, null, max(s.collected_at)
from public.search_daily s where s.window_days = 1 group by s.tenant_id, s.brand_id, s.date
union all
select s.tenant_id, s.brand_id, s.date, 'gsc_ctr', null, null, sum(s.clicks), sum(s.impressions), max(s.collected_at)
from public.search_daily s where s.window_days = 1 group by s.tenant_id, s.brand_id, s.date
union all
select s.tenant_id, s.brand_id, s.date, 'gsc_average_position',
       sum(s.position * s.impressions) / nullif(sum(s.impressions), 0), sum(s.impressions), null, null, max(s.collected_at)
from public.search_daily s where s.window_days = 1 and s.position is not null and s.impressions is not null
group by s.tenant_id, s.brand_id, s.date;

grant select on public.search_metric_observations to authenticated;
