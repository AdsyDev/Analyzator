-- Etapa 3, a treia felie: Indexare (deciziile L din docs/decisions.md).
--
-- 1. `index_urls`: lista de URL-uri prioritare ale brandului, introdusă de agenție.
-- 2. `index_inspections`: rezultatul URL Inspection (Search Console) pe URL și zi, scris doar de worker.
-- 3. `brand_index_status`: ultima inspecție a fiecărui URL și numărul lor pe stări. Regimul E8.
--
-- Nu există o metrică de registru („rata de indexare”): ecranul arată numere de URL-uri, din lista inspectată, nu din tot site-ul.

-- 1. URL-urile prioritare ---------------------------------------------------------------------------------------------------

create table public.index_urls (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  brand_id    uuid not null,
  url         text not null check (url ~ '^https?://[^[:space:]]+$' and length(url) <= 2048),
  -- Calculat de bază (interfața nu are md5): cheia unică rămâne sub limita btree și nu poate fi trimisă greșit.
  url_md5     text generated always as (md5(url)) stored,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, brand_id, url_md5),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
comment on table public.index_urls is
  'URL-urile prioritare ale brandului pentru verificarea indexării, introduse de agenție. Rândurile nu se modifică: un URL greșit se șterge.';

alter table public.index_urls enable row level security;
revoke all on public.index_urls from public, anon, authenticated;
grant select, delete on public.index_urls to authenticated;
grant insert (tenant_id, brand_id, url, created_by) on public.index_urls to authenticated;
grant all on public.index_urls to service_role;

create policy index_urls_select on public.index_urls for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy index_urls_insert on public.index_urls for insert to authenticated
  with check (
    private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
    and created_by = (select auth.uid())
  );
create policy index_urls_update on public.index_urls for update to authenticated
  using (false);
create policy index_urls_delete on public.index_urls for delete to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));

create trigger index_urls_audit after insert or delete on public.index_urls
  for each row execute function private.audit_row();

-- Cel mult 150 de URL-uri prioritare pe brand: URL Inspection are o cotă zilnică pe proprietate, iar rularea inspectează
-- și paginile cu cele mai multe clickuri.
create function private.index_urls_limit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.index_urls u where u.tenant_id = new.tenant_id and u.brand_id = new.brand_id) >= 150 then
    raise exception 'Un brand poate avea cel mult 150 de URL-uri prioritare' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.index_urls_limit() from public, anon, authenticated;
create trigger index_urls_limit before insert on public.index_urls
  for each row execute function private.index_urls_limit();

-- 2. Inspecțiile ------------------------------------------------------------------------------------------------------------

