# Contract TikTok Ads (Business API v1.3)

Surse: SDK-ul oficial ([tiktok-business-api-sdk, AuthenticationApi](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AuthenticationApi.md)) și documentația Marketing API (raportul integrat, informațiile advertiserului, codurile de răspuns), citite 2026-10-12. Teste: `connectors/tiktok/tiktok.test.ts` („derivat din documentație, neconfirmat”). **Nicio rulare reală încă.**

## Configurare

| provider | brand_id | external_account_id | Vault |
|---|---|---|---|
| `tiktok_account` | NULL | eticheta „TikTok Business (N conturi)” | câmpurile de token (`access_token`, `refresh_token`, expirări), `advertiser_ids`, `obtained_at`, prin OAuth |
| `tiktok_ads` | brandul | advertiser ID (cifre) | — |

Mediul workerului: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`.

## Token

După SDK-ul oficial, access token-ul e valabil 24 de ore, iar refresh token-ul un an. La fiecare rulare: `POST /oauth2/refresh_token/` `{ app_id, secret, refresh_token, grant_type }`, apoi tokenul nou se salvează cu `rotate_source_token` (audit `worker`). Un refuz cu cod de token marchează credențialul `invalid`: e nevoie de reconectare. Un token fără `refresh_token` se folosește direct. După un an, TikTok cere reautorizarea.

## Cereri (antet `Access-Token`; succes = `code: 0` în corp, chiar și la HTTP 200)

1. `GET /advertiser/info/?advertiser_ids=["…"]&fields=["name","currency","timezone","display_timezone"]`.
2. `GET /report/integrated/get/?report_type=BASIC&data_level=AUCTION_CAMPAIGN&dimensions=["campaign_id","stat_time_day"]&metrics=["spend","impressions","clicks","conversion","campaign_name"]&start_date&end_date&page&page_size=1000`. Fereastra de 35 de zile se cere în bucăți de cel mult 30 de zile.

## Maparea în `paid_daily`

`source = tiktok_ads`, `account_id` = advertiser ID, `campaign_id`, `ad_group_id = ''`, `ad_id = ''`, `date` = primele 10 caractere din `stat_time_day`, `spend`, `impressions`, `clicks` (`click_type = all`), `conversions` = `conversion` (conversiile pentru obiectivul de optimizare), `currency` = moneda advertiserului. Valorile absente → NULL. Fusul orar necunoscut → Europe/Bucharest, cu notă.

## Erori (din `code`, de confirmat)

40102 / 40104 / 40105 → `access_denied`; 40001–40003 → `permission_denied`; 40100 / 40133 / 50002 sau HTTP 429 → `rate_limited`, retry 10 s / 60 s / 5 min; ≥ 50000 → `server_error`, cu retry.

## Rulare

`.github/workflows/tiktok-weekly.yml`, marți 04:00 UTC, activ când `CONNECTOR_TIKTOK_ENABLED = true`. Local: `npm run collect:tiktok`.

## De confirmat la prima rulare

Codurile de eroare, numele câmpurilor de expirare, limita intervalului raportului zilnic, formatul `timezone` al advertiserului.
