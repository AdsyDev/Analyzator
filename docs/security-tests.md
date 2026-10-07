# Teste de securitate: izolare pe tenant și brand

Se rulează din nou înainte de lansare și după orice migration care adaugă tabele, view-uri, funcții, bucket-uri sau exporturi.

## Cum rulez

Necesită Docker (OrbStack) și Supabase CLI. Rulează **doar pe Supabase local**: scriptul refuză alt `API_URL`.

```bash
supabase start
npm run test:security
```

Scriptul (`scripts/test-security.sh`) face trei pași:
1. `supabase db reset`: migrații și seed-ul de test (`supabase/tests/seed/seed.sql`);
2. pgTAP (`supabase/tests/database/*.test.sql`);
3. atacuri prin API (`tests/security/api-isolation.test.mjs`, `node --test`), cu JWT-uri semnate local pentru utilizatorii din seed.

**Verificarea testelor.** Înainte de lansare, slăbește temporar `private.has_brand_role` (să întoarcă `true`) și confirmă că suitele pică; apoi `supabase db reset`. Ultima verificare (7 oct 2026): 10 teste API și majoritatea testelor pgTAP de izolare au picat, cum era de așteptat.

## Date de test

| Tenant | Branduri | Utilizatori |
|---|---|---|
| T1 `1000…0001` | 1A `2000…0011`, 1B `2000…0012` | admin T1 · strategist T1 (acces 1A) · account T1 (acces 1B) · client T1 (acces 1A) · client fără acces |
| T2 `1000…0002` | 2A `2000…0021`, 2B `2000…0022` | admin T2 · strategist T2 (acces 2A) |

## Inventar la 7 oct 2026

| Tip | Ce există | Acoperit de |
|---|---|---|
| Tabele | 10 în `public`, toate cu RLS | A1–A7, B1, B2, 01–03 |
| View-uri / materialized views | niciunul | A8, A9 (gardă pentru viitor) |
| Funcții RPC în `public` | niciuna | A11, B3 |
| SECURITY DEFINER | 6 în `private`: 4 de autorizare (boolean, răspund doar pentru `auth.uid()`), `user_has_brand_role` și `user_can_import` (user_id explicit, neexecutabile de clienți), `audit_row` (trigger) | A10, A14, B3 |
| Bucket-uri storage | niciunul | A12, B6 (gardă) |
| Realtime | nicio publicare | A13 |
| GraphQL | `pg_graphql` nu e instalat local | B7 (tolerant: ori eroare, ori doar date permise) |
| Exporturi, linkuri semnate, cache | nu există încă | **neverificat** (vezi mai jos) |

## A. Gărzi de inventar (pgTAP, `04_security_inventory.test.sql`)

| ID | Verificare |
|---|---|
| A1 | RLS activ pe toate tabelele din `public` |
| A2 | Fiecare tabel are politică explicită pe SELECT, INSERT, UPDATE și DELETE |
| A3 | Nicio politică `true` în `public` sau `storage` |
| A4 | Toate politicile sunt restrânse la `authenticated` |
| A5 | `anon` și `PUBLIC` nu au privilegii pe tabele sau coloane |
| A6 | `authenticated` nu are TRUNCATE (ocolește RLS), REFERENCES sau TRIGGER |
| A7 | `id`, `tenant_id`, `user_id` și coloanele de autor nu sunt actualizabile; `brand_id` doar pe `source_connections` |
| A8 | Orice view din `public` are `security_invoker = true` |
| A9 | Niciun materialized view în schemele expuse (nu respectă RLS) |
| A10 | Nicio funcție SECURITY DEFINER în schemele expuse; toate au `search_path` fixat; niciuna nu returnează date (doar boolean sau trigger); lista exactă a funcțiilor executabile de `authenticated` |
| A11 | Nicio funcție RPC în `public`. **O funcție nouă trebuie revizuită și adăugată explicit.** |
| A12 | Niciun bucket public |
| A13 | Niciun tabel în `supabase_realtime`, nicio publicație FOR ALL TABLES |
| A14 | Fără oracol: un brand străin existent și unul inexistent dau același răspuns; `user_has_brand_role` și TRUNCATE sunt refuzate ca `authenticated` |

## Scenarii SQL (pgTAP, `01`–`03`)

- **01:** izolare brand și tenant pentru strategist T1, strategist T2 și admin T2; scrieri pe brand străin; FK compuse; timezone invalid.
- **02:** client fără `brand_access` (0 rânduri); client cu acces (fără date de agenție, fără auto-acordare, fără escaladare de rol); account nu scrie direct în `import_batches`; `user_can_import`; anon.
- **03:** revocare `brand_access`, revocare membership, arhivarea tenantului; auditul cu actor; `audit_events` imutabil; RLS peste tot.

