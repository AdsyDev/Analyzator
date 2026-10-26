# Contract: Airbyte (destinația Postgres) — etapa 1, descoperire

Decizia E-6 (26 oct. 2026). Airbyte-ul agenției sincronizează deja conturile Meta, Google Ads și TikTok într-o bază Postgres. Analyzator citește această bază **read-only**: întâi descoperă ce tabele, conturi și metrici există (etapa 1, acest contract), apoi, în etapa 2, colectează datele în `paid_daily`.

Pași pentru agenție: `docs/connectors/airbyte.md`. Teste de securitate: `docs/security-tests.md`, secțiunea I.

## Conexiunile

| Nivel | `provider` | `external_account_id` | Credențiala (Vault) |
|---|---|---|---|
| Client (`brand_id` NULL) | `airbyte_postgres` | eticheta destinației (de ex. „Airbyte AdSymphony”) | connection string-ul, simplu sau JSON `{ "dsn": "...", "ca_cert": "-----BEGIN CERTIFICATE-----..." }` |
| Site | `airbyte` | `<platformă>:<ID cont>`: `meta_ads:1234567890`, `google_ads:1112223333`, `tiktok_ads:7000000000000000001` | fără (folosește cheia clientului) |

Un site poate avea mai multe conexiuni `airbyte` (câte un cont pe platformă). Constrângerea `unique (tenant_id, provider, external_account_id)` leagă un cont de un singur site al clientului.

ID-urile sunt cele din tabelele Airbyte, ca text: Meta `account_id` (fără `act_`), Google Ads `customer.id` (fără cratime), TikTok `advertiser_id`.

## Credențiala

`postgresql://utilizator:parolă@server.exemplu.ro:5432/bază?sslmode=require`

- Se folosesc doar host, port, utilizator, parolă, bază și `sslmode`. Alți parametri (de exemplu `options=-c ...`) se ignoră, ca să nu poată schimba sesiunea read-only.
- `sslmode`: `require`, `verify-ca` sau `verify-full` (implicit). Toate duc la **verificarea completă** a certificatului, pe numele serverului. `disable`, `allow` și `prefer` sunt refuzate (`tls_required`).
- Host: nume de domeniu public. IP-urile sunt refuzate: certificatul se verifică pe nume, iar runtime-ul nu validează certificate pe IP. Portul trebuie să fie între 1024 și 65535.
- `ca_cert` (opțional): certificatul PEM al autorității care a emis certificatul serverului, un singur bloc, maximum 8.000 de caractere. Fără el se folosesc autoritățile publice.

## Funcția server `airbyte`

`POST /functions/v1/airbyte` cu sesiunea utilizatorului (Bearer):

```json
{ "action": "inspect", "connection_id": "<uuid-ul conexiunii airbyte_postgres>" }
```

Reguli:

- Doar `agency_admin` activ în tenantul conexiunii. Alt rol: 403. Alt tenant: 404, ca la RLS. Conexiunea nu e `airbyte_postgres` la nivel de client: 422. Fără credențială: 409.
- Limita e de **30 de inspecții pe zi (UTC)** per conexiune, contorizate în `provider_api_calls` (`purpose = discover`) înainte de conexiune. Se numără doar încercările care ajung să deschidă o conexiune; o credențială respinsă la verificare nu consumă.
- **SSRF.** Numele trebuie să fie public: fără `localhost`, `*.local`, `*.internal`, `*.svc`, nume fără domeniu sau forme numerice (`127.1`, `0x7f.1`). Toate adresele A și AAAA în care se rezolvă trebuie să fie publice (fără 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10, fc00::/7, fe80::/10, `::ffff:` mapate etc.). Conexiunea merge la IP-ul verificat, iar numele servește doar la TLS. Numele nu se rezolvă a doua oară, deci un DNS rebinding nu are efect.
- **Read-only.** Sesiunea pornește cu `default_transaction_read_only=on`, `statement_timeout=8000`, `lock_timeout=2000` și `idle_in_transaction_session_timeout=10000`. Înainte de orice citire se verifică `transaction_read_only = on`; altfel, conexiunea se închide (`not_read_only`). Se rulează doar SELECT-uri, cu identificatorii luați din catalog și citați. Inspecția durează cel mult 45 s; tabelele rămase apar ca `skipped`.
- Ce se citește: `information_schema.columns` (doar tabelele la care utilizatorul are drept), apoi pe fiecare tabel detectat un `GROUP BY` pe cont (număr de rânduri, prima și ultima zi, ultima `_airbyte_extracted_at`). La TikTok se citesc și cheile `metrics` / `dimensions` din cel mult 500 de rânduri. Se citesc cel mult 40 de tabele și 200 de conturi pe tabel; peste aceste limite, rezultatul e `truncated`.
- Connection string-ul nu apare în răspuns, în audit sau în loguri. Erorile driverului se clasifică fără mesajul serverului.
- Audit: `airbyte_inspected` cu rezultatul, numărul de tabele și conturi și starea credențialei.
- Starea credențialei (`record_source_validation`): `valid` la `ok`; `invalid` la erorile de configurare (`invalid_dsn`, `tls_required`, `host_not_allowed`, `dns_failed` cu nume inexistent, `auth_failed`, `database_not_found`, `tls_failed`, `permission_denied`, `not_read_only`). Penele (`unreachable`, `timeout`, `database_error`, DNS temporar) nu schimbă starea.

