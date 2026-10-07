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

mutate "M9 funcție în metrics care citește un tabel" 04_security_inventory.test.sql <<'SQL'
create function metrics.leak_count() returns bigint language sql stable set search_path = ''
as $$ select count(*) from public.brands $$;
SQL

mutate "M10 funcție SECURITY DEFINER în metrics" 04_security_inventory.test.sql <<'SQL'
create function metrics.definer_probe() returns integer language sql immutable security definer set search_path = ''
as $$ select 1 $$;
SQL

mutate "M11 metrics.ratio întoarce 0 la numitor zero" 06_metric_registry.test.sql <<'SQL'
create or replace function metrics.ratio(p_numerator numeric, p_denominator numeric, p_multiplier numeric default 1)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_denominator = 0 then 0 else coalesce(p_multiplier, 1) * p_numerator / p_denominator end;
$$;
SQL

mutate "M12 variația relativă pe bază zero devine infinit" 06_metric_registry.test.sql <<'SQL'
create or replace function metrics.change(p_value numeric, p_comparison numeric, p_unit text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'absolute_change', p_value - p_comparison,
    'absolute_change_unit', case when p_unit = 'percent' then 'pp' else p_unit end,
    'relative_change', case when p_comparison = 0 then 'Infinity'::numeric else 100 * (p_value - p_comparison) / abs(p_comparison) end,
    'base_zero', false);
$$;
SQL

mutate "M13 rank absent tratat ca poziția 100" 06_metric_registry.test.sql <<'SQL'
create or replace function metrics.rank_summary(p_ranks jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'tracked', count(*), 'ranked', count(*), 'unranked', 0,
    'top3', count(*) filter (where coalesce((r ->> 'rank')::numeric, 100) <= 3),
    'top10', count(*) filter (where coalesce((r ->> 'rank')::numeric, 100) <= 10),
    'average_rank', avg(coalesce((r ->> 'rank')::numeric, 100)))
  from jsonb_array_elements(p_ranks) r;
$$;
SQL

echo
echo "Mutații: $total, neprinse: $failures"
[ "$failures" -eq 0 ]
