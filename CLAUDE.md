# Analyzator

Platformă de analiză pentru clienții AdSymphony (pilot: trei branduri STADA). Context complet: `docs/product/brief.md` (decizii de pilot, cap. 4, 11, 12) și `docs/product/spec.md` (arhitectură și contracte, cap. 24-26).

## Reguli nenegociabile

1. **Fără date demo** în staging și production. Un modul fără sursă afișează „Sursă neconectată" și motivul.
2. **Fără secrete** în frontend, în prompturi sau în documente. Tokenurile furnizorilor trăiesc doar în worker și în funcțiile server.
3. **Fără acces cross-tenant.** Orice query din worker cu service role verifică explicit `tenant_id` (și `brand_id` unde e cazul). RLS pe toate tabelele expuse.
4. **Fără formule de metrici în UI.** Formulele trăiesc în SQL (view-uri, funcții) sau în registrul de metrici (`docs/metrics`).
5. **Fără schimbare de schemă fără migration** în `supabase/migrations`.
6. **Nivelul C nu se construiește înainte de 26 octombrie 2026** (inclusiv AdSy AI). Fără funcții noi după 16 octombrie; cererile de scop se notează cu impact în timp și cost.
7. **Limba interfeței este româna**, cu termenii de marketing uzuali în engleză; tooltipurile explică fiecare KPI.
8. **`null`, `0` și eroare sunt trei stări distincte.** Nu se deduc câmpuri lipsente; zero nu înlocuiește lipsa.
9. **Toate datele calendaristice în Europe/Bucharest** în UI și la calculul perioadelor; ISO în API.

## Convenții

- `tenant_id` pe toate entitățile de business, `brand_id` pe cele de brand, cu FK compuse `(tenant_id, brand_id)`. **Excepție explicită:** `metric_definitions` (registrul de metrici al produsului, același pentru toți clienții) nu are `tenant_id`; personalizarea per client va sta în `dashboard_configs`. Vezi `docs/security-tests.md`, E2.
- Formulele metricilor stau în schema `metrics` (funcții pure, fără acces la tabele), iar definițiile în `metric_definitions` și `docs/metrics/registry.md`. Contractul răspunsului: `docs/contracts/metric-response.md`.
- Un singur șablon pentru toate brandurile; personalizarea e configurare, nu cod.
- Importul CSV folosește aceleași tabele și contracte ca viitorii conectori.
- Importurile sunt idempotente (upsert pe cheie naturală), scrise în `sync_runs`, și rulează în afara browserului.
- Nu se schimbă definițiile metricilor fără actualizarea contractului din `docs/contracts` și a testelor.
- Nu se modifică permisiuni pentru a face testele să treacă.

## Structura

`apps/web` (React 18, TS strict, Tailwind) · `server` · `connectors` · `analytics` · `supabase/migrations` · `tests/fixtures` · `docs/{product,contracts,metrics}` · `docs/runbook.md`

## Cum lucrăm

- La începutul fiecărui task enumeri **criteriile de acceptare**.
- La final dai **diff-ul, testele relevante și ce a rămas neverificat**.
- Un singur instrument scrie în repo la un moment dat.
- Comenzi: `npm run dev`, `npm run build`, `npm run typecheck`, `npm run test`.
