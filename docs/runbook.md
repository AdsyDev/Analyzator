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

## Colectare săptămânală SEOmonitor

- Conexiunea: `source_connections` cu `provider = 'seomonitor'`, **la nivel de client** (`brand_id` gol), `external_account_id` = company_id SEOmonitor. Tokenul se setează ca la Clarity: `npm run set-source-token -- --connection <uuid> --email <admin>`. Vezi `docs/contracts/seomonitor.md`.
- **Maparea grupurilor** (obligatorie înainte de prima rulare): `seomonitor_group_mappings`, creată de `agency_admin`. Fiecare grup SEOmonitor primește una din trei variante:
  - `brand`: cu `brand_id`, `brand_type` (`branded`/`nonbranded`) și cel mult un grup `is_primary_visibility` per brand;
  - `multi_brand`;
  - `excluded`.

  Schimbarea înseamnă o **versiune nouă** cu `effective_from`, fără editare.
- **Coada de verificare** (`seomonitor_mapping_queue`): grupuri nemapate, multi-brand sau dispărute. Se rezolvă prin mapare; până atunci, datele lor nu intră în niciun brand.
- **Programare:** `.github/workflows/seomonitor-weekly.yml`, marți la **04:00 UTC**.
  - **Nota DST:** cron-ul GitHub e în UTC și nu urmează ora de vară. Rularea pică la **06:00** ora României vara (EEST, UTC+3) și la **05:00** iarna (EET, UTC+2), de la ultima duminică din octombrie (25 oct 2026) până la ultima duminică din martie. Pentru 06:00 tot anul, cron-ul trebuie schimbat de două ori pe an în `0 3 * * 2` (iarna) și înapoi. Pentru pilot păstrăm 04:00 UTC: datele sunt până ieri, deci ora exactă nu schimbă rezultatul.
  - Activare: `CONNECTOR_SEOMONITOR_ENABLED = true` în GitHub Variables. Secrete în environment-ul `staging`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Rulare manuală: Actions → seomonitor-weekly → Run workflow.
- Rulare locală: `npm run collect:seomonitor`. Reimportă ultimele 35 de zile; nu pornește sub 50 de apeluri rămase azi (UTC; cota documentată e de 10.000 pe zi).
- **Prima rulare reală:** verifică punctele din „De confirmat" din contract (unitatea visibility, rankul pentru „nu se clasează" etc.) pe `*_original`, `rank_status = 'at_tracking_limit'` și notele `parser_unknown_field` din `sync_runs.errors`.
- Diagnostic:
  - `sync_runs` (`source = seomonitor`): `errors` cu ruta, `coverage` per set de date;
  - `provider_api_calls`;
  - coada de mapare.
- Mesaje frecvente:

  | Mesaj | Ce înseamnă |
  |---|---|
  | `access_denied` (401/403) | Tokenul e marcat `invalid` și rularea se oprește; generează un token nou (Account Settings → Edit Profile → API Token). |
  | 429 | Limita pe secundă sau cota zilnică; retry după 1, 5, 15 minute (cu `Retry-After`, când vine). |
  | `pagination_stalled` | Offset-ul pare ignorat (pagini identice); verifică ruta. |
  | `mapped_group_missing` | Grupul a fost șters sau redenumit în SEOmonitor; actualizează maparea. |

## Incidente
_De completat._ 401 → verifică tokenul; 403 → verifică permisiunile; fără reîncercări agresive.

## Backup și restaurare
_De completat._


## GA4 și Search Console

- Configurare și reguli: `docs/contracts/google.md`. Service account-ul (un JSON per tenant) se setează cu `npm run set-source-token -- --connection <uuid-conexiune-google_service_account> --email <admin>`; conexiunile `ga4` și `gsc` (per brand) conțin doar property ID / site_url.
- Rulare: marți 04:00 UTC prin `.github/workflows/google-weekly.yml` (dezactivat până la `CONNECTOR_GOOGLE_ENABLED = true`), sau manual: `npm run collect:google [-- --only ga4|gsc]`.
- Verificare după rulare: `sync_runs` (source `ga4` / `gsc`: `status`, `errors`, `coverage`), `source_reconciliations` (`mismatch` = diferență peste toleranță; `incomparable` = interval, fus sau proprietate diferite).
- `not_connected` în log = lipsește credentialul Google al tenantului, sau a fost marcat invalid. Nu e o eroare a rulării.
- `access_denied` pe un brand = service account-ul nu are acces la proprietatea respectivă (adaugă-l în GA4 / Search Console).
- `ga4_incompatible_*` = combinație de dimensiuni și metrici respinsă de `checkCompatibility`; metrica rămâne NULL, nu 0.


## Import CSV (paid, social, listening)

- Contracte și șabloane: `docs/contracts/csv-*.md` și `docs/templates/csv/*.csv` (generate cu `npm run docs:csv`).
- Flux (Edge Function `csv-import`): `preview` (validare; nimic nu intră în tabelul țintă) → agenția verifică raportul → `confirm`. Doar `agency_admin` și `account` cu `brand_access` pot importa.
- La încărcare se declară moneda (paid), fusul orar și, opțional, `attribution_config` și `click_type`.
- Un fișier respins: `import_batches.detected.errors` (antet / format) și `import_batch_rows` (`status = rejected`, `reason`).
- Fișier identic după import → 409. Un reimport al aceleiași perioade, dintr-un fișier diferit, înlocuiește rândurile cu aceeași cheie.
- Lot rămas în `validating` (proces întrerupt): se reia cu `confirm`; dacă a rămas blocat, `update import_batches set status = 'validated' where id = …` (service role), apoi reconfirmă.
- Cost / CPC / CPA sunt `draft` până când contractul `MetricResponse` primește unitatea monetară (vezi `docs/decisions.md`, B6-9).
