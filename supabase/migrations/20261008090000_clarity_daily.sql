-- Clarity: metrici zilnice per brand și dimensiune, cu proveniență. Contract: docs/contracts/clarity.md.
--
-- `date` = ziua anterioară rulării, în Europe/Bucharest. Fereastra reală a datelor: cele 24 de ore
-- (window_days × 24) care se încheie la `collected_at`, în UTC (numOfDays=1 din Data Export API).
--
-- Coloanele de metrici urmează lista din documentația Microsoft (actualizată 2025-12-05). Documentația dă
-- numele câmpurilor doar pentru blocul „Traffic"; celelalte coloane rămân NULL până când numele câmpurilor
-- sunt confirmate pe un payload real (parserul loghează câmpurile necunoscute). O metrică absentă = NULL, nu 0.

create table public.clarity_daily (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  date                 date not null,
  dimension            text not null check (dimension in ('all', 'device', 'source', 'page')),
  dimension_value      text not null check (length(dimension_value) between 1 and 2048),

  -- Blocul „Traffic" (câmpuri documentate)
  sessions             bigint check (sessions >= 0),           -- totalSessionCount
  bot_sessions         bigint check (bot_sessions >= 0),       -- totalBotSessionCount
  distinct_users       bigint check (distinct_users >= 0),     -- distantUserCount
  pages_per_session    numeric check (pages_per_session >= 0), -- PagesPerSessionPercentage

  -- Metrici listate în documentație, fără nume de câmpuri documentate (neconfirmate)
  scroll_depth         numeric check (scroll_depth >= 0),
  engagement_time      numeric check (engagement_time >= 0),
  dead_click_count     numeric check (dead_click_count >= 0),
  rage_click_count     numeric check (rage_click_count >= 0),
  quickback_click      numeric check (quickback_click >= 0),
  excessive_scroll     numeric check (excessive_scroll >= 0),
  script_error_count   numeric check (script_error_count >= 0),
  error_click_count    numeric check (error_click_count >= 0),

  -- Proveniență
  source_id            uuid not null,
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'api' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  window_days          smallint not null default 1 check (window_days between 1 and 3),
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, date, dimension, dimension_value),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);

comment on table public.clarity_daily is
  'Clarity Data Export: o zi (Europe/Bucharest, ziua anterioară rulării) × dimensiune × valoare. '
  'window_days = 2 sau 3 marchează un agregat de recuperare, nu o zi reală.';
comment on column public.clarity_daily.date is
  'Ziua anterioară rulării în Europe/Bucharest. Fereastra reală: window_days × 24 h care se încheie la collected_at (UTC).';
comment on column public.clarity_daily.pages_per_session is
  'PagesPerSessionPercentage din blocul Traffic; în exemplul din documentație valoarea e de forma 1.0931 (pagini per sesiune).';
comment on column public.clarity_daily.scroll_depth is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';
comment on column public.clarity_daily.engagement_time is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';
comment on column public.clarity_daily.dead_click_count is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';
comment on column public.clarity_daily.rage_click_count is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';
comment on column public.clarity_daily.quickback_click is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';
comment on column public.clarity_daily.excessive_scroll is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';
comment on column public.clarity_daily.script_error_count is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';
comment on column public.clarity_daily.error_click_count is 'Neconfirmat: documentația listează metrica, nu și câmpurile.';

create index clarity_daily_brand_date_idx on public.clarity_daily (tenant_id, brand_id, date, dimension);

create trigger clarity_daily_updated_at before update on public.clarity_daily
  for each row execute function private.set_updated_at();

-- RLS ca la restul tabelelor de metrici: citire pentru oricine are acces la brand (inclusiv client),
-- scriere doar prin service role (worker).
grant select on public.clarity_daily to authenticated;
alter table public.clarity_daily enable row level security;

create policy clarity_daily_select on public.clarity_daily for select to authenticated
  using (private.has_brand_access(brand_id));
create policy clarity_daily_insert on public.clarity_daily for insert to authenticated
  with check (false);
create policy clarity_daily_update on public.clarity_daily for update to authenticated
  using (false);
create policy clarity_daily_delete on public.clarity_daily for delete to authenticated
  using (false);

-- Observații pentru metrics.compute, conform definițiilor draft din registru (docs/metrics/registry.md).
-- Doar dimensiunea „all" și doar zilele reale (window_days = 1). `value` NULL rămâne NULL: compute o exclude și raportează motivul.
-- security_invoker: RLS-ul din clarity_daily se aplică celui care citește.
create view public.clarity_metric_observations
with (security_invoker = true) as
select d.tenant_id, d.brand_id, d.date, m.metric_key, m.value, m.weight, d.collected_at, d.window_days
from public.clarity_daily d
cross join lateral (
  values
    ('clarity_rage_click_sessions', d.rage_click_count, null::numeric),
    ('clarity_dead_click_sessions', d.dead_click_count, null::numeric),
    ('clarity_quickback_sessions', d.quickback_click, null::numeric),
    ('clarity_scroll_depth', d.scroll_depth, d.sessions::numeric)
) as m (metric_key, value, weight)
where d.dimension = 'all'
  and d.window_days = 1; -- agregatele de recuperare (2–3 zile) nu sunt zile reale

grant select on public.clarity_metric_observations to authenticated;
