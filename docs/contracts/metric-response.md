# Contract: răspunsul unei metrici

Sursa de adevăr: `docs/product/spec.md` cap. 26, cu deciziile din 7 oct 2026 (B2). Implementare: `metrics.compute` și `metrics.build_response` (migrația `20261007140000_metric_registry.sql`). Tipul TypeScript: `analytics/contracts/metric-response.ts`. Un test compară lista de câmpuri de mai jos cu tipul TS, iar testul pgTAP `06_metric_registry` o compară cu ieșirea SQL.

Un răspuns are forma `{ data, meta }`. `data` e o listă de metrici; fiecare are `metric_key` plus câmpurile de mai jos.

## Câmpurile metricii

| Câmp | Tip | Semnificație |
|---|---|---|
| `value` | număr sau null | Valoarea pe perioadă. Null când nu se poate afișa o valoare: fără conexiune, eroare, numitor zero, zero neconfirmat. Null nu înseamnă 0. |
| `unit` | `count`, `percent`, `seconds`, `position`, `score` | Unitatea din registru. Procentele sunt deja ×100 (2 = 2%). |
| `numerator` | număr sau null | Pentru rate și medii ponderate: numărătorul agregat (de exemplu, clicks). |
| `denominator` | număr sau null | Numitorul agregat (de exemplu, impressions sau sesiuni). |
| `comparison_value` | număr sau null | Aceeași metrică pe perioada de comparație. |
| `absolute_change` | număr sau null | `value − comparison_value`. Pentru `unit = percent` e în **puncte procentuale**. |
| `relative_change` | număr sau null | `100 × (value − comparison_value) / |comparison_value|`, în procente. Null pe bază zero. |
| `status` | vezi „Statusuri" | Cea mai gravă condiție aplicabilă. Celelalte condiții apar în `meta.warnings`. |
| `data_as_of` | dată ISO sau null | Ultima zi cu date pentru metrica asta (sursele diferă între ele). |
| `coverage` | 0–1 sau null | Zile confirmate / zile din perioadă; 1 sau 0 pentru ultima observație și raportul pe interval. |
| `evidence_query` | obiect | Referință stabilă: `metric_key`, `version`, `brand_id`, `period`, `comparison_period`. EvidenceDrawer o rezolvă ulterior. |

**Diferență față de spec cap. 26 (decizie 7 oct 2026):** spec-ul pune `data_as_of` și `coverage` doar în `meta`. Brief cap. 4 le pune pe metrică. Le păstrăm în ambele locuri: în `meta` ca rezumat (cea mai veche dată, cea mai mică acoperire) și pe fiecare metrică, pentru că pe Overview sursele au date diferite.

## Statusuri

Ordinea = gravitatea; se alege prima condiție îndeplinită.

| Ordine | Status | Condiție | Text UI |
|---|---|---|---|
| 1 | `not_connected` | Fără conexiune sau fără acces | „Sursă neconectată" |
| 2 | `unavailable` | Interogare eșuată, fără zile confirmate, lipsește raportul pe interval, lipsește observația, observații duplicate | „Indisponibil" |
| 3 | `cannot_compute` | Numitor sau suma ponderilor zero | „Nu se poate calcula" |
| 4 | `insufficient_sample` | `n < min_sample` (numitorul, la rate) | „Eșantion insuficient" |
| 5 | `stale` | `data_as_of` < min(sfârșitul perioadei, ieri) − `freshness_grace_days` | „Date neactualizate" |
| 6 | `partial` | Acoperire < 100%, rânduri excluse sau zero neconfirmat | „Date parțiale" |
| 7 | `base_zero` | Valoare validă, comparație cu bază 0 | „Bază zero" |
| 8 | `ok` | Nicio condiție de mai sus | — |

## Meta

| Câmp | Semnificație |
|---|---|
| `tenant_id` | Rezolvat pe server (RPC), niciodată primit de la client |
| `brand_id`, `period`, `comparison_period`, `cohort_version` | Din contextul cererii |
| `data_as_of` | Cea mai veche `data_as_of` dintre metrici |
| `generated_at` | Momentul generării |
| `sources` | Sursele principale ale metricilor |
| `coverage` | Cea mai mică acoperire dintre metrici |
| `metric_definition_version` | `{ metric_key: versiune }` |
| `warnings` | Listă de `{ metric_key, code, severity, detail }` |

## Coduri în `meta.warnings`

| `code` | `severity` | Când |
|---|---|---|
| `unavailable`, `cannot_compute`, `insufficient_sample`, `stale`, `partial`, `base_zero` | warning | Condiții secundare (statusul principal e altul) |
| `query_failed` | warning | Interogarea sursei a eșuat |
| `no_confirmed_data`, `interval_report_missing`, `no_observation`, `duplicate_observations`, `zero_denominator`, `zero_not_confirmed` | warning | Motivul unei valori null |
| `excluded_rows` | warning | `detail = { reason, count }`, de exemplu `missing_weight`, `outside_period`, `interval_mismatch` |
| `comparison_unavailable`, `comparison_partial` | warning | Comparația nu e calculabilă sau e parțială |
| `incomplete_period` | info | MTD, YTD sau perioadă care include ziua curentă; `detail = "perioadă incompletă"` |
| `aggregation_label` | info | Eticheta agregării din registru (de exemplu „medie în perioadă") |
| `definition_draft` | info | Definiție neconfirmată pe date reale; `detail` = motivul |
