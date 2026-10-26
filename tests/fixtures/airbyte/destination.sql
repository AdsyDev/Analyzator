-- O destinație Postgres Airbyte falsă (Destinations V2), pentru testarea locală a funcției server `airbyte` (E-6).
-- Date sintetice, doar pentru teste; structura urmează fluxurile surselor Airbyte:
--   Meta: source-facebook-marketing (ads_insights, ad_account)
--   Google Ads: source-google-ads (account_performance_report, campaign, customer); câmpurile `customer.id` devin
--     coloane `customer_id`
--   TikTok: source-tiktok-marketing (advertisers_reports_daily cu `metrics` jsonb, advertisers)
-- Rulare: psql -d <baza de test> -f tests/fixtures/airbyte/destination.sql (creează și utilizatorul read-only).

create schema if not exists airbyte_internal;
create table if not exists airbyte_internal.public_raw__stream_ads_insights (
  _airbyte_raw_id uuid primary key, _airbyte_data jsonb, _airbyte_extracted_at timestamptz, _airbyte_loaded_at timestamptz
);

create schema if not exists meta;
create table meta.ads_insights (
  _airbyte_raw_id uuid primary key default gen_random_uuid(),
  _airbyte_extracted_at timestamptz not null,
  _airbyte_meta jsonb not null default '{}',
  _airbyte_generation_id bigint,
  account_id varchar, account_name varchar, account_currency varchar,
  date_start date, date_stop date,
  campaign_id varchar, campaign_name varchar, adset_id varchar, ad_id varchar,
  spend numeric, impressions bigint, clicks bigint, reach bigint, frequency numeric,
  actions jsonb, action_values jsonb, cpc numeric, ctr numeric, cpm numeric
);
insert into meta.ads_insights (_airbyte_extracted_at, account_id, account_name, account_currency, date_start, date_stop, campaign_id, campaign_name, ad_id, spend, impressions, clicks, reach, actions)
select timestamptz '2026-10-26 03:00:00+00', a.id, a.name, 'RON', d::date, d::date, a.id || '01', 'Campanie ' || a.name, a.id || '0101',
       round((random() * 100)::numeric, 2), (random() * 10000)::bigint, (random() * 300)::bigint, (random() * 8000)::bigint,
       '[{"action_type":"link_click","value":"12"}]'::jsonb
from (values ('1234567890', 'Aflamin'), ('2345678901', 'Hepathrombin'), ('3456789012', 'Minimartieni')) a(id, name)
cross join generate_series(date '2026-09-01', date '2026-10-25', interval '1 day') d;

create table meta.ad_account (
  _airbyte_raw_id uuid primary key default gen_random_uuid(),
  _airbyte_extracted_at timestamptz not null,
  _airbyte_meta jsonb not null default '{}',
  id varchar, account_id varchar, name varchar, currency varchar, timezone_name varchar, account_status bigint
);
insert into meta.ad_account (_airbyte_extracted_at, id, account_id, name, currency, timezone_name, account_status) values
  ('2026-10-26 03:00:00+00', 'act_1234567890', '1234567890', 'Aflamin RO', 'RON', 'Europe/Bucharest', 1),
  ('2026-10-26 03:00:00+00', 'act_2345678901', '2345678901', 'Hepathrombin RO', 'RON', 'Europe/Bucharest', 1),
  ('2026-10-26 03:00:00+00', 'act_9999999999', '9999999999', 'Cont fără date', 'RON', 'Europe/Bucharest', 2);

create schema if not exists google_ads;
create table google_ads.account_performance_report (
  _airbyte_raw_id uuid primary key default gen_random_uuid(),
  _airbyte_extracted_at timestamptz not null,
  _airbyte_meta jsonb not null default '{}',
  customer_id bigint, customer_descriptive_name varchar, customer_currency_code varchar,
  segments_date date, segments_device varchar, segments_ad_network_type varchar,
  metrics_cost_micros bigint, metrics_impressions bigint, metrics_clicks bigint,
  metrics_conversions numeric, metrics_conversions_value numeric
);
insert into google_ads.account_performance_report (_airbyte_extracted_at, customer_id, customer_descriptive_name, customer_currency_code, segments_date, segments_device, segments_ad_network_type, metrics_cost_micros, metrics_impressions, metrics_clicks, metrics_conversions)
select timestamptz '2026-10-25 22:00:00+00', c.id, c.name, 'RON', d::date, 'DESKTOP', 'SEARCH',
       (random() * 50000000)::bigint, (random() * 5000)::bigint, (random() * 200)::bigint, round((random() * 5)::numeric, 2)
