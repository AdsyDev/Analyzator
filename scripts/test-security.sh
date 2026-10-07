#!/usr/bin/env bash
# Rulează suita de securitate pe Supabase LOCAL: reset, pgTAP, apoi atacuri prin API.
set -euo pipefail
cd "$(dirname "$0")/.."
supabase db reset
supabase test db supabase/tests/database
set -a
eval "$(supabase status -o env)"
set +a
node --test tests/security/*.test.mjs
