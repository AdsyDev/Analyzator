-- Credențialele surselor în Supabase Vault + contorul de apeluri către furnizori.
-- Tokenul intră doar prin set_source_token (funcția server, service role) și iese doar prin
-- get_source_token (worker / funcția server, service role). Utilizatorii văd doar starea.

-- source_connections: referință Vault și starea credențialului -----------------------------

alter table public.source_connections drop column secret_ref;

alter table public.source_connections
  add column vault_secret_id        uuid unique,
  add column credential_status      text not null default 'missing'
    check (credential_status in ('missing', 'unverified', 'valid', 'invalid')),
  add column credential_updated_at  timestamptz,
  add column credential_updated_by  uuid references auth.users (id) on delete set null,
  add column last_validated_at      timestamptz,
  add column last_validation_error  text,
  add constraint source_connections_credential_consistent
    check ((vault_secret_id is null) = (credential_status = 'missing'));

comment on column public.source_connections.external_account_id is
  'ID-ul contului la furnizor (pentru Clarity: project ID). Text, fără interpretare.';
comment on column public.source_connections.vault_secret_id is
  'vault.secrets.id; secretul are numele source_connection:<id>. Scris doar de set_source_token.';

-- Utilizatorii nu pot scrie referința Vault sau starea credențialului: granturi pe coloane.
revoke insert, update on public.source_connections from authenticated;
grant insert (tenant_id, brand_id, provider, external_account_id, display_name, timezone, currency, status)
  on public.source_connections to authenticated;
grant update (display_name, timezone, currency, status, brand_id)
  on public.source_connections to authenticated;

-- Ștergerea conexiunii șterge și secretul din Vault.
create function private.delete_source_secret() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.vault_secret_id is not null then
    delete from vault.secrets where id = old.vault_secret_id;
  end if;
  return old;
end;
$$;

revoke all on function private.delete_source_secret() from public, anon, authenticated;

create trigger source_connections_delete_secret
  after delete on public.source_connections
  for each row execute function private.delete_source_secret();

-- provider_api_calls ---------------------------------------------------------------------
-- Apeluri consumate din bugetul zilnic al furnizorului, per conexiune (token) și zi UTC.
-- Append-only; scris doar de worker și de funcția server (service role).

create table public.provider_api_calls (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null,
  brand_id             uuid,
  source_connection_id uuid not null,
  call_date_utc        date not null,
  purpose              text not null check (purpose in ('collect', 'validate')),
  calls                integer not null check (calls > 0),
  sync_run_id          uuid references public.sync_runs (id) on delete set null,
  actor_user_id        uuid,
  created_at           timestamptz not null default now(),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_connection_id) references public.source_connections (tenant_id, id) on delete cascade
);

create index provider_api_calls_day_idx
  on public.provider_api_calls (tenant_id, brand_id, source_connection_id, call_date_utc);

create function private.prevent_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% este append-only', tg_table_name using errcode = '42501';
end;
$$;

revoke all on function private.prevent_update() from public, anon, authenticated;

create trigger provider_api_calls_immutable
  before update on public.provider_api_calls
  for each row execute function private.prevent_update();

grant select on public.provider_api_calls to authenticated;
alter table public.provider_api_calls enable row level security;

