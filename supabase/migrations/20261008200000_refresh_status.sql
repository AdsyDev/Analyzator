-- B8: statusul surselor, istoricul sincronizărilor, acoperirea și alertele de eșec ale refreshului săptămânal.
--
-- Statusul se expune prin VIEW-uri `security_invoker` (RLS-ul tabelelor de bază se aplică celui care citește), nu prin funcții
-- noi în `public`: garda A10/A11 interzice funcții executabile de utilizatori. O sursă fără conexiune apare ca `not_connected`,
-- nu ca zero. `data_as_of` și acoperirea se calculează din zilele cu date reale din tabelele sursei; o zi fără rânduri e
-- neconfirmată, nu zero.

-- Alerte operaționale: contacte și coadă (același mecanism ca la farmacovigilență, tabele separate) ---------------------------

create table public.alert_contacts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  email      text not null check (email ~ '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$' and length(email) <= 254),
  name       text check (length(name) <= 200),
  active     boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index alert_contacts_email_idx on public.alert_contacts (tenant_id, lower(email));
comment on table public.alert_contacts is
  'Contacte interne pentru alertele operaționale (eșecul refreshului). Separate de pv_contacts (farmacovigilență).';

create table public.ops_notifications (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  brand_id            uuid,
  sync_run_id         uuid not null references public.sync_runs (id) on delete cascade,
  kind                text not null check (kind in ('refresh_failed')),
  source              text not null check (source ~ '^[a-z0-9_]+$'),
  subject             text not null check (length(subject) <= 300),
  body                text not null check (length(body) <= 5000),
  status              text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts            integer not null default 0 check (attempts >= 0),
  last_error          text check (length(last_error) <= 500),
  recipients          text[],
  provider_message_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz,
  check ((status = 'sent') = (sent_at is not null)),
  unique (sync_run_id, kind),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
create index ops_notifications_status_idx on public.ops_notifications (status, created_at);
comment on table public.ops_notifications is
  'Coada alertelor de eșec: un rând per sync_run eșuat (idempotent), cu status pending până la trimitere. Nu se pierde fără secret sau contacte.';

create trigger alert_contacts_updated_at before update on public.alert_contacts for each row execute function private.set_updated_at();
create trigger ops_notifications_updated_at before update on public.ops_notifications for each row execute function private.set_updated_at();
create trigger alert_contacts_audit after insert or update or delete on public.alert_contacts for each row execute function private.audit_row();

grant select on public.alert_contacts, public.ops_notifications to authenticated;
grant insert (tenant_id, email, name) on public.alert_contacts to authenticated;
grant update (email, name, active) on public.alert_contacts to authenticated;
grant delete on public.alert_contacts to authenticated;

alter table public.alert_contacts   enable row level security;
alter table public.ops_notifications enable row level security;

create policy alert_contacts_select on public.alert_contacts for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy alert_contacts_insert on public.alert_contacts for insert to authenticated
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy alert_contacts_update on public.alert_contacts for update to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]))
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy alert_contacts_delete on public.alert_contacts for delete to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));

create policy ops_notifications_select on public.ops_notifications for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy ops_notifications_insert on public.ops_notifications for insert to authenticated with check (false);
create policy ops_notifications_update on public.ops_notifications for update to authenticated using (false);
create policy ops_notifications_delete on public.ops_notifications for delete to authenticated using (false);

-- Zilele cu date reale, per brand și sursă ---------------------------------------------------------------------------------------
-- Doar zilele cu o valoare primară nenulă (NULL = necunoscut, nu zi acoperită). Mențiunile (Listening) nu au acoperire pe zile:
-- o zi fără mențiuni e o zi legitimă fără evenimente, nu o lipsă; ele apar în status doar prin conexiune și import.

