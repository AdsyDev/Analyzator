#!/usr/bin/env bash
# Teste de integrare pe Supabase LOCAL: reset (migrații + seed de test), apoi tests/integration/*.test.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
supabase db reset
set -a
eval "$(supabase status -o env)"
set +a
case "$API_URL" in http://127.0.0.1*|http://localhost*) ;; *) echo "Refuz: API_URL nu e local ($API_URL)"; exit 1;; esac
node --experimental-strip-types --test --test-concurrency=1 'tests/integration/**/*.test.ts'
