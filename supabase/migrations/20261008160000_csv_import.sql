-- Import CSV asistat (nivel B): Google Ads, Meta Ads, TikTok Ads, Planable Analytics, Planable Listening.
-- Contracte: docs/contracts/csv-*.md (generate din supabase/functions/_shared/csv-import/contracts.ts).
--
-- Fluxul: previzualizare (validare rând cu rând, rânduri păstrate în import_batch_rows) → confirmare (upsert în tabelele
-- tipizate). Doar service role scrie; funcția server verifică rolul (account / agency_admin) și brand_access.
-- O valoare lipsă în CSV = NULL, nu 0. Moneda și fusul orar se declară pe lot.

-- import_batches: declarații pe lot, perioadă, rezultat detectat, confirmare -------------------------------------

alter table public.import_batches
  add column currency         char(3) check (currency ~ '^[A-Z]{3}$'),
  add column timezone         text,
  add column attribution_config text check (length(attribution_config) between 1 and 64),
  add column click_type       text check (length(click_type) between 1 and 64),
  add column period_start     date,
  add column period_end       date,
  add column rows_total       integer check (rows_total >= 0),
  add column rows_skipped     integer not null default 0 check (rows_skipped >= 0),
  add column detected         jsonb not null default '{}'::jsonb check (jsonb_typeof(detected) = 'object'),
  add column confirmed_by     uuid references auth.users (id) on delete set null,
  add column confirmed_at     timestamptz,
  add constraint import_batches_period_ordered check (period_end is null or period_start is null or period_end >= period_start),
  add constraint import_batches_confirmed_consistent check ((confirmed_by is null) = (confirmed_at is null)),
  add constraint import_batches_tenant_brand_id_key unique (tenant_id, brand_id, id);

-- import_batch_rows: rândurile validate ale unui lot (acceptate și respinse, cu motivul) --------------------------

create table public.import_batch_rows (
  batch_id    uuid not null,
  row_number  integer not null check (row_number >= 1),
  tenant_id   uuid not null,
  brand_id    uuid not null,
  status      text not null check (status in ('accepted', 'rejected')),
  reason      text,
  target      text check (target in ('paid_daily', 'social_daily', 'social_posts', 'mentions')),
  data        jsonb check (jsonb_typeof(data) = 'object'),
  created_at  timestamptz not null default now(),
  primary key (batch_id, row_number),
  check ((status = 'accepted') = (data is not null and target is not null)),
  check ((status = 'rejected') = (reason is not null)),
  foreign key (tenant_id, brand_id, batch_id) references public.import_batches (tenant_id, brand_id, id) on delete cascade
);
comment on table public.import_batch_rows is
  'Rândurile unui lot după validare. Acceptate = gata de scris la confirmare; respinse = cu motivul. Vizibile doar agenției.';
create index import_batch_rows_status_idx on public.import_batch_rows (tenant_id, brand_id, batch_id, status);

-- paid_daily: Google Ads, Meta Ads, TikTok Ads -------------------------------------------------------------------
-- Cheia din spec cap. 25 (tenant, source, account, campaign, ad_group, ad, date, breakdown_signature,
-- attribution_config) + brand_id (aceeași campanie importată pentru două branduri nu se suprascrie).
-- ad_group_id / ad_id = '' când exportul e la nivel de campanie sau grup. ID-ul lipsă dintr-un export doar cu nume
-- devine 'name:<nume>' (marcat), nu se inventează un ID.

