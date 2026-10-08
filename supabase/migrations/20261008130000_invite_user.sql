-- Invitare de utilizatori (funcția server `invite-user`) și lista persoanelor cu nume/email.
-- Ambele funcții sunt apelate doar cu service role; verificarea de rol e în corp (ca la set_source_token).
-- Excepția E1 din docs/security-tests.md acoperă și aceste funcții.

-- Creează, într-o singură tranzacție, membership-ul, accesul la branduri și evenimentul de audit
-- pentru un utilizator deja creat în auth.users de Auth Admin (invite). Orice eroare anulează tot.
create function public.invite_user_grant(
  p_actor_user_id    uuid,
  p_tenant_id        uuid,
  p_invited_user_id  uuid,
  p_role             public.membership_role,
  p_brand_ids        uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_ids     uuid[];
  v_membership_id uuid;
begin
  perform private.assert_service_role();

  if p_actor_user_id is null or p_tenant_id is null or p_invited_user_id is null or p_role is null then
    raise exception 'Parametri lipsă' using errcode = '22023';
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
    raise exception 'Doar agency_admin al clientului poate invita utilizatori' using errcode = '42501';
  end if;

  if p_brand_ids is not null and array_position(p_brand_ids, null) is not null then
    raise exception 'Listă de branduri invalidă' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct b), '{}') into v_brand_ids from unnest(coalesce(p_brand_ids, '{}')) as b;

  if p_role = 'agency_admin' and cardinality(v_brand_ids) > 0 then
    raise exception 'agency_admin vede toate brandurile; nu se alocă branduri' using errcode = '22023';
  end if;
  if p_role <> 'agency_admin' and cardinality(v_brand_ids) = 0 then
    raise exception 'Rolul cere cel puțin un brand' using errcode = '22023';
  end if;

  -- Toate brandurile trebuie să fie active și din tenantul cerut.
  if (select count(*) from public.brands b
      where b.tenant_id = p_tenant_id and b.status = 'active' and b.id = any (v_brand_ids))
     <> cardinality(v_brand_ids) then
    raise exception 'Brand inexistent, arhivat sau din alt client' using errcode = '23503';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_invited_user_id) then
    raise exception 'Utilizator inexistent' using errcode = 'P0002';
  end if;

  -- unique (tenant_id, user_id): un membru existent (și revocat) dă 23505; nu se suprascrie tăcut.
  insert into public.memberships (tenant_id, user_id, role)
  values (p_tenant_id, p_invited_user_id, p_role)
  returning id into v_membership_id;

  insert into public.brand_access (tenant_id, brand_id, user_id, granted_by)
  select p_tenant_id, b, p_invited_user_id, p_actor_user_id from unnest(v_brand_ids) as b;

  insert into public.audit_events (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    p_tenant_id, p_actor_user_id, 'user', 'user_invited', 'memberships', v_membership_id::text,
    jsonb_build_object('invited_user_id', p_invited_user_id, 'role', p_role, 'brand_ids', to_jsonb(v_brand_ids))
  );

  return v_membership_id;
end;
$$;

-- Persoanele tenantului cu nume și email, pentru lista din Administrare → Utilizatori.
-- auth.users nu e expus: doar agency_admin al tenantului, doar membrii acelui tenant.
create function public.list_tenant_people(p_actor_user_id uuid, p_tenant_id uuid)
returns table (
  user_id          uuid,
  email            text,
  full_name        text,
  invited_at       timestamptz,
  last_sign_in_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_service_role();

  if not exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.tenant_id = p_tenant_id
      and m.user_id = p_actor_user_id
      and m.revoked_at is null
      and m.role = 'agency_admin'
  ) then
    raise exception 'Doar agency_admin al clientului poate vedea persoanele' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    u.email::text,
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''),
    u.invited_at,
    u.last_sign_in_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant_id
  order by m.created_at, m.id;
end;
$$;

revoke all on function public.invite_user_grant(uuid, uuid, uuid, public.membership_role, uuid[]) from public, anon, authenticated;
revoke all on function public.list_tenant_people(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_user_grant(uuid, uuid, uuid, public.membership_role, uuid[]) to service_role;
grant execute on function public.list_tenant_people(uuid, uuid) to service_role;
