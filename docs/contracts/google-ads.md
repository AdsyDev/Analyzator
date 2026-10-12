# Contract Google Ads (Google Ads API v25, REST)

Surse: documentația Google Ads API (googleAds:search, GAQL, GoogleAdsFailure); calendarul versiunilor (v25 e versiunea majoră curentă la 2026-10-12, cu sunset anunțat pentru august 2027; [anunțul de sunset v22](https://ads-developers.googleblog.com/2026/09/google-ads-api-v22-sunset-reminder.html)). Răspunsurile de test sunt în `connectors/google-ads/google-ads.test.ts` („derivat din documentație, neconfirmat”). **Nicio rulare reală încă.**

## Configurare

| provider | brand_id | external_account_id | Vault |
|---|---|---|---|
| `google_ads_account` | NULL | ID-ul contului de manager (MCC), 10 cifre | `{ refresh_token, scope, login_customer_id }`, prin OAuth (`docs/contracts/oauth.md`) |
| `google_ads` | brandul | customer ID-ul contului brandului (`123-456-7890`) | — |

Mediul workerului: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`. Fără ele, sau fără contul conectat, conexiunile raportează `not_connected`, fără cereri.

## Cereri

1. `POST oauth2.googleapis.com/token` (`grant_type=refresh_token`) → access token. `invalid_grant` = token revocat: credențialul devine `invalid`.
2. `POST /v25/customers/{id}/googleAds:search`, cu antetele `Authorization`, `developer-token` și `login-customer-id` (MCC):
   - `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer`;
   - `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '<start>' AND '<end>'`, paginat cu `nextPageToken`.

Datele sunt la **nivel de campanie**, pentru că așa intră și campaniile Performance Max (fără grupuri de reclame). Fereastra: 35 de zile până ieri, în fusul contului.

## Maparea în `paid_daily` (aceleași chei ca CSV-ul Google Ads)

`source = google_ads`, `account_id` = customer ID, `campaign_id`, `ad_group_id = ''`, `ad_id = ''`, `date = segments.date`, `spend = cost_micros / 1.000.000`, `impressions`, `clicks` (`click_type = all`), `conversions` = „Conversions” (conversiile principale, după setările contului), `currency = customer.currency_code`, `attribution_config = unspecified`, proveniență API.

**Câmpuri absente (proto3).** În JSON-ul REST al Google Ads, un câmp numeric egal cu 0 poate lipsi din rând (maparea proto3 → JSON). Un câmp **cerut în interogare** și absent dintr-un rând **întors** se scrie ca 0, iar fiecare caz devine o notă `parser_note` în `sync_runs.errors`. Un rând care lipsește cu totul nu se inventează. Decizia D-9; de verificat la prima rulare.

## Erori

401 → `access_denied`; 403 → `permission_denied`, cu codul din `GoogleAdsFailure` în mesaj (de ex. `DEVELOPER_TOKEN_NOT_APPROVED`, `USER_PERMISSION_DENIED`); 429 → `rate_limited`, retry 10 s / 60 s / 5 min; 5xx → retry. Ritm: o cerere la 300 ms, plafon 1.000 pe rulare.

## Rulare

`.github/workflows/google-ads-weekly.yml`, marți 04:00 UTC, activ când `CONNECTOR_GOOGLE_ADS_ENABLED = true`. Local: `npm run collect:google-ads`.

## De confirmat la prima rulare

1. Câmpurile cu 0 lipsesc într-adevăr din JSON (notele `parser_note`).
2. Nivelul de acces al developer token-ului: Basic sau Standard (cu „Test account access” nu se citesc conturi reale).
