# AI referrals, calitatea trackingului, buget și pacing

Trei RPC-uri din Etapa 3 (deciziile J din `docs/decisions.md`), migrația `20261111090000_stage3_ai_referrals_tracking_budget.sql`. Toate urmează regimul E8 din `docs/security-tests.md`: `SECURITY INVOKER`, verifică `private.has_brand_access` în corp, citesc prin RLS. Fără autentificare sau fără acces la brand: eroare `42501`.

## `brand_ai_referrals(p_brand_id, p_start, p_end)`

Sesiunile GA4 venite din asistenți AI, pe domeniu, din `web_daily`.

```json
{
  "connected": true,
  "sources": [{ "domain": "chatgpt.com", "sessions": 13, "key_events": 3, "conversion_rate": null }],
  "rules_version": "v1",
  "rules_effective_from": "2026-11-11",
  "data_as_of": "2026-10-05"
}
```

- `connected: false` când GA4 nu e conectat pe brand; atunci celelalte chei lipsesc.
- **Regulile de clasificare** stau în `metrics.ai_referral_rule_list()` (funcție pură, fără tabel) și se aplică prin `metrics.ai_referral_domain(source_medium)`. Sursa sesiunii e partea dinaintea „ / ” din `sessionSourceMedium`, cu litere mici. O regulă `domain` se potrivește cu domeniul exact sau cu un subdomeniu al lui; o regulă `source` cu textul exact (`utm_source` fără domeniu).
- **Versiunea 1** (în vigoare din 11 nov. 2026): `chatgpt.com` (și `chat.openai.com`), `perplexity.ai`, `gemini.google.com` (și `bard.google.com`), `copilot.microsoft.com`, `claude.ai`, `chat.deepseek.com`, `meta.ai`, `grok.com`, `chat.mistral.ai`, `you.com`, `poe.com`; surse fără domeniu: `chatgpt`, `perplexity`, `gemini`, `copilot`, `claude`.
- O schimbare a listei înseamnă o versiune nouă, cu altă dată de intrare în vigoare; cifrele perioadelor trecute se recalculează cu regulile curente.
- **Limite:** traficul din Google AI Overviews și AI Mode vine ca `google / organic` și nu poate fi deosebit. Traficul fără referrer intră la Direct. Se arată doar partea identificabilă.
- `key_events` e `null` când raportul de evenimente cheie (`web_key_events`) nu are date în perioadă, ca la canale (regula 8).
- `conversion_rate` e mereu `null`: „rata sesiunilor cu key event” nu are definiție în registru (G-1), iar evenimente / sesiuni nu e acea rată. Interfața ascunde coloana cât timp e goală.

## `brand_tracking_quality(p_brand_id, p_start, p_end)`

Verificări ale măsurării GA4, calculate la cerere din datele deja colectate.

```json
{
  "connected": true,
  "checked_at": "2026-10-06T05:00:00+00:00",
  "checks": [
    { "id": "key_events", "status": "ok", "event_names": 1 },
    { "id": "daily_coverage", "status": "warning", "covered_days": 4, "expected_days": 5 },
    { "id": "reconciliation", "status": "warning", "difference_pct": -1.7, "tolerance_pct": 1, "period_start": "2026-09-28", "period_end": "2026-10-04" },
    { "id": "unassigned", "status": "ok", "share_pct": 3.1, "threshold_pct": 10 },
    { "id": "landing_not_set", "status": "ok", "share_pct": 3.1, "threshold_pct": 10 }
  ]
}
```

- `checked_at` e momentul ultimei colectări GA4 a brandului, nu ora cererii. Fără nicio colectare: `checked_at: null` și `checks: []`.
- Stări: `ok`, `warning`, `problem`, `unknown`. Textele în română se aleg în interfață; starea și pragurile vin de aici.

| `id` | Ce verifică | Stare |
|---|---|---|
| `key_events` | Evenimente cheie distincte cu valoare peste zero în perioadă | `ok` dacă există; altfel `warning` |
| `daily_coverage` | Zile cu sesiuni din zilele deja colectate (până la ultima zi cu date, nu până la sfârșitul perioadei) | `ok` toate; `warning` unele lipsă; `problem` niciuna; `unknown` perioadă necolectată |
| `reconciliation` | Cea mai recentă reconciliere a sesiunilor (`source_reconciliations`) care atinge perioada | `ok` la `match` / `within_tolerance`; `warning` la `mismatch`; altfel `unknown` |
| `unassigned` | Cota sesiunilor cu grupul de canale `Unassigned` | `warning` de la prag; `unknown` fără sesiuni |
| `landing_not_set` | Cota sesiunilor cu landing page `(not set)` | `warning` de la prag; `unknown` fără sesiuni |

Pragurile stau în `metrics.tracking_thresholds()` (10 % pentru ambele cote) și sunt provizorii (J-3). O zi fără sesiuni nu e dovada unei probleme: un site mic poate să nu aibă trafic în ziua respectivă.

## `paid_budgets` și `brand_paid_budget(p_brand_id, p_day)`

`paid_budgets`: bugetul de paid media aprobat pe un interval (`plan_from`, `plan_to`, cel mult 400 de zile), pentru toate platformele brandului: `amount` (> 0), `currency` (trei litere), `note` (opțional), `created_by`.

- **Citire:** oricine are acces la brand, inclusiv clientul.
- **Scriere:** `agency_admin`, `strategist` și `account` cu acces la brand; `created_by` trebuie să fie utilizatorul curent. Rândurile nu se modifică (fără `UPDATE`): un plan greșit se șterge și se introduce din nou. Inserarea și ștergerea se auditează în `audit_events`.
- La suprapunere, pentru o zi e în vigoare planul introdus cel mai recent.

`brand_paid_budget` întoarce planul în vigoare în ziua cerută (interfața trimite sfârșitul perioadei alese):

```json
{
  "plan": {
    "id": "…", "plan_from": "2026-10-01", "plan_to": "2026-10-31",
    "approved_budget": 1000, "currency": "RON", "plan_note": "plan lunar",
    "spent": 70, "currency_mismatch": false, "data_as_of": "2026-10-07",
    "elapsed_days": 7, "planned_days": 31, "spend_pct": 7, "time_pct": 22.58
  }
}
```

- `plan: null` când nicio zi a vreunui plan nu acoperă ziua cerută. Lipsa unui buget nu e buget zero.
- `spent`: suma costului din `paid_daily` (rândurile fără defalcare, ca în `brand_paid`) între începutul planului și sfârșitul lui.
- `data_as_of`: ultima zi cu cost din plan. `elapsed_days` se numără până la ea, ca cele două procente să se refere la aceeași zi.
- `currency_mismatch: true` când costul e în altă monedă decât planul sau în mai multe monede: `spent` și `spend_pct` sunt `null`. Monedele nu se convertesc.
- `spend_pct` = 100 × cost / buget; `time_pct` = 100 × zile trecute / zile planificate, ambele prin `metrics.ratio`. Sunt repere liniare, fără verdict.
