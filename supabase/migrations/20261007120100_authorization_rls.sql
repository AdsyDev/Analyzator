-- ANZ04/ANZ05: funcții de autorizare, granturi minime și RLS pe toate tabelele expuse.
-- Accesul se citește din tabele la fiecare query, deci revocarea se aplică și sesiunilor existente.
-- Service role ocolește RLS: workerul verifică explicit tenant_id în cod.

-- Funcții de autorizare --------------------------------------------------------

-- Utilizatorul curent are membership activ în tenant (activ), cu unul din roluri.
create function private.has_role(p_tenant_id uuid, p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.revoked_at is null
      and m.role = any (p_roles)
  );
$$;

-- Pentru un utilizator dat (explicit): agency_admin vede tot tenantul,
-- ceilalți au nevoie de brand_access nerevocat.
create function private.user_has_brand_role(p_user_id uuid, p_brand_id uuid, p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.brands b
    join public.tenants t on t.id = b.tenant_id and t.status = 'active'
    join public.memberships m
      on m.tenant_id = b.tenant_id
     and m.user_id = p_user_id
     and m.revoked_at is null
    where b.id = p_brand_id
      and m.role = any (p_roles)
      and (
        m.role = 'agency_admin'
        or exists (
          select 1
          from public.brand_access ba
          where ba.tenant_id = b.tenant_id
            and ba.brand_id = b.id
            and ba.user_id = m.user_id
            and ba.revoked_at is null
        )
      )
  );
$$;

create function private.has_brand_role(p_brand_id uuid, p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_brand_role((select auth.uid()), p_brand_id, p_roles);
$$;

create function private.has_brand_access(p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_brand_role(
    p_brand_id,
    array['agency_admin', 'strategist', 'account', 'client_viewer']::public.membership_role[]
  );
$$;

-- Tenantul e vizibil pentru admin sau pentru cine are acces la cel puțin un brand din el.
create function private.can_see_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_tenant_id, array['agency_admin']::public.membership_role[])
      or exists (
        select 1 from public.brands b
        where b.tenant_id = p_tenant_id and private.has_brand_access(b.id)
      );
$$;

-- Pentru funcția server de import (rulează cu service role, deci primește user_id explicit).
create function private.user_can_import(p_user_id uuid, p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_brand_role(
    p_user_id,
    p_brand_id,
    array['agency_admin', 'account']::public.membership_role[]
  );
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function
  private.has_role(uuid, public.membership_role[]),
  private.has_brand_role(uuid, public.membership_role[]),
  private.has_brand_access(uuid),
  private.can_see_tenant(uuid)
to authenticated;
-- user_has_brand_role primește un user_id arbitrar: nu se expune lui authenticated.
grant execute on function private.user_can_import(uuid, uuid) to service_role;

-- Granturi minime ------------------------------------------------------------------
-- anon nu are acces. authenticated primește doar ce permit politicile.
-- Tabelele viitoare nu mai primesc granturi implicite: fiecare migration le acordă explicit.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

grant select, update (name, status) on public.tenants to authenticated;
grant select, insert, update (slug, name, domain, status) on public.brands to authenticated;
grant select, insert, update (role, revoked_at), delete on public.memberships to authenticated;
grant select, insert, update (revoked_at), delete on public.brand_access to authenticated;
grant select, insert on public.competitor_sets to authenticated;
grant select, insert on public.competitor_set_members to authenticated;
grant select, insert,
  update (display_name, secret_ref, timezone, currency, status, brand_id),
  delete
  on public.source_connections to authenticated;
grant select on public.sync_runs to authenticated;
grant select on public.import_batches to authenticated;
grant select on public.audit_events to authenticated;

-- RLS ------------------------------------------------------------------------------

alter table public.tenants                enable row level security;
alter table public.brands                 enable row level security;
alter table public.memberships            enable row level security;
alter table public.brand_access           enable row level security;
alter table public.competitor_sets        enable row level security;
alter table public.competitor_set_members enable row level security;
alter table public.source_connections     enable row level security;
alter table public.sync_runs              enable row level security;
alter table public.import_batches         enable row level security;
alter table public.audit_events           enable row level security;

-- tenants: creare doar prin service role; fără ștergere (arhivare prin status).
create policy tenants_select on public.tenants for select to authenticated
  using (private.can_see_tenant(id));
create policy tenants_insert on public.tenants for insert to authenticated
  with check (false);
create policy tenants_update on public.tenants for update to authenticated
  using (private.has_role(id, array['agency_admin']::public.membership_role[]))
  with check (private.has_role(id, array['agency_admin']::public.membership_role[]));
create policy tenants_delete on public.tenants for delete to authenticated
  using (false);

-- brands
create policy brands_select on public.brands for select to authenticated
  using (private.has_brand_access(id));
create policy brands_insert on public.brands for insert to authenticated
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy brands_update on public.brands for update to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]))
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy brands_delete on public.brands for delete to authenticated
  using (false);

