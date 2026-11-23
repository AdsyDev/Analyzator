-- Datele competitorilor din Planable Listening și Google Ads Transparency (deciziile Y din docs/decisions.md).
--
-- 1. Identificatorii competitorilor, pe membrii setului (versionați ca restul setului):
--    `listening_keywords` = cuvintele de tip „competitor” din Planable Listening atribuite competitorului (lista goală = numele lui);
--    `ads_advertiser_ids` = ID-urile de advertiser Google (AR…) din Ads Transparency Center.
-- 2. `competitor_trackers`: ce a interogat colectarea (un cuvânt, un advertiser), cu intervalul acoperit. Deosebește
--    „zero mențiuni / reclame” de „nu s-a colectat” (regula 8), fără să citească `sync_runs` (pe care clientul nu le vede, G-7).
-- 3. `competitor_mentions`: mențiunile cuvintelor de tip „competitor”. Fără text și fără autor (doar rețea, link, dată, sentimentul furnizorului).
-- 4. `competitor_ads`: reclamele advertiserilor competitorilor afișate într-o regiune, cu intervalul declarat de Google.
-- 5. `brand_competition`: Listening (mențiuni, share of voice) și Reclame pentru competitori; `brand_competitor_ads`: lista reclamelor. Regimul E8.
--
-- Scrise doar de worker (service role). Nimic nu se deduce: un competitor fără cuvânt sau fără advertiser rămâne N/A cu motiv.

-- 1. Identificatorii pe membrii setului -----------------------------------------------------------------------------------------

alter table public.competitor_set_members
  add column listening_keywords text[] not null default '{}',
  add column ads_advertiser_ids text[] not null default '{}',
  add constraint competitor_set_members_listening_keywords_check check (
    cardinality(listening_keywords) <= 10
    and array_position(listening_keywords, null) is null
    and length(array_to_string(listening_keywords, '')) <= 2000
  ),
  add constraint competitor_set_members_ads_advertiser_ids_check check (
    cardinality(ads_advertiser_ids) <= 10
    and array_to_string(ads_advertiser_ids, ',', '?') ~ '^(AR[0-9]{5,40}(,AR[0-9]{5,40})*)?$'
  );

comment on column public.competitor_set_members.listening_keywords is
  'Cuvintele de tip „competitor” din Planable Listening atribuite competitorului (comparate fără diferență de majuscule). Lista goală = numele competitorului.';
comment on column public.competitor_set_members.ads_advertiser_ids is
  'ID-urile de advertiser din Google Ads Transparency Center (AR urmat de cifre). Lista goală = reclamele competitorului nu se colectează.';

