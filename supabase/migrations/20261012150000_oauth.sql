-- Conectare OAuth (punctul 4, decizia D-8, 12 oct 2026): Google Ads și TikTok Ads.
--
-- 1. oauth_states: un `state` per pornire de conectare. Se păstrează doar hash-ul (SHA-256) al valorii trimise
--    furnizorului, legat de client, furnizor și utilizatorul care a pornit conectarea; valabil 10 minute, folosit o
--    singură dată. Scris și citit doar de funcția server `oauth` (service role): authenticated nu are niciun drept.
-- 2. rotate_source_token: workerul salvează tokenul reînnoit de furnizor (TikTok rotește refresh token-ul). Doar
--    service_role; nu schimbă starea credențialului și nu primește un actor uman: auditul e `actor_type = worker`.
--    Excepția E6 din docs/security-tests.md.

create table public.oauth_states (
  id             uuid primary key default gen_random_uuid(),
  state_hash     text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  provider       text not null check (provider in ('google_ads', 'tiktok_ads')),
  actor_user_id  uuid not null references auth.users (id) on delete cascade,
  -- PKCE (Google): verificatorul rămâne pe server; furnizorul primește doar challenge-ul.
  code_verifier  text check (code_verifier is null or code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'),
  account_label  text check (account_label is null or length(account_label) between 1 and 120),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);

comment on table public.oauth_states is
  'Pornirile de conectare OAuth (D-8). Doar hash-ul state-ului; folosit o singură dată, expiră în 10 minute. Doar service role.';

create index oauth_states_tenant_idx on public.oauth_states (tenant_id, created_at desc);

alter table public.oauth_states enable row level security;
create policy oauth_states_select on public.oauth_states for select to authenticated using (false);
create policy oauth_states_insert on public.oauth_states for insert to authenticated with check (false);
create policy oauth_states_update on public.oauth_states for update to authenticated using (false);
create policy oauth_states_delete on public.oauth_states for delete to authenticated using (false);
revoke all on public.oauth_states from anon, authenticated;

create function public.rotate_source_token(p_connection_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn  public.source_connections%rowtype;
  v_token text := trim(coalesce(p_token, ''));
begin
  perform private.assert_service_role();

  if v_token = '' or length(v_token) > 8192 then
    raise exception 'Token gol sau prea lung' using errcode = '22023';
  end if;

  select * into v_conn from public.source_connections where id = p_connection_id for update;
  if not found or v_conn.status <> 'active' then
    raise exception 'Conexiune inexistentă sau inactivă' using errcode = 'P0002';
  end if;
  -- Doar conturile OAuth își reînnoiesc singure tokenul; celelalte se schimbă doar de un agency_admin.
  if v_conn.provider not in ('google_ads_account', 'tiktok_account') then
    raise exception 'Reînnoirea automată nu e permisă pentru %', v_conn.provider using errcode = '42501';
  end if;
  if v_conn.vault_secret_id is null then
    raise exception 'Conexiunea nu are token' using errcode = 'P0002';
  end if;

  perform vault.update_secret(v_conn.vault_secret_id, v_token);
  update public.source_connections set credential_updated_at = now() where id = v_conn.id;

  insert into public.audit_events (tenant_id, brand_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (v_conn.tenant_id, v_conn.brand_id, null, 'worker', 'credential_refreshed', 'source_connections', v_conn.id::text,
          jsonb_build_object('provider', v_conn.provider, 'credential_status', v_conn.credential_status));

  return v_conn.credential_status;
end;
$$;

revoke all on function public.rotate_source_token(uuid, text) from public, anon, authenticated;
grant execute on function public.rotate_source_token(uuid, text) to service_role;
