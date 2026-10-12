# Contract: conectarea OAuth (Google Ads, TikTok Ads)

Decizia D-8. Funcția server `supabase/functions/oauth` (Edge Function, `verify_jwt = false` în `supabase/config.toml`; pornirea verifică singură sesiunea). Teste: `supabase/functions/oauth/handler.test.ts`, `supabase/tests/database/14_oauth.test.sql`.

## Flux

1. **Pornire** — `POST /functions/v1/oauth` `{ action: "start", provider, tenant_id, account_label? }`, cu JWT-ul utilizatorului.
   - Doar `agency_admin` activ al clientului (altfel 403). Furnizor neconfigurat pe server → 503 cu numele secretelor lipsă.
   - Google Ads cere `account_label` = ID-ul contului de manager (MCC), 10 cifre.
   - Se generează `state` (32 de octeți aleatori) și, la Google, un verificator PKCE. În `oauth_states` se scrie doar **hash-ul SHA-256** al `state`-ului, clientul, furnizorul, utilizatorul și expirarea (**10 minute**).
   - Răspuns: `{ authorize_url }`. Browserul merge la furnizor. Secretul aplicației nu pleacă niciodată în browser.
2. **Întoarcere** — `GET /functions/v1/oauth/callback/<provider>?code|auth_code=…&state=…` (fără JWT).
   - `state` se revendică **atomic** (`used_at is null` și neexpirat): o singură folosire. Furnizorul din adresă trebuie să fie cel din `state`.
   - Rolul `agency_admin` se **reverifică** la întoarcere.
   - Codul se schimbă pe token (Google: cu `code_verifier`); tokenul se scrie în Vault prin `set_source_token`, cu utilizatorul care a pornit conectarea ca actor; conexiunea e marcată `valid`.
   - Redirect `303` la `APP_BASE_URL/admin/sources?oauth=<provider>&result=ok|error&reason=<cod>`. Tokenul nu apare în răspuns sau în adresă.

Coduri `reason`: `state_invalid`, `denied`, `forbidden`, `code_missing`, `exchange_failed`, `no_refresh_token`, `scope_missing`, `internal`.

## Furnizori

| | Google Ads | TikTok Ads |
|---|---|---|
| Autorizare | `accounts.google.com/o/oauth2/v2/auth`, scope `https://www.googleapis.com/auth/adwords`, `access_type=offline`, `prompt=consent`, PKCE S256 | `business-api.tiktok.com/portal/auth?app_id&state&redirect_uri` |
| Schimb | `POST oauth2.googleapis.com/token` (form) | `POST /open_api/v1.3/oauth2/access_token/` `{ app_id, secret, auth_code }` |
| Ce se păstrează în Vault | `{ refresh_token, scope, login_customer_id }` | câmpurile de token, expirare, `advertiser_ids`, `scope` + `obtained_at` |
| Conexiunea clientului | `google_ads_account`, `external_account_id` = MCC | `tiktok_account`, eticheta „TikTok Business (N conturi)” |
| Reînnoire | workerul cere un access token la fiecare rulare (refresh token-ul nu se schimbă) | workerul reînnoiește și salvează tokenul nou cu `rotate_source_token` (SDK-ul oficial: access token 24 h, refresh token 1 an) |

## Secrete (doar pe server)

- Funcția `oauth` (Supabase → Edge Functions → Secrets): `APP_BASE_URL`, `ANALYZATOR_APP_ORIGIN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`; opțional `OAUTH_REDIRECT_BASE` (implicit `SUPABASE_URL`).
- Workerii (GitHub Secrets): aceleași ID și secrete OAuth, plus `GOOGLE_ADS_DEVELOPER_TOKEN`.
- **Redirect URI** de înregistrat la furnizor: `https://<proiect>.supabase.co/functions/v1/oauth/callback/google_ads` și `…/callback/tiktok_ads`.

## De confirmat la prima conectare reală

- Adresa exactă de autorizare TikTok și numele câmpurilor de expirare din răspuns.
- Dacă TikTok rotește refresh token-ul la fiecare reînnoire.
