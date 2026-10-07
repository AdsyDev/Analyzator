# Contract Clarity (Data Export API)

Endpoint: `GET https://www.clarity.ms/export-data/api/v1/project-live-insights`
Autentificare: `Authorization: Bearer {token}` (un token per proiect, doar server-side).

## Configurare

- O conexiune per brand în `source_connections`: `provider = 'clarity'`, `tenant_id`, `brand_id`, `external_account_id` = ID-ul proiectului Clarity, `status`.
- Tokenul e în **Supabase Vault** (secret `source_connection:<id>`). Se setează din Administrare → Surse (după ce există ecranul), iar până atunci cu `npm run set-source-token`. Ambele trec prin Edge Function `source-credentials`. Frontend-ul vede doar `credential_status` (`missing` / `unverified` / `valid` / `invalid`).
- Worker-ul citește conexiunile active cu service role. Le sare pe cele `missing` sau `invalid` și citește tokenul cu `get_source_token` doar după verificarea bugetului.
- Proba (`npm run probe:clarity`) citește în continuare `CLARITY_PROJECTS` din `.env.local`, până există UI-ul.

## Stocare: `clarity_daily`

- **Ziua stocată (`date`) = ziua anterioară rulării, în Europe/Bucharest.** Exemplu: o rulare la 22:05 UTC pe 7 oct (01:05 pe 8 oct la București) scrie `date = 2026-10-07`.
- **Fereastra reală a datelor = cele 24 de ore care se încheie la `collected_at`**, în UTC (`numOfDays=1`; `window_days` × 24 h în general). Ziua stocată e o aproximare a zilei calendaristice: cu rularea programată la 22:05 UTC, fereastra acoperă 01:05–01:05 ora României vara (decalaj de o oră) și 00:05–00:05 iarna. La 25 octombrie (zi de 25 de ore), o oră din ziua calendaristică nu e acoperită.
- `window_days` = 2 sau 3 marchează un agregat de recuperare (`numOfDays` 2–3), nu o zi reală. View-ul de observații îl exclude.
- Cheie unică: `(tenant_id, brand_id, date, dimension, dimension_value)`; upsert idempotent (`on_conflict`). O a doua rulare în aceeași zi suprascrie rândurile cu fereastra ei de 24 h: cu același payload, aceleași valori și niciun duplicat. Rândurile unei dimensiuni care lipsesc din a doua rulare rămân din prima.
- Dimensiuni: `all` (fără `dimension1`), `device` (`Device`), `source` (`Source`), `page` (`URL`). `dimension_value` = valoarea cheii cu numele dimensiunii; valoare lipsă → `(unknown)` (notă în log); valoare repetată în același bloc → se păstrează primul rând, fără adunare.
- Proveniență pe fiecare rând: `source_id` (conexiunea), `sync_run_id`, `collected_at`, `collection_method = 'api'`, `payload_hash` (SHA-256 al corpului brut), `window_days`, `schema_version = 'docs-2025-12-05'`.
- RLS: citire pentru oricine are acces la brand (inclusiv client); scriere doar de worker (service role), cu verificarea tenantului înainte și după upsert.
- **O metrică absentă din payload rămâne NULL, nu 0.**

### Maparea câmpurilor (parser: `connectors/clarity/parse.ts`, Zod)

| metricName | Câmp | Coloană | Sursa mapării |
|---|---|---|---|
| `Traffic` | `totalSessionCount` (string) | `sessions` | documentație (exemplu) |
| `Traffic` | `totalBotSessionCount` (string) | `bot_sessions` | documentație (exemplu) |
| `Traffic` | `distantUserCount` (string) | `distinct_users` | documentație (exemplu) |
| `Traffic` | `PagesPerSessionPercentage` (număr, de forma 1.0931) | `pages_per_session` | documentație (exemplu) |
| `Scroll Depth`, `Engagement Time`, `Dead Click Count`, `Rage Click Count`, `Quickback Click`, `Excessive Scroll`, `Script Error Count`, `Error Click Count` | **nedocumentate** | `scroll_depth`, `engagement_time`, `dead_click_count`, `rage_click_count`, `quickback_click`, `excessive_scroll`, `script_error_count`, `error_click_count` | **neconfirmat**: rămân NULL până la un payload real |
| `Popular Pages`, `Browser`, `Device`, `OS`, `Country/Region`, `Page Title`, `Referrer URL` | — | — | blocuri de defalcare, ignorate explicit (notă în log) |

