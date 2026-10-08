# Registrul de metrici (ANZ07)

Sursa umană a tabelului `public.metric_definitions`. Valorile se schimbă **doar prin migrație**, ca versiune nouă. Orice schimbare actualizează în același commit acest document, `docs/contracts/metric-response.md` dacă e cazul, și testele. Un test (`analytics/contracts/registry-docs.test.ts`) verifică faptul că cheile și versiunile de aici sunt aceleași cu cele din migrații.

Calculul: `metrics.compute` (SQL). Contractul răspunsului: `docs/contracts/metric-response.md`. Regulile: spec cap. 2, 9 și 11.

## Tipuri de agregare

| Agregare | Calcul | Reguli |
|---|---|---|
| `sum` | Suma pe zile distincte | Aceeași zi de două ori → `unavailable` (`duplicate_observations`). Zero doar cu toate zilele confirmate. |
| `ratio` | `multiplier × Σnumărător / Σnumitor` | Niciodată media ratelor. Numitor 0 → null, `cannot_compute`. |
| `weighted_mean` | `Σ(valoare × pondere) / Σpondere` | Rândurile fără pondere se exclud, se numără în `meta.warnings` (`excluded_rows`), iar metrica devine `partial`. |
| `last_observation` | Ultima observație validă până la sfârșitul perioadei | Fără observație → `unavailable`. |
| `interval_report_only` | Doar raportul pe exact intervalul cerut | Zilele nu se însumează; fără raport → `unavailable`. |

## Metrici de nivel A

| metric_key | Versiune | Nume | Sursă | Unitate | Agregare | Pondere | Toleranță stale (zile) | Stare |
|---|---|---|---|---|---|---|---|---|
| `ga4_sessions` | 1 | Sesiuni | GA4 | count | sum | — | 2 | active |
| `ga4_active_users` | 1 | Utilizatori activi | GA4 | count | interval_report_only | — | 2 | active |
| `ga4_engaged_sessions` | 1 | Sesiuni cu implicare | GA4 | count | sum | — | 2 | active |
| `ga4_key_events` | 1 | Key events | GA4 | count | sum | — | 2 | active |
| `gsc_clicks` | 1 | Clicks (Search Console) | GSC | count | sum | — | 3 | active |
| `gsc_impressions` | 1 | Impressions (Search Console) | GSC | count | sum | — | 3 | active |
| `gsc_ctr` | 1 | CTR (Search Console) | GSC | percent | ratio (×100) | — | 3 | active |
| `gsc_average_position` | 1 | Poziție medie (Search Console) | GSC | position | weighted_mean | impressions | 3 | active |
| `seomonitor_visibility` | 1 | Visibility SEOmonitor (medie în perioadă) | SEOmonitor | score | weighted_mean | zile acoperite | 7 | draft |
| `seomonitor_visibility_latest` | 1 | Visibility SEOmonitor (ultima observație) | SEOmonitor | score | last_observation | — | 7 | draft |
| `seomonitor_keywords_top3` | 1 | Keywords în Top 3 | SEOmonitor | count | last_observation | — | 7 | active |
| `seomonitor_keywords_top10` | 1 | Keywords în Top 10 | SEOmonitor | count | last_observation | — | 7 | active |
| `clarity_rage_click_sessions` | 1 | Sesiuni cu rage clicks | Clarity | count | sum | — | 1 | draft |
| `clarity_dead_click_sessions` | 1 | Sesiuni cu dead clicks | Clarity | count | sum | — | 1 | draft |
| `clarity_quickback_sessions` | 1 | Sesiuni cu quick backs | Clarity | count | sum | — | 1 | draft |
| `clarity_scroll_depth` | 1 | Scroll depth mediu | Clarity | percent | weighted_mean | sesiuni | 1 | draft |

Toate au `valid_from = 2026-10-01` și `min_sample = null`: nivelul A nu are încă prag de eșantion. Pragurile AI din spec (50 de răspunsuri, acoperire minimă 80%) intră cu conectorul AI.

## Metrici de nivel B (import CSV)

