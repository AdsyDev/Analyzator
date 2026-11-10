# Contract: dovezile unei metrici (`brand_metric_evidence`)

Surse: propunerea din 10 nov. 2026 („din fiecare indicator, clientul ajunge la sursa concluziei”), spec cap. 12 și 26. Migrația
`20261110090000_stage2_evidence_action_plan.sql`, decizia G-4. Consumator: `EvidenceDrawer`, prin `MetricsProvider.evidence`.

## Cererea

`public.brand_metric_evidence(p_brand_id uuid, p_metric_key text, p_start date, p_end date, p_device text default null, p_limit integer default 10)`

- **SECURITY INVOKER**, executabilă de `authenticated`; aceeași poartă ca `brand_metrics` (excepția E8). Verifică în corp `has_brand_access`:
  brand străin, brand inexistent și lipsa sesiunii dau același răspuns (`42501`, „Nu ai acces la acest spațiu de brand”).
- `p_metric_key` trebuie să respecte `^[a-z][a-z0-9_]{0,63}$` (altfel `22023`). Perioada: `p_end >= p_start`, cel mult 400 de zile.
- `p_limit` se aduce în intervalul 1–100. `p_device` contează doar pentru metricile SEOmonitor (`desktop` implicit, ca pe carduri).

## Răspunsul

```json
{
  "metric_key": "meta_ads_spend",
  "version": 2,
  "aggregation": "sum",
  "unit": "currency",
  "source": "meta_ads",
  "status": "ok",
  "total_records": 28,
  "records": [{ "date": "2026-11-09", "value": 16, "currency": "RON" }]
}
```

| Câmp | Note |
|---|---|
| `status` | `ok` (există observații), `unavailable` (sursă conectată, nicio observație în interval), `not_connected` (metrică fără definiție, fără view de observații sau sursă neconectată pentru brand) |
| `total_records` | numărul tuturor observațiilor din interval, indiferent de `p_limit` |
| `records` | cele mai recente `p_limit` observații, descrescător după dată; forma depinde de `aggregation` |
| `aggregation`, `unit`, `source`, `version` | din `metric_definitions_current`; `null` pentru o cheie fără definiție |

Forma unei observații, după agregarea din registru:

| `aggregation` | Câmpuri |
|---|---|
| `sum`, `last_observation` și restul | `date`, `value` (+ `currency` la metricile de ads) |
| `ratio` | `date`, `numerator`, `denominator` (rata nu vine calculată pe zi) |
| `weighted_mean` | `date`, `value`, `weight` |
| `interval_report_only` | `start`, `end`, `value` |

## Reguli

- Funcția **nu calculează**: întoarce observațiile din aceleași view-uri și prin aceeași funcție (`private.metric_observations`) ca
  `brand_metrics` și `brand_metric_trends`. Valoarea cardului și dovezile lui au aceeași sursă.
- O observație cu valoare `null` rămâne `null` („Fără date” în drawer), nu zero.
- Serverul nu trimite text: etichetele coloanelor și formatarea sunt în `apps/web/src/data/supabase/metricsProvider.ts`.
- `imported_at` și `payload_hash` din `Evidence` rămân `null` pe date reale: observațiile agregate nu au un singur payload. Drawerul
  ascunde rândurile respective.

## Teste

`supabase/tests/database/24_stage2_evidence_action_plan.test.sql`, N1–N4: valori necalculate, limită și total, rate cu numărător și
numitor, stări fără date, clientul vede aceleași observații ca agenția, refuzuri identice fără acces.
`apps/web/src/data/supabase/metricsProvider.test.ts`: parametrii cererii, coloanele pe agregare, cele trei răspunsuri fără date,
răspuns în afara contractului.