-- Aceeași funcție (aceeași semnătură, aceleași verificări), plus cele două liste pe fiecare membru, opționale.
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
  v_item      jsonb;
  v_text      text;
  v_keywords  text[];
  v_words_all text[] := '{}';
  v_ads       text[];
  v_ads_all   text[] := '{}';
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
  if p_effective_from < v_today then
    raise exception 'Data de la care se aplică versiunea nu poate fi în trecut (azi este %, Europe/Bucharest)',
      to_char(v_today, 'YYYY-MM-DD') using errcode = '22023';
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
      raise exception 'Membrul % este invalid: așteptat obiect cu name, domain, color', v_pos using errcode = '22023';
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

    -- Cuvintele din Planable Listening (tip „competitor”). Un cuvânt aparține unui singur competitor din set: altfel
    -- aceeași mențiune s-ar număra la doi competitori. Lista goală înseamnă numele competitorului.
    v_keywords := '{}';
    if jsonb_typeof(v_member -> 'listening_keywords') not in ('array', 'null') and v_member ? 'listening_keywords' then
      raise exception 'Membrul % (%): listening_keywords trebuie să fie o listă de texte', v_pos, v_name using errcode = '22023';
    end if;
    if jsonb_typeof(v_member -> 'listening_keywords') = 'array' then
      for v_item in select value from jsonb_array_elements(v_member -> 'listening_keywords') loop
        if jsonb_typeof(v_item) <> 'string' then
          raise exception 'Membrul % (%): fiecare cuvânt din listening_keywords trebuie să fie text', v_pos, v_name using errcode = '22023';
        end if;
        v_text := btrim(v_item #>> '{}');
        if v_text = '' or length(v_text) > 200 then
          raise exception 'Membrul % (%): un cuvânt din listening_keywords trebuie să aibă între 1 și 200 de caractere', v_pos, v_name
            using errcode = '22023';
        end if;
        if lower(v_text) = any (select lower(k) from unnest(v_keywords) k) then
          raise exception 'Membrul % (%): cuvântul „%” apare de mai multe ori', v_pos, v_name, v_text using errcode = '22023';
        end if;
        v_keywords := v_keywords || v_text;
      end loop;
      if cardinality(v_keywords) > 10 then
        raise exception 'Membrul % (%): cel mult 10 cuvinte în listening_keywords', v_pos, v_name using errcode = '22023';
      end if;
    end if;
    for v_text in select lower(w) from unnest(case when cardinality(v_keywords) > 0 then v_keywords else array[v_name] end) w loop
      if v_text = any (v_words_all) then
        raise exception 'Membrul % (%): cuvântul „%” e deja atribuit altui competitor din set', v_pos, v_name, v_text using errcode = '22023';
      end if;
      v_words_all := v_words_all || v_text;
    end loop;

    -- ID-urile de advertiser Google (Ads Transparency Center): AR urmat de cifre, fiecare la un singur competitor.
    v_ads := '{}';
    if jsonb_typeof(v_member -> 'ads_advertiser_ids') not in ('array', 'null') and v_member ? 'ads_advertiser_ids' then
      raise exception 'Membrul % (%): ads_advertiser_ids trebuie să fie o listă de texte', v_pos, v_name using errcode = '22023';
    end if;
    if jsonb_typeof(v_member -> 'ads_advertiser_ids') = 'array' then
      for v_item in select value from jsonb_array_elements(v_member -> 'ads_advertiser_ids') loop
        if jsonb_typeof(v_item) <> 'string' then
          raise exception 'Membrul % (%): fiecare ID din ads_advertiser_ids trebuie să fie text', v_pos, v_name using errcode = '22023';
        end if;
        v_text := upper(btrim(v_item #>> '{}'));
        if v_text !~ '^AR[0-9]{5,40}$' then
          raise exception 'Membrul % (%): ID-ul de advertiser „%” nu are forma AR urmat de cifre (din adresa paginii advertiserului în Ads Transparency Center)',
            v_pos, v_name, v_item #>> '{}' using errcode = '22023';
        end if;
        if v_text = any (v_ads_all) then
          raise exception 'Membrul % (%): ID-ul de advertiser % apare de mai multe ori în set', v_pos, v_name, v_text using errcode = '22023';
        end if;
        v_ads := v_ads || v_text;
        v_ads_all := v_ads_all || v_text;
      end loop;
      if cardinality(v_ads) > 10 then
        raise exception 'Membrul % (%): cel mult 10 ID-uri în ads_advertiser_ids', v_pos, v_name using errcode = '22023';
      end if;
    end if;

    insert into public.competitor_set_members (tenant_id, brand_id, competitor_set_id, name, domain, color, sort_order, listening_keywords, ads_advertiser_ids)
    values (v_tenant_id, p_brand_id, v_set_id, v_name, v_domain, v_color, v_pos - 1, v_keywords, v_ads);
  end loop;

  return query select v_set_id, v_version, p_effective_from, v_count;
end;
$$;

-- 2. Ce a interogat colectarea ------------------------------------------------------------------------------------------------

create table public.competitor_trackers (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null,
  brand_id      uuid not null,
  -- planable_listening: un cuvânt de tip „competitor” (external_id = keywordId, label = textul cuvântului);
  -- google_ads_transparency: un advertiser (external_id = ID-ul AR…, label = numele declarat de advertiser).
  source        text not null check (source in ('planable_listening', 'google_ads_transparency')),
  external_id   text not null check (length(external_id) between 1 and 128),
  label         text check (length(label) <= 512),
  -- Zilele (Europe/Bucharest) pentru care colectarea a citit tot ce oferă sursa. covered_from NULL = fără limită inferioară
  -- declarată (Ads Transparency dă tot istoricul reclamelor păstrate de Google).
  covered_from  date,
  covered_to    date not null,
  -- false = ultima rulare nu a citit tot (eroare sau paginare întreruptă) pentru acest cuvânt sau advertiser.
  complete      boolean not null,
  last_seen_at  timestamptz not null,
  source_id     uuid not null,
  sync_run_id   uuid references public.sync_runs (id) on delete set null,
  updated_at    timestamptz not null default now(),
  check (covered_from is null or covered_from <= covered_to),
  check (source <> 'google_ads_transparency' or external_id ~ '^AR[0-9]{5,40}$'),
  check (source <> 'planable_listening' or (label is not null and length(btrim(label)) between 1 and 200)),
  unique (tenant_id, brand_id, source, external_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.competitor_trackers is
  'Cuvintele Planable de tip „competitor” și advertiserii Google interogați pentru competitori, cu zilele acoperite. Scris doar de worker. '
  'Un competitor fără rând aici nu a fost colectat (N/A), nu are zero.';
create trigger competitor_trackers_updated_at before update on public.competitor_trackers
  for each row execute function private.set_updated_at();

-- 3. Mențiunile competitorilor ------------------------------------------------------------------------------------------------

create table public.competitor_mentions (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null,
  brand_id       uuid not null,
  keyword_id     text not null check (length(keyword_id) between 1 and 128),
  -- Ca la `mentions`: h: + hash-ul URL-ului; s: + hash-ul identității (rețea, autor, moment, text) pentru mențiunile fără link.
  native_id      text not null check (native_id ~ '^[hs]:[0-9a-f]{32}$'),
  -- Rețeaua, cum o trimite Planable (text liber, ca `mentions.source_name`); NULL când lipsește, nu se deduce.
  platform       text check (length(platform) between 1 and 256),
  url            text check (url ~ '^https?://' and length(url) <= 2048),
  published_at   timestamptz not null,
  -- Sentimentul dat de Planable, păstrat ca atare; nu se revizuiește și nu se afișează ca etichetă.
  sentiment      text not null default 'unknown' check (sentiment in ('positive', 'neutral', 'negative', 'unknown')),
  source_id      uuid not null,
  sync_run_id    uuid references public.sync_runs (id) on delete set null,
  collected_at   timestamptz not null,
  payload_hash   text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version text not null,
  updated_at     timestamptz not null default now(),
  check ((url is null) = (native_id like 's:%')),
  unique (tenant_id, brand_id, keyword_id, native_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.competitor_mentions is
  'Mențiunile cuvintelor de tip „competitor” din Planable Listening, pe cuvânt. Fără text și fără autor (minimizare). Scris doar de worker.';
create index competitor_mentions_brand_published_idx on public.competitor_mentions (tenant_id, brand_id, published_at);
create trigger competitor_mentions_updated_at before update on public.competitor_mentions
  for each row execute function private.set_updated_at();

-- 4. Reclamele competitorilor -------------------------------------------------------------------------------------------------

create table public.competitor_ads (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid not null,
  brand_id           uuid not null,
  source             text not null check (source in ('google_ads_transparency')),
  advertiser_id      text not null check (advertiser_id ~ '^AR[0-9]{5,40}$'),
  advertiser_name    text check (length(advertiser_name) <= 512),
  native_ad_id       text not null check (native_ad_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  region_code        text not null check (region_code ~ '^[A-Z]{2}$'),
  format             text not null check (format in ('text', 'image', 'video', 'unknown')),
  -- Intervalul de afișare în regiune, declarat de Google. Distinct de first_seen / last_seen (observațiile noastre, spec cap. 08).
  first_shown        date,
  last_shown         date,
  -- Numărul de afișări, ca interval declarat de Google; NULL când Google nu îl publică pentru regiune.
  times_shown_lower  bigint check (times_shown_lower >= 0),
  times_shown_upper  bigint check (times_shown_upper >= 0),
  source_url         text check (source_url ~ '^https://adstransparency\.google\.com/' and length(source_url) <= 2048),
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null,
  source_id          uuid not null,
  sync_run_id        uuid references public.sync_runs (id) on delete set null,
  collected_at       timestamptz not null,
  payload_hash       text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version     text not null,
  updated_at         timestamptz not null default now(),
  check (first_shown is null or last_shown is null or first_shown <= last_shown),
  check (times_shown_lower is null or times_shown_upper is null or times_shown_lower <= times_shown_upper),
  unique (tenant_id, brand_id, source, advertiser_id, native_ad_id, region_code),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.source_connections (tenant_id, id) on delete restrict
);
comment on table public.competitor_ads is
  'Reclamele advertiserilor competitorilor din Google Ads Transparency Center (setul public BigQuery), pe regiune. Nu conțin cost, '
  'clickuri sau performanță și nu se folosesc pentru a le estima (spec cap. 08). Scris doar de worker.';
create index competitor_ads_brand_shown_idx on public.competitor_ads (tenant_id, brand_id, region_code, last_shown);
create trigger competitor_ads_updated_at before update on public.competitor_ads
  for each row execute function private.set_updated_at();

-- RLS: citire pentru oricine are acces la brand (inclusiv clientul), scriere doar service role ------------------------------

alter table public.competitor_trackers enable row level security;
alter table public.competitor_mentions enable row level security;
alter table public.competitor_ads enable row level security;
revoke all on public.competitor_trackers, public.competitor_mentions, public.competitor_ads from public, anon, authenticated;
grant select on public.competitor_trackers, public.competitor_mentions, public.competitor_ads to authenticated;
grant all on public.competitor_trackers, public.competitor_mentions, public.competitor_ads to service_role;

create policy competitor_trackers_select on public.competitor_trackers for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy competitor_trackers_insert on public.competitor_trackers for insert to authenticated with check (false);
create policy competitor_trackers_update on public.competitor_trackers for update to authenticated using (false);
create policy competitor_trackers_delete on public.competitor_trackers for delete to authenticated using (false);

create policy competitor_mentions_select on public.competitor_mentions for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy competitor_mentions_insert on public.competitor_mentions for insert to authenticated with check (false);
create policy competitor_mentions_update on public.competitor_mentions for update to authenticated using (false);
create policy competitor_mentions_delete on public.competitor_mentions for delete to authenticated using (false);

create policy competitor_ads_select on public.competitor_ads for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy competitor_ads_insert on public.competitor_ads for insert to authenticated with check (false);
create policy competitor_ads_update on public.competitor_ads for update to authenticated using (false);
create policy competitor_ads_delete on public.competitor_ads for delete to authenticated using (false);

-- 5. Concurența în ecran ----------------------------------------------------------------------------------------------------
-- Aceeași funcție ca în 20261012250000 (cu modificările din 20261110120000: perioada yoy și asistenții AI fără AI Overviews),
-- plus Listening și Reclame pentru competitori. Ordinea grupurilor rămâne: ai, seo, social, listening; reclamele sunt ultimele.

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
  v_e       jsonb;
  v_num     bigint;
  v_cit     bigint;
  v_status  text;
  v_entities jsonb;
  v_seo_top  jsonb;
  v_seo_vis  jsonb;
  v_listen   jsonb;
  v_social   jsonb;
  v_days     integer := p_end - p_start + 1;
  v_from_ts  timestamptz := p_start::timestamp at time zone 'Europe/Bucharest';
  v_to_ts    timestamptz := (p_end + 1)::timestamp at time zone 'Europe/Bucharest';
  -- Listening și reclame pentru competitori (Y).
  v_ml_connected  boolean;
  v_ads_connected boolean;
  v_ml_cells  jsonb := '{}'::jsonb;
  v_sov_cells jsonb := '{}'::jsonb;
  v_ads_shown jsonb := '{}'::jsonb;
  v_ads_new   jsonb := '{}'::jsonb;
  v_ads_brand jsonb;
  v_words     text[];
  v_ids       text[];
  v_n         bigint;
  v_new       bigint;
  v_cfrom     date;
  v_cto       date;
  v_complete  boolean;
  v_cov_days  integer;
  v_cov       numeric;
  v_reason    text;
  v_total     numeric;
  v_all_ok    boolean;
  v_ads_asof  date;
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
  v_social := jsonb_build_object('value', (select metrics.ratio(count(*)::numeric, greatest((p_end - p_start + 1)::numeric / 7, 1)) from public.social_posts sp
                                           where sp.brand_id = p_brand_id and sp.published_at >= (p_start::timestamp at time zone 'Europe/Bucharest')
                                             and sp.published_at < ((p_end + 1)::timestamp at time zone 'Europe/Bucharest')),
                                 'unit', 'count', 'coverage', null, 'reason', null,
                                 'status', case when private.brand_source_connected(p_brand_id, 'planable_analytics') then 'ok' else 'not_connected' end);
  if v_social ->> 'status' = 'not_connected' then v_social := v_social || jsonb_build_object('value', null); end if;

  -- Listening pe competitori (Y-3): mențiunile cuvintelor Planable de tip „competitor” atribuite competitorului (lista lui sau
  -- numele lui), publicate în perioadă (Europe/Bucharest). O mențiune găsită de două cuvinte ale aceluiași competitor se numără o dată.
  -- Acoperirea: zilele perioadei pe care colectarea le-a citit pentru toate cuvintele competitorului.
  v_ml_connected := exists (select 1 from public.competitor_trackers t where t.brand_id = p_brand_id and t.source = 'planable_listening');
  v_ml_cells := v_ml_cells || jsonb_build_object(p_brand_id::text, v_listen);
  for m in select mm.id, mm.name, mm.listening_keywords from public.competitor_set_members mm where mm.competitor_set_id = v_set.id loop
    v_words := case when cardinality(m.listening_keywords) > 0 then m.listening_keywords else array[m.name] end;
    select count(*), max(t.covered_from), min(t.covered_to), coalesce(bool_and(t.complete), false), coalesce(array_agg(t.external_id), '{}')
      into v_n, v_cfrom, v_cto, v_complete, v_ids
    from public.competitor_trackers t
    where t.brand_id = p_brand_id and t.source = 'planable_listening'
      and lower(btrim(t.label)) in (select lower(btrim(w)) from unnest(v_words) w);
    if not v_ml_connected then
      v_ml_cells := v_ml_cells || jsonb_build_object(m.id::text, jsonb_build_object('value', null, 'unit', 'count', 'status', 'not_connected', 'coverage', null,
        'reason', 'Mențiunile competitorilor nu au fost încă colectate (Planable Listening, cuvinte de tip „competitor”).'));
      continue;
    end if;
    if v_n = 0 then
      v_ml_cells := v_ml_cells || jsonb_build_object(m.id::text, jsonb_build_object('value', null, 'unit', 'count', 'status', 'unavailable', 'coverage', null,
        'reason', 'Niciun cuvânt de tip „competitor” urmărit în Planable Listening nu corespunde competitorului (căutat: ' || array_to_string(v_words, ', ') || ').'));
      continue;
    end if;
    v_cov_days := greatest(0, least(p_end, v_cto) - greatest(p_start, coalesce(v_cfrom, p_start)) + 1);
    v_cov := round(v_cov_days::numeric / v_days, 4);
    select count(distinct cm.native_id) into v_num from public.competitor_mentions cm
    where cm.brand_id = p_brand_id and cm.keyword_id = any (v_ids) and cm.published_at >= v_from_ts and cm.published_at < v_to_ts;
    v_reason := case
      when v_cov_days = 0 then 'Perioada e în afara zilelor colectate pentru acest competitor (' || coalesce(to_char(v_cfrom, 'DD.MM.YYYY'), '…') || ' – ' || to_char(v_cto, 'DD.MM.YYYY') || ').'
      when v_cov < 1 then 'Mențiunile competitorului sunt colectate doar pentru ' || coalesce(to_char(v_cfrom, 'DD.MM.YYYY'), '…') || ' – ' || to_char(v_cto, 'DD.MM.YYYY') || '.'
      when not v_complete then 'Ultima colectare nu a citit toate mențiunile competitorului.'
    end;
    v_ml_cells := v_ml_cells || jsonb_build_object(m.id::text, jsonb_build_object(
      'value', case when v_cov_days = 0 then null else v_num end, 'unit', 'count',
      'status', case when v_cov_days = 0 then 'unavailable' when v_cov < 1 or not v_complete then 'partial' else 'ok' end,
      'coverage', v_cov, 'reason', v_reason));
  end loop;

  -- Share of voice în mențiuni: mențiunile entității / mențiunile tuturor entităților din tabel, aceeași perioadă și aceeași sursă.
  -- Cere toți competitorii completi (altfel cota s-ar împărți la un total incomplet) și o valoare pentru brand. Celula brandului
  -- e cea din registru, unde o zi fără mențiuni nu e confirmată de sursă, deci e de obicei „parțială”: cota preia starea ei.
  select bool_and(c.value ->> 'status' = 'ok'), sum((c.value ->> 'value')::numeric) into v_all_ok, v_total
  from jsonb_each(v_ml_cells) c where c.key <> p_brand_id::text;
  v_all_ok := coalesce(v_all_ok, false) and v_listen ->> 'status' in ('ok', 'partial') and jsonb_typeof(v_listen -> 'value') = 'number';
  v_total := coalesce(v_total, 0) + case when v_all_ok then (v_listen ->> 'value')::numeric else 0 end;
  for v_e in select value from jsonb_array_elements(v_entities) loop
    v_sov_cells := v_sov_cells || jsonb_build_object(v_e ->> 'id', case
      when not v_all_ok then jsonb_build_object('value', null, 'unit', 'percent', 'status', 'unavailable', 'coverage', null,
        'reason', 'Cota se calculează când mențiunile tuturor competitorilor sunt complete în perioadă și brandul are mențiuni colectate.')
      when v_total = 0 then jsonb_build_object('value', null, 'unit', 'percent', 'status', 'base_zero', 'coverage', null,
        'reason', 'Nicio mențiune în perioadă pentru brand și competitori.')
      else jsonb_build_object('value', metrics.ratio((v_ml_cells -> (v_e ->> 'id') ->> 'value')::numeric, v_total, 100), 'unit', 'percent',
        'status', v_listen ->> 'status', 'coverage', null,
        'reason', case when v_listen ->> 'status' = 'partial' then 'Mențiunile brandului sunt parțiale în registru: zilele fără mențiuni nu sunt confirmate de sursă.' end)
    end);
  end loop;

  -- Reclame (Y-5): creative-urile advertiserilor competitorului afișate în România, după intervalul declarat de Google.
  -- Acoperirea: până la ziua datelor celei mai vechi colectări dintre advertiserii lui (Google dă tot istoricul păstrat).
  v_ads_connected := exists (select 1 from public.competitor_trackers t where t.brand_id = p_brand_id and t.source = 'google_ads_transparency');
  v_ads_brand := jsonb_build_object('value', null, 'unit', 'count', 'status', 'unavailable', 'coverage', null,
    'reason', 'Reclamele brandului sunt în Paid media, din conturile proprii; din Ads Transparency se colectează doar competitorii.');
  v_ads_shown := jsonb_build_object(p_brand_id::text, v_ads_brand);
  v_ads_new := jsonb_build_object(p_brand_id::text, v_ads_brand);
  for m in select mm.id, mm.ads_advertiser_ids from public.competitor_set_members mm where mm.competitor_set_id = v_set.id loop
    v_reason := null;
    if not v_ads_connected then
      v_reason := 'Reclamele competitorilor nu au fost încă colectate (Google Ads Transparency Center).';
      v_status := 'not_connected';
    elsif cardinality(m.ads_advertiser_ids) = 0 then
      v_reason := 'Competitorul nu are ID de advertiser Google în setul de competitori.';
      v_status := 'unavailable';
    else
      select count(*), min(t.covered_to), coalesce(bool_and(t.complete), false) into v_n, v_cto, v_complete
      from public.competitor_trackers t
      where t.brand_id = p_brand_id and t.source = 'google_ads_transparency' and t.external_id = any (m.ads_advertiser_ids);
      if v_n = 0 then
        v_reason := 'ID-urile de advertiser ale competitorului nu au fost încă interogate; apar după următoarea colectare.';
        v_status := 'unavailable';
      else
        v_cov_days := greatest(0, least(p_end, v_cto) - p_start + 1);
        v_cov := round(v_cov_days::numeric / v_days, 4);
        if v_cov_days = 0 then
          v_reason := 'Perioada e după ultima colectare (date până la ' || to_char(v_cto, 'DD.MM.YYYY') || ').';
          v_status := 'unavailable';
        else
          v_status := case when v_cov < 1 or not v_complete or v_n < cardinality(m.ads_advertiser_ids) then 'partial' else 'ok' end;
          v_reason := case
            when v_n < cardinality(m.ads_advertiser_ids) then 'Nu toate ID-urile de advertiser ale competitorului au fost încă interogate.'
            when not v_complete then 'Ultima colectare nu a citit toate reclamele competitorului.'
            when v_cov < 1 then 'Date până la ' || to_char(v_cto, 'DD.MM.YYYY') || '.'
          end;
          select count(*) filter (where a.first_shown <= p_end and a.last_shown >= p_start),
                 count(*) filter (where a.first_shown between p_start and p_end)
            into v_num, v_new
          from public.competitor_ads a
          where a.brand_id = p_brand_id and a.source = 'google_ads_transparency' and a.region_code = 'RO'
            and a.advertiser_id = any (m.ads_advertiser_ids);
        end if;
      end if;
    end if;
    v_ads_shown := v_ads_shown || jsonb_build_object(m.id::text, jsonb_build_object(
      'value', case when v_status in ('ok', 'partial') then v_num end, 'unit', 'count', 'status', v_status,
      'coverage', case when v_status in ('ok', 'partial') then v_cov end, 'reason', v_reason));
    v_ads_new := v_ads_new || jsonb_build_object(m.id::text, jsonb_build_object(
      'value', case when v_status in ('ok', 'partial') then v_new end, 'unit', 'count', 'status', v_status,
      'coverage', case when v_status in ('ok', 'partial') then v_cov end, 'reason', v_reason));
  end loop;

  return jsonb_build_object('has_set', true, 'entities', v_entities, 'set_version', v_set.version, 'effective_from', v_set.effective_from,
    'data_as_of', (select max(s.crawl_at) from private.ai_assistant_scope(p_brand_id, p_start, p_end) s),
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
      jsonb_build_object('dimension', 'social', 'title', 'Social public', 'source', 'Planable', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'social_cadence', 'label', 'Postări pe săptămână', 'direction', 'neutral',
          'definition', 'Postări publicate în perioadă / numărul de săptămâni ale perioadei.',
          'cells', (select jsonb_object_agg(e ->> 'id', case when e ->> 'kind' = 'brand' then v_social else v_na || jsonb_build_object('unit', 'count', 'reason', 'Conturile sociale ale competitorilor (Planable Competitors) nu sunt încă importate.') end) from jsonb_array_elements(v_entities) e)))),
      jsonb_build_object('dimension', 'listening', 'title', 'Listening', 'source', 'Planable Listening', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'mentions_count', 'label', 'Mențiuni', 'direction', 'neutral',
          'definition', 'Mențiuni distincte publicate în perioadă: pentru brand, ale cuvintelor de tip „brand”; pentru competitori, ale cuvintelor de tip „competitor” atribuite lor în set.',
          'cells', v_ml_cells),
        jsonb_build_object('key', 'mentions_sov', 'label', 'Share of voice (mențiuni)', 'direction', 'higher_is_better',
          'definition', '100 × mențiunile entității / mențiunile brandului și ale tuturor competitorilor din set, în aceeași perioadă. Doar când toate sunt complete.',
          'cells', v_sov_cells))),
      jsonb_build_object('dimension', 'ads', 'title', 'Reclame Google', 'source', 'Google Ads Transparency Center (România)', 'rows', jsonb_build_array(
        jsonb_build_object('key', 'ads_shown', 'label', 'Reclame afișate', 'direction', 'neutral',
          'definition', 'Reclame (creative) distincte ale advertiserilor competitorului pe care Google le declară afișate în România cel puțin o zi din perioadă. Nu arată buget, reach sau eficiență.',
          'cells', v_ads_shown),
        jsonb_build_object('key', 'ads_new', 'label', 'Reclame noi', 'direction', 'neutral',
          'definition', 'Reclame a căror primă afișare în România, declarată de Google, cade în perioadă.',
          'cells', v_ads_new)))
    ));
end;
$$;

-- Lista reclamelor competitorilor din perioadă (setul în vigoare la sfârșitul perioadei), paginată pe server. Regimul E8.
create function public.brand_competitor_ads(p_brand_id uuid, p_start date, p_end date, p_limit integer default 24, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_set  uuid;
  v_rows jsonb;
  v_total bigint;
begin
  perform private.ai_check(p_brand_id, p_start, p_end, null, null);
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'Paginare invalidă' using errcode = '22023';
  end if;
  select cs.id into v_set from public.competitor_sets cs where cs.brand_id = p_brand_id and cs.effective_from <= p_end order by cs.effective_from desc limit 1;
  if v_set is null then return jsonb_build_object('has_set', false); end if;
  if not exists (select 1 from public.competitor_trackers t where t.brand_id = p_brand_id and t.source = 'google_ads_transparency') then
    return jsonb_build_object('has_set', true, 'connected', false);
  end if;

  with members as (
    select mm.id, mm.name, 'C' || row_number() over (order by mm.sort_order, mm.name) as label, mm.ads_advertiser_ids
    from public.competitor_set_members mm where mm.competitor_set_id = v_set
  ),
  shown as (
    select a.*, mb.id as member_id, mb.name as member_name, mb.label as member_label
    from public.competitor_ads a
    join members mb on a.advertiser_id = any (mb.ads_advertiser_ids)
    where a.brand_id = p_brand_id and a.source = 'google_ads_transparency' and a.region_code = 'RO'
      and a.first_shown <= p_end and a.last_shown >= p_start
  )
  select (select count(*) from shown),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', s.advertiser_id || ':' || s.native_ad_id || ':' || s.region_code,
             'competitor_id', s.member_id, 'competitor_name', s.member_name, 'competitor_label', s.member_label,
             'advertiser_id', s.advertiser_id, 'advertiser_name', s.advertiser_name, 'ad_id', s.native_ad_id,
             'format', s.format, 'region', s.region_code, 'first_shown', s.first_shown, 'last_shown', s.last_shown,
             'new_in_period', s.first_shown between p_start and p_end,
             'times_shown_lower', s.times_shown_lower, 'times_shown_upper', s.times_shown_upper,
             'source_url', s.source_url, 'last_seen', s.last_seen) order by s.last_shown desc, s.first_shown desc, s.advertiser_id, s.native_ad_id)
           from (select * from shown order by last_shown desc, first_shown desc, advertiser_id, native_ad_id limit p_limit offset p_offset) s), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('has_set', true, 'connected', true,
    'data_as_of', (select min(t.covered_to) from public.competitor_trackers t where t.brand_id = p_brand_id and t.source = 'google_ads_transparency'),
    'total', v_total, 'items', v_rows);
end;
$$;

revoke all on function public.brand_competitor_ads(uuid, date, date, integer, integer) from public, anon;
grant execute on function public.brand_competitor_ads(uuid, date, date, integer, integer) to authenticated, service_role;
comment on function public.brand_competitor_ads(uuid, date, date, integer, integer) is
  'Reclamele advertiserilor din setul de competitori afișate în România în perioadă (Google Ads Transparency). SECURITY INVOKER; verifică has_brand_access (E8).';

revoke all on all functions in schema metrics from public, anon;
grant execute on all functions in schema metrics to authenticated, service_role;