Surse: import CSV asistat (paid, social, listening), cu aceleași tabele și contracte ca viitorii conectori direcți (`docs/contracts/csv-*.md`). Registrul păstrează o cheie per platformă: conversiile și costurile platformelor nu se însumează într-un total (spec 2.6). `CPC` și `CPA` sunt rate recalculate din totaluri (cost / clicks, cost / conversii).

| metric_key | Versiune | Nume | Sursă | Unitate | Agregare | Pondere | Toleranță stale (zile) | Stare |
|---|---|---|---|---|---|---|---|---|
| `google_ads_spend` | 1 | Cost Google Ads | Google Ads | count | sum | — | 14 | draft |
| `google_ads_impressions` | 1 | Impressions Google Ads | Google Ads | count | sum | — | 14 | active |
| `google_ads_clicks` | 1 | Clicks Google Ads | Google Ads | count | sum | — | 14 | active |
| `google_ads_conversions` | 1 | Conversii Google Ads | Google Ads | count | sum | — | 14 | active |
| `google_ads_cpc` | 1 | CPC Google Ads | Google Ads | count | ratio | — | 14 | draft |
| `google_ads_cpa` | 1 | CPA Google Ads | Google Ads | count | ratio | — | 14 | draft |
| `meta_ads_spend` | 1 | Cost Meta Ads | Meta Ads | count | sum | — | 14 | draft |
| `meta_ads_impressions` | 1 | Impressions Meta Ads | Meta Ads | count | sum | — | 14 | active |
| `meta_ads_clicks` | 1 | Clicks Meta Ads | Meta Ads | count | sum | — | 14 | active |
| `meta_ads_conversions` | 1 | Conversii Meta Ads | Meta Ads | count | sum | — | 14 | active |
| `meta_ads_cpc` | 1 | CPC Meta Ads | Meta Ads | count | ratio | — | 14 | draft |
| `meta_ads_cpa` | 1 | CPA Meta Ads | Meta Ads | count | ratio | — | 14 | draft |
| `tiktok_ads_spend` | 1 | Cost TikTok Ads | TikTok Ads | count | sum | — | 14 | draft |
| `tiktok_ads_impressions` | 1 | Impressions TikTok Ads | TikTok Ads | count | sum | — | 14 | active |
| `tiktok_ads_clicks` | 1 | Clicks TikTok Ads | TikTok Ads | count | sum | — | 14 | active |
| `tiktok_ads_conversions` | 1 | Conversii TikTok Ads | TikTok Ads | count | sum | — | 14 | active |
| `tiktok_ads_cpc` | 1 | CPC TikTok Ads | TikTok Ads | count | ratio | — | 14 | draft |
| `tiktok_ads_cpa` | 1 | CPA TikTok Ads | TikTok Ads | count | ratio | — | 14 | draft |
| `mentions_count` | 1 | Mențiuni (Planable Listening) | Planable Listening | count | sum | — | 14 | active |

Toate au `valid_from = 2026-10-01` și `min_sample = null`. Metricile monetare (cost, CPC, CPA) sunt `draft`: contractul `MetricResponse` nu are încă unitatea `currency`; până atunci `unit = count`, iar moneda se citește din lotul de import (`currency` în view).

Observațiile paid se grupează pe zi, monedă, configurație de atribuire și tip de click: dacă pentru aceeași zi există mai multe grupuri (monede sau atribuiri diferite), metrica devine indisponibilă (`duplicate_observations`), nu o sumă de lucruri incomparabile. Rândurile cu defalcare (`breakdown_signature <> 'none'`) nu intră în totaluri.

## Detalii

### ga4_sessions
_Observații: view-ul `web_metric_observations` (din `web_daily`); vezi `docs/contracts/google.md`._

Numărul de sesiuni GA4 în perioadă; suma zilelor.

### ga4_active_users
_Observații: view-ul `web_active_users_observations` (din `web_active_users_interval`, un raport per interval); vezi `docs/contracts/google.md`._

Utilizatori activi GA4 din raportul pe **intervalul întreg**. Zilele nu se însumează: același utilizator activ în mai multe zile ar fi numărat de mai multe ori. Fără raport pe interval, `unavailable`.

### ga4_engaged_sessions
Sesiunile GA4 cu implicare (engaged sessions); suma zilelor.

