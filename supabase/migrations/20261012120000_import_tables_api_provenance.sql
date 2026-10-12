-- Date prin API în tabelele de import (decizia D-4, 12 oct 2026): Planable (social și listening) acum, Meta Ads,
-- Google Ads și TikTok Ads după aceea. Aceleași tabele și aceleași contracte ca importul CSV (CLAUDE.md, „Convenții”).
--
-- 1. Proveniența: un rând vine fie dintr-un lot CSV (import_batch_id + row_number), fie dintr-o rulare API
--    (source_id = conexiunea, sync_run_id = rularea), ca la ceilalți conectori. Un CHECK impune exact una din forme.
-- 2. source_status: pentru sursele de import, o rulare API reușită sau parțială contează ca un import; starea ultimei
--    rulări (inclusiv `partial`) se vede în status.
-- 3. compute_metric_snapshot: sursa e „conectată” și cu o rulare API reușită sau parțială, nu doar cu un lot importat.
-- Restul definițiilor (view, funcție) e copiat neschimbat din 20261008200000_refresh_status.sql și 20261008180000_insights_pv.sql.

alter table public.paid_daily
  alter column import_batch_id drop not null,
  alter column row_number drop not null,
  add column source_id uuid,
  add column sync_run_id uuid references public.sync_runs (id) on delete restrict,
  add constraint paid_daily_provenance check (
    (collection_method = 'csv' and import_batch_id is not null and row_number is not null and source_id is null and sync_run_id is null)
    or (collection_method = 'api' and import_batch_id is null and row_number is null and source_id is not null and sync_run_id is not null)
  ),
  add constraint paid_daily_source_fk foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict;

alter table public.social_daily
  alter column import_batch_id drop not null,
  alter column row_number drop not null,
  add column source_id uuid,
  add column sync_run_id uuid references public.sync_runs (id) on delete restrict,
  add constraint social_daily_provenance check (
    (collection_method = 'csv' and import_batch_id is not null and row_number is not null and source_id is null and sync_run_id is null)
    or (collection_method = 'api' and import_batch_id is null and row_number is null and source_id is not null and sync_run_id is not null)
  ),
  add constraint social_daily_source_fk foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict;

alter table public.social_posts
  alter column import_batch_id drop not null,
  alter column row_number drop not null,
  add column source_id uuid,
  add column sync_run_id uuid references public.sync_runs (id) on delete restrict,
  add constraint social_posts_provenance check (
    (collection_method = 'csv' and import_batch_id is not null and row_number is not null and source_id is null and sync_run_id is null)
    or (collection_method = 'api' and import_batch_id is null and row_number is null and source_id is not null and sync_run_id is not null)
  ),
  add constraint social_posts_source_fk foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict;

alter table public.mentions
  alter column import_batch_id drop not null,
  alter column row_number drop not null,
  add column source_id uuid,
  add column sync_run_id uuid references public.sync_runs (id) on delete restrict,
  add constraint mentions_provenance check (
    (collection_method = 'csv' and import_batch_id is not null and row_number is not null and source_id is null and sync_run_id is null)
    or (collection_method = 'api' and import_batch_id is null and row_number is null and source_id is not null and sync_run_id is not null)
  ),
  add constraint mentions_source_fk foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict;

comment on column public.paid_daily.source_id is 'Conexiunea API (collection_method = api); NULL pentru CSV.';
comment on column public.social_daily.source_id is 'Conexiunea API (collection_method = api); NULL pentru CSV.';
comment on column public.social_posts.source_id is 'Conexiunea API (collection_method = api); NULL pentru CSV.';
comment on column public.mentions.source_id is 'Conexiunea API (collection_method = api); NULL pentru CSV.';