create table public.paid_daily (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  source               text not null check (source in ('google_ads', 'meta_ads', 'tiktok_ads')),
  account_id           text not null default '' check (length(account_id) <= 128),
  campaign_id          text not null check (length(campaign_id) between 1 and 512),
  ad_group_id          text not null default '' check (length(ad_group_id) <= 512),
  ad_id                text not null default '' check (length(ad_id) <= 512),
  date                 date not null,
  breakdown_signature  text not null default 'none' check (length(breakdown_signature) between 1 and 128),
  attribution_config   text not null default 'unspecified' check (length(attribution_config) between 1 and 64),
  click_type           text not null default 'unspecified' check (length(click_type) between 1 and 64),

  account_name         text,
  campaign_name        text,
  ad_group_name        text,
  ad_name              text,

  spend                numeric check (spend >= 0),
  impressions          bigint check (impressions >= 0),
  clicks               bigint check (clicks >= 0),
  conversions          numeric check (conversions >= 0),
  currency             char(3) not null check (currency ~ '^[A-Z]{3}$'),

  import_batch_id      uuid not null,
  row_number           integer not null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'csv' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  source_timezone      text not null,
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, source, account_id, campaign_id, ad_group_id, ad_id, date, breakdown_signature, attribution_config),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, import_batch_id) references public.import_batches (tenant_id, brand_id, id) on delete restrict
);
comment on table public.paid_daily is
  'Paid media pe zi × campanie × grup × reclamă (CSV). Un reimport al aceleiași chei înlocuiește rândul. Moneda e cea declarată pe lot.';
create index paid_daily_brand_date_idx on public.paid_daily (tenant_id, brand_id, source, date);

-- social_daily / social_posts: Planable Analytics -------------------------------------------------------------------

create table public.social_daily (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  platform             text not null check (platform ~ '^[a-z0-9_]+$'),
  account_id           text not null check (length(account_id) between 1 and 256),
  account_name         text,
  date                 date not null,

  followers            bigint check (followers >= 0),  -- snapshot: ultima observație, nu se însumează
  impressions          bigint check (impressions >= 0),
  reach_not_additive   bigint check (reach_not_additive >= 0), -- reach zilnic: NU se însumează pe zile sau platforme
  engagements          bigint check (engagements >= 0),
  likes                bigint check (likes >= 0),
  comments             bigint check (comments >= 0),
  shares               bigint check (shares >= 0),
  saves                bigint check (saves >= 0),
  link_clicks          bigint check (link_clicks >= 0),
  video_views          bigint check (video_views >= 0),

  import_batch_id      uuid not null,
  row_number           integer not null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'csv' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  source_timezone      text not null,
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, platform, account_id, date),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, import_batch_id) references public.import_batches (tenant_id, brand_id, id) on delete restrict
);
comment on table public.social_daily is
  'Social propriu pe zi × cont (Planable Analytics, CSV). Absența unei metrici = NULL, nu 0. Followers = snapshot; reach nu se însumează.';
create index social_daily_brand_date_idx on public.social_daily (tenant_id, brand_id, platform, date);

create table public.social_posts (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  platform             text not null check (platform ~ '^[a-z0-9_]+$'),
  account_id           text not null check (length(account_id) between 1 and 256),
  post_id              text not null check (length(post_id) between 1 and 512),
  snapshot_date        date not null,
  metrics_scope        text not null check (metrics_scope in ('lifetime', 'period')),
  published_at         timestamptz not null,
  post_url             text,
  post_text            text check (length(post_text) <= 10000),

  impressions          bigint check (impressions >= 0),
  reach_not_additive   bigint check (reach_not_additive >= 0),
  engagements          bigint check (engagements >= 0),
  likes                bigint check (likes >= 0),
  comments             bigint check (comments >= 0),
  shares               bigint check (shares >= 0),
  saves                bigint check (saves >= 0),
  link_clicks          bigint check (link_clicks >= 0),
  video_views          bigint check (video_views >= 0),

  import_batch_id      uuid not null,
  row_number           integer not null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'csv' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  source_timezone      text not null,
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  unique (tenant_id, brand_id, platform, account_id, post_id, snapshot_date, metrics_scope),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, import_batch_id) references public.import_batches (tenant_id, brand_id, id) on delete restrict
);
comment on table public.social_posts is
  'Postări proprii cu snapshot de metrici (Planable Analytics, CSV). Lifetime și perioadă sunt rapoarte diferite și nu se suprapun.';
create index social_posts_brand_idx on public.social_posts (tenant_id, brand_id, platform, published_at);

