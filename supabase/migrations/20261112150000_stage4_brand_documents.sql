-- Etapa 4, a treia felie (deciziile P din docs/decisions.md): baza de documente aprobate ale brandului (spec cap. 23).
--
-- 1. `brand_documents`: documentul, cu tip, țară, limbă, versiune, cine răspunde de el la brand și valabilitate.
--    Introducerea unui document NU îl aprobă: intră ca `draft`. Îl aprobă strategistul sau agency_admin, apoi nu se mai
--    editează; se retrage și se adaugă o versiune nouă.
-- 2. `brand_document_fragments`: textul, împărțit în fragmente cu referință de secțiune, cu index de căutare.
-- 3. `brand_document_search`: fragmentele documentelor APROBATE și VALABILE la o dată, pentru o întrebare. Regimul E8.
--
-- Căutarea e lexicală (cuvinte), nu semantică. Documentele definesc ce spune brandul despre produs; indicatorii rămân
-- date observate în piață. Cele două nu se amestecă.

-- 1. Documentele -------------------------------------------------------------------------------------------------------------

create table public.brand_documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  brand_id     uuid not null,
  title        text not null check (length(trim(title)) between 1 and 300),
  doc_type     text not null check (doc_type in ('product_info', 'claims', 'brand_guidelines', 'faq', 'other')),
  -- Produsul la care se referă, unde e cazul (nu există încă un nomenclator de produse).
  product      text check (product is null or length(trim(product)) between 1 and 200),
  country      text not null check (country ~ '^[A-Z]{2}$'),
  language     text not null check (language ~ '^[a-z]{2}$'),
  version      text not null check (length(trim(version)) between 1 and 40),
  -- Cine răspunde de document la brand (persoană sau departament). Obligatoriu la aprobare.
  owner        text check (owner is null or length(trim(owner)) between 1 and 200),
  status       text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_at  timestamptz,
  approved_by  uuid,
  valid_from   date,
  valid_to     date,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (valid_from is null or valid_to is null or valid_to >= valid_from),
  check ((status = 'draft') = (approved_at is null)),
  unique (tenant_id, brand_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
comment on table public.brand_documents is
  'Documentele brandului pentru contextul AdSy AI. Doar cele `approved` și valabile la data întrebării intră în context. '
  'Un document aprobat nu se editează: se retrage și se adaugă o versiune nouă.';
create index brand_documents_brand_idx on public.brand_documents (tenant_id, brand_id, status);
create trigger brand_documents_updated_at before update on public.brand_documents
  for each row execute function private.set_updated_at();

create table public.brand_document_fragments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  brand_id     uuid not null,
  document_id  uuid not null,
  position     integer not null check (position between 1 and 400),
  -- Unde se află fragmentul în document: titlul secțiunii sau pagina.
  section_ref  text check (section_ref is null or length(trim(section_ref)) between 1 and 200),
  content      text not null check (length(trim(content)) between 1 and 4000),
  -- Căutare fără diacritice și fără stemming: „doză” găsește „doza”, dar nu „dozele”.
  search       tsvector generated always as (to_tsvector('simple'::regconfig, translate(lower(content), 'ăâîșşțţ', 'aaisstt'))) stored,
  created_at   timestamptz not null default now(),
  unique (document_id, position),
  foreign key (tenant_id, brand_id, document_id) references public.brand_documents (tenant_id, brand_id, id) on delete cascade
);
comment on table public.brand_document_fragments is
  'Textul unui document, pe fragmente cu referință de secțiune. Se scriu doar cât documentul e ciornă.';
create index brand_document_fragments_search_idx on public.brand_document_fragments using gin (search);
create index brand_document_fragments_brand_idx on public.brand_document_fragments (tenant_id, brand_id, document_id);