create or replace view public.source_status
with (security_invoker = true) as
with src (source, kind) as (
  values ('ga4', 'api'), ('gsc', 'api'), ('clarity', 'api'), ('seomonitor', 'api'),
         ('google_ads', 'csv'), ('meta_ads', 'csv'), ('tiktok_ads', 'csv'), ('planable_analytics', 'csv'), ('planable_listening', 'csv')
), today (d) as (
  select (now() at time zone 'Europe/Bucharest')::date
), base as (
  select b.tenant_id, b.id as brand_id, b.name as brand_name, s.source, s.kind
  from public.brands b
  cross join src s
  where b.status = 'active'
    and private.has_brand_role(b.id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
)
select
  x.tenant_id, x.brand_id, x.brand_name, x.source, x.kind,
  x.state,
  x.reason,
  x.connected,
  x.credential_status,
  x.last_run_at,
  x.last_run_status,
  x.last_run_rows,
  x.last_run_error_count,
  x.last_success_at,
  x.data_as_of,
  x.grace_days,
  x.expected_days,
  x.covered_days,
  case when x.kind = 'api' or x.source in ('google_ads', 'meta_ads', 'tiktok_ads', 'planable_analytics')
       then round(x.covered_days::numeric / x.expected_days, 4) end as coverage
from (
  select
    base.*,
    cn.credential_status,
    case
      when base.kind = 'api' and cn.id is null then 'no_connection'
      when base.kind = 'api' and base.source in ('ga4', 'gsc') and (g.id is null or g.credential_status = 'missing') then 'credential_missing'
      when base.kind = 'api' and base.source in ('ga4', 'gsc') and g.credential_status = 'invalid' then 'credential_invalid'
      when base.kind = 'api' and cn.credential_status = 'missing' and base.source in ('clarity', 'seomonitor') then 'credential_missing'
      when base.kind = 'api' and cn.credential_status = 'invalid' and base.source in ('clarity', 'seomonitor') then 'credential_invalid'
      when base.source = 'seomonitor' and not exists (
        select 1 from public.seomonitor_group_mappings m where m.tenant_id = base.tenant_id and m.brand_id = base.brand_id) then 'no_mapping'
      when base.kind = 'csv' and ib.last_at is null then 'no_import'
    end as reason,
    case
      when base.kind = 'api' then cn.id is not null
        and (case when base.source in ('ga4', 'gsc') then g.id is not null and g.credential_status in ('unverified', 'valid')
                  else cn.credential_status in ('unverified', 'valid') end)
        and (base.source <> 'seomonitor' or exists (
          select 1 from public.seomonitor_group_mappings m where m.tenant_id = base.tenant_id and m.brand_id = base.brand_id))
      else ib.last_at is not null
    end as connected,
    coalesce(lr.created_at, ib.last_at) as last_run_at,
    case when base.kind = 'api' then lr.status when ib.last_at is not null then ib.status end as last_run_status,
    case when base.kind = 'api' then lr.rows_written else ib.rows end as last_run_rows,
    lr.error_count as last_run_error_count,
    case when base.kind = 'api' then ls.last_ok else ib.last_at end as last_success_at,
    dd.data_as_of,
    coalesce((select max(m.freshness_grace_days) from public.metric_definitions m where m.primary_source = base.source), 14) as grace_days,
    35 as expected_days,
    coalesce(dd.covered_days, 0)::integer as covered_days,
    case
      when base.kind = 'api' and cn.id is null then 'not_connected'
      when base.kind = 'api' and base.source in ('ga4', 'gsc') and (g.id is null or g.credential_status = 'missing') then 'not_connected'
      when base.kind = 'api' and base.source in ('clarity', 'seomonitor') and cn.credential_status = 'missing' then 'not_connected'
      when base.source = 'seomonitor' and not exists (
        select 1 from public.seomonitor_group_mappings m where m.tenant_id = base.tenant_id and m.brand_id = base.brand_id) then 'not_connected'
      when base.kind = 'csv' and ib.last_at is null then 'not_connected'
      when base.kind = 'api' and ((base.source in ('ga4', 'gsc') and g.credential_status = 'invalid') or cn.credential_status = 'invalid') then 'error'
      when base.kind = 'api' and lr.status = 'failed' then 'error'
      when base.kind = 'api' and lr.status = 'partial' then 'partial'
      when dd.data_as_of is null then 'no_data'
      when dd.data_as_of < (select d from today) - 1 - coalesce((select max(m.freshness_grace_days) from public.metric_definitions m where m.primary_source = base.source), 14) then 'stale'
      else 'ok'
    end as state
  from base
  left join lateral (
    select c.id, c.credential_status from public.source_connections c
    where base.kind = 'api' and c.tenant_id = base.tenant_id and c.provider = base.source and c.status = 'active'
      and (c.brand_id = base.brand_id or (base.source = 'seomonitor' and c.brand_id is null))
    order by (c.brand_id is not null) desc limit 1
  ) cn on true
  left join lateral (
    select c.id, c.credential_status from public.source_connections c
    where base.source in ('ga4', 'gsc') and c.tenant_id = base.tenant_id and c.provider = 'google_service_account'
      and c.brand_id is null and c.status = 'active'
    limit 1
  ) g on true
  left join lateral (
    select r.status, r.rows_written, r.created_at, jsonb_array_length(r.errors) as error_count
    from public.sync_runs r
    where base.kind = 'api' and r.tenant_id = base.tenant_id and r.brand_id = base.brand_id and r.source = base.source
    order by r.created_at desc limit 1
  ) lr on true
  left join lateral (
    select max(r.finished_at) as last_ok from public.sync_runs r
    where base.kind = 'api' and r.tenant_id = base.tenant_id and r.brand_id = base.brand_id and r.source = base.source and r.status = 'succeeded'
  ) ls on true
  left join lateral (
    -- Sursele pe tabele de import primesc date și prin API (Planable, Meta Ads, Google Ads, TikTok Ads): o rulare API
    -- reușită sau parțială contează ca un import (D-4). O rulare eșuată nu alimentează nimic și apare în istoric.
    select max(x.at) as last_at,
           (array_agg(x.rows order by x.at desc))[1] as rows,
           (array_agg(x.status order by x.at desc))[1] as status
    from (
      select b2.confirmed_at as at, b2.rows_accepted as rows, 'succeeded'::public.sync_status as status
      from public.import_batches b2
      where base.kind = 'csv' and b2.tenant_id = base.tenant_id and b2.brand_id = base.brand_id and b2.source = base.source and b2.status = 'imported'
      union all
      select r.finished_at, r.rows_written, r.status
      from public.sync_runs r
      where base.kind = 'csv' and r.tenant_id = base.tenant_id and r.brand_id = base.brand_id and r.source = base.source
        and r.status in ('succeeded', 'partial')
    ) x
  ) ib on true
  left join lateral (
    select max(d.date) as data_as_of,
           count(*) filter (where d.date between (select t.d from today t) - 35 and (select t.d from today t) - 1) as covered_days
    from public.source_dataset_days d
    where d.tenant_id = base.tenant_id and d.brand_id = base.brand_id and d.source = base.source
  ) dd on true
) x;;

create or replace function private.compute_metric_snapshot(
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
    or exists (
      select 1 from public.sync_runs r
      where r.tenant_id = p_tenant_id and r.brand_id = p_brand_id and r.source = v_source and r.status in ('succeeded', 'partial'))
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
