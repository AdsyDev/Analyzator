# Registrul de metrici: nivel B (import CSV)

Continuarea lui `docs/metrics/registry.md` pentru metricile cu sursă CSV (paid per platformă, mențiuni). Valorile se schimbă **doar prin migrație**, ca versiune nouă
(`supabase/migrations/20261008160000_csv_import.sql`). Orice schimbare actualizează în același commit acest document și testele. Testul
`analytics/contracts/registry-docs.test.ts` verifică faptul că cheile și versiunile din ambele fișiere sunt cele inserate în migrații.

## Metrici de nivel B (import CSV)

Surse: import CSV asistat (paid, social, listening), cu aceleași tabele și contracte ca viitorii conectori direcți (`docs/contracts/csv-*.md`). Registrul păstrează o cheie per platformă: conversiile și costurile platformelor nu se însumează într-un total (spec 2.6). `CPC` și `CPA` sunt rate recalculate din totaluri (cost / clicks, cost / conversii).

| metric_key | Versiune | Nume | Sursă | Unitate | Agregare | Pondere | Toleranță stale (zile) | Stare |
|---|---|---|---|---|---|---|---|---|
| `google_ads_spend` | 1 | Cost Google Ads | Google Ads | count | sum | — | 14 | draft (înlocuită de v2) |
| `google_ads_impressions` | 1 | Impressions Google Ads | Google Ads | count | sum | — | 14 | active |
| `google_ads_clicks` | 1 | Clicks Google Ads | Google Ads | count | sum | — | 14 | active |
| `google_ads_conversions` | 1 | Conversii Google Ads | Google Ads | count | sum | — | 14 | active |
| `google_ads_cpc` | 1 | CPC Google Ads | Google Ads | count | ratio | — | 14 | draft (înlocuită de v2) |
| `google_ads_cpa` | 1 | CPA Google Ads | Google Ads | count | ratio | — | 14 | draft (înlocuită de v2) |
| `meta_ads_spend` | 1 | Cost Meta Ads | Meta Ads | count | sum | — | 14 | draft (înlocuită de v2) |
| `meta_ads_impressions` | 1 | Impressions Meta Ads | Meta Ads | count | sum | — | 14 | active |
| `meta_ads_clicks` | 1 | Clicks Meta Ads | Meta Ads | count | sum | — | 14 | active |
| `meta_ads_conversions` | 1 | Conversii Meta Ads | Meta Ads | count | sum | — | 14 | active |
| `meta_ads_cpc` | 1 | CPC Meta Ads | Meta Ads | count | ratio | — | 14 | draft (înlocuită de v2) |
| `meta_ads_cpa` | 1 | CPA Meta Ads | Meta Ads | count | ratio | — | 14 | draft (înlocuită de v2) |
| `tiktok_ads_spend` | 1 | Cost TikTok Ads | TikTok Ads | count | sum | — | 14 | draft (înlocuită de v2) |
| `tiktok_ads_impressions` | 1 | Impressions TikTok Ads | TikTok Ads | count | sum | — | 14 | active |
| `tiktok_ads_clicks` | 1 | Clicks TikTok Ads | TikTok Ads | count | sum | — | 14 | active |
| `tiktok_ads_conversions` | 1 | Conversii TikTok Ads | TikTok Ads | count | sum | — | 14 | active |
| `tiktok_ads_cpc` | 1 | CPC TikTok Ads | TikTok Ads | count | ratio | — | 14 | draft (înlocuită de v2) |
| `tiktok_ads_cpa` | 1 | CPA TikTok Ads | TikTok Ads | count | ratio | — | 14 | draft (înlocuită de v2) |
| `mentions_count` | 1 | Mențiuni (Planable Listening) | Planable Listening | count | sum | — | 14 | active |
| `google_ads_spend` | 2 | Cost Google Ads | Google Ads | currency | sum | — | 14 | active |
| `google_ads_cpc` | 2 | CPC Google Ads | Google Ads | currency | ratio | — | 14 | active |
| `google_ads_cpa` | 2 | CPA Google Ads | Google Ads | currency | ratio | — | 14 | active |
| `meta_ads_spend` | 2 | Cost Meta Ads | Meta Ads | currency | sum | — | 14 | active |
| `meta_ads_cpc` | 2 | CPC Meta Ads | Meta Ads | currency | ratio | — | 14 | active |
| `meta_ads_cpa` | 2 | CPA Meta Ads | Meta Ads | currency | ratio | — | 14 | active |
| `tiktok_ads_spend` | 2 | Cost TikTok Ads | TikTok Ads | currency | sum | — | 14 | active |
| `tiktok_ads_cpc` | 2 | CPC TikTok Ads | TikTok Ads | currency | ratio | — | 14 | active |
| `tiktok_ads_cpa` | 2 | CPA TikTok Ads | TikTok Ads | currency | ratio | — | 14 | active |