-- Regulile documentului: statusul are un singur drum (draft → approved → retired), aprobarea cere conținut, responsabil și
-- început de valabilitate, iar un document aprobat sau retras nu se mai schimbă.
create function private.brand_documents_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Un document % nu se șterge; se retrage', old.status using errcode = '42501';
    end if;
    return old;
  end if;

  if new.tenant_id is distinct from old.tenant_id or new.brand_id is distinct from old.brand_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'tenant_id, brand_id și autorul documentului nu se modifică' using errcode = '42501';
  end if;

  if old.status = 'draft' and new.status = 'draft' then
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'approved' then
    if not private.has_brand_role(old.brand_id, array['agency_admin', 'strategist']::public.membership_role[]) then
      raise exception 'Doar strategistul sau administratorul agenției aprobă un document' using errcode = '42501';
    end if;
    if new.owner is null or new.valid_from is null then
      raise exception 'Aprobarea cere responsabilul documentului la brand și data de început a valabilității' using errcode = '23514';
    end if;
    if not exists (select 1 from public.brand_document_fragments f where f.document_id = old.id) then
      raise exception 'Un document fără text nu se aprobă' using errcode = '23514';
    end if;
    new.approved_at := now();
    new.approved_by := (select auth.uid());
    return new;
  end if;

  if old.status = 'approved' and new.status = 'retired' then
    if not private.has_brand_role(old.brand_id, array['agency_admin', 'strategist']::public.membership_role[]) then
      raise exception 'Doar strategistul sau administratorul agenției retrage un document' using errcode = '42501';
    end if;
    -- Retragerea schimbă doar statusul: conținutul aprobat rămâne cum a fost aprobat.
    if (new.title, new.doc_type, new.product, new.country, new.language, new.version, new.owner, new.valid_from, new.valid_to, new.approved_at, new.approved_by)
       is distinct from (old.title, old.doc_type, old.product, old.country, old.language, old.version, old.owner, old.valid_from, old.valid_to, old.approved_at, old.approved_by) then
      raise exception 'Un document aprobat nu se editează; retrage-l și adaugă o versiune nouă' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = new.status then
    raise exception 'Un document % nu se editează; retrage-l și adaugă o versiune nouă', old.status using errcode = '42501';
  end if;
  raise exception 'Tranziție nepermisă: % → %', old.status, new.status using errcode = '23514';
end;
$$;
revoke all on function private.brand_documents_guard() from public, anon, authenticated;
create trigger brand_documents_guard before insert or update or delete on public.brand_documents
  for each row execute function private.brand_documents_guard();

-- Fragmentele se scriu și se șterg doar cât documentul e ciornă: textul aprobat nu se poate schimba pe dedesubt.
create function private.brand_document_fragments_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.brand_document_fragments := coalesce(new, old);
  v_status text;
begin
  select d.status into v_status from public.brand_documents d where d.id = v_row.document_id;
  -- Ștergerea în cascadă a unei ciorne: documentul nu mai există, fragmentele pleacă odată cu el.
  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Textul unui document se modifică doar cât e ciornă' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.brand_id is distinct from old.brand_id or new.document_id is distinct from old.document_id) then
    raise exception 'Un fragment nu se mută la alt document' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
revoke all on function private.brand_document_fragments_guard() from public, anon, authenticated;
create trigger brand_document_fragments_guard before insert or update or delete on public.brand_document_fragments
  for each row execute function private.brand_document_fragments_guard();

alter table public.brand_documents enable row level security;
alter table public.brand_document_fragments enable row level security;
revoke all on public.brand_documents, public.brand_document_fragments from public, anon, authenticated;
grant select, delete on public.brand_documents, public.brand_document_fragments to authenticated;
grant insert (tenant_id, brand_id, title, doc_type, product, country, language, version, owner, valid_from, valid_to, created_by) on public.brand_documents to authenticated;
grant update (title, doc_type, product, country, language, version, owner, valid_from, valid_to, status) on public.brand_documents to authenticated;
grant insert (tenant_id, brand_id, document_id, position, section_ref, content) on public.brand_document_fragments to authenticated;
grant all on public.brand_documents, public.brand_document_fragments to service_role;