create view public.source_dataset_days
with (security_invoker = true) as
select tenant_id, brand_id, 'ga4'::text as source, date
from public.web_daily where window_days = 1 and sessions is not null
group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'gsc', date
from public.search_daily where window_days = 1 and clicks is not null
group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'clarity', date
from public.clarity_daily where dimension = 'all' and window_days = 1 and sessions is not null
group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'seomonitor', date
from public.rank_observations
group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, source, date
from public.paid_daily where breakdown_signature = 'none' and spend is not null
group by tenant_id, brand_id, source, date
union all
select tenant_id, brand_id, 'planable_analytics', date
from public.social_daily
group by tenant_id, brand_id, date;

grant select on public.source_dataset_days to authenticated;

-- Statusul surselor (agenția): conexiune, ultima rulare, date până la, acoperire -------------------------------------------------------
-- state: not_connected · error · partial · stale · no_data · ok

create view public.source_status
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
    case when base.kind = 'api' then lr.status when ib.last_at is not null then 'succeeded' end as last_run_status,
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
    select max(b2.confirmed_at) as last_at,
           (array_agg(b2.rows_accepted order by b2.confirmed_at desc))[1] as rows
    from public.import_batches b2
    where base.kind = 'csv' and b2.tenant_id = base.tenant_id and b2.brand_id = base.brand_id and b2.source = base.source and b2.status = 'imported'
  ) ib on true
  left join lateral (
    select max(d.date) as data_as_of,
           count(*) filter (where d.date between (select t.d from today t) - 35 and (select t.d from today t) - 1) as covered_days
    from public.source_dataset_days d
    where d.tenant_id = base.tenant_id and d.brand_id = base.brand_id and d.source = base.source
  ) dd on true
) x;

grant select on public.source_status to authenticated;
comment on view public.source_status is
  'Statusul surselor per brand (agenția). state: not_connected · error · partial · stale · no_data · ok. Coverage = zile cu date / 35, fereastra de reimport.';

-- Actualitatea datelor pentru client: doar „date până la” și o explicație, fără erori, costuri sau conexiuni ----------------------------------

create view public.source_freshness
with (security_invoker = true) as
select b.tenant_id, b.id as brand_id, s.source, dd.data_as_of,
       coalesce((select max(m.freshness_grace_days) from public.metric_definitions m where m.primary_source = s.source), 14) as grace_days,
       case
         when dd.data_as_of is null then 'no_data'
         when dd.data_as_of < (now() at time zone 'Europe/Bucharest')::date - 1
              - coalesce((select max(m.freshness_grace_days) from public.metric_definitions m where m.primary_source = s.source), 14) then 'delayed'
         else 'current'
       end as freshness
from public.brands b
cross join (values ('ga4'), ('gsc'), ('clarity'), ('seomonitor'), ('google_ads'), ('meta_ads'), ('tiktok_ads'), ('planable_analytics')) as s (source)
left join lateral (
  select max(d.date) as data_as_of from public.source_dataset_days d
  where d.tenant_id = b.tenant_id and d.brand_id = b.id and d.source = s.source
) dd on true
where b.status = 'active';

grant select on public.source_freshness to authenticated;
comment on view public.source_freshness is
  'Actualitatea datelor per brand și sursă, pentru orice utilizator cu acces la brand (inclusiv client). no_data = fără date (sursă neconectată sau încă neimportată).';

-- Istoricul sincronizărilor (agenția) --------------------------------------------------------------------------------------------------------

create view public.sync_history
with (security_invoker = true) as
select r.id, r.tenant_id, r.brand_id, r.source, r.source_connection_id, r.status, r.period_start, r.period_end,
       r.rows_written, r.attempt_count, jsonb_array_length(r.errors) as error_count,
       (select coalesce(jsonb_agg(distinct e ->> 'code'), '[]'::jsonb) from jsonb_array_elements(r.errors) e) as error_codes,
       r.started_at, r.finished_at,
       extract(epoch from (r.finished_at - r.started_at))::numeric(12, 3) as duration_seconds,
       r.coverage, r.created_at
from public.sync_runs r
where private.has_brand_role(r.brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]);

grant select on public.sync_history to authenticated;
