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