### Detectarea (după coloane, nu după numele tabelelor)

Numele coloanelor se normalizează (`customer.id` → `customer_id`). Coloanele tehnice Airbyte (`_airbyte_*`) nu sunt metrici.

| Platformă | Raport (cont + zi + măcar o coloană de performanță) | Catalog (doar numele conturilor) | Nume cont |
|---|---|---|---|
| Meta (`source-facebook-marketing`) | `account_id`, `date_start`, `spend` sau `impressions`: `ads_insights` și defalcările lui | tabel care se termină în `ad_account`, cu `name` | `account_name` din raport sau `name` din catalog |
| Google Ads (`source-google-ads`) | `customer_id`, `segments_date`, `metrics_cost_micros` / `metrics_impressions` / `metrics_clicks` | tabel care se termină în `customer`, cu `customer_descriptive_name` | ca în catalog |
| TikTok (`source-tiktok-marketing`) | `advertiser_id`, `stat_time_day`, `metrics` (jsonb) sau `spend` | tabel care se termină în `advertisers`, cu `name` | din catalog |

Numele din catalog au prioritate. Nivelul raportului vine din cel mai fin ID prezent (`ad_id` → anunț, `adset_id` / `ad_group_id` → ad set / ad group, `campaign_id` → campanie, altfel cont). Metricile sunt coloanele numerice fără `_id` (Meta, TikTok fără jsonb), coloanele `metrics_*` (Google Ads), jsonb-urile `actions`, `action_values` etc. (Meta) și cheile din `metrics` (TikTok). Defalcările sunt coloanele cunoscute Meta (`age`, `country`, `publisher_platform`…), `segments_*` fără dată (Google Ads) și cheile din `dimensions` (TikTok).

### Răspunsul

```json
{
  "connection_id": "…",
  "outcome": "ok",
  "credential_status": "valid",
  "message": "Conexiunea funcționează: 6 conturi în 3 tabele (Meta Ads, Google Ads, TikTok Ads).",
  "calls_today": 1,
  "daily_limit": 30,
  "inspected_at": "2026-10-26T10:00:00.000Z",
  "platforms": [
    { "platform": "meta_ads", "label": "Meta Ads", "tables": [
      { "schema": "meta", "table": "ads_insights", "role": "report", "level": "ad", "rows": 165, "accounts": 3,
        "first_date": "2026-09-01", "last_date": "2026-10-25", "last_synced_at": "2026-10-26T03:00:00Z",
        "metrics": ["actions", "clicks", "impressions", "spend"], "dimensions": [], "error": null }
    ] }
  ],
  "accounts": [
    { "id": "meta_ads:1234567890", "name": "Aflamin RO", "detail": "Meta Ads · ID 1234567890", "platform": "meta_ads",
      "account_id": "1234567890", "rows": 55, "first_date": "2026-09-01", "last_date": "2026-10-25",
      "last_synced_at": "2026-10-26T03:00:00Z", "tables": 1 }
  ],
  "truncated": false
}
```

- `rows`, `accounts`, `first_date` și `last_date` sunt `null` când tabelul nu a putut fi citit (`error`: `timeout`, `permission`, `failed`, `skipped`), niciodată 0 inventat (regula 8).
- `accounts[].rows` vine din tabelul cu cele mai multe rânduri al contului; perioada e cea mai largă dintre tabele.
- Datele sunt ISO (`YYYY-MM-DD`), momentele sunt UTC. Interfața le afișează în Europe/Bucharest.

| `outcome` | Când | Credențiala |
|---|---|---|
| `ok` | conexiune reușită (inclusiv fără niciun tabel detectat, cu mesaj despre GRANT) | `valid` |
| `budget_exhausted` | 30/30 azi; nimic citit din Vault | neschimbată |
| `invalid_dsn` | connection string sau CA invalid, IP în loc de nume | `invalid` |
| `tls_required` | `sslmode` fără criptare | `invalid` |
| `host_not_allowed` | adresă internă, înainte sau după DNS | `invalid` |
| `dns_failed` | numele nu există (`invalid`) sau DNS temporar indisponibil (neschimbată) | vezi stânga |
| `auth_failed` | parolă greșită sau `pg_hba.conf` refuză | `invalid` |
| `database_not_found` | baza din connection string nu există | `invalid` |
| `tls_failed` | serverul fără TLS sau certificat nevalid pentru nume | `invalid` |
| `permission_denied` | fără `CONNECT` pe bază | `invalid` |
| `not_read_only` | sesiunea nu a putut fi pusă read-only | `invalid` |
| `unreachable`, `timeout`, `database_error` | rețea, firewall, server lent | neschimbată |

## Etapa 2 (nefăcută)

Colectorul din tabelele Airbyte în `paid_daily`, pe conexiunile `airbyte` ale site-urilor, cu o metodă de colectare proprie. Un cont legat și la conectorul API (`meta_ads`, `google_ads`, `tiktok_ads`) și la `airbyte` nu se colectează de două ori: se alege o singură metodă per cont. Până atunci, sursa `airbyte` apare „Neconectat”, cu motivul „colectarea din Airbyte în Paid Media nu e încă activă”, iar Paid Media nu citește din Airbyte.
