-- Metricile sociale ale competitorilor din Planable (cererea proprietarului produsului, 23 nov. 2026; decizia Y-6).
--
-- 1. Fiecare competitor din set poate avea profiluri sociale (rețea + handle), salvate pe versiunea setului
--    (`competitor_set_members.social_profiles`). Ele leagă datele colectate de competitor; nu se potrivește nimic după nume.
-- 2. `competitor_social_daily` (urmăritori și engagement pe zi) și `competitor_social_posts` (postările competitorilor, cu
--    like-uri, comentarii, distribuiri) se scriu doar de worker, din rutele Planable `/pages/{id}/competitors/*`.
-- 3. `brand_competition`: grupul „Social public” are trei rânduri cu aceleași definiții pentru brand și competitori
--    (postări pe săptămână, urmăritori, interacțiuni publice pe postare), pe rețelele cu analiza competitorilor, plus
--    `social_as_of` (ultima zi observată pe entitate) pentru secțiunea „Concurență publică” din Social.

-- Rețelele pe care Planable urmărește competitori (documentat pe fiecare rută `/competitors`). --------------------------
create function private.competitor_social_platforms()
returns text[] language sql immutable set search_path = '' as $$
  select array['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin']::text[];
$$;
revoke all on function private.competitor_social_platforms() from public, anon;
grant execute on function private.competitor_social_platforms() to authenticated, service_role;