-- mentions: Planable Listening ---------------------------------------------------------------------------------------
-- Fără autor (date personale minime). Sentimentul furnizorului se suprascrie la reimport doar dacă nu a fost revizuit
-- de un om (sentiment_reviewed_*): corecțiile umane au prioritate (spec 2.7).

create table public.mentions (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid not null,
  native_id            text not null check (length(native_id) between 1 and 512),
  url                  text not null check (length(url) between 1 and 2048),
  source_name          text check (length(source_name) <= 256),
  published_at         timestamptz not null,
  text                 text check (length(text) <= 20000),
  sentiment            text not null default 'unknown' check (sentiment in ('positive', 'neutral', 'negative', 'unknown')),
  sentiment_reviewed_by uuid references auth.users (id) on delete set null,
  sentiment_reviewed_at timestamptz,
  language             text check (language ~ '^[a-z]{2,3}$'),
  country              text check (country ~ '^[A-Z]{2}$'),

  import_batch_id      uuid not null,
  row_number           integer not null,
  collected_at         timestamptz not null,
  collection_method    text not null default 'csv' check (collection_method in ('api', 'csv')),
  payload_hash         text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  source_timezone      text not null,
  schema_version       text not null,
  updated_at           timestamptz not null default now(),

  check ((sentiment_reviewed_by is null) = (sentiment_reviewed_at is null)),
  unique (tenant_id, brand_id, native_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, brand_id, import_batch_id) references public.import_batches (tenant_id, brand_id, id) on delete restrict
);
comment on table public.mentions is
  'Mențiuni (Planable Listening, CSV). native_id = ID-ul din fișier sau hash-ul URL-ului. Sentimentul revizuit de om nu se suprascrie la reimport.';
create index mentions_brand_published_idx on public.mentions (tenant_id, brand_id, published_at);

create trigger paid_daily_updated_at before update on public.paid_daily for each row execute function private.set_updated_at();
create trigger social_daily_updated_at before update on public.social_daily for each row execute function private.set_updated_at();
create trigger social_posts_updated_at before update on public.social_posts for each row execute function private.set_updated_at();
create trigger mentions_updated_at before update on public.mentions for each row execute function private.set_updated_at();

-- RLS ----------------------------------------------------------------------------------------------------------------------
-- Datele importate: citire pentru oricine are acces la brand (inclusiv client); scriere doar service role.
-- import_batch_rows: doar agenția (conține și rândurile respinse).

grant select on public.paid_daily, public.social_daily, public.social_posts, public.mentions, public.import_batch_rows to authenticated;

alter table public.paid_daily        enable row level security;
alter table public.social_daily      enable row level security;
alter table public.social_posts      enable row level security;
alter table public.mentions          enable row level security;
alter table public.import_batch_rows enable row level security;

create policy paid_daily_select on public.paid_daily for select to authenticated using (private.has_brand_access(brand_id));
create policy paid_daily_insert on public.paid_daily for insert to authenticated with check (false);
create policy paid_daily_update on public.paid_daily for update to authenticated using (false);
create policy paid_daily_delete on public.paid_daily for delete to authenticated using (false);

create policy social_daily_select on public.social_daily for select to authenticated using (private.has_brand_access(brand_id));
create policy social_daily_insert on public.social_daily for insert to authenticated with check (false);
create policy social_daily_update on public.social_daily for update to authenticated using (false);
create policy social_daily_delete on public.social_daily for delete to authenticated using (false);

create policy social_posts_select on public.social_posts for select to authenticated using (private.has_brand_access(brand_id));
create policy social_posts_insert on public.social_posts for insert to authenticated with check (false);
create policy social_posts_update on public.social_posts for update to authenticated using (false);
create policy social_posts_delete on public.social_posts for delete to authenticated using (false);

create policy mentions_select on public.mentions for select to authenticated using (private.has_brand_access(brand_id));
create policy mentions_insert on public.mentions for insert to authenticated with check (false);
create policy mentions_update on public.mentions for update to authenticated using (false);
create policy mentions_delete on public.mentions for delete to authenticated using (false);

