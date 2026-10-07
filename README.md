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