create table public.index_inspections (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid not null,
  brand_id           uuid not null,
  url                text not null check (length(url) between 1 and 2048),
  url_md5            text not null check (url_md5 = md5(url)),
  -- Ziua inspecției, în Europe/Bucharest. Un URL are cel mult o inspecție pe zi; istoricul se păstrează.
  inspected_on       date not null,
  -- De ce a fost inspectat: e în lista agenției sau e printre paginile cu cele mai multe clickuri.
  origin             text not null check (origin in ('priority', 'top_page')),

  -- Câmpurile `indexStatusResult` din URL Inspection, neschimbate. NULL = absent din răspuns, nu „nu”.
  verdict            text check (length(verdict) <= 64),
  coverage_state     text check (length(coverage_state) <= 512),
  indexing_state     text check (length(indexing_state) <= 64),
  robots_txt_state   text check (length(robots_txt_state) <= 64),
  page_fetch_state   text check (length(page_fetch_state) <= 64),
  crawled_as         text check (length(crawled_as) <= 64),
  last_crawl_time    timestamptz,
  google_canonical   text check (length(google_canonical) <= 2048),
  user_canonical     text check (length(user_canonical) <= 2048),

  source_id          uuid not null,
  sync_run_id        uuid references public.sync_runs (id) on delete set null,
  collected_at       timestamptz not null,
  payload_hash       text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version     text not null,
  updated_at         timestamptz not null default now(),

  unique (tenant_id, brand_id, url_md5, inspected_on),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.index_inspections is
  'Search Console URL Inspection (index.inspect) pe URL și zi. Scris doar de worker. Starea e a unui URL din lista inspectată, '
  'nu a întregului site.';
create index index_inspections_brand_idx on public.index_inspections (tenant_id, brand_id, inspected_on);
create trigger index_inspections_updated_at before update on public.index_inspections
  for each row execute function private.set_updated_at();

alter table public.index_inspections enable row level security;
revoke all on public.index_inspections from public, anon, authenticated;
grant select on public.index_inspections to authenticated;
grant all on public.index_inspections to service_role;

create policy index_inspections_select on public.index_inspections for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy index_inspections_insert on public.index_inspections for insert to authenticated
  with check (false);
create policy index_inspections_update on public.index_inspections for update to authenticated
  using (false);
create policy index_inspections_delete on public.index_inspections for delete to authenticated
  using (false);

-- 3. Starea indexării ---------------------------------------------------------------------------------------------------------

-- Clasificarea verdictului Google (L-2): PASS = URL-ul e în index; FAIL și NEUTRAL = nu e (eroare, respectiv exclus);
-- orice altceva, inclusiv lipsa verdictului = necunoscut. Derivat din documentația API-ului; de confirmat la prima rulare reală.
create function metrics.index_state(p_verdict text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(coalesce(p_verdict, ''))
    when 'PASS' then 'indexed'
    when 'FAIL' then 'not_indexed'
    when 'NEUTRAL' then 'not_indexed'
    else 'unknown'
  end;
$$;

create function public.brand_index_status(p_brand_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_urls jsonb;
  v_priority jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if not private.brand_source_connected(p_brand_id, 'gsc') then
    return jsonb_build_object('connected', false);
  end if;

  -- Ultima inspecție a fiecărui URL. Un URL scos din lista prioritară își păstrează ultima stare cunoscută.
  with latest as (
    select distinct on (i.url_md5) i.*
    from public.index_inspections i
    where i.brand_id = p_brand_id
    order by i.url_md5, i.inspected_on desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'url', l.url,
      'priority', exists (select 1 from public.index_urls u where u.brand_id = p_brand_id and u.url_md5 = l.url_md5),
      'state', metrics.index_state(l.verdict),
      'verdict', l.verdict, 'coverage_state', l.coverage_state, 'indexing_state', l.indexing_state,
      'robots_txt_state', l.robots_txt_state, 'page_fetch_state', l.page_fetch_state, 'crawled_as', l.crawled_as,
      'last_crawl_time', l.last_crawl_time,
      'google_canonical', l.google_canonical, 'user_canonical', l.user_canonical,
      -- Canonicalul ales de Google față de cel declarat în pagină; NULL când lipsește unul dintre ele.
      'canonical_matches', case when l.google_canonical is null or l.user_canonical is null then null else l.google_canonical = l.user_canonical end,
      'inspected_on', l.inspected_on) order by l.url), '[]'::jsonb)
    into v_urls
  from latest l;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'url', u.url,
      'inspected', exists (select 1 from public.index_inspections i where i.brand_id = p_brand_id and i.url_md5 = u.url_md5)) order by u.url), '[]'::jsonb)
    into v_priority
  from public.index_urls u
  where u.brand_id = p_brand_id;

  return jsonb_build_object(
    'connected', true,
    'inspected_on', (select max(inspected_on) from public.index_inspections where brand_id = p_brand_id),
    'summary', (
      select jsonb_build_object(
        'total', count(*),
        'indexed', count(*) filter (where x ->> 'state' = 'indexed'),
        'not_indexed', count(*) filter (where x ->> 'state' = 'not_indexed'),
        'unknown', count(*) filter (where x ->> 'state' = 'unknown'),
        'canonical_mismatch', count(*) filter (where x ->> 'canonical_matches' = 'false'))
      from jsonb_array_elements(v_urls) x),
    'urls', v_urls,
    'priority_urls', v_priority);
end;
$$;

revoke all on function public.brand_index_status(uuid) from public, anon;
grant execute on function public.brand_index_status(uuid) to authenticated, service_role;
comment on function public.brand_index_status(uuid) is
  'Ultima inspecție URL Inspection a fiecărui URL al brandului, numărul lor pe stări și lista prioritară. SECURITY INVOKER; verifică has_brand_access (E8).';

revoke all on all functions in schema metrics from public, anon;
grant execute on all functions in schema metrics to authenticated, service_role;
