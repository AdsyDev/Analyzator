# Contract Google Ads Transparency (reclamele competitorilor)

Deciziile Y din `docs/decisions.md`. **Nicio rulare reală încă.**

**Ce spune documentația citită la 23 nov. 2026:** pagina Google „Ads transparency” (Advertising Policies Help): „Google provides API access to data about ads served in the EEA in the Ads Transparency Center”, sub termenii Ads Transparency Center. Pagina BigQuery „Public datasets”: plătești doar interogările, „the first 1 TB per month is free”, iar până la 1 TB se poate interoga fără facturare activă. Descrierea setului (citată pe forumul Google Developers, ianuarie 2025): datele acoperă „the European Economic Area or Turkey”, se actualizează periodic și pot întârzia față de site. **Schema oficială a tabelului nu e publicată în afara consolei Google Cloud** (pagina cere autentificare); din surse publice sunt confirmate `advertiser_id`, `creative_id` și `times_shown_lower_bound`. De aceea colectorul citește schema la fiecare rulare (mai jos).

## Ruta

Google nu publică un API REST pentru Ads Transparency Center. Ruta programatică este setul public BigQuery
`bigquery-public-data.google_ads_transparency_center.creative_stats` (spec cap. 08, S25: „acces API pentru date despre ads din SEE”).

- **Interogare:** `POST https://bigquery.googleapis.com/bigquery/v2/projects/{project}/queries` (jobs.query), standard SQL, parametri numiți, `location = US`, `maximumBytesBilled`; un job neterminat se așteaptă cu `GET …/queries/{jobId}` (jobs.getQueryResults), paginat.
- **Autentificare:** service account-ul Google al clientului (conexiunea `google_service_account`, același JSON din Vault ca la GA4 și Search Console), scope `https://www.googleapis.com/auth/bigquery`.
- **Cine plătește:** proiectul `project_id` din JSON-ul service account-ului sau variabila `ADS_TRANSPARENCY_BILLING_PROJECT`. Service account-ul are nevoie de rolul **BigQuery Job User** în acel proiect și de API-ul BigQuery activ.
- **Schema, înaintea interogării:** `SELECT field_path, data_type FROM bigquery-public-data.google_ads_transparency_center.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS WHERE table_name = 'creative_stats'` (metadate, plafon 1 GB; BigQuery facturează minimum 10 MB). Obligatorii: `advertiser_id`, `creative_id`, `region_stats`, `region_stats.region_code`; dacă lipsește unul, toate rulările clientului eșuează cu `schema_changed` și lista câmpurilor găsite, fără interogarea mare. Opționale: `advertiser_disclosed_name`, `ad_format_type`, `creative_page_url` (absente → `NULL` în interogare) și câmpurile din `region_stats` (absente → NULL); cele absente apar într-o notă `schema`.
- **Cost:** BigQuery facturează bytes citiți din coloanele folosite. Interogarea citește doar `advertiser_id`, `creative_id`, coloanele opționale găsite și `region_stats`. Plafon pe interogare: `ADS_TRANSPARENCY_MAX_GB` (implicit 100 GB); peste el BigQuery oprește jobul înainte de facturare (`bytesBilledLimitExceeded`), iar rularea eșuează cu plafonul în mesaj. Bytes facturați se scriu în `sync_runs.errors` ca notă (`dimension = bytes_billed`). Mărimea tabelului și clusterizarea lui nu sunt confirmate.

```sql
-- cu toate câmpurile opționale găsite în schemă
SELECT cs.advertiser_id, cs.creative_id, cs.advertiser_disclosed_name, cs.ad_format_type, cs.creative_page_url,
       rs.region_code, TO_JSON_STRING(rs) AS region_stats
FROM `bigquery-public-data.google_ads_transparency_center.creative_stats` AS cs, UNNEST(cs.region_stats) AS rs
WHERE cs.advertiser_id IN UNNEST(@advertiser_ids) AND rs.region_code = @region   -- @region = 'RO'
```

`region_stats` se citește ca JSON, tolerant: `first_shown`, `last_shown` (DATE sau TIMESTAMP → ziua), `times_shown_lower_bound`, `times_shown_upper_bound` (întregi ≥ 0; un interval inversat devine NULL). Un câmp absent rămâne NULL.

## Configurare