create policy provider_api_calls_select on public.provider_api_calls for select to authenticated
  using (
    case
      when brand_id is null then
        private.has_role(tenant_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
      else
        private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
    end
  );
create policy provider_api_calls_insert on public.provider_api_calls for insert to authenticated
  with check (false);
create policy provider_api_calls_update on public.provider_api_calls for update to authenticated
  using (false);
create policy provider_api_calls_delete on public.provider_api_calls for delete to authenticated
  using (false);

-- Funcții server (doar service_role) -------------------------------------------------------
-- Verificarea rolului e în corp, nu doar în GRANT.

create function private.assert_service_role() returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     or coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Permis doar pentru service_role' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_service_role() from public, anon, authenticated;

-- Setează sau rotește tokenul. p_actor_user_id = utilizatorul autentificat de funcția server.
create function public.set_source_token(p_actor_user_id uuid, p_connection_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn      public.source_connections%rowtype;
  v_token     text := trim(coalesce(p_token, ''));
  v_secret_id uuid;
  v_action    text;
begin
  perform private.assert_service_role();

  if v_token = '' or length(v_token) > 8192 then
    raise exception 'Token gol sau prea lung' using errcode = '22023';
  end if;

  select * into v_conn from public.source_connections where id = p_connection_id for update;
  if not found or v_conn.status <> 'active' then
    raise exception 'Conexiune inexistentă sau inactivă' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.tenant_id = v_conn.tenant_id
      and m.user_id = p_actor_user_id
      and m.revoked_at is null
      and m.role = 'agency_admin'
  ) then
    raise exception 'Doar agency_admin al tenantului poate configura tokenul' using errcode = '42501';
  end if;

  -- Un secret rămas fără referință (numele e unic și legat de ID-ul conexiunii) se refolosește.
  if v_conn.vault_secret_id is null then
    select id into v_secret_id from vault.secrets where name = 'source_connection:' || v_conn.id::text;
    if v_secret_id is not null then
      v_conn.vault_secret_id := v_secret_id;
    end if;
  end if;

  if v_conn.vault_secret_id is null then
    v_secret_id := vault.create_secret(
      v_token, 'source_connection:' || v_conn.id::text, 'Token ' || v_conn.provider || ' pentru conexiunea ' || v_conn.id::text
    );
    v_action := 'credential_set';
  else
    perform vault.update_secret(v_conn.vault_secret_id, v_token);
    v_secret_id := v_conn.vault_secret_id;
    v_action := 'credential_rotated';
  end if;

  update public.source_connections
  set vault_secret_id       = v_secret_id,
      credential_status     = 'unverified',
      credential_updated_at = now(),
      credential_updated_by = p_actor_user_id,
      last_validation_error = null
  where id = v_conn.id;

  insert into public.audit_events (tenant_id, brand_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_conn.tenant_id, v_conn.brand_id, p_actor_user_id, 'user', v_action, 'source_connections', v_conn.id::text,
    jsonb_build_object('provider', v_conn.provider, 'credential_status', 'unverified')
  );

  return 'unverified';
end;
$$;

-- Tokenul decriptat, pentru worker și funcția server de validare.
create function public.get_source_token(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn  public.source_connections%rowtype;
  v_token text;
begin
  perform private.assert_service_role();

  select * into v_conn from public.source_connections where id = p_connection_id;
  if not found or v_conn.status <> 'active' or v_conn.vault_secret_id is null then
    raise exception 'Conexiune inexistentă, inactivă sau fără token' using errcode = 'P0002';
  end if;

  -- Secretul trebuie să aparțină exact acestei conexiuni.
  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.id = v_conn.vault_secret_id
    and ds.name = 'source_connection:' || v_conn.id::text;

  if v_token is null then
    raise exception 'Secretul nu corespunde conexiunii' using errcode = '42501';
  end if;
  return v_token;
end;
$$;

-- Rezultatul unei validări (butonul „Testează conexiunea" sau worker-ul).
create function public.record_source_validation(p_connection_id uuid, p_ok boolean, p_error text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := case when p_ok then 'valid' else 'invalid' end;
begin
  perform private.assert_service_role();

  update public.source_connections
  set credential_status     = v_status,
      last_validated_at     = now(),
      last_validation_error = case when p_ok then null else left(p_error, 500) end
  where id = p_connection_id and vault_secret_id is not null;

  if not found then
    raise exception 'Conexiune inexistentă sau fără token' using errcode = 'P0002';
  end if;
  return v_status;
end;
$$;

revoke all on function public.set_source_token(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_source_token(uuid) from public, anon, authenticated;
revoke all on function public.record_source_validation(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_source_token(uuid, uuid, text) to service_role;
grant execute on function public.get_source_token(uuid) to service_role;
grant execute on function public.record_source_validation(uuid, boolean, text) to service_role;