-- Forma profilurilor sociale ale unui competitor: listă de cel mult 10 obiecte {platform, handle}, fără dubluri,
-- handle cu litere mici și fără „@”. Constrângerea ține și pentru inserările directe (RLS permite insert-ul membrilor).
create function private.valid_social_profiles(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 10 then false
    else not exists (
      select 1 from jsonb_array_elements(p) e
      where case when jsonb_typeof(e) <> 'object' then true
        else (select count(*) from jsonb_object_keys(e)) <> 2
          or jsonb_typeof(e -> 'platform') is distinct from 'string'
          or jsonb_typeof(e -> 'handle') is distinct from 'string'
          or (e ->> 'platform') <> all (private.competitor_social_platforms())
          or (e ->> 'handle') !~ '^[^[:space:]/?#@]{1,100}$'
          or (e ->> 'handle') <> lower(e ->> 'handle') end)
    and (select count(*) from jsonb_array_elements(p)) = (select count(distinct (e ->> 'platform', e ->> 'handle')) from jsonb_array_elements(p) e)
  end;
$$;
revoke all on function private.valid_social_profiles(jsonb) from public, anon;
grant execute on function private.valid_social_profiles(jsonb) to authenticated, service_role;

alter table public.competitor_set_members
  add column social_profiles jsonb not null default '[]'::jsonb
  constraint competitor_set_members_social_profiles_check check (private.valid_social_profiles(social_profiles));
comment on column public.competitor_set_members.social_profiles is
  'Profilurile sociale ale competitorului în Planable: [{platform, handle}], litere mici, fără „@”. Leagă datele din competitor_social_* de competitor.';

-- Datele colectate --------------------------------------------------------------------------------------------------------
create table public.competitor_social_daily (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null,
  brand_id        uuid not null,
  platform        text not null check (platform = any (private.competitor_social_platforms())),
  handle          text not null check (handle ~ '^[^[:space:]/?#@]{1,100}$' and handle = lower(handle)),
  display_name    text check (length(display_name) <= 200),
  -- Ziua punctului din seria Planable (`points[].date`), în fusul workspace-ului.
  date            date not null,
  -- NULL = absent din răspuns, nu 0. Urmăritorii sunt un snapshot și nu se adună pe zile.
  followers       bigint check (followers >= 0),
  -- Engagement-ul zilnic raportat de Planable pentru competitor (bază „scraped”, diferită ușor de cea a brandului).
  engagement      numeric check (engagement >= 0),
  source_id       uuid not null,
  sync_run_id     uuid references public.sync_runs (id) on delete set null,
  collected_at    timestamptz not null,
  payload_hash    text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version  text not null,
  updated_at      timestamptz not null default now(),
  unique (tenant_id, brand_id, platform, handle, date),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.competitor_social_daily is
  'Seriile zilnice ale profilurilor urmărite drept competitori în Planable (GET /pages/{id}/competitors/metrics). Scris doar de worker.';
create index competitor_social_daily_brand_idx on public.competitor_social_daily (tenant_id, brand_id, platform, handle, date);
create trigger competitor_social_daily_updated_at before update on public.competitor_social_daily
  for each row execute function private.set_updated_at();

create table public.competitor_social_posts (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null,
  brand_id        uuid not null,
  platform        text not null check (platform = any (private.competitor_social_platforms())),
  handle          text not null check (handle ~ '^[^[:space:]/?#@]{1,100}$' and handle = lower(handle)),
  -- Primele 32 de caractere hex din SHA-256(url): postarea are același id oricâte rulări o văd.
  post_key        text not null check (post_key ~ '^[0-9a-f]{32}$'),
  post_url        text not null check (length(post_url) <= 2048 and post_url ~ '^https?://'),
  posted_at       timestamptz not null,
  media_type      text check (length(media_type) <= 64),
  -- Ultima observație. NULL = absent din răspuns (de ex. distribuirile pe Instagram nu sunt publice), nu 0.
  likes           bigint check (likes >= 0),
  comments        bigint check (comments >= 0),
  shares          bigint check (shares >= 0),
  views           bigint check (views >= 0),
  source_id       uuid not null,
  sync_run_id     uuid references public.sync_runs (id) on delete set null,
  collected_at    timestamptz not null,
  payload_hash    text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version  text not null,
  updated_at      timestamptz not null default now(),
  unique (tenant_id, brand_id, platform, handle, post_key),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.competitor_social_posts is
  'Postările profilurilor urmărite drept competitori în Planable (GET /pages/{id}/competitors/top-posts), fără textul lor. Scris doar de worker.';
create index competitor_social_posts_brand_idx on public.competitor_social_posts (tenant_id, brand_id, platform, handle, posted_at);
create trigger competitor_social_posts_updated_at before update on public.competitor_social_posts
  for each row execute function private.set_updated_at();

alter table public.competitor_social_daily enable row level security;
alter table public.competitor_social_posts enable row level security;
revoke all on public.competitor_social_daily, public.competitor_social_posts from public, anon, authenticated;
grant select on public.competitor_social_daily, public.competitor_social_posts to authenticated;
grant all on public.competitor_social_daily, public.competitor_social_posts to service_role;

create policy competitor_social_daily_select on public.competitor_social_daily for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy competitor_social_daily_insert on public.competitor_social_daily for insert to authenticated with check (false);
create policy competitor_social_daily_update on public.competitor_social_daily for update to authenticated using (false);
create policy competitor_social_daily_delete on public.competitor_social_daily for delete to authenticated using (false);
create policy competitor_social_posts_select on public.competitor_social_posts for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy competitor_social_posts_insert on public.competitor_social_posts for insert to authenticated with check (false);
create policy competitor_social_posts_update on public.competitor_social_posts for update to authenticated using (false);
create policy competitor_social_posts_delete on public.competitor_social_posts for delete to authenticated using (false);

-- Formulele ---------------------------------------------------------------------------------------------------------------
-- Aceleași definiții pentru brand și competitori. Perioada = zile calendaristice Europe/Bucharest (regula 9).
-- SECURITY INVOKER: RLS-ul tabelelor rămâne autoritatea (apelate din RPC-urile E8).

-- Un competitor (profilurile lui din set): postări pe săptămână, urmăritori, interacțiuni publice pe postare.
create function private.competitor_social_stats(p_brand_id uuid, p_profiles jsonb, p_start date, p_end date)
returns jsonb language sql stable set search_path = '' as $$
  with prof as (
    select e ->> 'platform' as platform, e ->> 'handle' as handle from jsonb_array_elements(coalesce(p_profiles, '[]'::jsonb)) e
  ),
  daily as (
    select d.platform, d.handle, d.date, d.followers from public.competitor_social_daily d
    join prof on prof.platform = d.platform and prof.handle = d.handle
    where d.brand_id = p_brand_id and d.date between p_start and p_end
  ),
  last_f as (
    select distinct on (platform, handle) followers from daily where followers is not null order by platform, handle, date desc
  ),
  posts as (
    select p.likes, p.comments, p.shares from public.competitor_social_posts p
    join prof on prof.platform = p.platform and prof.handle = p.handle
    where p.brand_id = p_brand_id
      and p.posted_at >= (p_start::timestamp at time zone 'Europe/Bucharest')
      and p.posted_at < ((p_end + 1)::timestamp at time zone 'Europe/Bucharest')
  )
  select jsonb_build_object(
    'covered_days', (select count(distinct date) from daily),
    'last_date', (select max(date) from daily),
    'posts', (select count(*) from posts),
    'cadence', metrics.ratio((select count(*) from posts), greatest((p_end - p_start + 1)::numeric / 7, 1)),
    'followers', (select sum(followers) from last_f),
    -- Like-urile și comentariile sunt cerute de schema Planable; distribuirile lipsesc unde nu sunt publice și nu se numără.
    'interactions_per_post', metrics.ratio((select sum(coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0)) from posts), (select count(*) from posts)));
$$;
revoke all on function private.competitor_social_stats(uuid, jsonb, date, date) from public, anon;
grant execute on function private.competitor_social_stats(uuid, jsonb, date, date) to authenticated, service_role;

-- Brandul, pe aceleași rețele: postările lui (fiecare postare o dată, oricâte snapshoturi are) și urmăritorii conturilor.
create function private.brand_social_public_stats(p_brand_id uuid, p_start date, p_end date)
returns jsonb language sql stable set search_path = '' as $$
  with daily as (
    select d.platform, d.account_id, d.date, d.followers from public.social_daily d
    where d.brand_id = p_brand_id and d.date between p_start and p_end and d.platform = any (private.competitor_social_platforms())
  ),
  last_f as (
    select distinct on (platform, account_id) followers from daily where followers is not null order by platform, account_id, date desc
  ),
  posts as (
    select distinct sp.platform, sp.account_id, sp.post_id from public.social_posts sp
    where sp.brand_id = p_brand_id and sp.platform = any (private.competitor_social_platforms())
      and sp.published_at >= (p_start::timestamp at time zone 'Europe/Bucharest')
      and sp.published_at < ((p_end + 1)::timestamp at time zone 'Europe/Bucharest')
  )
  select jsonb_build_object(
    'last_date', (select max(date) from daily),
    'posts', (select count(*) from posts),
    'cadence', metrics.ratio((select count(*) from posts), greatest((p_end - p_start + 1)::numeric / 7, 1)),
    'followers', (select sum(followers) from last_f));
$$;
revoke all on function private.brand_social_public_stats(uuid, date, date) from public, anon;
grant execute on function private.brand_social_public_stats(uuid, date, date) to authenticated, service_role;

-- Versiunea setului primește și profilurile sociale (`social` pe fiecare membru, opțional). ------------------------------
create or replace function public.create_competitor_set_version(
  p_brand_id       uuid,
  p_effective_from date,
  p_note           text,
  p_members        jsonb
)
returns table (competitor_set_id uuid, version integer, effective_from date, member_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_today     date := (now() at time zone 'Europe/Bucharest')::date;
  v_note      text := nullif(trim(p_note), '');
  v_version   integer;
  v_set_id    uuid;
  v_count     integer;
  v_member    jsonb;
  v_pos       integer := 0;
  v_name      text;
  v_domain    text;
  v_color     text;
  v_names     text[] := '{}';
  v_social    jsonb;
  v_prof      jsonb;
  v_platform  text;
  v_handle    text;
  v_profiles  text[] := '{}';
begin
  -- Același răspuns pentru brand inexistent, brand străin și rol insuficient (fără oracol de existență).
  if (select auth.uid()) is null
     or not private.has_brand_role(p_brand_id, array['agency_admin', 'strategist']::public.membership_role[]) then
    raise exception 'Nu ai dreptul să creezi o versiune a setului de competitori pentru acest brand'
      using errcode = '42501';
  end if;

  select b.tenant_id into v_tenant_id from public.brands b where b.id = p_brand_id;
  if v_tenant_id is null then
    raise exception 'Nu ai dreptul să creezi o versiune a setului de competitori pentru acest brand'
      using errcode = '42501';
  end if;

  if p_effective_from is null then
    raise exception 'Data de la care se aplică versiunea este obligatorie' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Nota poate avea cel mult 1000 de caractere' using errcode = '22023';
  end if;

  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'Membrii trebuie trimiși ca listă (array JSON)' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_members);
  if v_count < 1 or v_count > 10 then
    raise exception 'Setul de competitori trebuie să aibă între 1 și 10 membri (primit: %)', v_count
      using errcode = '22023';
  end if;

  -- Serializează crearea de versiuni pe același brand: max+1 nu poate produce aceeași versiune de două ori.
  perform pg_advisory_xact_lock(hashtextextended('competitor_set_version:' || p_brand_id::text, 0));

  -- Prima versiune a brandului poate începe în trecut: nu există comparații văzute înainte pe care să le schimbe,
  -- iar perioadele trecute primesc setul în loc de „Sursă neconectată” (decizia din 23 nov. 2026).
  -- Versiunile următoare rămân de azi înainte: istoricul deja văzut nu se rescrie.
  -- Verificarea stă după lock, ca două prime versiuni concurente să nu treacă amândouă drept „prima”.
  if p_effective_from < v_today and exists (
    select 1 from public.competitor_sets cs where cs.tenant_id = v_tenant_id and cs.brand_id = p_brand_id
  ) then
    raise exception 'Data de la care se aplică versiunea nu poate fi în trecut (azi este %, Europe/Bucharest); doar prima versiune a setului poate începe în trecut',
      to_char(v_today, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  if p_effective_from < date '2020-01-01' then
    raise exception 'Data de la care se aplică versiunea nu poate fi înainte de 2020-01-01' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.competitor_sets cs
    where cs.tenant_id = v_tenant_id and cs.brand_id = p_brand_id and cs.effective_from = p_effective_from
  ) then
    raise exception 'Există deja o versiune a setului cu data de aplicare %', to_char(p_effective_from, 'YYYY-MM-DD')
      using errcode = '23505';
  end if;

  select coalesce(max(cs.version), 0) + 1 into v_version
  from public.competitor_sets cs
  where cs.tenant_id = v_tenant_id and cs.brand_id = p_brand_id;

  insert into public.competitor_sets (tenant_id, brand_id, version, effective_from, note, created_by)
  values (v_tenant_id, p_brand_id, v_version, p_effective_from, v_note, (select auth.uid()))
  returning id into v_set_id;

  -- Fiecare membru e validat apoi inserat; orice eroare anulează întreaga tranzacție (nu rămâne set parțial).
  for v_member in select value from jsonb_array_elements(p_members) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_member) <> 'object' then
      raise exception 'Membrul % este invalid: așteptat obiect cu name, domain, color, social', v_pos using errcode = '22023';
    end if;
    if jsonb_typeof(v_member -> 'name') is distinct from 'string' then
      raise exception 'Membrul %: numele este obligatoriu', v_pos using errcode = '22023';
    end if;
    v_name := trim(v_member ->> 'name');
    if v_name = '' then
      raise exception 'Membrul %: numele nu poate fi gol', v_pos using errcode = '22023';
    end if;
    if length(v_name) > 120 then
      raise exception 'Membrul %: numele poate avea cel mult 120 de caractere', v_pos using errcode = '22023';
    end if;
    if lower(v_name) = any (v_names) then
      raise exception 'Membrul %: numele „%” apare de mai multe ori', v_pos, v_name using errcode = '22023';
    end if;
    v_names := v_names || lower(v_name);

    if jsonb_typeof(v_member -> 'domain') not in ('string', 'null') and v_member ? 'domain' then
      raise exception 'Membrul % (%): domeniul trebuie să fie text', v_pos, v_name using errcode = '22023';
    end if;
    if jsonb_typeof(v_member -> 'color') not in ('string', 'null') and v_member ? 'color' then
      raise exception 'Membrul % (%): culoarea trebuie să fie text', v_pos, v_name using errcode = '22023';
    end if;
    -- Domeniu: lowercase, fără schemă, utilizator, cale, query, fragment sau port.
    v_domain := nullif(trim(v_member ->> 'domain'), '');
    if v_domain is not null then
      v_domain := regexp_replace(lower(v_domain), '^[a-z][a-z0-9+.-]*://', '');
      v_domain := regexp_replace(v_domain, '[/?#].*$', '');
      v_domain := regexp_replace(v_domain, '^[^@]*@', '');
      v_domain := regexp_replace(v_domain, ':[0-9]+$', '');
      if v_domain !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$' then
        raise exception 'Membrul % (%): domeniul nu este valid (se acceptă ex. exemplu.ro, fără schemă și cale)', v_pos, v_name
          using errcode = '22023';
      end if;
    end if;
    v_color := nullif(trim(v_member ->> 'color'), '');
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'Membrul % (%): culoarea trebuie să aibă forma #RRGGBB', v_pos, v_name using errcode = '22023';
    end if;

    -- Profilurile sociale (Planable): rețea + handle, litere mici, fără „@” la început. Un profil aparține unui singur
    -- competitor din set; matricea leagă datele colectate de competitor doar prin ele (fără potrivire după nume).
    if v_member ? 'social' and jsonb_typeof(v_member -> 'social') not in ('array', 'null') then
      raise exception 'Membrul % (%): profilurile sociale trebuie trimise ca listă', v_pos, v_name using errcode = '22023';
    end if;
    v_social := '[]'::jsonb;
    for v_prof in select value from jsonb_array_elements(case when jsonb_typeof(v_member -> 'social') = 'array' then v_member -> 'social' else '[]'::jsonb end) loop
      if jsonb_typeof(v_prof) <> 'object' or jsonb_typeof(v_prof -> 'platform') is distinct from 'string' or jsonb_typeof(v_prof -> 'handle') is distinct from 'string' then
        raise exception 'Membrul % (%): fiecare profil social are rețea (platform) și handle', v_pos, v_name using errcode = '22023';
      end if;
      v_platform := lower(trim(v_prof ->> 'platform'));
      v_handle := lower(regexp_replace(trim(v_prof ->> 'handle'), '^@+', ''));
      if v_platform <> all (private.competitor_social_platforms()) then
        raise exception 'Membrul % (%): rețeaua „%” nu are analiza competitorilor în Planable', v_pos, v_name, v_platform using errcode = '22023';
      end if;
      if v_handle !~ '^[^[:space:]/?#@]{1,100}$' then
        raise exception 'Membrul % (%): handle-ul „%” nu este valid', v_pos, v_name, v_prof ->> 'handle' using errcode = '22023';
      end if;
      if (v_platform || ':' || v_handle) = any (v_profiles) then
        raise exception 'Membrul % (%): profilul % @% apare de mai multe ori în set', v_pos, v_name, v_platform, v_handle using errcode = '22023';
      end if;
      v_profiles := v_profiles || (v_platform || ':' || v_handle);
      v_social := v_social || jsonb_build_array(jsonb_build_object('platform', v_platform, 'handle', v_handle));
    end loop;
    if jsonb_array_length(v_social) > 10 then
      raise exception 'Membrul % (%): cel mult 10 profiluri sociale', v_pos, v_name using errcode = '22023';
    end if;

    insert into public.competitor_set_members (tenant_id, brand_id, competitor_set_id, name, domain, color, sort_order, social_profiles)
    values (v_tenant_id, p_brand_id, v_set_id, v_name, v_domain, v_color, v_pos - 1, v_social);
  end loop;

  return query select v_set_id, v_version, p_effective_from, v_count;
end;
$$;


comment on function public.create_competitor_set_version(uuid, date, text, jsonb) is
  'Creează atomic o versiune nouă a setului de competitori (set + membri, cu profilurile sociale). Prima versiune poate începe în trecut, următoarele nu. SECURITY INVOKER: RLS rămâne autoritatea. Vezi docs/security-tests.md, E4.';

-- Matricea de concurență: grupul „Social public” cu datele competitorilor. ----------------------------------------------
-- Pornește de la definiția curentă (20261012250000 + schimbările din 20261110120000: tipul `yoy` și `ai_assistant_scope`);
-- AI, SEO și Listening sunt neschimbate.
create or replace function public.brand_competition(p_brand_id uuid, p_start date, p_end date, p_kind text default 'custom')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_brand   record;
  v_set     record;
  v_ai      boolean;
  v_na      jsonb;
  v_ai_cells jsonb := '{}'::jsonb;
  v_cit_cells jsonb := '{}'::jsonb;
  v_rec_cells jsonb := '{}'::jsonb;
  v_valid   bigint;
  m         record;
  v_num     bigint;
  v_cit     bigint;
  v_status  text;
  v_entities jsonb;
  v_seo_top  jsonb;
  v_seo_vis  jsonb;
  v_listen   jsonb;
  v_social   jsonb;
  v_sc_cells jsonb := '{}'::jsonb;
  v_sf_cells jsonb := '{}'::jsonb;
  v_si_cells jsonb := '{}'::jsonb;
  v_as_of    jsonb := '{}'::jsonb;
  v_planable boolean;
  v_days     integer := p_end - p_start + 1;
  v_st       jsonb;
  v_cov      numeric;
  v_cell_st  text;
  v_reason   text;
begin
  perform private.ai_check(p_brand_id, p_start, p_end, null, null);
  if coalesce(p_kind, '') not in ('custom', 'mtd', 'yoy') then raise exception 'Tip de perioadă necunoscut: %', p_kind using errcode = '22023'; end if;
  select b.id, b.name, b.tenant_id into v_brand from public.brands b where b.id = p_brand_id;
  select cs.id, cs.version, cs.effective_from into v_set from public.competitor_sets cs
  where cs.brand_id = p_brand_id and cs.effective_from <= p_end order by cs.effective_from desc limit 1;
  if v_set.id is null then
    return jsonb_build_object('has_set', false);
  end if;

  select jsonb_build_array(jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'kind', 'brand', 'label', v_brand.name))
         || coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', 'competitor', 'label', 'C' || x.rn) order by x.rn), '[]'::jsonb)
    into v_entities
  from (select mm.id, mm.name, row_number() over (order by mm.sort_order, mm.name) as rn from public.competitor_set_members mm where mm.competitor_set_id = v_set.id) x;

  -- AI: același numitor (răspunsurile valide ale brandului) pentru toate cele patru entități.
  v_ai := private.brand_source_connected(p_brand_id, 'seomonitor');
  select count(*) filter (where s.status <> 'technical_error') into v_valid from private.ai_assistant_scope(p_brand_id, p_start, p_end) s;
  v_status := case when not v_ai then 'not_connected' when coalesce(v_valid, 0) = 0 then 'unavailable' when v_valid < 50 then 'insufficient_sample' else 'ok' end;

  -- Brandul.
  select count(*) filter (where s.status = 'brand_present'),
         count(*) filter (where s.status <> 'technical_error' and exists (
           select 1 from public.ai_citations c where c.brand_id = p_brand_id and c.engine = s.engine and c.keyword_id = s.keyword_id
             and c.crawl_at = s.crawl_at and c.device = s.device and c.is_own_domain))
    into v_num, v_cit from private.ai_assistant_scope(p_brand_id, p_start, p_end) s;
  v_ai_cells := v_ai_cells || jsonb_build_object(p_brand_id::text, jsonb_build_object('value', case when v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_num, v_valid, 100) end, 'unit', 'percent', 'status', v_status, 'coverage', null, 'reason', null));
  v_cit_cells := v_cit_cells || jsonb_build_object(p_brand_id::text, jsonb_build_object('value', case when v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_cit, v_valid, 100) end, 'unit', 'percent', 'status', v_status, 'coverage', null, 'reason', null));

  -- Competitorii: prezențe din observațiile de competiție, citări pe domeniul lor, în aceleași răspunsuri valide.
  for m in select mm.id, mm.domain from public.competitor_set_members mm where mm.competitor_set_id = v_set.id loop
    select count(distinct (o.engine, o.keyword_id, o.crawl_at, o.device)) into v_num
    from public.ai_brand_observations o
    join private.ai_assistant_scope(p_brand_id, p_start, p_end) s on s.engine = o.engine and s.keyword_id = o.keyword_id and s.crawl_at = o.crawl_at and s.device = o.device
    where o.brand_id = p_brand_id and m.domain is not null and o.observed_domain = m.domain and o.present and s.status <> 'technical_error';
    select count(distinct (c.engine, c.keyword_id, c.crawl_at, c.device)) into v_cit
    from public.ai_citations c
    join private.ai_assistant_scope(p_brand_id, p_start, p_end) s on s.engine = c.engine and s.keyword_id = c.keyword_id and s.crawl_at = c.crawl_at and s.device = c.device
    where c.brand_id = p_brand_id and m.domain is not null and s.status <> 'technical_error'
      and lower(regexp_replace(substring(c.url from '^[a-z]+://([^/?#]+)'), '^www\.', '')) in (m.domain, 'www.' || m.domain)
         or (c.brand_id = p_brand_id and m.domain is not null and s.status <> 'technical_error' and lower(substring(c.url from '^[a-z]+://([^/?#]+)')) like '%.' || m.domain);
    v_ai_cells := v_ai_cells || jsonb_build_object(m.id::text, jsonb_build_object(
      'value', case when m.domain is null or v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_num, v_valid, 100) end,
      'unit', 'percent', 'status', case when m.domain is null then 'unavailable' else v_status end, 'coverage', null,
      'reason', case when m.domain is null then 'Competitorul nu are domeniu în setul de competitori.' end));
    v_cit_cells := v_cit_cells || jsonb_build_object(m.id::text, jsonb_build_object(
      'value', case when m.domain is null or v_status in ('not_connected', 'unavailable') then null else metrics.ratio(v_cit, v_valid, 100) end,
      'unit', 'percent', 'status', case when m.domain is null then 'unavailable' else v_status end, 'coverage', null,
      'reason', case when m.domain is null then 'Competitorul nu are domeniu în setul de competitori.' end));
  end loop;

  -- Rânduri fără date pentru o parte din entități: N/A cu motiv.
  v_na := jsonb_build_object('value', null, 'unit', 'percent', 'status', 'unavailable', 'coverage', null);
  select jsonb_object_agg(e ->> 'id', v_na || jsonb_build_object('reason', 'SEOmonitor nu marchează recomandarea explicită a unui brand.'))
    into v_rec_cells from jsonb_array_elements(v_entities) e;

  v_seo_top := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'seomonitor_keywords_top10', p_start, p_end, p_kind, '{"device": "desktop"}');
  v_seo_vis := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'seomonitor_visibility_latest', p_start, p_end, p_kind, '{"device": "desktop"}');
  v_listen := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'mentions_count', p_start, p_end, p_kind, '{}');
  -- Social public (Y-6): aceleași definiții pentru brand și competitori, pe rețelele cu analiza competitorilor din Planable.
  -- Brandul: social_posts / social_daily. Competitorii: competitor_social_posts / competitor_social_daily, legați de membru
  -- doar prin profilurile sociale din set. Fără profil sau fără observații: N/A cu motiv, nu zero.
  v_planable := private.brand_source_connected(p_brand_id, 'planable_analytics');
  v_st := private.brand_social_public_stats(p_brand_id, p_start, p_end);
  v_status := case when not v_planable then 'not_connected' else 'ok' end;
  v_sc_cells := jsonb_build_object(p_brand_id::text, jsonb_build_object('value', case when v_planable then v_st -> 'cadence' end, 'unit', 'count', 'status', v_status, 'coverage', null, 'reason', null));
  v_sf_cells := jsonb_build_object(p_brand_id::text, jsonb_build_object('value', case when v_planable then v_st -> 'followers' end, 'unit', 'count',
    'status', case when not v_planable then 'not_connected' when v_st -> 'followers' = 'null'::jsonb then 'unavailable' else 'ok' end, 'coverage', null,
    'reason', case when v_planable and v_st -> 'followers' = 'null'::jsonb then 'Planable nu are observații de urmăritori pentru brand în perioadă.' end));
  v_si_cells := jsonb_build_object(p_brand_id::text, jsonb_build_object('value', null, 'unit', 'count',
    'status', case when v_planable then 'unavailable' else 'not_connected' end, 'coverage', null,
    'reason', 'Planable nu dă separat like-urile, comentariile și distribuirile postărilor proprii (doar engagement-ul total).'));
  v_as_of := jsonb_build_object(p_brand_id::text, v_st -> 'last_date');

  for m in select mm.id, mm.social_profiles from public.competitor_set_members mm where mm.competitor_set_id = v_set.id loop
    v_st := private.competitor_social_stats(p_brand_id, m.social_profiles, p_start, p_end);
    v_cov := round((v_st ->> 'covered_days')::numeric / v_days, 4);
    if jsonb_array_length(m.social_profiles) = 0 then
      v_cell_st := 'unavailable';
      v_reason := 'Competitorul nu are profiluri sociale în setul de competitori. Adaugă-le într-o versiune nouă (Configurare → Competitori).';
    elsif not v_planable then
      v_cell_st := 'not_connected';
      v_reason := 'Planable nu este conectat pentru acest brand.';
    elsif (v_st ->> 'covered_days')::integer = 0 then
      v_cell_st := 'unavailable';
      v_reason := 'Planable nu are observații pentru profilurile competitorului în perioadă.';
    else
      v_cell_st := case when v_cov < 1 then 'partial' else 'ok' end;
      v_reason := case when v_cov < 1 then 'Observații Planable pentru ' || (v_st ->> 'covered_days') || ' din ' || v_days || ' zile ale perioadei.' end;
    end if;
    v_sc_cells := v_sc_cells || jsonb_build_object(m.id::text, jsonb_build_object('value', case when v_cell_st in ('ok', 'partial') then v_st -> 'cadence' end,
      'unit', 'count', 'status', v_cell_st, 'coverage', case when v_cell_st in ('ok', 'partial') then v_cov end, 'reason', v_reason));
    v_sf_cells := v_sf_cells || jsonb_build_object(m.id::text, jsonb_build_object('value', case when v_cell_st in ('ok', 'partial') then v_st -> 'followers' end,
      'unit', 'count', 'status', case when v_cell_st in ('ok', 'partial') and v_st -> 'followers' = 'null'::jsonb then 'unavailable' else v_cell_st end,
      'coverage', case when v_cell_st in ('ok', 'partial') then v_cov end,
      'reason', case when v_cell_st in ('ok', 'partial') and v_st -> 'followers' = 'null'::jsonb then 'Planable nu are observații de urmăritori pentru competitor în perioadă.' else v_reason end));
    v_si_cells := v_si_cells || jsonb_build_object(m.id::text, jsonb_build_object('value', case when v_cell_st in ('ok', 'partial') then v_st -> 'interactions_per_post' end,
      'unit', 'count', 'status', case when v_cell_st in ('ok', 'partial') and v_st -> 'interactions_per_post' = 'null'::jsonb then 'cannot_compute' else v_cell_st end,
      'coverage', case when v_cell_st in ('ok', 'partial') then v_cov end,
      'reason', case when v_cell_st in ('ok', 'partial') and v_st -> 'interactions_per_post' = 'null'::jsonb then 'Competitorul nu are postări în perioadă.' else v_reason end));
    v_as_of := v_as_of || jsonb_build_object(m.id::text, v_st -> 'last_date');
  end loop;

  return jsonb_build_object('has_set', true, 'entities', v_entities, 'set_version', v_set.version, 'effective_from', v_set.effective_from,
    'data_as_of', (select max(s.crawl_at) from private.ai_assistant_scope(p_brand_id, p_start, p_end) s),
    'social_as_of', v_as_of,
    'groups', jsonb_build_array(
      jsonb_build_object('dimension', 'ai', 'title', 'AI Visibility', 'source', 'SEOmonitor (AI Search și AI Overview)', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'ai_mention_rate', 'label', 'Mention Rate', 'direction', 'higher_is_better',
          'definition', '100 × răspunsuri valide în care apare entitatea / răspunsuri valide (aceleași întrebări și engine-uri pentru toți).', 'cells', v_ai_cells),
        jsonb_build_object('key', 'ai_citation_rate', 'label', 'Rată de citare', 'direction', 'higher_is_better',
          'definition', '100 × răspunsuri valide care citează domeniul entității / răspunsuri valide.', 'cells', v_cit_cells),
        jsonb_build_object('key', 'ai_recommendation_rate', 'label', 'Recommendation Rate', 'direction', 'higher_is_better',
          'definition', '100 × răspunsuri valide care recomandă explicit entitatea / răspunsuri valide.', 'cells', v_rec_cells))),
      jsonb_build_object('dimension', 'seo', 'title', 'SEO', 'source', 'SEOmonitor', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'seomonitor_keywords_top10', 'label', 'Keywords în Top 10 (desktop)', 'direction', 'higher_is_better',
          'definition', 'Keywords urmărite cu poziția 1–10 la ultima observație.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_seo_top else v_na || jsonb_build_object('unit', 'count', 'reason', 'Pozițiile organice ale competitorilor nu sunt colectate.') end) from jsonb_array_elements(v_entities) e)),
        jsonb_build_object('key', 'seomonitor_visibility_latest', 'label', 'Visibility (desktop)', 'direction', 'higher_is_better',
          'definition', 'Visibility raportată de SEOmonitor, ultima observație.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_seo_vis else v_na || jsonb_build_object('unit', 'score', 'reason', 'Visibility-ul competitorilor nu e colectat.') end) from jsonb_array_elements(v_entities) e)))),
      jsonb_build_object('dimension', 'social', 'title', 'Social public', 'source', 'Planable (Analytics și Competitors)', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'social_cadence', 'label', 'Postări pe săptămână', 'direction', 'neutral',
          'definition', 'Postări publicate în perioadă / numărul de săptămâni ale perioadei, pe Instagram, Facebook, YouTube, TikTok și LinkedIn.',
          'cells', v_sc_cells),
        jsonb_build_object('key', 'social_followers', 'label', 'Urmăritori', 'direction', 'higher_is_better',
          'definition', 'Suma, pe profiluri, a ultimei observații de urmăritori din perioadă (Instagram, Facebook, YouTube, TikTok, LinkedIn).',
          'cells', v_sf_cells),
        jsonb_build_object('key', 'social_interactions_per_post', 'label', 'Interacțiuni publice pe postare', 'direction', 'higher_is_better',
          'definition', '(Like-uri + comentarii + distribuiri, unde sunt publice) / postările din perioadă, la ultima observație Planable.',
          'cells', v_si_cells))),
      jsonb_build_object('dimension', 'listening', 'title', 'Listening', 'source', 'Planable Listening', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'mentions_count', 'label', 'Mențiuni', 'direction', 'neutral',
          'definition', 'Mențiuni distincte publicate în perioadă.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_listen else v_na || jsonb_build_object('unit', 'count', 'reason', 'Mențiunile competitorilor nu sunt colectate (cuvintele de tip „competitor” din Planable nu intră încă).') end) from jsonb_array_elements(v_entities) e))))
    ));
end;
$$;

