# Contract Planable (Public API v1)

Sursa: specificația OpenAPI 3.1 publică, `https://api.planable.io/api/v1/openapi.json` (citită 2026-10-12), și [ghidul Planable](https://planable.io/guides/planable-public-api/). Răspunsurile de test sunt construite după schema OpenAPI, în `connectors/planable/planable.test.ts` („derivat din documentație, neconfirmat”). **Nicio rulare reală încă.**

## Din documentație

- **URL de bază:** `https://api.planable.io/api/v1`. **Autentificare:** `Authorization: Bearer pln_…`. Tokenul îl creează un Owner sau Administrator al companiei Planable, cu scope **Read**, pe toate workspace-urile sau pe unele, cu expirare aleasă (30 de zile … „Never”).
- **Plan:** tokenurile noi se pot genera doar pe **Pro** și **Enterprise**; cele existente continuă să funcționeze.
- **Erori:** `{ error: { code, message, requestId } }`, cu `code` = `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `VALIDATION_ERROR`, `INTERNAL` etc. 403 pe metrici: „token fără acces la pagină sau add-on-ul Analytics inactiv”.
- **Limite:** 429 e documentat, dar **valorile limitei nu sunt**. Folosim un ritm conservator (vezi „Rulare”) și respectăm `Retry-After`.
- **Paginare:** `offset` + `limit` cu `pagination.hasMore` (pagini, postări, metrici de pagină); `cursor` + `pagination.nextCursor` (mențiuni).

## Configurare (`source_connections`)

| provider | brand_id | external_account_id | token în Vault |
|---|---|---|---|
| `planable_account` | NULL (per client) | etichetă liberă (de ex. numele companiei Planable) | **da**: tokenul `pln_…` |
| `planable` | brandul | ID-ul **workspace-ului** Planable al brandului | nu |

- Tokenul și workspace-ul se setează din pagina site-ului → cardul Planable: pasul 1 (tokenul clientului, refolosit de toate site-urile lui) și pasul 2 (workspace-ul site-ului).
- Fără token (lipsă sau invalid), conexiunile `planable` ale clientului raportează `not_connected`, fără `sync_run` și fără cereri.
- 401 pe `GET /workspaces` marchează tokenul `invalid`. Un 403 pe un workspace înseamnă „tokenul nu are acces la workspace-ul acesta”: tokenul nu se marchează invalid.

## Rute folosite

| Rută | Folosire |
|---|---|
| `GET /workspaces` | accesul tokenului și fusul orar al workspace-ului |
| `GET /pages?workspaceId=` | canalele sociale ale workspace-ului (`isConnected`) |
| `GET /pages/{id}/metrics?startDate&endDate` | snapshoturile zilnice ale paginii → `social_daily` |
| `GET /posts?workspaceId&pageId&scheduledAfter&scheduledBefore` | postările publicate în fereastră |
| `GET /posts/{id}/metrics` | ultimul snapshot al postării (cumulat) → `social_posts` |
| `GET /keywords?workspaceId&type=brand` | cuvintele urmărite pentru brand (Listening) |
| `GET /keywords/{id}/mentions?workspaceId&startDate&endDate&sortBy=recency` | mențiunile → `mentions` |

Cuvintele de tip `topic` și `competitor` nu se colectează la pilot: mențiunile din `mentions` sunt ale brandului.

## Tabele și reguli

Aceleași tabele și chei ca importul CSV (`docs/contracts/csv-planable-analytics.md`, `csv-planable-listening.md`); proveniența API e `collection_method = 'api'`, `source_id` (conexiunea `planable` a brandului) și `sync_run_id` (migrația `20261012120000_import_tables_api_provenance.sql`).

| Tabel | Cheie naturală | Din API |
|---|---|---|
| `social_daily` | tenant, brand, platform, account_id, date | `account_id` = ID-ul paginii Planable; `date` = ziua lui `fetchedAt` în fusul workspace-ului (**de confirmat**: documentația spune „snapshots”, nu „zile”); mai multe snapshoturi în aceeași zi → ultimul |
| `social_posts` | tenant, brand, platform, account_id, post_id, snapshot_date, metrics_scope | `post_id` = ID-ul postării Planable; `metrics_scope = 'lifetime'`; `snapshot_date` = ziua lui `fetchedAt`; `published_at` = `scheduledAt` |
| `mentions` | tenant, brand, native_id | `native_id` = `h:` + primele 32 de caractere hex din SHA-256(url), **la fel ca importul CSV fără ID**, ca aceeași mențiune să nu se dubleze între CSV și API |

**Platforma** (`pageType`): litere mici; `twitter` → `x`, `googleMyBusiness` → `google_business`, ca în contractul CSV.

**Maparea metricilor de pagină** (câmpurile documentate; tot ce lipsește rămâne NULL, nu 0):

| Platformă | followers | impressions | reach_not_additive | engagements | likes | comments | shares | video_views |
|---|---|---|---|---|---|---|---|---|
| facebook | `totalFollowers` | `views` | — | `engagement` | `reactions` | — | — | — |
| instagram | `totalFollowers` | `impressions` | `reach` | `engagement` | — | — | — | `views` |
| linkedin | `totalFollowers` | `impressions` | — | `engagement` | `reactions` | `comments` | `reshares` | — |
| tiktok | `followers_count` | — | — | `engagement` | `likes` | `comments` | `shares` | `video_views` |
| threads | — | `views` | — | — | `likes` | `replies` | `reposts` | — |
| x | `totalFollowers` | `impressions` | — | `engagement` | `reactions` | — | — | — |
| youtube | `totalSubscribers` | — | — | `engagement` | `likes` | `comments` | `shares` | `views` |
| google_business | — | `impressions` | — | `engagement` | — | — | — | — |

**Postări:** `impressions`, `engagement` → `engagements`, `reactions` → `likes`. Câmpurile pe platformă ale postării nu sunt descrise în specificație (obiecte fără proprietăți): rămân NULL.

**Cont propriu (D-22):** `author.name` / `author.username` ale mențiunii se compară cu numele paginilor workspace-ului (`GET /pages`, aceeași platformă); se salvează doar `author_is_owned`, nu și numele autorului.

**Sentiment:** `positive` / `negative` / `neutral` din API; lipsă → `unknown`. **Corecțiile umane (`sentiment_reviewed_by`) au prioritate** și nu se suprascriu (ca la CSV).

## Rulare

- `.github/workflows/planable-weekly.yml`, marți 04:00 UTC, **dezactivat** până la `CONNECTOR_PLANABLE_ENABLED = true`; `workflow_dispatch` activ oricând. Local: `npm run collect:planable`.
- Fereastra: ultimele **35 de zile până ieri** (Europe/Bucharest), ca la ceilalți conectori.
- Ritm: cel mult 4 cereri pe secundă; retry la 429/5xx după 5 s, 30 s și 2 min (Retry-After are prioritate); fără retry pe 401/403. Plafon de siguranță: 5.000 de cereri pe rulare.
- Două `sync_runs` per brand: `planable_analytics` (social, cu acoperire = zile cu `social_daily` / 35) și `planable_listening` (mențiuni, fără acoperire pe zile). O rulare cu orice eroare nu e niciodată `succeeded`.

## De confirmat la prima rulare reală

1. Un snapshot de pagină = o zi? (`fetchedAt` față de ziua măsurată.)
2. `totalFollowers` față de `followers` la Facebook; `views` față de `impressions` la Facebook și Threads.
3. Dimensiunea maximă a paginii la `GET /pages` și `GET /posts` (folosim 50).
4. Limitele reale de apeluri.
