# Analyzator

Analiză de marketing pentru clienții AdSymphony. Vezi `CLAUDE.md` pentru reguli și `docs/product/` pentru brief și specificație.

## Pornire

Necesită Node (vezi `.nvmrc`).

```bash
npm --prefix apps/web install
cp .env.example .env.local   # completează local; nu comite
npm run dev
```

## Comenzi

- `npm run dev` — server de dezvoltare
- `npm run dev:preview` — dezvoltare cu date fictive (vezi „Previzualizare design”)
- `npm run build` — verificare de tipuri și build de producție
- `npm run build:staging` — build cu `--mode staging`
- `npm run typecheck`
- `npm run test`

## Previzualizare design (date fictive)

Pentru a vedea interfața fără surse conectate:

```bash
npm run dev:preview
```

Setează `VITE_DESIGN_PREVIEW=true` și comută stratul de date pe fixtures din `tests/fixtures/ui/`: trei branduri fictive, cu toate cele opt statusuri de metrici, cu `partial`, `stale` și `not_connected` pe fiecare ecran cu date. Un banner „Previzualizare design — date fictive” rămâne vizibil permanent.

Garanții (regula 1 din `CLAUDE.md`: fără date demo în staging și production):

- Flag-ul se citește **doar la build**. Fără el, importul fixtures dispare din bundle.
- Flag-ul e acceptat doar în modurile `development` și `design-preview`. Orice alt mod (`production`, `staging`, un mod nou sau necunoscut) oprește build-ul cu eroare, la fel o valoare alta decât `true` sau `false`. Nu seta variabila în mediul CI și nici în fișierele `.env` ale staging-ului.
- `apps/web/src/preview/build.test.ts` rulează build-uri reale: verifică eșecul pe `production`, `staging` și moduri necunoscute, și că bundle-urile fără flag nu conțin fixtures (un control pozitiv dovedește că verificarea ar prinde o scurgere). Rulează cu `npm run test`.
- `npm run build:preview` produce un build local cu fixtures, doar pentru demonstrații; nu se publică.

## Baza de date (local)

Necesită Docker (OrbStack) și Supabase CLI.

```bash
supabase start
npm run db:reset   # migrații + seed de test (supabase/tests/seed)
npm run test:db    # teste pgTAP de izolare (RLS)
```

Seed-ul de test rulează doar local. Migrațiile ajung pe staging prin CI.

## Tokenul unei surse (până există ecranul Administrare → Surse)

Tokenul ajunge în Supabase Vault prin Edge Function `source-credentials`, ca `agency_admin`:

```bash
npm run set-source-token -- --connection <uuid> --email <admin@agentie.ro>
```

Scriptul cere parola și tokenul fără ecou. Cu `--validate` face și un apel de test, care consumă 1 din cele 10 apeluri zilnice Clarity. Local, funcția se pornește cu `supabase functions serve source-credentials`.

## Teste

- `npm run test`: conectori, funcția server, web
- `npm run test:security`: reset local, pgTAP și atacuri prin API și pe Edge Function (vezi `docs/security-tests.md`)
- `npm run test:integration`: reset local, apoi pipeline-ul Clarity pe fixtures docs-derived (worker → `clarity_daily` → view → `metrics.compute`)
- `npm run test:guards`: mutații care slăbesc protecțiile; fiecare trebuie prinsă de teste