create policy import_batch_rows_select on public.import_batch_rows for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy import_batch_rows_insert on public.import_batch_rows for insert to authenticated with check (false);
create policy import_batch_rows_update on public.import_batch_rows for update to authenticated using (false);
create policy import_batch_rows_delete on public.import_batch_rows for delete to authenticated using (false);

-- View-uri de observații pentru metrics.compute --------------------------------------------------------------------------
-- Aceeași formă ca la celelalte surse. Paid: doar rândurile fără defalcare; grupat pe monedă, atribuire și tip de click,
-- ca valorile incomparabile să nu se însumeze (mai multe grupuri în aceeași zi → duplicate_observations → indisponibil).
-- Nu se transformă NULL în 0: sum(NULL) rămâne NULL.

create view public.paid_metric_observations
with (security_invoker = true) as
with daily as (
  select tenant_id, brand_id, source, date, currency, attribution_config, click_type,
         sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks, sum(conversions) as conversions,
         max(collected_at) as collected_at
  from public.paid_daily
  where breakdown_signature = 'none'
  group by tenant_id, brand_id, source, date, currency, attribution_config, click_type
)
select d.tenant_id, d.brand_id, d.date, d.source || '_' || m.metric as metric_key,
       case m.metric when 'spend' then d.spend when 'impressions' then d.impressions::numeric
                     when 'clicks' then d.clicks::numeric when 'conversions' then d.conversions end as value,
       null::numeric as weight, null::numeric as numerator, null::numeric as denominator,
       d.currency, d.attribution_config, d.click_type, d.collected_at
from daily d
cross join (values ('spend'), ('impressions'), ('clicks'), ('conversions')) as m (metric)
union all
select d.tenant_id, d.brand_id, d.date, d.source || '_cpc', null, null, d.spend, d.clicks::numeric,
       d.currency, d.attribution_config, d.click_type, d.collected_at
from daily d
union all
select d.tenant_id, d.brand_id, d.date, d.source || '_cpa', null, null, d.spend, d.conversions,
       d.currency, d.attribution_config, d.click_type, d.collected_at
from daily d;

grant select on public.paid_metric_observations to authenticated;

-- Mențiuni distincte pe zi (data publicării, Europe/Bucharest) și distribuția sentimentului.
create view public.mentions_metric_observations
with (security_invoker = true) as
select tenant_id, brand_id, (published_at at time zone 'Europe/Bucharest')::date as date,
       'mentions_count'::text as metric_key, count(*)::numeric as value, max(collected_at) as collected_at
from public.mentions
group by tenant_id, brand_id, (published_at at time zone 'Europe/Bucharest')::date;

grant select on public.mentions_metric_observations to authenticated;

create view public.mention_sentiment_daily
with (security_invoker = true) as
select tenant_id, brand_id, (published_at at time zone 'Europe/Bucharest')::date as date, sentiment,
       count(*)::bigint as mentions, count(*) filter (where sentiment_reviewed_by is not null)::bigint as reviewed
from public.mentions
group by tenant_id, brand_id, (published_at at time zone 'Europe/Bucharest')::date, sentiment;

grant select on public.mention_sentiment_daily to authenticated;

