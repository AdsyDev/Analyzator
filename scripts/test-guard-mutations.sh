#!/usr/bin/env bash
# Verifică gărzile de securitate prin mutații, pe Supabase LOCAL.
# Fiecare mutație slăbește intenționat o protecție; testul pgTAP indicat TREBUIE să pice.
# Dacă trece, garda nu mai protejează nimic și scriptul iese cu eroare.
# La final baza locală e resetată (migrații + seed de test).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)
DB="supabase_db_${PROJECT_ID}"
LOG_DIR=$(mktemp -d)
trap 'supabase db reset >/dev/null 2>&1 || true; rm -rf "$LOG_DIR"' EXIT

eval "$(supabase status -o env)"
case "$API_URL" in http://127.0.0.1*|http://localhost*) ;; *) echo "Refuz: Supabase nu e local ($API_URL)"; exit 1;; esac

failures=0
total=0

# mutate <nume> <fișier pgTAP> < SQL
mutate() {
  local name=$1 test_file=$2 log="$LOG_DIR/$total.log"
  total=$((total + 1))
  supabase db reset >/dev/null 2>&1
  if ! docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q >"$log" 2>&1; then
    echo "✖ $name: mutația nu s-a putut aplica"; cat "$log"; failures=$((failures + 1)); return
  fi
  if supabase test db "supabase/tests/database/$test_file" >>"$log" 2>&1; then
    echo "✖ $name: $test_file a TRECUT cu protecția slăbită (garda nu prinde mutația)"
    failures=$((failures + 1))
  else
    echo "✔ $name: prinsă de $test_file ($(grep -c '^# Failed test' "$log" || true) teste picate)"
  fi
}

mutate "M1 funcție nelistată în public (fără EXECUTE pentru clienți)" 04_security_inventory.test.sql <<'SQL'
create function public.leak_probe() returns integer language sql as 'select 1';
revoke all on function public.leak_probe() from public, anon, authenticated;
SQL

mutate "M2 EXECUTE pe get_source_token pentru authenticated" 04_security_inventory.test.sql <<'SQL'
grant execute on function public.get_source_token(uuid) to authenticated;
SQL

mutate "M3 assert_service_role fără verificare" 05_source_credentials.test.sql <<'SQL'
create or replace function private.assert_service_role() returns void
language plpgsql stable set search_path = '' as $$ begin return; end; $$;
SQL

mutate "M4 has_brand_role întoarce mereu true" 01_tenant_brand_isolation.test.sql <<'SQL'
create or replace function private.has_brand_role(p_brand_id uuid, p_roles public.membership_role[])
returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
SQL

mutate "M5 get_source_token fără verificarea numelui secretului" 05_source_credentials.test.sql <<'SQL'
create or replace function public.get_source_token(p_connection_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_conn  public.source_connections%rowtype;
  v_token text;
begin
  perform private.assert_service_role();
  select * into v_conn from public.source_connections where id = p_connection_id;
  if not found or v_conn.status <> 'active' or v_conn.vault_secret_id is null then
    raise exception 'Conexiune inexistentă, inactivă sau fără token' using errcode = 'P0002';
  end if;
  select ds.decrypted_secret into v_token from vault.decrypted_secrets ds where ds.id = v_conn.vault_secret_id;
  if v_token is null then
    raise exception 'Secretul nu corespunde conexiunii' using errcode = '42501';
  end if;
  return v_token;
end;
$$;
SQL

mutate "M6 RLS dezactivat pe provider_api_calls" 04_security_inventory.test.sql <<'SQL'
alter table public.provider_api_calls disable row level security;
SQL

mutate "M7 politică permisivă true pe provider_api_calls" 04_security_inventory.test.sql <<'SQL'
drop policy provider_api_calls_select on public.provider_api_calls;
create policy provider_api_calls_select on public.provider_api_calls for select to authenticated using (true);
SQL

mutate "M8 EXECUTE pentru anon pe o funcție aprobată (record_source_validation)" 04_security_inventory.test.sql <<'SQL'
grant execute on function public.record_source_validation(uuid, boolean, text) to anon;
SQL

echo
echo "Mutații: $total, neprinse: $failures"
[ "$failures" -eq 0 ]
