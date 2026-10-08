-- Versiune nouă a setului de competitori, atomic (o singură funcție = o singură tranzacție).
-- Fără ea, două insert-uri separate puteau lăsa un set efectiv fără membri, imposibil de corectat
-- (competitor_sets și competitor_set_members sunt imutabile).
--
-- Alegere: SECURITY INVOKER, apelabilă direct de utilizatorul autentificat (RPC), fără Edge Function.
-- Motivare: rolul și accesul la brand sunt deja decise de RLS (competitor_sets_insert / _members_insert);
-- funcția rulează cu drepturile apelantului, deci nu poate scrie nimic ce politicile nu permit și nu
-- primește un actor din exterior (created_by = auth.uid()). Un SECURITY DEFINER executabil de clienți
-- ar fi cerut o excepție la garda A10; aceasta nu e necesară. Verificarea explicită din corp există
-- doar pentru mesaje clare în română și pentru a nu depinde de eroarea generică RLS.
-- Auditul: triggerele existente (competitor_sets_audit, competitor_set_members_audit) scriu în
-- audit_events câte un rând pentru set și pentru fiecare membru, cu actorul din JWT, în aceeași tranzacție.

create function public.create_competitor_set_version(
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

    insert into public.competitor_set_members (tenant_id, brand_id, competitor_set_id, name, domain, color, sort_order)
    values (v_tenant_id, p_brand_id, v_set_id, v_name, v_domain, v_color, v_pos - 1);
  end loop;

  return query select v_set_id, v_version, p_effective_from, v_count;
end;
$$;

revoke all on function public.create_competitor_set_version(uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_competitor_set_version(uuid, date, text, jsonb) to authenticated;

comment on function public.create_competitor_set_version(uuid, date, text, jsonb) is
  'Creează atomic o versiune nouă a setului de competitori (set + membri). SECURITY INVOKER: RLS rămâne autoritatea. Vezi docs/security-tests.md, E4.';
