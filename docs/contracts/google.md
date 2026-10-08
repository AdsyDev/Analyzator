# Contract Google: GA4 Data API și Search Console API

Surse (citite 2026-10-08):
[GA4 `runReport`](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport),
[`checkCompatibility`](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility),
[schema API GA4](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema),
[Search Analytics `query`](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).
Biblioteci: `@google-analytics/data`, `@googleapis/searchconsole`, `google-auth-library`.
Fixtures: `tests/fixtures/google/docs-derived/` (**derivate din documentație, neconfirmate**; niciun payload real încă).

## Configurare (`source_connections`)

| provider | brand_id | external_account_id | token în Vault | timezone |
|---|---|---|---|---|
| `google_service_account` | NULL (per tenant) | etichetă liberă (de ex. adresa service account-ului) | **da**: un singur JSON de service account per tenant | — |
| `ga4` | brandul | ID-ul proprietății GA4 (numeric, sau `properties/NNN`) | nu | fusul proprietății GA4 |
| `gsc` | brandul | `site_url`: `https://…/` sau `sc-domain:…` | nu | (ignorat: GSC e în PT) |

- Service account-ul trebuie adăugat ca utilizator cu drept de citire pe proprietatea GA4 și pe proprietatea Search Console.
- JSON-ul se setează cu `npm run set-source-token` (conexiunea `google_service_account`), nu din fișiere sau din mediu.
- **Fără credential** (conexiune lipsă, `missing` sau `invalid`): conexiunile `ga4`/`gsc` ale tenantului raportează `not_connected`, fără excepție, fără `sync_run`, fără cereri.
- Un `403` pe o proprietate înseamnă „service account-ul nu are acces la proprietatea asta”; credentialul tenantului nu se marchează invalid.

## GA4: rapoarte

| Raport | Dimensiuni | Metrici | Tabel |
|---|---|---|---|
| zilnic | `date`, `sessionDefaultChannelGroup`, `sessionSourceMedium`, `landingPagePlusQueryString` | `sessions`, `activeUsers`, `engagedSessions`, `keyEvents` | `web_daily` |
| key events | `date`, `eventName` | `keyEvents` | `web_key_events` |
| totaluri | (niciuna) | `sessions`, `engagedSessions`, `keyEvents` | (doar reconciliere) |
| utilizatori activi | (niciuna; **fără `date`**), câte unul per interval | `activeUsers` | `web_active_users_interval` |

- Fereastra: ultimele **35 de zile până ieri**, în fusul proprietății (reimport al sursei mutabile, spec cap. 9).
- Paginare: `limit` 100.000, `offset` până la `rowCount`; peste 20 de pagini, `ga4_too_many_pages`.
- **`checkCompatibility` rulează înainte de fiecare `runReport`** (o dată per combinație). Metrici incompatibile: se elimină din cerere și rămân NULL (`ga4_incompatible_metrics`). Dimensiune incompatibilă: raportul se sare (`ga4_incompatible_dimensions`). Ambele în `sync_runs.errors`; run-ul nu e `succeeded`.
- Din `metadata` se raportează: `dataLossFromOtherRow` (`ga4_data_loss_other_row`), `samplingMetadatas` (`ga4_sampled`), `subjectToThresholding` (`ga4_thresholding`), `timeZone` diferit de conexiune (`timezone_mismatch`).
- Valorile metricilor vin ca **string**; absente → NULL. `"0"` primit de la sursă = 0 real.
- `activeUsers` din raportul pe zile se stochează ca `active_users_not_additive` și **nu** intră în metrici.
- **Intervale pentru utilizatori activi** (nesumabile): ultima săptămână completă (luni–duminică), ultimele 4 și 13 săptămâni, luna calendaristică precedentă, plus perioada anterioară de aceeași lungime pentru fiecare. Un interval personalizat nu are raport: `unavailable`.

## Search Console: rapoarte

| Raport | Dimensiuni | Tabel |
|---|---|---|
| totaluri pe zi și device | `date`, `device` | `search_daily` (include interogările anonimizate) |
| totaluri pe zi | `date` | (doar reconciliere) |
| detalii | `date`, `query`, `page`, `device` | `search_queries` (nu însumează la total) |

- Datele sunt interpretate și întoarse în **PT** (`America/Los_Angeles`); `source_timezone` pe fiecare rând.
- `dataState = final`; `type = web`; `rowLimit` 25.000, paginare `startRow` până la o pagină incompletă; plafon 40 de pagini (`gsc_truncated`).
- Zilele fără date lipsesc din răspuns: sunt **neconfirmate**, nu zero.
- Poziția medie GSC ≠ rankul SEOmonitor; păstrează numele complet.

## Proveniență (pe fiecare rând)

`source_id` (conexiunea brandului), `sync_run_id`, `collected_at`, `collection_method = 'api'`, `payload_hash` (SHA-256 al paginii brute), `window_days`, `source_timezone`, `schema_version`, `data_state` (GSC). Chei unice naturale: vezi migrația `20261008140000_google_ga4_gsc.sql`. Textele lungi (landing page, query, page) intră în cheie prin `md5`, verificat de CHECK.

## Acoperire și statusul run-ului

`sync_runs.coverage`: `web_daily`, `web_key_events`, `web_active_users_interval`, `search_daily`, `search_queries` (zile cu rânduri / zile așteptate, sau intervale scrise / intervale cerute). Run-ul e `succeeded` doar fără erori și cu acoperire 100%; altfel `partial`; `failed` la acces refuzat, configurare invalidă sau zero rânduri cu erori.

## Reconcilierea

`source_reconciliations`: totalul nostru (suma rândurilor scrise) față de totalul raportat de sursă pe **același interval, fus orar și proprietate**. Toleranță 1% (GA4) și 0,5% (GSC). Stări: `match`, `within_tolerance`, `mismatch` (devine eroare în `sync_runs`), `incomparable` (interval, fus sau proprietate diferite, sau un total lipsește). Vizibilă doar agenției.

## Observații pentru `metrics.compute`

| View | metric_key | Agregare | Coloane |
|---|---|---|---|
| `web_metric_observations` | `ga4_sessions`, `ga4_engaged_sessions` (din `web_daily`), `ga4_key_events` (din `web_key_events`) | `sum` | `date`, `value` |
| `web_active_users_observations` | `ga4_active_users` | `interval_report_only` | `start`, `end`, `value` |
| `search_metric_observations` | `gsc_clicks`, `gsc_impressions` | `sum` | `date`, `value` |
| | `gsc_ctr` | `ratio` (×100) | `date`, `numerator` = clicks, `denominator` = impressions |
| | `gsc_average_position` | `weighted_mean` | `date`, `value` = poziția zilei (ponderată pe device-uri), `weight` = impressions |

Toate sunt `security_invoker`, deci RLS-ul tabelelor se aplică celui care citește. Un `value` NULL rămâne NULL: `metrics.compute` îl exclude și raportează motivul.

## RLS

Citire pentru oricine are acces la brand (inclusiv client), cu excepția `source_reconciliations` (doar agenția). Scriere doar prin service role (worker), cu verificarea tenantului înainte și după upsert.

## Rulare

`.github/workflows/google-weekly.yml`: marți 04:00 UTC, **dezactivat** până la `CONNECTOR_GOOGLE_ENABLED = true`; `workflow_dispatch` activ oricând (`only`: `ga4` sau `gsc`). Local: `npm run collect:google [-- --only ga4|gsc]`.
