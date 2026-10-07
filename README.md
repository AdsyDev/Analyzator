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
- `npm run build` — verificare de tipuri și build
- `npm run typecheck`
- `npm run test`

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
- `npm run test:guards`: mutații care slăbesc protecțiile; fiecare trebuie prinsă de teste
