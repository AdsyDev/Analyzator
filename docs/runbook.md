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

## Invitarea utilizatorilor (Edge Function `invite-user`)

- Funcția: `supabase/functions/invite-user`. Acțiuni: `invite` (`{ email, tenant_id, role, brand_ids[] }`) și `people` (`{ tenant_id }`), ambele doar pentru `agency_admin` activ al tenantului. Contractul complet: `docs/design/ui-data-needs.md`.
- **Secrete și variabile** (Supabase le injectează automat în Edge Functions: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Cheia service role nu se pune niciodată în frontend sau în repo. Opțional, ca secrete ale funcției:
  - `ANALYZATOR_APP_ORIGIN`: originea aplicației, pentru CORS;
  - `ANALYZATOR_INVITE_REDIRECT_URL`: unde ajunge persoana după linkul din e-mail (trebuie să fie în `additional_redirect_urls` din Auth).
  Pe staging: `supabase secrets set ANALYZATOR_APP_ORIGIN=… ANALYZATOR_INVITE_REDIRECT_URL=…`.
- **Migrația** `20261008130000_invite_user.sql` trebuie aplicată înainte de deploy (funcțiile `invite_user_grant`, `list_tenant_people`).
- **Pornire locală:** `supabase start`, apoi `supabase functions serve invite-user`. E-mailurile locale ajung în Inbucket (`http://127.0.0.1:54324`). Apel de probă, cu JWT-ul unui `agency_admin` obținut prin login:
  `curl -X POST "$API_URL/functions/v1/invite-user" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ADMIN_JWT" -d '{"action":"invite","email":"…","tenant_id":"…","role":"strategist","brand_ids":["…"]}'`
- **Deploy:** `supabase functions deploy invite-user`.
- **Valabilitatea invitației** o dă `[auth.email] otp_expiry` (setare globală Auth, comună cu resetarea parolei), nu funcția. Vezi S10 în `docs/security-tests.md`.
- Erori: 409 = există deja un cont cu acel e-mail; 429 = limita de e-mailuri Auth; 502 = Auth nu a putut trimite. Dacă în loguri apare `invite-user: compensarea a eșuat`, există un cont invitat fără membership; se șterge din Auth → Users.
- Audit: `audit_events` cu `action = 'user_invited'` (actorul, rolul, brandurile; fără e-mail).

## Incidente
_De completat._ 401 → verifică tokenul; 403 → verifică permisiunile; fără reîncercări agresive.

## Backup și restaurare
_De completat._