-- Definiții de nivel B (import CSV): paid per platformă, mențiuni. Sursa umană: docs/metrics/registry.md
insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('google_ads_spend', 1, 'Cost Google Ads', 'Costul Google Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.', 'count', 'google_ads', 'sum', 1, null,
   null, 'neutral', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#google_ads_spend'),
  ('google_ads_impressions', 1, 'Impressions Google Ads', 'Afișările Google Ads în perioadă; suma zilelor.', 'count', 'google_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#google_ads_impressions'),
  ('google_ads_clicks', 1, 'Clicks Google Ads', 'Clicks Google Ads în perioadă; suma zilelor. Tipul de click (click_type) trebuie să fie același în ambele perioade comparate.', 'count', 'google_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#google_ads_clicks'),
  ('google_ads_conversions', 1, 'Conversii Google Ads', 'Conversiile raportate de Google Ads, pentru aceeași configurație de atribuire; suma zilelor. Se afișează separat de key events GA4 și nu se însumează între platforme.', 'count', 'google_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#google_ads_conversions'),
  ('google_ads_cpc', 1, 'CPC Google Ads', 'Cost / clicks pe totalurile perioadei (Google Ads), în moneda declarată; nu media ratelor zilnice.', 'count', 'google_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#google_ads_cpc'),
  ('google_ads_cpa', 1, 'CPA Google Ads', 'Cost / conversii pe totalurile perioadei (Google Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.', 'count', 'google_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#google_ads_cpa'),
  ('meta_ads_spend', 1, 'Cost Meta Ads', 'Costul Meta Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.', 'count', 'meta_ads', 'sum', 1, null,
   null, 'neutral', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#meta_ads_spend'),
  ('meta_ads_impressions', 1, 'Impressions Meta Ads', 'Afișările Meta Ads în perioadă; suma zilelor.', 'count', 'meta_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#meta_ads_impressions'),
  ('meta_ads_clicks', 1, 'Clicks Meta Ads', 'Clicks Meta Ads în perioadă; suma zilelor. Tipul de click (click_type) trebuie să fie același în ambele perioade comparate.', 'count', 'meta_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#meta_ads_clicks'),
  ('meta_ads_conversions', 1, 'Conversii Meta Ads', 'Conversiile raportate de Meta Ads, pentru aceeași configurație de atribuire; suma zilelor. Se afișează separat de key events GA4 și nu se însumează între platforme.', 'count', 'meta_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#meta_ads_conversions'),
  ('meta_ads_cpc', 1, 'CPC Meta Ads', 'Cost / clicks pe totalurile perioadei (Meta Ads), în moneda declarată; nu media ratelor zilnice.', 'count', 'meta_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#meta_ads_cpc'),
  ('meta_ads_cpa', 1, 'CPA Meta Ads', 'Cost / conversii pe totalurile perioadei (Meta Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.', 'count', 'meta_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#meta_ads_cpa'),
  ('tiktok_ads_spend', 1, 'Cost TikTok Ads', 'Costul TikTok Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.', 'count', 'tiktok_ads', 'sum', 1, null,
   null, 'neutral', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#tiktok_ads_spend'),
  ('tiktok_ads_impressions', 1, 'Impressions TikTok Ads', 'Afișările TikTok Ads în perioadă; suma zilelor.', 'count', 'tiktok_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#tiktok_ads_impressions'),
  ('tiktok_ads_clicks', 1, 'Clicks TikTok Ads', 'Clicks TikTok Ads în perioadă; suma zilelor. Tipul de click (click_type) trebuie să fie același în ambele perioade comparate.', 'count', 'tiktok_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#tiktok_ads_clicks'),
  ('tiktok_ads_conversions', 1, 'Conversii TikTok Ads', 'Conversiile raportate de TikTok Ads, pentru aceeași configurație de atribuire; suma zilelor. Se afișează separat de key events GA4 și nu se însumează între platforme.', 'count', 'tiktok_ads', 'sum', 1, null,
   null, 'higher_is_better', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#tiktok_ads_conversions'),
  ('tiktok_ads_cpc', 1, 'CPC TikTok Ads', 'Cost / clicks pe totalurile perioadei (TikTok Ads), în moneda declarată; nu media ratelor zilnice.', 'count', 'tiktok_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#tiktok_ads_cpc'),
  ('tiktok_ads_cpa', 1, 'CPA TikTok Ads', 'Cost / conversii pe totalurile perioadei (TikTok Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.', 'count', 'tiktok_ads', 'ratio', 1, null,
   null, 'lower_is_better', null, 14, 'draft', 'Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.', '2026-10-01', 'docs/metrics/registry-b.md#tiktok_ads_cpa'),
  ('mentions_count', 1, 'Mențiuni (Planable Listening)', 'Numărul de mențiuni distincte publicate în interval; importul nu schimbă data publicării.', 'count', 'planable_listening', 'sum', 1, null,
   null, 'neutral', null, 14, 'active', null, '2026-10-01', 'docs/metrics/registry-b.md#mentions_count');