-- memberships: propriul rând sau agency_admin al tenantului.
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_role(tenant_id, array['agency_admin']::public.membership_role[])
  );
create policy memberships_insert on public.memberships for insert to authenticated
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy memberships_update on public.memberships for update to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]))
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy memberships_delete on public.memberships for delete to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));

-- brand_access: propriul rând sau agency_admin; granted_by = cine acordă.
create policy brand_access_select on public.brand_access for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_role(tenant_id, array['agency_admin']::public.membership_role[])
  );
create policy brand_access_insert on public.brand_access for insert to authenticated
  with check (
    private.has_role(tenant_id, array['agency_admin']::public.membership_role[])
    and granted_by = (select auth.uid())
  );
create policy brand_access_update on public.brand_access for update to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]))
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy brand_access_delete on public.brand_access for delete to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));

-- competitor_sets: versiuni imutabile; creare de agency_admin sau strategist cu acces la brand.
create policy competitor_sets_select on public.competitor_sets for select to authenticated
  using (private.has_brand_access(brand_id));
create policy competitor_sets_insert on public.competitor_sets for insert to authenticated
  with check (
    private.has_brand_role(brand_id, array['agency_admin', 'strategist']::public.membership_role[])
    and created_by = (select auth.uid())
  );
create policy competitor_sets_update on public.competitor_sets for update to authenticated
  using (false);
create policy competitor_sets_delete on public.competitor_sets for delete to authenticated
  using (false);

create policy competitor_set_members_select on public.competitor_set_members for select to authenticated
  using (private.has_brand_access(brand_id));
create policy competitor_set_members_insert on public.competitor_set_members for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin', 'strategist']::public.membership_role[]));
create policy competitor_set_members_update on public.competitor_set_members for update to authenticated
  using (false);
create policy competitor_set_members_delete on public.competitor_set_members for delete to authenticated
  using (false);

-- source_connections: citire pentru rolurile de agenție; scriere doar agency_admin.
create policy source_connections_select on public.source_connections for select to authenticated
  using (
    case
      when brand_id is null then
        private.has_role(tenant_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
      else
        private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
    end
  );
create policy source_connections_insert on public.source_connections for insert to authenticated
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy source_connections_update on public.source_connections for update to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]))
  with check (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy source_connections_delete on public.source_connections for delete to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));

-- sync_runs: citire pentru agenție cu acces la brand; scriere doar service role.
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy sync_runs_insert on public.sync_runs for insert to authenticated
  with check (false);
create policy sync_runs_update on public.sync_runs for update to authenticated
  using (false);
create policy sync_runs_delete on public.sync_runs for delete to authenticated
  using (false);

-- import_batches: la fel; scrierea trece prin funcția server (private.user_can_import).
create policy import_batches_select on public.import_batches for select to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));
create policy import_batches_insert on public.import_batches for insert to authenticated
  with check (false);
create policy import_batches_update on public.import_batches for update to authenticated
  using (false);
create policy import_batches_delete on public.import_batches for delete to authenticated
  using (false);

-- audit_events: citire doar agency_admin; scriere prin triggere sau service role.
create policy audit_events_select on public.audit_events for select to authenticated
  using (private.has_role(tenant_id, array['agency_admin']::public.membership_role[]));
create policy audit_events_insert on public.audit_events for insert to authenticated
  with check (false);
create policy audit_events_update on public.audit_events for update to authenticated
  using (false);
create policy audit_events_delete on public.audit_events for delete to authenticated
  using (false);
