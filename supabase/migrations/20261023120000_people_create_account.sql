-- Utilizatori (E-5, 23 oct. 2026): contul creat direct de agency_admin, cu parolă temporară. Contul se creează prin API-ul
-- de administrare GoTrue (funcția server `users`), cu marcajul `must_change_password` în app_metadata, pe care doar
-- service role îl poate scrie. Aici: starea contului în lista de persoane și auditul distinct al creării. Funcțiile rămân
-- SECURITY DEFINER, executabile DOAR de service_role (excepția E10, în regimul E1).

-- Identitatea persoanelor: plus `temporary_password` (parola aleasă de administrator, încă neschimbată) -------------
drop function public.tenant_people_for(uuid);

create function public.tenant_people_for(p_actor_user_id uuid)
returns table (
  tenant_id          uuid,
  user_id            uuid,
  email              text,
  full_name          text,
  last_sign_in_at    timestamptz,
  temporary_password boolean
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
      u.last_sign_in_at,
      coalesce(u.raw_app_meta_data ->> 'must_change_password', '') = 'true'
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

-- Acordarea accesului: aceeași funcție, cu acțiunea de audit `user_invited` (implicit) sau `user_created` -----------
drop function public.grant_invited_access(uuid, uuid, uuid, public.membership_role, uuid[]);

create function public.grant_invited_access(
  p_actor_user_id uuid,
  p_tenant_id     uuid,
  p_user_id       uuid,
  p_role          public.membership_role,
  p_brand_ids     uuid[],
  p_audit_action  text default 'user_invited'
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
  if p_audit_action is null or p_audit_action not in ('user_invited', 'user_created') then
    raise exception 'Acțiune de audit necunoscută' using errcode = '22023';
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
    p_tenant_id, null, p_actor_user_id, 'user', p_audit_action, 'memberships', v_membership_id::text,
    jsonb_build_object('user_id', p_user_id, 'role', p_role, 'brand_ids', to_jsonb(v_brands))
  );

  return v_membership_id;
end;
$$;

revoke all on function public.grant_invited_access(uuid, uuid, uuid, public.membership_role, uuid[], text) from public, anon, authenticated;
grant execute on function public.grant_invited_access(uuid, uuid, uuid, public.membership_role, uuid[], text) to service_role;
