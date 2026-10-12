-- Crearea unui client (tenant) din aplicație, de către orice agency_admin activ (decizia D-1, 12 oct 2026;
-- docs/security-tests.md, E5).
--
-- Până acum tenants_insert era `with check (false)`: clienții se creau doar cu service role.
-- Alegere: RLS + trigger, fără funcție RPC și fără Edge Function.
--   * Politica permite INSERT doar cui are un rol agency_admin activ într-un tenant activ. Verificarea
--     folosește funcțiile de autorizare existente (has_role), deci lista A10 de funcții executabile rămâne
--     neschimbată. Subinterogarea pe memberships trece prin RLS: utilizatorul își vede doar propriile rânduri.
--   * Un trigger SECURITY DEFINER îl face pe creator agency_admin în tenantul nou, în aceeași tranzacție.
--     Fără el, creatorul n-ar mai vedea tenantul pe care tocmai l-a creat (memberships_insert cere deja
--     agency_admin în tenant). Triggerul nu primește actorul din exterior: folosește auth.uid().
--   * Un tenant se creează mereu `active`; arhivarea rămâne o actualizare separată.
--   * Clientul trimite el `id`-ul (uuid generat în browser) și nu cere RETURNING: rândul devine vizibil
--     abia după ce triggerul AFTER a creat membership-ul.
-- Auditul: tenants_audit și memberships_audit scriu ambele rânduri cu actorul din JWT.

grant insert (id, slug, name) on public.tenants to authenticated;

drop policy tenants_insert on public.tenants;
create policy tenants_insert on public.tenants for insert to authenticated
  with check (
    status = 'active'
    and exists (
      select 1
      from public.memberships m
      where m.user_id = (select auth.uid())
        and m.revoked_at is null
        and m.role = 'agency_admin'
        and private.has_role(m.tenant_id, array['agency_admin']::public.membership_role[])
    )
  );

create function private.add_tenant_creator() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- Inserțiile cu service role (fără utilizator) nu creează membership.
  if v_actor is null then
    return null;
  end if;
  insert into public.memberships (tenant_id, user_id, role) values (new.id, v_actor, 'agency_admin');
  return null;
end;
$$;

revoke all on function private.add_tenant_creator() from public, anon, authenticated;

create trigger tenants_add_creator
  after insert on public.tenants
  for each row execute function private.add_tenant_creator();

comment on policy tenants_insert on public.tenants is
  'Orice agency_admin activ poate crea un client (D-1, E5); creatorul devine agency_admin prin tenants_add_creator.';