| Unde | Ce |
|---|---|
| `competitor_set_members.ads_advertiser_ids` | ID-urile de advertiser (`AR` + cifre) ale fiecărui competitor, prin `create_competitor_set_version` (versiune nouă a setului). Se iau din adresa paginii advertiserului în adstransparency.google.com (`/advertiser/AR…`). |
| `source_connections` `google_service_account` | aceeași conexiune ca la Google, la nivel de client |
| GitHub Variables | `CONNECTOR_ADS_TRANSPARENCY_ENABLED` (rularea programată), opțional `ADS_TRANSPARENCY_MAX_GB`, `ADS_TRANSPARENCY_BILLING_PROJECT` |

Se colectează advertiserii din versiunea setului în vigoare azi și din versiunile viitoare; versiunile trecute nu.

## Tabele

| Tabel | Cheie naturală | Conținut |
|---|---|---|
| `competitor_ads` | tenant, brand, source, advertiser_id, native_ad_id, region_code | o reclamă într-o regiune (`RO`): format (`text`/`image`/`video`/`unknown`), `first_shown`/`last_shown` declarate de Google, intervalul de afișări, `source_url` (doar `https://adstransparency.google.com/…`), `first_seen` (prima noastră observație, nu se suprascrie) și `last_seen` |
| `competitor_trackers` | tenant, brand, source = `google_ads_transparency`, external_id = ID-ul advertiserului | fiecare advertiser interogat, **și cel fără reclame** (zero real); `covered_from` NULL (istoricul păstrat de Google), `covered_to` = ieri (Europe/Bucharest) la colectare, `complete` = rezultatul nu a fost trunchiat |

`first_seen`/`last_seen` sunt observațiile noastre, distincte de intervalul declarat de sursă (spec cap. 08). „Activă” nu se afișează: aplicația spune „afișată în România între … și …”, cum declară Google. Reclamele nu au cost, clickuri sau performanță și nu se folosesc pentru estimări (spec cap. 08, brief: „nu se inferă spend, CTR, CPA”).

## Rulare

- `.github/workflows/ads-transparency-weekly.yml`, marți 05:00 UTC, **dezactivat** până la `CONNECTOR_ADS_TRANSPARENCY_ENABLED = true`; `workflow_dispatch` oricând. Local: `npm run collect:ads-transparency`.
- O interogare per client (toți advertiserii brandurilor lui), apoi un `sync_run` `ads_transparency` per brand, cu rândurile doar ale advertiserilor din setul brandului. Perioada rulării = ziua datelor (ieri).
- Siguranță: cel mult 20 de pagini × 10.000 de rânduri și 50.000 de rânduri pe interogare; peste ele, rularea e `partial`, iar trackerii au `complete = false`.
- Fără service account valid: `not_connected` pe brandurile clientului, fără `sync_run` și fără cereri.

## În aplicație

- **Matricea de Competiție**, grupul „Reclame Google”: „Reclame afișate” (creative distincte afișate în România cel puțin o zi din perioadă) și „Reclame noi” (prima afișare în perioadă). Brandul e N/A (reclamele proprii sunt în Paid media). Un competitor fără advertiser e N/A cu motiv; un advertiser încă neinterogat face celula parțială; zilele de după ultima colectare la fel.
- **„Reclamele competitorilor”**: lista paginată pe server (`brand_competitor_ads`), cu competitorul, advertiserul, formatul, intervalul afișării, marcajul „Nouă în perioadă”, intervalul de afișări și linkul spre pagina reclamei din Ads Transparency Center (acolo se vede creația; aplicația nu copiază imagini sau video).

## De confirmat la prima rulare reală

1. Câmpurile reale: nota `schema` (sau eroarea `schema_changed`) le arată la prima rulare; dacă `first_shown`/`last_shown` au alt nume, se adaugă în `REGION_FIELDS` și în `regionFields`.
2. Bytes facturați pe interogare (nota `bytes_billed`) și dacă tabelul e clusterizat pe `advertiser_id`.
3. Întârzierea setului: dacă „ieri” e o limită corectă pentru `covered_to`.
4. Valorile `ad_format_type` (presupuse `TEXT`, `IMAGE`, `VIDEO`).
5. Dacă reclamele eliminate de Google dispar din `creative_stats` (există și `removed_creative_stats`, necitit).
6. Acoperirea: un utilizator raporta (ianuarie 2025) mult mai puține reclame în BigQuery decât pe site pentru un advertiser; explicația dată a fost filtrul pe SEE și Turcia. De comparat, pe un competitor, numărul din aplicație cu site-ul filtrat pe România.