from (values (1112223333::bigint, 'Aflamin Search'), (4445556666::bigint, 'Hepathrombin Search')) c(id, name)
cross join generate_series(date '2026-08-01', date '2026-10-24', interval '1 day') d;

create table google_ads.customer (
  _airbyte_raw_id uuid primary key default gen_random_uuid(),
  _airbyte_extracted_at timestamptz not null,
  _airbyte_meta jsonb not null default '{}',
  customer_id bigint, customer_descriptive_name varchar, customer_currency_code varchar, customer_time_zone varchar
);
insert into google_ads.customer (_airbyte_extracted_at, customer_id, customer_descriptive_name, customer_currency_code, customer_time_zone) values
  ('2026-10-25 22:00:00+00', 1112223333, 'Aflamin Search', 'RON', 'Europe/Bucharest'),
  ('2026-10-25 22:00:00+00', 4445556666, 'Hepathrombin Search', 'RON', 'Europe/Bucharest');

create schema if not exists tiktok;
create table tiktok.advertisers_reports_daily (
  _airbyte_raw_id uuid primary key default gen_random_uuid(),
  _airbyte_extracted_at timestamptz not null,
  _airbyte_meta jsonb not null default '{}',
  advertiser_id bigint, stat_time_day timestamp, dimensions jsonb, metrics jsonb
);
insert into tiktok.advertisers_reports_daily (_airbyte_extracted_at, advertiser_id, stat_time_day, dimensions, metrics)
select timestamptz '2026-10-26 01:00:00+00', 7000000000000000001, d,
       jsonb_build_object('advertiser_id', 7000000000000000001, 'stat_time_day', d::text),
       jsonb_build_object('spend', round((random() * 80)::numeric, 2), 'impressions', (random() * 9000)::int, 'clicks', (random() * 150)::int,
                          'conversion', (random() * 4)::int, 'cpc', 0.5, 'ctr', 1.2, 'reach', (random() * 7000)::int)
from generate_series(timestamp '2026-10-01', timestamp '2026-10-25', interval '1 day') d;

create table tiktok.advertisers (
  _airbyte_raw_id uuid primary key default gen_random_uuid(),
  _airbyte_extracted_at timestamptz not null,
  _airbyte_meta jsonb not null default '{}',
  advertiser_id bigint, name varchar, currency varchar, timezone varchar
);
insert into tiktok.advertisers (_airbyte_extracted_at, advertiser_id, name, currency, timezone) values
  ('2026-10-26 01:00:00+00', 7000000000000000001, 'Minimartieni TikTok', 'RON', 'Europe/Bucharest');

-- Un tabel care nu e Ads (ignorat) și unul la care utilizatorul nu are drept de citire (invizibil).
create table public.users (id bigint primary key, email text);
create schema if not exists secret;
create table secret.ads_insights (account_id varchar, date_start date, spend numeric, impressions bigint);

-- Utilizatorul read-only, cum îl recomandă docs/connectors/airbyte.md.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'analyzator_ro') then
    create role analyzator_ro login password 'parola-doar-pentru-test-local';
  end if;
end $$;
alter role analyzator_ro set default_transaction_read_only = on;
grant usage on schema meta, google_ads, tiktok, public to analyzator_ro;
grant select on all tables in schema meta, google_ads, tiktok to analyzator_ro;
grant select on public.users to analyzator_ro;
analyze meta.ads_insights, meta.ad_account, google_ads.account_performance_report, google_ads.customer, tiktok.advertisers_reports_daily, tiktok.advertisers;
