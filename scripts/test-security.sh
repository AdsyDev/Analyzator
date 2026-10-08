#!/usr/bin/env bash
# Rulează suita de securitate pe Supabase LOCAL: reset, pgTAP, atacuri prin API și pe Edge Function.
set -euo pipefail
cd "$(dirname "$0")/.."
supabase db reset
supabase test db supabase/tests/database
set -a
eval "$(supabase status -o env)"
set +a
case "$API_URL" in http://127.0.0.1*|http://localhost*) ;; *) echo "Refuz: API_URL nu e local ($API_URL)"; exit 1;; esac

# Edge Functions (source-credentials, csv-import) pentru testele D și E (oprite la final).
supabase functions serve >/dev/null 2>&1 &
FN_PID=$!
trap 'kill $FN_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/source-credentials" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -d '{}' || true)
  code2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/csv-import" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -d '{}' || true)
  [ "$code" = "401" ] && [ "$code2" = "401" ] && break
  sleep 2
done

# Secvențial: fișierele modifică aceeași bază (revocări, tokenuri, contoare).
node --test --test-concurrency=1 tests/security/*.test.mjs