### ga4_key_events
_Observații: view-ul `web_metric_observations` (din `web_key_events`, suma pe `eventName`); vezi `docs/contracts/google.md`._

Key events GA4; suma zilelor. Se afișează separat de conversiile platformelor de ads (spec 2.6).

### gsc_clicks
_Observații: view-ul `search_metric_observations` (din `search_daily`, suma device-urilor); vezi `docs/contracts/google.md`._

Clicks din Google Search (Search Console); suma zilelor.

### gsc_impressions
Afișări în Google Search; suma zilelor.

### gsc_ctr
`100 × clicks / impressions` pe totalurile perioadei. Exemplu: 10 din 100 plus 10 din 900 = 2%, nu 5,5%. Diferențele față de comparație sunt în puncte procentuale.

### gsc_average_position
Poziția medie GSC, ponderată cu impressions (cum agregă GSC). Nu e rankul SEOmonitor; se afișează cu numele complet. O valoare mai mică e mai bună.

### seomonitor_visibility
_Sursa observațiilor SEOmonitor: view-ul `seomonitor_metric_observations` (vezi `docs/contracts/seomonitor.md`); dispozitivul se alege la citire._

Visibility raportată de SEOmonitor: linie de observații și **medie în perioadă**, ponderată cu zilele acoperite de fiecare observație (o observație săptămânală valorează 7 zile). Nu se însumează. Eticheta „medie în perioadă" ajunge în răspuns (`meta.warnings`, `aggregation_label`). **Draft:** unitatea (procent sau scor) se confirmă pe payloadul SEOmonitor. Documentația e contradictorie: 0.53 la visibility pe grupuri, 53.3 la campanii.

### seomonitor_visibility_latest
Ultima valoare de visibility până la sfârșitul perioadei; folosită pe cardul KPI. Eticheta: „ultima observație". **Draft**, din același motiv.

### seomonitor_keywords_top3
Numărul de keywords urmărite cu rank 1–3 la ultima observație. Keywords fără rank rămân „fără rank": nu primesc poziția 100 și nu intră în Top 3 (`metrics.rank_summary`).

### seomonitor_keywords_top10
Ca mai sus, pentru rank 1–10.

### clarity_rage_click_sessions
_Sursa observațiilor pentru toate metricile Clarity: view-ul `clarity_metric_observations` (vezi `docs/contracts/clarity.md`)._

Sesiunile Clarity cu rage clicks; suma zilelor. **Draft:** forma payloadului (număr de sesiuni sau procent) se confirmă pe fixtures reale (`docs/contracts/clarity.md`). Valorile Clarity acoperă ferestre de 24 h în UTC, nu zile calendaristice.

### clarity_dead_click_sessions
Sesiunile Clarity cu dead clicks; suma zilelor. **Draft**, ca mai sus.

### clarity_quickback_sessions
Sesiunile Clarity cu quick backs; suma zilelor. **Draft**, ca mai sus.

### clarity_scroll_depth
Scroll depth Clarity, medie ponderată cu sesiunile fiecărei zile (80% pe 100 de sesiuni și 20% pe 900 dau 26%, nu 50%). **Draft**, ca mai sus.

### google_ads_spend
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Costul Google Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

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

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

### google_ads_cpa
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / conversii pe totalurile perioadei (Google Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

### meta_ads_spend
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Costul Meta Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

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

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

### meta_ads_cpa
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / conversii pe totalurile perioadei (Meta Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

### tiktok_ads_spend
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Costul TikTok Ads în perioadă, în moneda declarată la import; suma zilelor. Nu se însumează între monede.

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

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

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

### tiktok_ads_cpa
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Cost / conversii pe totalurile perioadei (TikTok Ads), pentru aceeași acțiune și configurație de atribuire; în moneda declarată.

**Draft:** Unitatea monetară nu există în contractul MetricResponse (unit = count provizoriu); moneda vine din lotul de import și din view.

### mentions_count
_Observații: view-urile `paid_metric_observations` / `mentions_metric_observations`; vezi `docs/contracts/csv-*.md`._

Numărul de mențiuni distincte publicate în interval; importul nu schimbă data publicării.
