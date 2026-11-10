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
- JSON-ul se setează din pagina site-ului → cardul GA4 sau Search Console → pasul 1 (fișierul e verificat în browser și trimis o singură dată funcției `source-credentials`) sau cu `npm run set-source-token` (conexiunea `google_service_account`); niciodată din fișiere sau din mediul workerului.
- **Fără credential** (conexiune lipsă, `missing` sau `invalid`): conexiunile `ga4`/`gsc` ale tenantului raportează `not_connected`, fără excepție, fără `sync_run`, fără cereri.
- Un `403` pe o proprietate înseamnă „service account-ul nu are acces la proprietatea asta”; credentialul tenantului nu se marchează invalid.
- **O singură proprietate Search Console per brand**, de preferat **Domain property** (`sc-domain:…`): include toate protocoalele și subdomeniile, deci e sursa completă (D-27). URL prefix doar când clientul nu are Domain property. Cheia rândurilor (`search_daily`, `search_queries`) nu conține proprietatea: două proprietăți active pe același brand nu s-ar aduna, s-ar suprascrie una pe alta. Pagina site-ului permite o singură conexiune `gsc`.
- `external_account_id` nu se schimbă pe loc (utilizatorii nu au drept de UPDATE pe coloană): proprietatea se schimbă arhivând conexiunea veche și adăugând una nouă, apoi reimportând istoricul (procedura din `docs/runbook.md`).

## GA4: rapoarte

| Raport | Dimensiuni | Metrici | Tabel |
|---|---|---|---|
| zilnic | `date`, `sessionDefaultChannelGroup`, `sessionSourceMedium`, `landingPagePlusQueryString` | `sessions`, `activeUsers`, `engagedSessions`, `keyEvents` | `web_daily` |
| key events | `date`, `eventName` | `keyEvents` | `web_key_events` |
| totaluri | (niciuna) | `sessions`, `engagedSessions`, `keyEvents` | (doar reconciliere) |
| utilizatori activi | (niciuna; **fără `date`**), câte unul per interval | `activeUsers` | `web_active_users_interval` |

- Fereastra: ultimele **35 de zile până ieri**, în fusul proprietății (reimport al sursei mutabile, spec cap. 9). Search Console: aceleași 35 de zile, dar terminate cu **2 zile înainte de ieri** (PT, `GSC_FINAL_LAG_DAYS`), pentru că datele `final` apar cu 2–3 zile întârziere (D-25). Zilele sărite intră la rularea următoare.
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

## Reimportul istoricului (Search Console și GA4)

`npm run collect:google -- --only gsc --brand <uuid> --from YYYY-MM-DD` (sau `google-weekly` → Run workflow cu `only`, `brand`, `from`). Folosit când se schimbă proprietatea unui site, ca toată seria să vină din aceeași proprietate (D-27).

- O singură sursă și un singur brand: altfel conectorul refuză înainte de orice citire. `from` nu poate fi mai vechi de 16 luni (`GSC_HISTORY_MONTHS`): mesajul spune cea mai veche zi permisă.
- Intervalul de la `from` până la sfârșitul ferestrei obișnuite se împarte în ferestre de 35 de zile, rulate **de la cea mai veche**; ultima e chiar fereastra obișnuită. Fiecare fereastră are `sync_run`-ul ei, reconcilierea ei și acoperirea raportată la zilele ei (prima poate fi mai scurtă). Ultima rulare rămâne astfel cea de zi cu zi, iar starea sursei (`source_status`, după ultima rulare) nu arată o fereastră veche.
- La prima fereastră `failed` (de ex. `access_denied` pe proprietatea nouă), reimportul se oprește; datele existente rămân. Se reia cu aceeași comandă (upsert idempotent).
- Rândurile se scriu pe aceleași chei naturale: o zi reimportată își înlocuiește rândurile, nu le dublează. `source_id` devine conexiunea nouă.
- **GA4 (H-3, 10 nov. 2026):** aceeași comandă cu `--only ga4` reimportă `web_daily` și `web_key_events` pe aceleași ferestre, cel mult 16 luni în urmă (`GA4_HISTORY_MONTHS`, limita noastră de volum, nu a furnizorului). Utilizatorii activi (`web_active_users_interval`) sunt rapoarte pe intervale relative la azi: îi aduce doar fereastra obișnuită, ultima din reimport; ferestrele vechi nu îi cer și nu raportează acoperire pentru ei. Reconcilierea rulează pe fiecare fereastră. `--from` cere acum o singură sursă (`--only gsc` sau `--only ga4`).