Parserul e tolerant: câmpurile și blocurile necunoscute nu opresc parsarea. Ele se loghează (`console.warn` și `sync_runs.errors`, coduri `parser_unknown_field`, `parser_unconfirmed_field`, `parser_unknown_block`, `parser_unknown_block_key`) fără să schimbe statusul run-ului. După prima rulare reală, notele `parser_unconfirmed_field` dau numele exacte ale câmpurilor: se completează `FIELD_MAP`, apoi contractul și registrul (definițiile Clarity ies din `draft`). O formă de bază invalidă (nu e listă de `{ metricName, information[] }`) pierde dimensiunea respectivă (`invalid_payload`), fără să scrie nimic.

### Observații pentru metrics.compute

View-ul `public.clarity_metric_observations` (`security_invoker`, RLS din `clarity_daily`) transformă rândurile `dimension = 'all'` și `window_days = 1` în observații pentru definițiile draft din registru:

| metric_key | value | weight |
|---|---|---|
| `clarity_rage_click_sessions` | `rage_click_count` | — |
| `clarity_dead_click_sessions` | `dead_click_count` | — |
| `clarity_quickback_sessions` | `quickback_click` | — |
| `clarity_scroll_depth` | `scroll_depth` | `sessions` |

Cât timp coloanele sunt NULL, `metrics.compute` întoarce `unavailable` (`no_confirmed_data`, plus `definition_draft`), nu 0. Zilele confirmate = zilele cu `value` nenul.

### Rulare programată

`.github/workflows/clarity-daily.yml`: zilnic la 22:05 UTC, **dezactivat** până la `CONNECTOR_CLARITY_ENABLED = true` (GitHub Variables). `workflow_dispatch` e activ oricând. Vezi `docs/runbook.md`.

## Bugetul zilnic

- 10 apeluri per proiect (token) pe zi, contorizate în `provider_api_calls` pentru colectare **și** pentru „Testează conexiunea".
- **Ziua de buget e UTC.** Momentul la care Clarity resetează limita **nu e documentat**; resetarea la 00:00 UTC e o presupunere. **De verificat în prima săptămână de rulare:** ora primului 429 și ora la care apelurile reușesc din nou.
- Worker-ul pornește cu 10 minus apelurile de azi și **nu pornește sub 4** (run `failed`, cod `insufficient_budget`, nicio cerere trimisă).
- Retry-urile intră în buget. La buget epuizat se pierd dimensiunile de la coada listei (paginile primele).
Sursa: [Clarity Data Export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api), pagină actualizată 2025-12-05, citită 2026-10-07.

## Din documentație (verificat 2026-10-07)

- **Limite:** 10 apeluri/zi per proiect; maximum 3 dimensiuni per apel; **maximum 1.000 de rânduri per răspuns, fără paginare**.
- **`numOfDays`:** 1, 2 sau 3 = **ultimele 24, 48 sau 72 de ore de la momentul apelului**, nu zile calendaristice. Rezultatele sunt în **UTC**.
- **Dimensiuni valide (exact):** `Browser`, `Device`, `Country/Region`, `OS`, `Source`, `Medium`, `Campaign`, `Channel`, `URL`.
- **Alegerea pentru pilot:** sursă de trafic = `Source`; pagini = `URL`. `Channel` și `Medium` sunt alternative documentate, nefolosite.
- **Metrici listate:** Scroll Depth, Engagement Time, Traffic, Popular Pages, Browser, Device, OS, Country/Region, Page Title, Referrer URL, Dead Click Count, Excessive Scroll, Rage Click Count, Quickback Click, Script Error Count, Error Click Count. Acestea sunt etichete din documentație; valorile exacte ale `metricName` se iau doar din fixtures.
- **Exemplul din documentație** (`metricName: "Traffic"`): câmpurile `totalSessionCount`, `totalBotSessionCount`, `distantUserCount` vin ca **string**, iar `PagesPerSessionPercentage` ca număr; dimensiunea apare ca o cheie cu numele ei (de exemplu `"OS": "Android"`). **De confirmat în fixtures.**
- **Erori documentate:** 400 parametri invalizi · 401 token lipsă, invalid sau expirat · 403 token fără drept pe operație · 429 limită zilnică depășită. Nu sunt documentate `Retry-After` sau 5xx.

