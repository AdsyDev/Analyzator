# Contract SEOmonitor (API 3.0)

Sursa: [SEOmonitor API 3.0](https://api-docs.seomonitor.com), paginile markdown din [`llms.txt`](https://api-docs.seomonitor.com/llms.txt) (schemele OpenAPI ale fiecărei rute), citite 2026-10-08. Fixtures: `tests/fixtures/seomonitor/docs-derived/` („derivat din documentație, neconfirmat"). **Nicio rulare reală încă.**

## Din documentație

- **URL de bază:** `https://apigw.seomonitor.com/v3`. **Autentificare:** `Authorization: <token>` (JWT brut, **fără** `Bearer`). Toate rutele folosite sunt `GET`.
- **Limite:** 10 cereri/secundă, 1.000 de rânduri per cerere, 10.000 de cereri pe zi. La depășire: 429, cu `{"error": {"message", "details"}}`. Ora la care se resetează cota zilnică **nu e documentată**: o contorizăm pe ziua UTC (`provider_api_calls`) și o verificăm din practică.
- **Erori:** 400, 401 (token invalid sau revocat), 403, 404, 429, 500, 50x.
- **Paginare:** `limit` (max. 1.000; campaniile max. 100) și `offset`. La `keywords/aio`, `limit` numără keywords **scanate**: pagina poate avea mai puține rânduri, deci se avansează cu `limit` până la o pagină goală (documentat).
- **Grupuri speciale:** `0` toate, `-1` **Brand folder**, `-2` negrupate, `-3` obiectivul Forecast.
- **`ai_search_llm` / `gpt_provider`:** `openai`, `gemini`, `perplexity`. Un motor neactivat **nu dă eroare**, ci întoarce gol sau zero: motoarele activate se citesc întâi din `ais/stats` (`engines[].enabled`).
- **AI Overview:** `rank = 100` înseamnă „not present" (documentat).

## Rute folosite

| Rută | Paginare | Folosire |
|---|---|---|
| `GET /dashboard/v3.0/campaigns/tracked` | limit 100, până la pagină scurtă | validateAccess (`limit=1`), descoperirea campaniilor, domeniul și poziția maximă urmărită |
| `GET /rank-tracker/v3.0/groups` | — | grupuri (imbricate în foldere) → mapare |
| `GET /rank-tracker/v3.0/keywords` | limit 1.000, până la pagină scurtă | keywords pe grup; `group_id=-1` → `is_branded` |
| `GET /rank-tracker/v3.0/keywords/daily-ranks` | idem | rankuri zilnice desktop și mobile; `get_archive=true` → keywords arhivate |
| `GET /rank-tracker/v3.0/groups/daily-visibility` | — | visibility zilnică pe grup |
| `GET /rank-tracker/v3.0/keywords/ais` | limit 1.000, **până la pagină goală** | răspunsuri AI Search (`content_format=markdown`, `include_raw_content=true`), citări |
| `GET /rank-tracker/v3.0/keywords/daily-ranks/ais` | până la pagină scurtă | rankuri AI Search **săptămânale** (`window_days = 7`) |
| `GET /rank-tracker/v3.0/keywords/competition/ais` | până la pagină scurtă | prezența concurenților în AI Search |
| `GET /rank-tracker/v3.0/groups/daily-visibility/ais-mentions` | — | visibility pe mențiuni de brand |
| `GET /rank-tracker/v3.0/groups/daily-visibility/ais-citations` | — | visibility pe citări |
| `GET /rank-tracker/v3.0/ais/stats` | — | motoarele activate (fără `gpt_provider`) și statistici per motor (`gpt_provider=<motor>`) |
| `GET /rank-tracker/v3.0/keywords/aio` | limit 1.000, **până la pagină goală** | răspunsuri Google AI Overview desktop și mobile |

Pentru `keywords/ais` documentația nu spune ce numără `limit`: folosim conservator „până la pagină goală" (un apel în plus).

**Diferență față de documentație:** pentru `daily-ranks`, `groups/daily-visibility`, `competition/ais`, `ais-mentions` și `ais-citations`, schema descrie rădăcina ca un singur obiect. Parserul acceptă și obiect, și listă.

## Maparea grupurilor pe branduri

- `seomonitor_group_mappings` e configurare de agenție: `agency_admin` creează versiuni, nimic nu se modifică, totul e auditat.
  - Versiunea curentă = cea mai mare versiune cu `effective_from` ≤ ziua rulării.
  - `mapping_kind` poate fi:
    - `brand` (cu `brand_id`, `brand_type` și opțional `is_primary_visibility`);
    - `multi_brand`: rezultatele **nu** se atribuie automat;
    - `excluded`: ignorat intenționat.
- Ce intră în **coada de verificare** (`seomonitor_mapping_queue`, vizibilă rolurilor de agenție):
  - un grup descoperit fără mapare (`unmapped`) nu intră în niciun brand;
  - un grup `multi_brand` (`multi_brand`) rămâne neatribuit;
  - un grup mapat care nu mai apare în SEOmonitor (`mapped_group_missing`), iar run-ul brandului devine `partial`.
- Datele se cer **per grup mapat** (`group_id=…`), deci un rând aparține brandului prin grupul lui (`attributed_group_id`, `mapping_version`).
- `keyword_groups.brand_type` vine din mapare. `keywords.is_branded` vine din listarea `group_id=-1` (Brand folder, documentat).

## Tabele și reguli

| Tabel | Cheie naturală (upsert) | Note |
|---|---|---|
| `keyword_groups` | tenant, brand, conexiune, campanie, group_id | tip `group`/`folder`/`smart`, `brand_type` |
| `keywords` | tenant, brand, conexiune, keyword_id | `status` active/archived; `group_ids`, `previous_group_ids`, `group_ids_changed_at` (trigger) |
| `rank_observations` | tenant, brand, keyword_id, device, date, domain | `rank` + `rank_status` + `rank_original`, `search_volume`, `keyword_status`, URL doar pentru ultima zi (landing page curentă) |
| `seomonitor_group_visibility_daily` | tenant, brand, campanie, grup, date, device, domain | `visibility` + `visibility_original`, `avg_rank`, `is_primary` |
| `ai_answers` | tenant, brand, engine, keyword_id, crawl_at, **device** | conținut sanitizat, citări, prezență, rank, sentiment, `status` |
| `ai_answer_originals` | answer_id | HTML brut al snapshotului, **doar roluri de agenție** |
| `ai_brand_observations` | tenant, brand, engine, keyword_id, crawl_at, device, domeniu observat | brandul propriu (rankuri săptămânale) și concurenții |
| `ai_citations` | tenant, brand, engine, keyword_id, crawl_at, device, url | poziția în listă, `is_own_domain` |
| `seomonitor_ai_visibility_daily` | tenant, brand, campanie, grup, date, engine, metric | `brand_mentions` / `site_citations` |
| `seomonitor_ai_engine_stats` | tenant, brand, campanie, grup, engine, perioadă | `presence_rate`, `source_citations`, `avg_position`, sentiment, `missing_data` |

**Abatere de la cheia cerută:** pentru AI, cheia include și `device`. Google AI Overview are răspunsuri separate desktop și mobile pentru același keyword și aceeași zi. Pentru AI Search, `device = 'none'`.

Proveniență pe fiecare rând: `source_id`, `sync_run_id`, `collected_at`, `collection_method = 'api'`, `payload_hash` (SHA-256 al paginii brute), `window_days`, `schema_version = 'docs-2026-10-08'`. RLS ca la metrici: citire cu acces la brand, scriere doar prin worker (service role), cu verificarea tenantului înainte și după upsert.

### Null, zero și stări distincte

- O valoare absentă (`null`, `""`, câmp lipsă) → **NULL**. `0` rămâne `0` (visibility 0, search volume 0).
- **Rank Google zilnic:** documentația **nu spune** ce întoarce un keyword care nu se clasează.

  | Valoare primită | `rank` | `rank_status` |
  |---|---|---|
  | lipsă sau `null` | NULL | `not_ranked` |
  | ≥ poziția maximă urmărită a campaniei (de ex. 100) | NULL | `at_tracking_limit` (**ambiguu**, nu se interpretează ca poziția 100) |
  | ≤ 0 sau nenumeric | NULL | `invalid` |

  `rank_original` păstrează mereu valoarea primită.
- **Rank AI Overview** `100` → NULL (documentat „not present"). **Rank AI Search** se păstrează doar când brandul e prezent.
- **Keyword arhivat** (`status = archived`, din `get_archive=true`), **rank absent** (`rank` NULL cu `rank_status`) și **grup schimbat** (`group_ids_changed_at`, `previous_group_ids`; observațiile vechi își păstrează `attributed_group_id`) sunt stări separate.
- **Răspunsuri AI**, după câmpul explicit `my_brand_present` / `brand_presence` / `competitor_brand_present`:

  | Valoare | `status` |
  |---|---|
  | `true` | `brand_present` |
  | `false` | `brand_absent` |
  | lipsă | `technical_error` (absența nu se deduce) |

  **`refusal` nu se atribuie automat:** documentația nu expune un semnal de refuz al motorului. Valoarea există în schemă pentru un câmp documentat ulterior sau pentru revizuire umană.
- **Concurenți (`competition/ais`):** documentația descrie `competitors[].rank` ca poziție organică Google, dar ruta ca poziții de citare AI. Ambiguu: `rank` NULL, valoarea în `rank_original`. Fără dată per observație: `crawl_at = end_date`, `window_days` = lungimea intervalului.

### Unitatea pentru visibility: DE CONFIRMAT

Documentația e contradictorie: `groups/daily-visibility` arată `0.53` (fracție?), iar `campaigns/tracked` arată `53.3` (procent?). Valorile se stochează exact cum vin (`visibility_original`), fără conversie. Definițiile `seomonitor_visibility` și `seomonitor_visibility_latest` rămân `draft` în registru (unitate `score`) până la un payload real.

## Observații pentru metrics.compute

- `public.seomonitor_metric_observations` (`security_invoker`):
  - `seomonitor_visibility` și `seomonitor_visibility_latest`: din grupul principal al brandului (`is_primary`), cu `weight = window_days` (o observație zilnică = o zi; medie în perioadă);
  - `seomonitor_keywords_top3` și `seomonitor_keywords_top10`: numărul de keywords cu rank 1–3 / 1–10 pe zi; rank NULL nu contează.
  - Coloana `device` alege dispozitivul. Registrul are o singură cheie per metrică; dispozitivul vine din configurarea dashboardului.
- `public.seomonitor_ai_answer_states`: `collection_ok`, `engine_refused` și `brand_present` per răspuns, pentru `metrics.ai_rate_inputs`. Erorile tehnice nu intră la numitor.

## Rulare

- `.github/workflows/seomonitor-weekly.yml`: marți la 04:00 UTC, **dezactivat** până la `CONNECTOR_SEOMONITOR_ENABLED = true`; `workflow_dispatch` activ. Vezi `docs/runbook.md` (inclusiv nota DST).
- Reimport: ultimele **35 de zile**, până ieri (Europe/Bucharest).
- Retry: 1, 5 și 15 minute, cu jitter ±20%; `Retry-After` are prioritate. **Fără retry pe 401/403**: un 401/403 marchează tokenul `invalid` și oprește rularea.
- Un `sync_run` per brand mapat, cu `coverage` (zile acoperite / 35 pentru rankuri, visibility și răspunsuri AI). **O rulare cu orice eroare nu e niciodată `succeeded`.** Notele de parser despre câmpuri necunoscute nu schimbă statusul.
- Bugetul: 10.000 minus apelurile de azi (UTC); sub 50 rularea nu pornește. La epuizare, `partial`.

## De confirmat la prima rulare reală

1. Unitatea pentru visibility (fracție sau procent).
2. Valoarea rankului zilnic pentru „nu se clasează" (`null`? `100`? `101`?).
3. Ce numără `limit` la `keywords/ais`.
4. Rădăcina listă sau obiect pentru rutele de mai sus.
5. Existența unui semnal de refuz AI.
6. Ora de resetare a cotei zilnice.
7. Ce ID are folderul Brand în lista de grupuri.