## B. Atacuri prin API (`tests/security/api-isolation.test.mjs`)

| ID | Vector | Rezultat așteptat |
|---|---|---|
| B1 | GET pe fiecare tabel cu `tenant_id`/`brand_id` străin; `or=`, `not.`, embedding în ambele direcții; `Prefer: count=exact`; client fără acces; admin T2 pe T1 | `[]`; count = doar rândurile proprii |
| B2 | PATCH pe brand străin; PATCH `tenant_id`; POST brand în T2; DELETE pe brands, tenants, audit; auto-acordare `brand_access`; escaladare de rol; admin T1 → acces în T2; mutarea unui membership; POST pe `sync_runs`, `import_batches`, `audit_events` | 0 rânduri afectate sau 401/403; valorile verificate cu service role |
| B3 | `/rpc/<funcție privată>`; `Accept-Profile` / `Content-Profile` pe `private`, `auth`, `tests`, `storage`, `vault` | 404 / 406 |
| B4 | JWT cu secret greșit, `role: service_role` falsificat, `alg: none`, expirat; claims injectate (`tenant_id`, `brand_ids`, `app_metadata.role`); `sub` inexistent; doar cheia anon | 401, sau 0 rânduri |
| B5 | Revocare `brand_access` (de admin, prin API) și revocare membership, cu **același JWT** | 0 rânduri la următorul request |
| B6 | Listare și creare bucket; GET / sign pe căi ghicite `imports/<tenant>/<brand>/<fișier>` | listă goală sau ≥ 400 |
| B7 | GraphQL `brandsCollection` | doar 1A, sau eroare |

## Neverificat (7 oct 2026)

- **Exporturi și linkuri semnate:** nu există încă. La implementare: export generat server-side, cu verificare `has_brand_access` pentru utilizatorul cerut, link cu expirare scurtă, testat cu ID schimbat.
- **Cache:** nu există. Cheia de cache trebuie să includă tenant, brand, rol, filtre și versiunea datasetului (spec cap. 26). Test: doi utilizatori, același URL, branduri diferite.
- **Storage real:** nu există bucket-uri, deci B6 doar confirmă că nu poți crea sau citi nimic. La primul bucket: politici pe `storage.objects` după primul segment de cale (`tenant_id/brand_id/…`), plus teste cu căi ghicite pe un obiect real.
- **GraphQL pe staging:** `pg_graphql` lipsește local, dar e de obicei activ pe proiectele hosted. B7 trebuie rulat și pe un mediu cu `pg_graphql`, sau extensia dezactivată pe staging și production dacă nu e folosită.
- **Login real și sign-out forțat:** JWT-urile sunt semnate în test, nu obținute prin login. Sesiunea nu e invalidată la revocare: datele dispar imediat (RLS), dar tokenul rămâne valid până expiră.
- **Service role în worker:** nu există cod de worker. Verificarea explicită `tenant_id` din worker se testează odată cu conectorii.
- **Configurarea Auth pe staging:** signup dezactivat doar în `config.toml` local; pe staging se aplică prin CI (`supabase config push`).
- **Contextul trimis către AI:** nivel C, nu există.

## Constatări deschise (propuneri, neaplicate)

| # | Severitate | Constatare | Corecție propusă |
|---|---|---|---|
| S1 | Scăzută | `sync_runs.source_connection_id` verifică doar tenantul: un run pe 1A poate referi conexiunea lui 1B. Scrie doar service role, deci e o problemă de integritate, nu de acces. | Trigger: conexiunea are `brand_id` null sau egal cu `brand_id` al run-ului. |
| S2 | Scăzută | Un strategist poate adăuga competitori într-o versiune veche a setului (istoricul nu e înghețat). | Trigger pe `competitor_set_members`: insert permis doar în cea mai recentă versiune, sau coloană `published_at` după care setul e înghețat. |
| S3 | Scăzută | Admin T1 poate insera membership pentru orice UUID; eroarea FK spune dacă UUID-ul există în `auth.users` (oracol de existență, dar UUID-urile nu se pot ghici). Poate adăuga și un utilizator din T2 fără acordul lui (fără acces la datele T2). | Membership-urile se creează doar prin funcția server de invitație (service role); scoatem INSERT pe `memberships` pentru `authenticated`. |
| S4 | Medie (operațională) | Revocarea nu închide sesiunea. | Funcția server de revocare apelează `auth.admin.signOut(user, 'global')` după update; JWT expiry scurt (≤ 1 h). |
