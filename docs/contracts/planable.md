# Contract Planable (Public API v1)

Sursa: specificația OpenAPI 3.1 publică, `https://api.planable.io/api/v1/openapi.json` (citită 2026-10-12; recitită 2026-11-23 pentru tipurile de cuvinte și rutele Planable Competitors), și [ghidul Planable](https://planable.io/guides/planable-public-api/). Răspunsurile de test sunt construite după schema OpenAPI, în `connectors/planable/planable.test.ts` („derivat din documentație, neconfirmat”). **Nicio rulare reală încă.**

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
| `GET /keywords?workspaceId&type=competitor` | cuvintele urmărite pentru competitori (deciziile Y) |
| `GET /keywords/{id}/mentions?…` (aceiași parametri) | mențiunile lor → `competitor_mentions` |
| `GET /pages/{id}/competitors` | profilurile urmărite în Planable Competitors pe o pagină a brandului (Y-13) |
| `GET /pages/{id}/competitors/metrics?startDate&endDate` | urmăritorii pe zi, pentru pagina proprie și profiluri → `competitor_social_daily.followers` |
| `GET /pages/{id}/competitors/comparison?startDate&endDate` | cu fereastra unei zile: postările și interacțiunile zilei → `posts`, `engagement` |

Cuvintele de tip `topic` au rularea lor din 25 nov. 2026 (`planable_listening_topics`, deciziile AI), la fel cele de tip `competitor` (`planable_listening_competitors`); mențiunile din `mentions` sunt doar ale brandului. Tipul se verifică și local (fără diferență de majuscule): dacă API-ul ar ignora parametrul `type`, un cuvânt de tip `competitor` sau `topic` nu ajunge la brand, iar fiecare tip ajunge doar în tabelul lui.

## Competitorii în Listening (deciziile Y, 23 nov. 2026)

- **`competitor_mentions`**, cheia (tenant, brand, `keyword_id`, `native_id`): aceeași mențiune găsită de două cuvinte are câte un rând pe cuvânt; atribuirea la competitor și deduplicarea pe competitor se fac în SQL. `native_id` ca la brand (`h:` din URL, `s:` construit pentru mențiunile fără link, numerotate în cadrul cuvântului). Se păstrează `platform`, `url`, `published_at` și sentimentul Planable; **nu** textul și autorul (minimizare: nu sunt despre client și nu servesc unei numărători).
- **Limba mențiunilor competitorilor (deciziile AF, 24 nov. 2026):** `competitorMentionRow` trimite textul doar în `language_text`, o coloană de intrare. Triggerul `competitor_mentions_language` stabilește `language_detected` (`metrics.text_language_v1`: `ro` / `other` / NULL) și golește coloana înainte de scriere; constrângerea `competitor_mentions_text_not_stored` garantează că textul nu rămâne în tabel. La un reimport fără text, limba deja stabilită rămâne. Matricea de Competiție nu numără mențiunile competitorilor clar în altă limbă.
- **`competitor_trackers`** (`source = planable_listening`): fiecare cuvânt citit, cu `label` = textul lui, `covered_from` / `covered_to` (zilele colectate: prima zi se păstrează cât timp ferestrele de 35 de zile se ating; după o pauză reîncepe) și `complete` (toate paginile citite fără eroare). Se scriu după mențiuni.
- **Atribuirea:** un cuvânt aparține competitorului din setul în vigoare a cărui listă `listening_keywords` îl conține (fără diferență de majuscule); lista goală înseamnă numele competitorului. Validarea din `create_competitor_set_version` nu permite același cuvânt la doi competitori.
- **Rularea:** `sync_run` `planable_listening_competitors`, aceeași fereastră de 35 de zile. Fără cuvinte de tip `competitor`: `not_connected`, fără `sync_run`.

## Topicurile în Listening (deciziile AI, 25 nov. 2026)

- **`topic_mentions`**, cheia (tenant, brand, `keyword_id`, `native_id`): mențiunile cuvintelor de tip `topic` (de exemplu „dureri articulare”), ca la competitori: rețeaua, linkul, momentul, sentimentul Planable, interacțiunile și limba (textul trece doar prin `language_text`, golit de trigger). Fără text și fără autor.
- **`listening_trackers`** (`kind = topic`): fiecare topic citit, cu `label`, zilele acoperite și `complete`. Rularea: `sync_run` `planable_listening_topics`, aceeași fereastră de 35 de zile. Fără cuvinte de tip `topic`: `not_connected`, fără `sync_run`.
- **Acoperirea cuvintelor brandului:** rularea `planable_listening` scrie și ea `listening_trackers` (`kind = brand`), după mențiuni; rândurile nu intră în `rows_written`. O zi e confirmată când cel puțin un cuvânt „brand” a citit-o și toate cuvintele care au citit-o au fost complete: în graficul „Mențiuni pe zi”, o zi confirmată fără mențiuni e 0, una neconfirmată e lipsă.

## În aplicație: `brand_listening_overview` (deciziile AI)

RPC INVOKER (E8), `(p_brand_id, p_start, p_end)`, perioada de cel mult 401 zile. Întoarce, pentru ecranul Listening:

| Câmp | Ce e |
|---|---|
| `days`, `series`, `total` | Zilele perioadei și mențiunile pe zi, cu regula indicatorului „Mențiuni” (`mentions_count` v2: fără cele clar în altă limbă, cu conturile proprii). `null` = zi neconfirmată. |
| `platforms[]` | Pe `source_name`: mențiunile, `share` = 100 × mențiunile rețelei / `total`, seria pe zile cu aceleași goluri. |
| `engagement` | `value` = suma `mentions.engagement` pe aceleași mențiuni (NULL dacă nicio mențiune nu are valoare); `mentions_with_value`; `comparison` = aceeași sumă pe perioada anterioară de aceeași lungime (`metrics.comparison_period`); `change` = `metrics.change`. |
| `auto_sentiment` | Sentimentul **automat** Planable, neverificat, doar autorii externi: numărătorile, `shares` = 100 × categorie / (pozitive + neutre + negative), `net` = 100 × (pozitive − negative) / același total, `owned_excluded`. Nu înlocuiește `brand_mention_sentiment` (revizuit de om). |
| `top_voices[]`, `voices_basis` | Primii 10 autori externi (cheie: rețea + username, altfel nume, fără majuscule), după mențiuni, apoi interacțiuni. `voices_basis` spune câte mențiuni externe au autor. |
| `topics[]`, `topics_tracked` | Topicurile citite cel puțin o zi din perioadă: mențiunile (fără altă limbă), `status` (`partial` când acoperirea < 1 sau ultima citire incompletă), `coverage`, sentimentul automat, interacțiunile, rețelele. |
| `competition` | `null` fără set în vigoare la `p_end`. Altfel, pe brand și competitori: `mentions` și `share_of_voice` = celulele din `brand_competition` (aceleași valori, stări și motive ca în Competiție), sentimentul automat (competitorii: `competitor_mentions` deduplicate pe competitor, aceeași atribuire a cuvintelor), `tracked`; `platforms[]` cu mențiunile fiecărei entități și `brand_share` doar când share of voice-ul brandului are valoare. |

## Planable Competitors (deciziile Y, 23 nov. 2026)

Rutele au apărut în specificația publică după 12 oct. (recitită la 23 nov. 2026). Funcționează doar pentru paginile Instagram, Facebook, YouTube, TikTok și LinkedIn și cer add-on-ul Analytics (403 altfel). Planable avertizează că interacțiunile paginii proprii sunt cele raportate de platformă, iar ale competitorilor sunt colectate din pagina publică („baze ușor diferite”).

- **Descoperirea:** `GET /pages` (paginile conectate ale workspace-ului, pe platformele de mai sus), apoi `GET /pages/{id}/competitors` (`trackedCompetitorId`, `scrapedPageId`, `handle`, `displayName`, `platform`, `syncStatus`, `lastSyncedAt`). 400 = tipul paginii nu are competitor analytics: pagina se sare. Un profil cu `scrapedPageId` NULL nu e încă preluat de Planable: notă, fără date. Fără niciun profil urmărit: `not_connected`, fără `sync_run`.
- **`competitor_social_daily`**, cheia (tenant, brand, platform, `profile_id`, date): `profile_id` = `scrapedPageId` (competitor) sau ID-ul paginii Planable (`is_own`). `followers` din `/competitors/metrics` (punctul zilei, în fusul workspace-ului); `posts` și `engagement` = `posts` și `totalEngagement` din `/competitors/comparison` cerut pentru fereastra fiecărei zile (de la 00:00 la 23:59:59.999 în fusul workspace-ului, trimise în UTC). O intrare care nu e pagina proprie și nu e în lista urmărită nu se scrie. O valoare absentă rămâne NULL.
- **`competitor_trackers`** (`source = planable_competitors`): fiecare profil preluat, cu `label` = handle, `display_name`, zilele acoperite (ca la cuvinte) și `complete` (toate cererile paginii reușite).
- **Atribuirea:** profilul aparține competitorului din setul în vigoare a cărui listă `social_handles` conține handle-ul (fără @, fără majuscule); lista goală înseamnă profilurile al căror nume afișat sau handle are aceeași cheie ca numele competitorului (fără diacritice, majuscule, spații și semne).
- **Raportul de atribuire:** ambele rulări de competitori citesc setul în vigoare azi și scriu note `parser_note` cu `dimension = attribution` (și în jurnalul rulării): fiecare cuvânt sau profil → competitorul lui, cele neatribuite și competitorii fără nimic. Doar nume de branduri, cuvinte și handle-uri; nu schimbă statusul.
- **Rularea:** `sync_run` `planable_competitors`, fereastra de 35 de zile; ~37 de cereri pe pagină cu competitori (lista, seria, 35 de comparații zilnice).
- **În aplicație:** rândurile „Social public” din Competiție (postări pe săptămână, urmăritori, interacțiuni pe postare) și secțiunea „Concurență publică” din Social (`brand_social_competitors`).

## Tabele și reguli

Aceleași tabele și chei ca importul CSV (`docs/contracts/csv-planable-analytics.md`, `csv-planable-listening.md`); proveniența API e `collection_method = 'api'`, `source_id` (conexiunea `planable` a brandului) și `sync_run_id` (migrația `20261012120000_import_tables_api_provenance.sql`).

| Tabel | Cheie naturală | Din API |
|---|---|---|
| `social_daily` | tenant, brand, platform, account_id, date | `account_id` = ID-ul paginii Planable; `date` = ziua lui `fetchedAt` în fusul workspace-ului (**de confirmat**: documentația spune „snapshots”, nu „zile”); mai multe snapshoturi în aceeași zi → ultimul |
| `social_posts` | tenant, brand, platform, account_id, post_id, snapshot_date, metrics_scope | `post_id` = ID-ul postării Planable; `metrics_scope = 'lifetime'`; `snapshot_date` = ziua lui `fetchedAt`; `published_at` = `scheduledAt` |
| `mentions` | tenant, brand, native_id | `native_id` = `h:` + primele 32 de caractere hex din SHA-256(url), **la fel ca importul CSV fără ID**, ca aceeași mențiune să nu se dubleze între CSV și API. Fără link: cheie construită, `s:` (vezi „Mențiuni fără link”) |

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

**Cont propriu (D-22):** `author.name` / `author.username` ale mențiunii se compară cu numele paginilor workspace-ului (`GET /pages`, aceeași platformă) și dau `author_is_owned`.

**Autorul și interacțiunile (deciziile AI, 25 nov. 2026):** la mențiunile brandului se păstrează și `author_name` / `author_username` (curățate, max. 256 de caractere; gol → NULL), pentru „Voci principale” și feed. Revine asupra D-22: autorii pot fi persoane fizice, deci sunt date personale, citite doar cu acces la brand (RLS neschimbat). Poza de profil nu se păstrează. `engagement` → `mentions.engagement` doar când e un număr întreg nenegativ; altfel NULL (nu zero). La competitori și topicuri, autorul tot nu se păstrează.

**Mențiuni fără link (deciziile R, 11 nov. 2026):** Planable trimite mențiunile de pe web fără `url` și fără `text` (confirmat la rularea reală: au `author.name`, `engagement`, `platform`, `publishedAt`, `sentiment`). O mențiune fără link, cu `publishedAt` valid, se scrie cu `url` NULL și `native_id` = `s:` + primele 32 de caractere hex din SHA-256 peste rețea, autor (nume și username, litere mici), momentul publicării (ISO, UTC), hash-ul textului (dacă există) și numărul de ordine printre mențiunile identice (1, 2, …). Autorul intră doar în hash. Aceeași mențiune găsită de două cuvinte urmărite se scrie o dată: pe fiecare identitate rămâne cea mai lungă listă dintre cuvinte. Fiecare rețea primește o notă `parser_note` cu `dimension = mentions_without_link`: „1068 mențiuni scrise din web fără link de la sursă (1068 și fără text); cheia e construită din rețea, autor și dată”. În aplicație, mențiunile fără link și fără text sunt numărate la „Mențiuni”, dar feed-ul nu le afișează și nu intră la revizuire.

**Limba mențiunilor (deciziile AC, 23 nov. 2026):** Planable nu trimite limba, iar conectorul nu o deduce. `mentions.language_detected` e o coloană generată în baza de date din `text` (`metrics.text_language_v1`: `ro` / `other` / NULL). Listening (feed și distribuție) arată implicit doar mențiunile care nu sunt clar în altă limbă; `language`, când vine din CSV, are întâietate. Din 24 nov. 2026, aceeași regulă se aplică și indicatorului `mentions_count` (versiunea 2, deciziile AE). Conectorul nu se schimbă.

**Mențiuni sărite:** o mențiune nu se scrie cu un URL care nu începe cu `http(s)` sau fără `publishedAt` valid; nu se deduce nimic în locul lor. Cele sărite se numără pe rețea (`platform`) și motiv (URL care nu începe cu http(s), fără dată de publicare validă, fără URL și fără dată) și devin câte o notă `parser_note` cu `dimension = mentions_skipped` în `sync_runs.errors`, de forma „3 mențiuni sărite din news: URL care nu începe cu http(s)”. Notele nu schimbă statusul rulării și nu conțin URL-ul sau textul mențiunii. O mențiune sărită, găsită de două cuvinte urmărite, se numără de două ori. `collect.ts` scrie ambele feluri de note și în jurnalul rulării.

Fiecare grup are și o a doua notă, cu **numele câmpurilor** pe care le aveau mențiunile sărite în răspunsul Planable (inclusiv cele nedescrise în schemă; obiectele deschise un nivel, de ex. `author.name`): „câmpurile lor (web): cu valoare: …; goale: url; cu link http(s): …”. Numărul din paranteză apare când câmpul nu e în toate mențiunile grupului. Se scriu doar nume, niciodată valori. Scopul e diagnosticul: dacă `url` vine gol, nota arată dacă linkul stă în alt câmp.

**Sentiment:** `positive` / `negative` / `neutral` din API; lipsă → `unknown`. **Corecțiile umane (`sentiment_reviewed_by`) au prioritate** și nu se suprascriu (ca la CSV).

## Rulare

- `.github/workflows/planable-weekly.yml`, marți 04:00 UTC, **dezactivat** până la `CONNECTOR_PLANABLE_ENABLED = true`; `workflow_dispatch` activ oricând. Local: `npm run collect:planable`.
- Fereastra: ultimele **35 de zile până ieri** (Europe/Bucharest), ca la ceilalți conectori.
- Ritm: cel mult 4 cereri pe secundă; retry la 429/5xx după 5 s, 30 s și 2 min (Retry-After are prioritate); fără retry pe 401/403. Plafon de siguranță: 5.000 de cereri pe rulare.
- Până la cinci `sync_runs` per brand: `planable_analytics` (social, cu acoperire = zile cu `social_daily` / 35), `planable_listening` (mențiuni; zilele citite în `listening_trackers`), `planable_listening_competitors` (doar cu cuvinte de tip `competitor`), `planable_listening_topics` (doar cu cuvinte de tip `topic`) și `planable_competitors` (doar cu profiluri urmărite în Planable Competitors). O rulare cu orice eroare nu e niciodată `succeeded`.

## De confirmat la prima rulare reală

1. Un snapshot de pagină = o zi? (`fetchedAt` față de ziua măsurată.)
2. `totalFollowers` față de `followers` la Facebook; `views` față de `impressions` la Facebook și Threads.
3. Dimensiunea maximă a paginii la `GET /pages` și `GET /posts` (folosim 50).
4. Limitele reale de apeluri.
5. `type` la cuvinte: confirmat în specificația din 23 nov. (`brand`, `topic`, `competitor`); de văzut doar că API-ul respectă filtrul (codul filtrează și local).
6. Planable Competitors: că `id` din `/competitors/metrics` și `/comparison` e `scrapedPageId` (codul cade pe handle dacă nu), că `startDate`/`endDate` au prioritate față de `range`, și ce înseamnă `posts` și `totalEngagement` pe fereastra unei zile (presupunem: postările publicate în zi și interacțiunile lor).
7. Forma lui `engagement` la mențiuni: număr (cum arată specificația) sau obiect. Un obiect devine NULL, fără notă; de verificat în `mentions.engagement` după prima rulare cu AI.
