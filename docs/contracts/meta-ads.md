# Contract Meta Ads (Marketing API, Graph API v26.0)

Surse: [versiunile Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions/) (v26.0, lansată 2026-07-29, cea mai nouă la 2026-10-12), documentația Marketing API pentru Ad Account, Insights și „Handling errors”. Răspunsurile de test sunt construite după documentație, în `connectors/meta/meta.test.ts` („derivat din documentație, neconfirmat”). **Nicio rulare reală încă.**

## Configurare (`source_connections`)

| provider | brand_id | external_account_id | token în Vault |
|---|---|---|---|
| `meta_account` | NULL (per client) | etichetă liberă (de ex. Business Manager-ul) | **da**: tokenul unui system user cu `ads_read` |
| `meta_ads` | brandul | contul de ads, `act_1234567890` (sau doar cifrele) | nu |

- Fără token (lipsă sau invalid): conexiunile `meta_ads` ale clientului raportează `not_connected`, fără `sync_run` și fără cereri.
- **Token refuzat** (cod 190 sau 102): tokenul se marchează `invalid`; celelalte conturi ale clientului nu mai fac cereri în rularea respectivă.
- **Fără drept pe un cont** (cod 10, 200, 294 sau HTTP 403): eșuează doar brandul acela (`permission_denied`); tokenul nu se marchează invalid.

## Cereri

1. `GET /act_{id}?fields=id,name,currency,timezone_name`: moneda și fusul orar al contului.
2. `GET /act_{id}/insights?level=ad&time_increment=1&time_range={"since","until"}&fields=…&limit=500`, paginat cu `paging.next`. Din `paging.next` se scoate `access_token`: tokenul circulă doar în antetul `Authorization`.

Fereastra: ultimele **35 de zile până ieri, în fusul contului**.

## Maparea în `paid_daily` (aceleași chei ca importul CSV Meta Ads)

| Coloană | Din API |
|---|---|
| `source` | `meta_ads` |
| `account_id` | `account_id` (cifrele contului) |
| `campaign_id` / `ad_group_id` / `ad_id` | `campaign_id` / `adset_id` / `ad_id` |
| `date` | `date_start` (ziua în fusul contului) |
| `spend` | `spend` (string zecimal) |
| `impressions`, `clicks` | `impressions`, `clicks` (string întreg); `clicks` = toate clickurile, deci `click_type = 'all'` |
| `conversions` | **NULL**: „Results” depinde de obiectivul campaniei; acțiunea de conversie nu se alege implicit (de decis per brand) |
| `currency` | `currency` al contului; o monedă diferită pe rând devine notă |
| `breakdown_signature`, `attribution_config` | `none`, `unspecified` |
| proveniență | `collection_method = 'api'`, `source_id` = conexiunea `meta_ads`, `sync_run_id`; `import_batch_id` și `row_number` NULL |

O valoare absentă rămâne NULL, nu 0. Un rând al altui cont în raport oprește rularea (izolare).

## Erori și limite

Meta răspunde la erori cu `{ error: { code, message, type } }`, de regulă HTTP 400, deci clasificarea citește `code`:
- **190, 102** → `access_denied` (token);
- **10, 200, 294** → `permission_denied`;
- **4, 17, 32, 613, 80000–80014** → `rate_limited`, cu retry după 10 s, 60 s și 5 min (`Retry-After` are prioritate);
- **1, 2** sau 5xx → `server_error`, cu retry;
- restul → `bad_request`, fără retry.

Limitele sunt pe utilizare (`X-Business-Use-Case-Usage`), nu un număr fix. Ritm: o cerere la 500 ms; plafon de 2.000 de cereri pe rulare.

## Rulare

`.github/workflows/meta-weekly.yml`, marți 04:00 UTC, dezactivat până la `CONNECTOR_META_ENABLED = true`. Local: `npm run collect:meta`. Un `sync_run` per brand, cu `source = meta_ads`. Statusul sursei și metricile (cost, CPC) folosesc aceleași view-uri ca importul CSV (D-4).

## De confirmat la prima rulare reală

1. Volumul la nivel de reclamă pe 35 de zile. La conturi mari, `insights` sincron poate expira; varianta e raportul asincron (`POST /insights` + `report_run_id`).
2. Acțiunea de conversie folosită pentru CPA, per brand.
3. Comportamentul la schimbarea de oră (25 oct) pentru conturile în Europe/Bucharest.
