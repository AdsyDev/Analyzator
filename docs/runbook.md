# Runbook operațional

## Refresh săptămânal
_De completat._ Sincronizare marți la 06:00 Europe/Bucharest pentru săptămâna anterioară (luni-duminică); reimport al ultimelor 35 de zile pentru sursele mutabile.

## Colectare zilnică Clarity

- Configurarea: `source_connections` cu `provider = 'clarity'`; tokenul e în Vault. Vezi `docs/contracts/clarity.md`.
- Setare sau rotire token, până există UI-ul:
  `npm run set-source-token -- --connection <uuid> --email <admin> [--validate]`
  Parola și tokenul se dau pe stdin, nu ca argumente. `--validate` consumă 1 din cele 10 apeluri zilnice.
- **Rulare programată:** `.github/workflows/clarity-daily.yml`, zilnic la 22:05 UTC (01:05 vara, 00:05 iarna, ora României). Stochează ziua anterioară în Europe/Bucharest.
  - **Activare:** GitHub → Settings → Secrets and variables → Actions → Variables → `CONNECTOR_CLARITY_ENABLED = true`. Fără ea, cron-ul pornește, dar jobul e sărit.
  - **Secrete** în environment-ul GitHub `staging`: `SUPABASE_URL` și `SUPABASE_SERVICE_ROLE_KEY`. Tokenurile Clarity rămân în Vault.
  - **Rulare manuală:** Actions → clarity-daily → Run workflow (`workflow_dispatch`, activ și când variabila e oprită). **Fiecare rulare consumă 4 din cele 10 apeluri zilnice per proiect.**
- Rulare locală: `npm run collect:clarity` (cu `SUPABASE_URL` și `SUPABASE_SERVICE_ROLE_KEY` în mediu). Nu pornește sub 4 apeluri rămase azi (UTC).
- **Prima rulare reală** (forma e derivată din documentație, neconfirmată):
  1. Rulează manual, pe un singur brand dacă se poate.
  2. În `sync_runs.errors` caută codurile `parser_unconfirmed_field` / `parser_unknown_field`: ele dau numele reale ale câmpurilor pentru Scroll Depth, Rage Click Count etc.
  3. Completează `FIELD_MAP` în `connectors/clarity/parse.ts`, contractul și registrul (versiune nouă a definițiilor, ieșire din `draft`), cu teste pe fixtures reale.
  4. Verifică `PagesPerSessionPercentage` (pagini per sesiune sau procent).
- Diagnostic: `sync_runs` (status, `errors` cu dimensiunile necolectate și notele parserului), `provider_api_calls` (apelurile zilei) și `clarity_daily` (`payload_hash`, `collected_at`).
- `partial` cu `empty_payload`: Clarity a răspuns fără rânduri pentru dimensiunea respectivă; restul s-a scris. `invalid_payload`: forma răspunsului s-a schimbat; nu s-a scris nimic pentru dimensiunea respectivă, verifică parserul.
- `failed` cu `insufficient_budget`: sub 4 apeluri rămase azi (UTC); nu s-a trimis nicio cerere. Rulează a doua zi.
- 429: limita zilnică Clarity atinsă; nu reîncerca azi.
- Token refuzat (401/403): starea devine `invalid`, iar conexiunea e sărită până la un token nou.
- Recuperare după o zi pierdută: `numOfDays` 2–3 dă un agregat pe 48–72 h (`window_days` 2–3), nu zile separate; nu se folosește ca zi reală. Pentru pilot, ziua pierdută rămâne lipsă (acoperire < 100%).

## Hosting: aplicația web (SPA)

Rutele aplicației sunt în browser (`/brands/:brandId/<modul>`, `/admin/<pagină>`, `/login`). Serverul de producție trebuie să **redirecționeze orice cale către `index.html`** (SPA fallback, cu status 200), altfel o reîncărcare sau un link direct dă 404. Fișierele din `assets/` rămân servite ca atare. Configurarea concretă depinde de hostul ales și se face la deploy; verifică după deploy că `/brands/<id>/overview` se deschide direct din bara de adrese.

Build-ul de staging și cel de producție se fac fără `VITE_DESIGN_PREVIEW`: variabila oprește build-ul în orice mod în afară de `development` și `design-preview` (vezi README, „Previzualizare design"). Nu o seta în mediul CI.

## Incidente
_De completat._ 401 → verifică tokenul; 403 → verifică permisiunile; fără reîncercări agresive.

## Backup și restaurare
_De completat._
