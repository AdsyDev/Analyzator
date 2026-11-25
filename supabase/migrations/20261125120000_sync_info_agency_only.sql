-- AH: informațiile despre sincronizare nu mai sunt vizibile clientului, nici în API.
--
-- Până acum `source_freshness` (date până la, current / delayed / no_data) era citibilă de orice utilizator cu acces la brand,
-- inclusiv `client_viewer` (B8-6, G-7), iar `source_dataset_days` (zilele cu date, baza lui `data_as_of`) de cine putea citi
-- tabelele de date. Interfața le ascunde deja clientului (PR #46); acum le închidem și la sursă: ambele vederi întorc rânduri
-- doar pentru rolurile de agenție cu acces la brand, ca `source_status` și `sync_history`.
--
-- Vederile rămân `security_invoker` (RLS-ul tabelelor de bază se aplică în continuare), cu aceleași coloane și aceeași
-- definiție; se adaugă doar condiția de rol. Clientul primește o listă goală, nu o eroare. Grant-urile nu se schimbă.
-- `create or replace view` păstrează grant-urile și comentariile existente, deci migrația e aditivă pentru deploy-ul web.
-- Decizia: docs/decisions.md, AH. Contractul: docs/contracts/refresh.md.

create or replace view public.source_dataset_days
with (security_invoker = true) as
select u.tenant_id, u.brand_id, u.source, u.date
from (
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
  group by tenant_id, brand_id, date
) u
where private.has_brand_role(u.brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]);

comment on view public.source_dataset_days is
  'Zilele cu date reale per brand și sursă (baza data_as_of și a acoperirii). Doar rolurile de agenție cu acces la brand; clientul nu vede nimic (AH).';

create or replace view public.source_freshness
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
where b.status = 'active'
  and private.has_brand_role(b.id, array['agency_admin', 'strategist', 'account']::public.membership_role[]);

comment on view public.source_freshness is
  'Actualitatea datelor per brand și sursă (date până la, no_data · current · delayed). Doar rolurile de agenție cu acces la brand; clientul nu vede nimic (AH).';

-- Garda: clientul nu mai are nicio cale de citire spre informațiile de sincronizare prin aceste vederi.
do $$
begin
  if exists (
    select 1 from pg_views
    where schemaname = 'public' and viewname in ('source_freshness', 'source_dataset_days')
      and position('has_brand_role' in definition) = 0
  ) then
    raise exception 'AH: source_freshness / source_dataset_days trebuie să verifice rolul de agenție';
  end if;
end;
$$;