## Ordinea apelurilor zilnice (prioritate)

| # | Dimensiune | `dimension` în `clarity_daily` | Fixture |
|---|---|---|---|
| 1 | (fără) | `all` | `{brand_slug}-totals.json` |
| 2 | `Device` | `device` | `{brand_slug}-device.json` |
| 3 | `Source` | `source` | `{brand_slug}-source.json` |
| 4 | `URL` | `page` | `{brand_slug}-page.json` |

La buget epuizat se pierd dimensiunile de la coada listei; run-ul devine `partial`, iar ce nu s-a colectat apare în `sync_runs.errors`.

Fixtures se generează cu `npm run probe:clarity`: 4 apeluri per proiect, fără retry.

> **Status (8 oct 2026):** conectorul e construit pe forma din documentație, cu fixtures în `tests/fixtures/clarity/docs-derived/` marcate „derivat din documentație, neconfirmat". Secțiunile de mai jos se completează după prima probă reală (`npm run probe:clarity`), doar cu ce apare în fixtures reale.

## Observații înainte de probă

- 7 oct 2026: un token inexistent primește **403**, nu 401 (testat cu un token fals; nu consumă bugetul vreunui proiect). Conectorul tratează 401 și 403 identic: eroare de acces, fără retry.

## Decizii deschise

- ~~Fereastra de 24 h față de ziua calendaristică~~ — **decis 8 oct 2026:** ziua stocată = ziua anterioară rulării în Europe/Bucharest; fereastra reală = 24 h până la `collected_at` (vezi „Stocare"). Rulare programată la 22:05 UTC.
- **Numele câmpurilor pentru metricile non-Traffic** nu sunt documentate; se confirmă la prima rulare reală din notele parserului.
- **`PagesPerSessionPercentage`:** numele sugerează procent, dar exemplul (1.0931, 2.2609) arată pagini per sesiune. De confirmat pe payload real.
- **Limita de 1.000 de rânduri pentru `URL`** poate trunchia paginile pe un site mare. De verificat în fixture dacă `page` are exact 1.000 de rânduri.

## Rulare

| Data rulării | Proiecte (brand_slug) | Coduri HTTP | Observații |
|---|---|---|---|
| _de completat_ | | | |

## Metrici disponibile

| metricName (exact) | Câmpuri în `information` | Unitate / tip | Prezent în totals | Prezent în device | Observații |
|---|---|---|---|---|---|
| _de completat_ | | | | | |

## Dimensiuni

| Dimensiune (exact) | Validată în probă | Valori observate | Observații |
|---|---|---|---|
| Device | _de completat_ | | |
| Source | _de completat_ | | |
| URL | _de completat_ | | Atenție la limita de 1.000 de rânduri |

## Forma payload-ului

- _de completat:_ structura de nivel superior (listă de blocuri `{ metricName, information[] }`?), tipul valorilor (string sau număr), câmpuri lipsă sau null, intervalul de timp acoperit de `numOfDays=1` (UTC sau fusul proiectului?), dacă răspunsul include data.

## Semantică null / zero / eroare

- _de completat după probă:_ cum apare o metrică fără date (bloc lipsă, listă goală, valoare `0`, `null`).