**Verificarea și trecerea mai multor site-uri:** `npm run gsc:properties` (sau workflow-ul `gsc-properties`). Fără `--apply`, doar citește: conexiunile `gsc`, site-urile active și proprietățile văzute de cheia clientului (aceeași listare ca selectorul, `discover`; o cerere per client). Acțiunea pe fiecare site e `switch`, `connect`, `keep` sau ceva de lămurit. Cu `--apply --brand <uuid>… [--from …]`, trece doar site-urile `switch` / `connect`, numai când cheia vede `sc-domain:<domeniul site-ului>` și proprietatea veche ține de același domeniu, apoi rulează colectarea de mai sus. Toate site-urile se verifică înainte de prima scriere. Scrierile filtrează pe `tenant_id`, `brand_id` și `provider`; dacă adăugarea conexiunii noi eșuează, cea veche se reactivează.

**Istoricul vechi dintr-o proprietate arhivată:** Domain property are date doar de când a fost creată (D-27). `npm run gsc:properties -- --history --brand <uuid>… [--from …]` (sau `mode = history`) aduce zilele dinaintea primei zile cu date de la proprietatea activă (din `search_daily`) din singura proprietate URL prefix arhivată a domeniului, pe care cheia trebuie s-o vadă încă; `from` implicit = cea mai veche zi permisă (16 luni).

- Ferestrele acoperă exact [`from`, ziua dinaintea proprietății active], de la cea mai veche; fiecare are `sync_run`-ul ei pe **conexiunea arhivată**, iar rândurile o au ca `source_id` (proveniența rămâne cea reală). Conexiunea rămâne arhivată.
- Niciun rând din afara ferestrei cerute nu se scrie (`normalize_out_of_window`, rândul se sare), deci zilele proprietății active nu se rescriu, chiar dacă API-ul ar trimite mai mult. Totalurile pentru reconciliere se iau tot doar din fereastră.
- La final rulează fereastra obișnuită pe proprietatea activă: ultima rulare rămâne cea de zi cu zi (`source_status`). Oprire la prima fereastră `failed`; reluarea e sigură (upsert).
- Refuz înainte de orice scriere: site-ul nu e pe Domain property, proprietatea activă nu are date, zero sau mai multe proprietăți URL prefix arhivate ale domeniului, cheia nu mai vede proprietatea arhivată. Toate site-urile cerute se verifică înainte de prima scriere.
- Verificarea (`gsc:properties` fără argumente) arată, pe fiecare site, prima și ultima zi a proprietății active și a celor arhivate, și dacă proprietățile arhivate au rânduri din prima zi a celei active încolo („zile amestecate”, trebuie `nu`).

## Proveniență (pe fiecare rând)

`source_id` (conexiunea brandului), `sync_run_id`, `collected_at`, `collection_method = 'api'`, `payload_hash` (SHA-256 al paginii brute), `window_days`, `source_timezone`, `schema_version`, `data_state` (GSC). Chei unice naturale: vezi migrația `20261008140000_google_ga4_gsc.sql`. Textele lungi (landing page, query, page) intră în cheie prin `md5`, verificat de CHECK.

## Acoperire și statusul run-ului

`sync_runs.coverage`: `web_daily`, `web_key_events`, `web_active_users_interval`, `search_daily`, `search_queries` (zile cu rânduri / zile așteptate, sau intervale scrise / intervale cerute). Run-ul e `succeeded` fără erori (D-25: zilele fără rânduri nu îl mai fac parțial; GA4 nu trimite zilele fără trafic, iar Search Console zilele nefinalizate, iar acoperirea rămâne în `coverage` și metricile o aplică singure); `partial` cu erori sau cu zero rânduri; `failed` la acces refuzat, configurare invalidă sau zero rânduri cu erori.

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
