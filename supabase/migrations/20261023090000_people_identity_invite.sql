-- Utilizatori (cererea din 23 oct. 2026, E-4): numele și emailul persoanelor pentru agency_admin și invitarea din aplicație.
-- Emailul și numele trăiesc doar în auth.users, inaccesibil clientului. Ca la E1, funcțiile de aici sunt SECURITY
-- DEFINER în public, executabile DOAR de service_role (verificat și în corp): le apelează funcția server `users`, care
-- autentifică utilizatorul și trimite actorul explicit. Rolul de agency_admin al actorului se verifică aici, pe tenant
-- (excepția E10 din docs/security-tests.md).

-- Identitatea persoanelor cu acces -------------------------------------------------------------------------------
-- Doar membrii tenanților în care actorul e agency_admin activ (tenant activ); un actor fără acest rol primește zero
-- rânduri. Numele vine din metadatele contului (`full_name`, apoi `name`), deci e declarat de persoană; emailul e al
-- contului. Rândurile revocate rămân, ca în lista de acces.
create function public.tenant_people_for(p_actor_user_id uuid)
returns table (
  tenant_id       uuid,
  user_id         uuid,
  email           text,
  full_name       text,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_service_role();
  return query
    select
      m.tenant_id,
      m.user_id,
      u.email::text,
      left(nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''), 120),
      u.last_sign_in_at
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id in (
      select am.tenant_id
      from public.memberships am
      join public.tenants t on t.id = am.tenant_id and t.status = 'active'
      where am.user_id = p_actor_user_id
        and am.revoked_at is null
        and am.role = 'agency_admin'
    );
end;
$$;

revoke all on function public.tenant_people_for(uuid) from public, anon, authenticated;
grant execute on function public.tenant_people_for(uuid) to service_role;

-- Contul existent pentru un email (doar funcția server) ----------------------------------------------------------
-- `confirmed` = contul a fost activat (invitație acceptată sau email confirmat); altfel invitația se retrimite.
create function public.find_user_for_invite(p_email text)
returns table (user_id uuid, confirmed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_service_role();
  return query
    select u.id, u.email_confirmed_at is not null
    from auth.users u
    where lower(u.email) = lower(trim(p_email))
      and u.deleted_at is null
    limit 1;
end;
$$;

revoke all on function public.find_user_for_invite(text) from public, anon, authenticated;
grant execute on function public.find_user_for_invite(text) to service_role;

-- Acordarea accesului la invitație, atomic: membership + brand_access + eveniment de audit cu actorul real ---------
create function public.grant_invited_access(
  p_actor_user_id uuid,
  p_tenant_id     uuid,
  p_user_id       uuid,
  p_role          public.membership_role,
  p_brand_ids     uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brands        uuid[] := coalesce(array(select distinct b from unnest(p_brand_ids) as b where b is not null), '{}');
  v_membership_id uuid;
begin
  perform private.assert_service_role();

  if p_role is null then
    raise exception 'Rol lipsă' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.tenant_id = p_tenant_id
      and m.user_id = p_actor_user_id
      and m.revoked_at is null
      and m.role = 'agency_admin'
  ) then
    raise exception 'Doar agency_admin al tenantului poate invita' using errcode = '42501';
  end if;

  if cardinality(v_brands) > 50 then
    raise exception 'Prea multe branduri' using errcode = '22023';
  end if;
  if (select count(*) from public.brands b where b.tenant_id = p_tenant_id and b.status = 'active' and b.id = any (v_brands))
     <> cardinality(v_brands) then
    raise exception 'Brand inexistent, arhivat sau din alt tenant' using errcode = '22023';
  end if;

  if exists (select 1 from public.memberships m where m.tenant_id = p_tenant_id and m.user_id = p_user_id) then
    raise exception 'Persoana are deja un rând de acces în acest tenant' using errcode = '23505';
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  values (p_tenant_id, p_user_id, p_role)
  returning id into v_membership_id;

  insert into public.brand_access (tenant_id, brand_id, user_id, granted_by)
  select p_tenant_id, b, p_user_id, p_actor_user_id from unnest(v_brands) as b;

  insert into public.audit_events (tenant_id, brand_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    p_tenant_id, null, p_actor_user_id, 'user', 'user_invited', 'memberships', v_membership_id::text,
    jsonb_build_object('user_id', p_user_id, 'role', p_role, 'brand_ids', to_jsonb(v_brands))
  );

  return v_membership_id;
end;
$$;

revoke all on function public.grant_invited_access(uuid, uuid, uuid, public.membership_role, uuid[]) from public, anon, authenticated;
grant execute on function public.grant_invited_access(uuid, uuid, uuid, public.membership_role, uuid[]) to service_role;