-- Echipa agenției vede toate documentele brandului; clientul, doar pe cele aprobate (sunt ale lui). Scrie doar echipa.
create policy brand_documents_select on public.brand_documents for select to authenticated
  using (brand_id in (select private.accessible_brand_ids())
         and (status = 'approved' or private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])));
create policy brand_documents_insert on public.brand_documents for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]) and created_by = (select auth.uid()));
create policy brand_documents_update on public.brand_documents for update to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]))
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy brand_documents_delete on public.brand_documents for delete to authenticated
  using (status = 'draft' and private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));

-- Fragmentele au vizibilitatea documentului: subinterogarea trece prin RLS-ul lui `brand_documents`.
create policy brand_document_fragments_select on public.brand_document_fragments for select to authenticated
  using (brand_id in (select private.accessible_brand_ids())
         and exists (select 1 from public.brand_documents d where d.id = document_id));
create policy brand_document_fragments_insert on public.brand_document_fragments for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy brand_document_fragments_update on public.brand_document_fragments for update to authenticated
  using (false);
create policy brand_document_fragments_delete on public.brand_document_fragments for delete to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));

-- Cine a introdus, aprobat sau retras un document rămâne în audit. Textul fragmentelor nu se dublează acolo.
create trigger brand_documents_audit after insert or update or delete on public.brand_documents
  for each row execute function private.audit_row();

-- 2. Căutarea ------------------------------------------------------------------------------------------------------------------

create function public.brand_document_search(p_brand_id uuid, p_query text, p_on date default null, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_on date := coalesce(p_on, (now() at time zone 'Europe/Bucharest')::date);
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_terms text;
  v_query tsquery;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;

  -- Cuvintele întrebării, fără diacritice, de cel puțin patru litere (cele scurte, „ce”, „la”, „de”, ar potrivi orice fragment).
  -- Oricare dintre ele poate potrivi un fragment; ordinea o dă numărul și frecvența potrivirilor.
  select string_agg(w, ' | ') into v_terms
  from (
    select distinct w
    from regexp_split_to_table(translate(lower(coalesce(p_query, '')), 'ăâîșşțţ', 'aaisstt'), '[^a-z0-9]+') w
    where length(w) between 4 and 40
    order by w
    limit 16
  ) t;
  if v_terms is null then
    return '[]'::jsonb;
  end if;
  v_query := to_tsquery('simple'::regconfig, v_terms);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'fragment_id', x.id, 'document_id', x.document_id, 'title', x.title, 'doc_type', x.doc_type, 'version', x.version,
      'section_ref', x.section_ref, 'content', x.content, 'valid_from', x.valid_from, 'valid_to', x.valid_to) order by x.rank desc, x.title, x.position)
    from (
      select f.id, f.document_id, d.title, d.doc_type, d.version, f.section_ref, f.content, d.valid_from, d.valid_to, f.position,
             ts_rank(f.search, v_query) as rank
      from public.brand_document_fragments f
      join public.brand_documents d on d.id = f.document_id
      where f.brand_id = p_brand_id and d.brand_id = p_brand_id
        -- Doar documente aprobate și valabile la data cerută. Un document expirat sau retras nu intră în context.
        and d.status = 'approved'
        and (d.valid_from is null or d.valid_from <= v_on)
        and (d.valid_to is null or d.valid_to >= v_on)
        and f.search @@ v_query
      order by rank desc, d.title, f.position
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.brand_document_search(uuid, text, date, integer) from public, anon;
grant execute on function public.brand_document_search(uuid, text, date, integer) to authenticated, service_role;
comment on function public.brand_document_search(uuid, text, date, integer) is
  'Fragmentele documentelor aprobate și valabile la o dată care potrivesc cuvintele unei întrebări (căutare lexicală). SECURITY INVOKER; verifică has_brand_access (E8).';