Versiunile 1 au `valid_from = 2026-10-01` și `min_sample = null`. **Versiunea 2** (cost, CPC, CPA; `valid_from = 2026-10-08`) trece pe `unit = currency`, `active`, odată cu versiunea 2 a contractului `MetricResponse`: răspunsul poartă câmpul `currency` (moneda lotului de import, ISO 4217). Versiunile 1 rămân (imutabile) ca istoric; `metric_definitions_current` o alege pe cea mai mare. Monede diferite în aceeași perioadă nu se însumează: metrica devine `unavailable` (`mixed_currency`); comparația în altă monedă se ignoră (`comparison_currency_mismatch`).

Observațiile paid se grupează pe zi, monedă, configurație de atribuire și tip de click: dacă pentru aceeași zi există mai multe grupuri (monede sau atribuiri diferite), metrica devine indisponibilă (`duplicate_observations`), nu o sumă de lucruri incomparabile. Rândurile cu defalcare (`breakdown_signature <> 'none'`) nu intră în totaluri.

## Detalii

### google_ads_spend
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Costul Google Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### google_ads_impressions
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Afișările Google Ads în perioadă; suma zilelor.

### google_ads_clicks
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Clicks Google Ads în perioadă; suma zilelor. Tipul de click (click_type) trebuie să fie același în ambele perioade comparate.

### google_ads_conversions
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Conversiile raportate de Google Ads, pentru aceeași configurație de atribuire; suma zilelor. Se afișează separat de key events GA4 și nu se însumează între platforme.

### google_ads_cpc
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / clicks pe totalurile perioadei (Google Ads), în moneda declarată; nu media ratelor zilnice.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### google_ads_cpa
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / conversii pe totalurile perioadei (Google Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### meta_ads_spend
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Costul Meta Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### meta_ads_impressions
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Afișările Meta Ads în perioadă; suma zilelor.

### meta_ads_clicks
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Clicks Meta Ads în perioadă; suma zilelor. Tipul de click (click_type) trebuie să fie același în ambele perioade comparate.

### meta_ads_conversions
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Conversiile raportate de Meta Ads, pentru aceeași configurație de atribuire; suma zilelor. Se afișează separat de key events GA4 și nu se însumează între platforme.

### meta_ads_cpc
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / clicks pe totalurile perioadei (Meta Ads), în moneda declarată; nu media ratelor zilnice.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### meta_ads_cpa
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / conversii pe totalurile perioadei (Meta Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### tiktok_ads_spend
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Costul TikTok Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### tiktok_ads_impressions
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Afișările TikTok Ads în perioadă; suma zilelor.

### tiktok_ads_clicks
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Clicks TikTok Ads în perioadă; suma zilelor. Tipul de click (click_type) trebuie să fie același în ambele perioade comparate.

### tiktok_ads_conversions
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Conversiile raportate de TikTok Ads, pentru aceeași configurație de atribuire; suma zilelor. Se afișează separat de key events GA4 și nu se însumează între platforme.

### tiktok_ads_cpc
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / clicks pe totalurile perioadei (TikTok Ads), în moneda declarată; nu media ratelor zilnice.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### tiktok_ads_cpa
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / conversii pe totalurile perioadei (TikTok Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.

**Versiunea 2 (8 oct 2026):** `unit = currency`; moneda vine din lotul de import și apare în `currency` (ISO 4217) în răspuns. Versiunea 1 (`unit = count`, draft) rămâne ca istoric.

### mentions_count
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Numărul de mențiuni distincte publicate în interval; importul nu schimbă data publicării.
