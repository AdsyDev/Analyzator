# Teste de securitate: izolare pe tenant și brand

Se rulează din nou înainte de lansare și după orice migration care adaugă tabele, view-uri, funcții, bucket-uri sau exporturi.

## Cum rulez

Necesită Docker (OrbStack) și Supabase CLI. Rulează **doar pe Supabase local**: scriptul refuză alt `API_URL`.

```bash
supabase start
npm run test:security
```

Scriptul (`scripts/test-security.sh`) face patru pași:
1. `supabase db reset`: migrații și seed-ul de test (`supabase/tests/seed/seed.sql`);
2. pgTAP (`supabase/tests/database/*.test.sql`);
3. pornește `supabase functions serve source-credentials` în fundal (oprit la final);
4. atacuri prin API și pe Edge Function (`tests/security/*.test.mjs`, `node --test --test-concurrency=1`), cu JWT-uri semnate local pentru utilizatorii din seed. Fișierele rulează **secvențial**, pentru că modifică aceeași bază (revocări, tokenuri, contoare); rulate în paralel, dau eșecuri false.

**Verificarea gărzilor prin mutații:**

```bash
npm run test:guards
```

`scripts/test-guard-mutations.sh` aplică pe rând câte o mutație care slăbește o protecție, rulează testul pgTAP care ar trebui s-o prindă și iese cu eroare dacă testul trece. La final resetează baza locală. Vezi secțiunea M.

## Date de test

| Tenant | Branduri | Utilizatori |
|---|---|---|
| T1 `1000…0001` | 1A `2000…0011`, 1B `2000…0012` | admin T1 · strategist T1 (acces 1A) · account T1 (acces 1B) · client T1 (acces 1A) · client fără acces |
| T2 `1000…0002` | 2A `2000…0021`, 2B `2000…0022` | admin T2 · strategist T2 (acces 2A) |

## Excepții aprobate

### E1. Funcții server în `public` (aprobată 7 oct 2026)

Garda inițială interzicea orice funcție în `public` și orice SECURITY DEFINER care returnează date. Excepție pentru credențialele din Vault:

| Funcție | Returnează | Cine o apelează |
|---|---|---|
| `set_source_token(actor, connection, token)` | starea (`unverified`) | Edge Function `source-credentials` |
| `get_source_token(connection)` | **tokenul decriptat** | worker-ul, Edge Function (validare) |
| `record_source_validation(connection, ok, error)` | starea | Edge Function, worker |

Condiții, verificate de teste:
- `anon`, `authenticated` și `PUBLIC` nu au EXECUTE (A10, A11, V1, B8).
- Fiecare funcție din `public` e într-o listă explicită în `04_security_inventory.test.sql`. O funcție nelistată pică testul.
- Corpul fiecărei funcții verifică singur că apelantul e `service_role` (claim JWT **și** rolul de bază de date), nu se bazează doar pe GRANT (V3, plus verificare prin mutație).
- `set_source_token` verifică în corp că actorul e `agency_admin` activ în tenantul conexiunii (V4).
- `get_source_token` verifică faptul că secretul are numele `source_connection:<id>` al conexiunii cerute; o referință mutată spre secretul altei conexiuni e refuzată (V8).

### E2. `metric_definitions` fără `tenant_id` (aprobată 7 oct 2026)

Registrul de metrici e al produsului, nu al unui client: aceleași definiții pentru toți tenanții. Personalizarea per client va sta în `dashboard_configs`.
- Citire: orice utilizator cu sesiune (`(select auth.uid()) is not null`), nu `anon` (06: A1, A2).
- Scriere: doar prin migrație. Politicile pentru INSERT, UPDATE și DELETE sunt `false`, iar un trigger refuză UPDATE și DELETE chiar și pentru owner: versiunile sunt imutabile (06: D2).
- Registrul nu conține date de client.

### E3. Schema `metrics` executabilă de `authenticated` (aprobată 7 oct 2026)

Funcțiile de calcul al metricilor sunt pure: primesc definiția și observațiile ca `jsonb` și nu citesc tabele. De aceea `authenticated` le poate executa fără risc de acces la date. Garda A15 cere: IMMUTABLE sau STABLE, fără SECURITY DEFINER, `search_path` gol, nicio referință la tabele sau view-uri, nicio relație în schemă, fără EXECUTE pentru `anon`. Schema nu e expusă prin API (`PGRST_DB_SCHEMAS = public,graphql_public`).

### E4. `create_competitor_set_version` executabilă de `authenticated` (aprobată 8 oct 2026)

Singura funcție din `public` apelabilă de utilizatori. Creează atomic o versiune nouă a setului de competitori (set + membri), pentru că `competitor_sets` și `competitor_set_members` sunt imutabile și două insert-uri separate puteau lăsa un set efectiv fără membri.

- **SECURITY INVOKER**, nu DEFINER: rulează cu drepturile apelantului, deci RLS (`competitor_sets_insert`, `competitor_set_members_insert`) rămâne autoritatea; funcția nu poate scrie nimic ce politicile nu permit. Nu primește actor din exterior: `created_by = auth.uid()`. Garda A10 (nicio funcție DEFINER executabilă de clienți) rămâne neschimbată. Nu e nevoie de Edge Function.
- Verificarea explicită din corp (`private.has_brand_role`, agency_admin sau strategist) există pentru mesaje clare în română; brand inexistent, brand străin și rol insuficient dau **același** răspuns (fără oracol de existență).
- Concurența: `pg_advisory_xact_lock` pe brand serializează apelurile, deci `max(version)+1` nu poate produce aceeași versiune de două ori.
- Auditul: triggerele existente scriu în `audit_events` un rând pentru set și câte unul pentru fiecare membru, cu actorul din JWT, în aceeași tranzacție.
- `anon` și `PUBLIC` nu au EXECUTE (A11/E4). Garda A11 admite exact această funcție pentru `authenticated`; orice altă funcție din `public` executabilă de clienți pică testul.

**Contractul pentru UI** (`supabase.rpc('create_competitor_set_version', …)`):

| Parametru | Tip | Note |
|---|---|---|
| `p_brand_id` | uuid | brandul; tenantul se deduce din brand |
| `p_effective_from` | date (ISO `YYYY-MM-DD`) | ≥ azi în Europe/Bucharest; unic per brand |
| `p_note` | text sau null | tăiată; maximum 1000 de caractere; gol → null |
| `p_members` | jsonb, listă de 1–10 obiecte `{ "name": text, "domain"?: text, "color"?: "#RRGGBB" }` | ordinea din listă devine `sort_order` |

Răspuns: un rând `{ competitor_set_id, version, effective_from, member_count }`.

Normalizări: `name` tăiat (maximum 120 de caractere), unic fără deosebire de majuscule; `domain` lowercase, fără schemă, utilizator, port, cale, query sau fragment, gol → null; `color` gol → null.

Erori (`error.code` PostgREST = SQLSTATE, `error.message` în română, afișabil direct):

| SQLSTATE | Cazuri |
|---|---|
| `42501` | „Nu ai dreptul să creezi o versiune a setului de competitori pentru acest brand” (fără sesiune, rol altul decât agency_admin/strategist, fără acces la brand, alt tenant, brand inexistent) |
| `22023` | dată lipsă sau în trecut; notă prea lungă; membrii nu sunt listă; mai puțin de 1 sau mai mult de 10 membri; nume lipsă, gol, prea lung sau duplicat; domeniu sau culoare invalide. Mesajele pe membru încep cu „Membrul N”. |
| `23505` | există deja o versiune cu aceeași `effective_from` |

Orice eroare anulează toată tranzacția: nu rămâne set parțial. Versiunile existente nu se modifică. O versiune cu `effective_from` mai mică decât a unei versiuni viitoare existente primește totuși numărul următor (versiunea efectivă se alege după dată, nu după număr).

### E5. Crearea unui client de către orice `agency_admin` activ (aprobată 12 oct 2026)

Decizia D-1 din `docs/decisions.md`. Până la 12 oct, `tenants_insert` era `with check (false)` (clienții se creau doar cu service role). Migrația `20261012090000_tenant_creation.sql`:

- **Cine:** `authenticated` primește `INSERT (id, slug, name)` pe `tenants`. Politica cere un rol `agency_admin` nerevocat într-un tenant activ (prin `private.has_role`, deja în lista A10). Statusul nu se alege: coloana nu are grant, iar politica cere `active`.
- **Creatorul devine `agency_admin`** în tenantul nou prin triggerul `tenants_add_creator` (`private.add_tenant_creator`, SECURITY DEFINER, `search_path` gol, returnează `trigger`, neexecutabil de `anon`/`authenticated`). Actorul e `auth.uid()`, nu un parametru. O inserție cu service role (fără utilizator) nu creează membership.
- **Neschimbat:** nimeni nu se poate adăuga într-un tenant existent; brandurile, accesul și conexiunile rămân pe politicile existente (`agency_admin` al tenantului). Lista A10/A11 de funcții executabile de clienți e aceeași.
- **Riscul acceptat:** un `agency_admin` al oricărui client (de regulă oameni AdSymphony) poate crea clienți noi, goi, în care doar el are acces. Nu poate vedea sau modifica alți clienți. Ștergerea nu există (doar arhivare prin `status`).
- **Teste:** `11_tenant_creation.test.sql` (H1–H6): roluri respinse, anon, status impus, creare și membership, unicitatea slug-ului, izolare față de alți admini, admin revocat, service role, audit, arhivarea și restaurarea brandurilor.

### E6. `rotate_source_token` (aprobată 12 oct 2026)

Funcție `SECURITY DEFINER` în `public`, executabilă **doar de service_role** (verificat în corp cu `assert_service_role`, ca E1). Workerul salvează tokenul reînnoit de furnizor (TikTok). Restricții: doar conexiunile `google_ads_account` și `tiktok_account`; starea credențialului nu se schimbă; auditul e `actor_type = worker`, `action = credential_refreshed`. Lista aprobată din `04_security_inventory.test.sql` o include explicit. Teste: `14_oauth.test.sql` (K2).

### E7. Funcția `oauth` fără verificarea JWT la poartă (aprobată 12 oct 2026)

Întoarcerea de la Google / TikTok nu are JWT, deci `verify_jwt = false`. Compensări: pornirea verifică sesiunea și rolul `agency_admin` în handler; `state` aleatoriu de 32 de octeți, păstrat doar ca hash, legat de client, furnizor și utilizator, valabil 10 minute și revendicat atomic o singură dată; PKCE la Google; rolul se reverifică la întoarcere; răspunsul e doar un redirect fix spre `APP_BASE_URL`, fără token. `oauth_states` nu e accesibil lui `authenticated` sau `anon` (K1). Teste: `supabase/functions/oauth/handler.test.ts`.

### E8. Poarta de metrici pentru ecranele de brand (aprobată 12 oct 2026)

Migrația `20261012180000_brand_metrics_rpc.sql`, decizia D-11.

- `public.brand_metrics` și `public.brand_metric_trends`: executabile de `authenticated`, **SECURITY INVOKER**. Verifică în corp `has_brand_access`; brand străin, brand inexistent și lipsa sesiunii dau **același** răspuns (42501). Datele vin din view-urile de observații prin RLS-ul apelantului; UI-ul trimite doar chei, perioadă și brand, iar formulele rămân în `metrics` (regula 4).
- `private.compute_metric_snapshot` și `private.metric_observations`: executabile de `authenticated`, tot SECURITY INVOKER (citesc prin RLS). `metric_observations` acceptă doar view-urile din allowlist.
- `private.brand_source_connected` și `private.brand_source_query_ok`: SECURITY DEFINER, întorc **doar boolean** și răspund `false` fără acces la brand (fără oracol). Sunt necesare pentru că `source_connections` și `sync_runs` sunt vizibile prin RLS doar agenției, iar un client trebuie totuși să vadă metricile brandului său.
- Același regim pentru ecranele de brand care au urmat (D-12 … D-15): `brand_paid`, `brand_mentions`, `brand_mention_sentiment`, `brand_insights`, `brand_traffic_channels`, `brand_clarity_devices`, `brand_search_keywords`, `brand_landing_pages`, `brand_ai_*`, `brand_competition`, `brand_competition_gaps`, plus utilitarele private INVOKER `competition_registry_cell`, `ai_check`, `ai_scope`, `ai_engine_db`, `ai_engine_ui`, `ai_outcome`.
- Garda A10/A11 le listează explicit și verifică faptul că sunt INVOKER. Teste: `15_brand_metrics.test.sql`, `16_brand_listening_insights.test.sql`, `17_brand_traffic_seo.test.sql`, `18_ai_visibility.test.sql` (L1–L4: valori calculate în SQL, clientul vede aceleași cifre ca agenția, refuzuri identice, serii cu null pe zilele fără date).

### E9. Acces la brand evaluat o dată pe interogare (aprobată 12 oct 2026)

Migrația `20261012290000_rls_brand_access_once_per_query.sql`, decizia D-20.

- Cele 21 de politici SELECT ale tabelelor de date (GA4, GSC, Clarity, SEOmonitor, AI, paid, social, mențiuni, competitori) folosesc `brand_id in (select private.accessible_brand_ids())` în loc de `private.has_brand_access(brand_id)`. Regula de acces e aceeași; diferă doar costul: funcția SECURITY DEFINER era evaluată pe fiecare rând (pe Minimartieni, cardurile SEO cereau 5,7 s și prima încărcare depășea limita de timp).
- `private.accessible_brand_ids()`: **SECURITY INVOKER**, executabilă de `authenticated`, nu de `anon`. Citește `brands` prin RLS-ul apelantului, a cărui politică este `has_brand_access(id)`; deci întoarce exact brandurile pe care apelantul le vede oricum. Nu ocolește nimic.
- Politicile cu condiții compuse (analize, recomandări, acțiuni, dovezi, `brands`) rămân pe `has_brand_access`.
- Teste: `19_rls_brand_access_once.test.sql` (R1: toate cele 21 de politici; R2: aceeași mulțime ca `has_brand_access` pentru strategist, client fără acces, alt tenant și admin; R3: INVOKER, fără `anon`), plus izolarea existentă (01–03) și lista A10.

### E10. Identitatea persoanelor și invitarea (23 oct 2026, cererea E-4; în regimul E1)

Migrația `20261023090000_people_identity_invite.sql`, decizia E-4. Emailul și numele trăiesc doar în `auth.users`, inaccesibil clientului. Trei funcții noi în `public`, **SECURITY DEFINER, executabile doar de service_role** (verificat și în corp cu `assert_service_role`), ca la E1:

| Funcție | Returnează | Cine o apelează |
|---|---|---|
| `tenant_people_for(actor)` | email, nume, ultima autentificare pentru membrii tenanților în care **actorul** e `agency_admin` activ (tenant activ); alt rol = zero rânduri | Edge Function `users` (`identities`) |
| `find_user_for_invite(email)` | id-ul contului și dacă e activat | Edge Function `users` (`invite`) |
| `grant_invited_access(actor, tenant, user, role, brands)` | id-ul membership-ului; verifică în corp actorul `agency_admin` pe tenant, brandurile active din același tenant, lipsa unui rând existent; scrie atomic membership, `brand_access` (`granted_by` = actor) și auditul `user_invited` cu actorul real | Edge Function `users` (`invite`) |

- Funcția `users` autentifică sesiunea prin `/auth/v1/user` și trimite actorul **din sesiune**, nu din corpul cererii; verifică explicit `tenant_id` înainte de orice email (rol, brandurile clientului, persoana deja în listă).
- Clientul nu primește nicio funcție nouă: lista A10/A11 de funcții executabile de `anon`/`authenticated` e aceeași. Cele trei sunt adăugate explicit în lista din `04_security_inventory.test.sql`.
- **Risc acceptat:** un `agency_admin` află, la invitație, dacă adresa avea deja un cont activ (răspunsul `access_granted`, fără email). Adresa e una pe care o adaugă chiar în clientul lui, unde persoana devine vizibilă oricum.
- Teste: `21_people_invite.test.sql` (P1–P3), `supabase/functions/users/handler.test.ts`, `tests/security/edge-users.test.mjs` (H1–H2).

**Extindere E-5 (23 oct 2026): contul creat direct, cu parolă temporară.** Migrația `20261023120000_people_create_account.sql` înlocuiește două funcții, cu aceleași nume și același regim (SECURITY DEFINER, doar service_role, `assert_service_role` în corp): `tenant_people_for` întoarce în plus `temporary_password`, iar `grant_invited_access` primește `p_audit_action` (`user_invited` implicit sau `user_created`; orice altă valoare e refuzată). Lista A10/A11 nu se schimbă.

- Contul se creează prin API-ul de administrare GoTrue, cu `app_metadata.must_change_password = true`. GoTrue refuză scrierea `app_metadata` din client (403); marcajul îl șterge doar funcția, cu service role.
- **Fără preluarea unui cont existent:** `create` refuză (409) orice adresă care are deja un cont, din orice client, fără să-i schimbe parola. Altfel, administratorul unui client ar putea prelua contul altcuiva.
- `change_temporary_password` lucrează doar pentru propriul cont și doar cât timp marcajul există (citit din GoTrue, nu din JWT). Parola se schimbă prin `PUT /auth/v1/user` cu sesiunea persoanei, deci cu politica și verificarea „aceeași parolă” din GoTrue; abia apoi se șterge marcajul. Fără marcaj, calea e închisă (409), deci nu ocolește „Am uitat parola”.
- Un cont creat, rămas fără acces (acordarea refuzată), se șterge imediat.
- **Risc acceptat (ca la invitație):** răspunsul 409 de la `create` îi confirmă unui `agency_admin` că adresa are deja un cont, fără alte date despre el.
- **Risc acceptat:** administratorul cunoaște parola temporară până la prima intrare. Ecranul de schimbare e o barieră a aplicației, nu a bazei de date: cu parola temporară, persoana are drepturile RLS ale rolului primit. Parola apare o singură dată în interfață și nu se păstrează nicăieri.
- Teste: `22_people_create_account.test.sql` (C1–C2), `handler.test.ts`, `edge-users.test.mjs` (H3–H4).

## Inventar la 7 oct 2026

| Tip | Ce există | Acoperit de |
|---|---|---|
| Tabele | 10 în `public`, toate cu RLS | A1–A7, B1, B2, 01–03 |
| View-uri / materialized views | niciunul | A8, A9 (gardă pentru viitor) |
| Funcții RPC în `public` | niciuna | A11, B3 |
| SECURITY DEFINER | În `private`: 4 de autorizare (boolean, răspund doar pentru `auth.uid()`), `user_has_brand_role` și `user_can_import` (user_id explicit, neexecutabile de clienți), triggere (`audit_row`, `delete_source_secret`). În `public`: 3 funcții server pentru credențiale, doar `service_role` (vezi excepția E1) | A10, A11, A14, B3, B8, V1–V3 |
| Tabele GA4/GSC (B5) | `web_daily`, `web_key_events`, `web_active_users_interval`, `search_daily`, `search_queries` (citire pe `has_brand_access`), `source_reconciliations` (doar agenția); scriere doar service role; view-uri `security_invoker` | A1–A9 (generice), `07_google_tables.test.sql`, B9 |
| Import CSV (B6) | `paid_daily`, `social_daily`, `social_posts`, `mentions` (citire pe `has_brand_access`), `import_batch_rows` (doar agenția); scriere doar service role; Edge Function `csv-import` cu autorizare prin RLS-ul utilizatorului; view-uri `security_invoker` | A1–A9, `08_csv_import.test.sql`, `supabase/functions/csv-import/handler.test.ts`, E1–E5 |
| Analize și PV (B7) | `insights`, `evidence_links`, `insight_snapshots`, `recommendations`, `actions` (vizibilitate: agenția tot, clientul doar `published` / acțiuni agreate), `insight_transitions`, `action_transitions`, `pv_contacts`, `pv_flags`, `pv_flag_events`, `pv_notifications` (agenție / `agency_admin`); tranziții prin trigger `SECURITY DEFINER`; Edge Function `notify` | A1–A11, `09_insights_pv.test.sql`, `supabase/functions/notify/handler.test.ts`, F1–F4 |
| Status surse și alerte (B8) | view-uri `source_status`, `source_freshness`, `sync_history`, `source_dataset_days` (`security_invoker`); `alert_contacts`, `ops_notifications` (doar `agency_admin`) | A1–A11, `10_refresh_status.test.sql`, G1–G3 |
| Vault | Tokenurile surselor; secret `source_connection:<id>` per conexiune | V1–V9, B8 |
| SEOmonitor | 10 tabele de date (RLS pe brand, scriere doar service role), `ai_answer_originals` (doar roluri de agenție), `seomonitor_group_mappings` (citire agenție, insert doar `agency_admin`, versiuni imutabile, auditate), `seomonitor_mapping_queue` (citire agenție), view-urile `seomonitor_metric_observations` și `seomonitor_ai_answer_states` (`security_invoker`) | A1–A8; RLS prin REST în `tests/integration/seomonitor-pipeline.test.ts` |
| Clarity | `clarity_daily` (RLS pe brand, scriere doar service role) și view `clarity_metric_observations` (`security_invoker`) | A1–A8; RLS prin REST în `tests/integration/clarity-pipeline.test.ts` |
| Registrul de metrici | `metric_definitions` (16 definiții, fără `tenant_id`, E2), view `metric_definitions_current` (`security_invoker`), schema `metrics` cu funcții pure (E3) | A1–A8, A15, 06 |
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
| A11 | Nicio funcție RPC în `public` executabilă de anon sau authenticated, în afara excepției E4 (`create_competitor_set_version`, SECURITY INVOKER). **O funcție nouă trebuie revizuită și adăugată explicit.** |
| A12 | Niciun bucket public |
| A13 | Niciun tabel în `supabase_realtime`, nicio publicație FOR ALL TABLES |
| A14 | Fără oracol: un brand străin existent și unul inexistent dau același răspuns; `user_has_brand_role` și TRUNCATE sunt refuzate ca `authenticated` |
| A15 | Schema `metrics`: doar funcții IMMUTABLE sau STABLE, SECURITY INVOKER, `search_path` gol, fără referințe la tabele sau view-uri, fără relații în schemă, fără EXECUTE pentru `anon` (E3) |

## Scenarii SQL (pgTAP, `01`–`03`)

- **01:** izolare brand și tenant pentru strategist T1, strategist T2 și admin T2; scrieri pe brand străin; FK compuse; timezone invalid.
- **02:** client fără `brand_access` (0 rânduri); client cu acces (fără date de agenție, fără auto-acordare, fără escaladare de rol); account nu scrie direct în `import_batches`; `user_can_import`; anon.
- **03:** revocare `brand_access`, revocare membership, arhivarea tenantului; auditul cu actor; `audit_events` imutabil; RLS peste tot.
- **06 (registrul de metrici):** regulile R1–R13 din ANZ07 (numitor zero, not_connected, zero real, rate din totaluri, interval report, medii ponderate, puncte procentuale, bază zero, perioada de comparație, MTD/YTD, rank absent, cele trei stări AI, eșantion), plus stale, ordinea statusurilor, contractul exact, imutabilitatea registrului și accesul (A1, A2). Datele sunt sintetice, doar în fișierul de test.
- **05 (Vault):**
  - V1: utilizatorii nu citesc `vault.*` și nu execută funcțiile de credențiale.
  - V2: nu pot scrie `vault_secret_id` sau `credential_status`.
  - V3: corpul funcțiilor refuză un apelant care nu e `service_role`, inclusiv un claim falsificat.
  - V4: doar `agency_admin` al tenantului setează sau rotește tokenul.
  - V5: auditul `credential_set` / `credential_rotated` cu actor; tokenul nu apare în afara Vault.
  - V6: adminul vede starea, nu tokenul.
  - V7: validare.
  - V8: secretul trebuie să aparțină conexiunii.
  - V9: ștergerea conexiunii șterge secretul.
  - V10: `provider_api_calls` e append-only, izolat pe brand și scris doar de service role.

## F. Versiune nouă a setului de competitori (pgTAP, `07_competitor_set_version.test.sql`)

| ID | Verificare |
|---|---|
| F1 | Respinși: strategist fără acces la brand, client_viewer (cu și fără acces), account, admin al altui tenant, brand inexistent (același mesaj ca brand străin), anon; nicio versiune creată |
| F2 | 0 și 11 membri, nume gol (al doilea membru, după ce primul fusese inserat), nume lipsă, duplicat (majuscule/spații), culoare și domeniu invalide, membri non-listă: niciun set parțial, niciun membru orfan |
| F3 | `effective_from` în trecut (inclusiv ieri în Europe/Bucharest) și null respins |
| F4 | Succes cu data de azi: versiune = max+1, normalizare (nume, domeniu, notă), `created_by`, `tenant_id` din brand, ordinea; versiunea 1 neatinsă |
| F5 | Audit: un eveniment pentru set și unul pe membru, cu actor |
| F6 | `effective_from` duplicat respins; versiunea crește la 3; lock advisory luat pe brand |
| F7 | Numărătoare independentă per brand; agency_admin pe orice brand al tenantului |
| F8 | Update și delete pe `competitor_sets` / `competitor_set_members` rămân interzise |

Concurența reală (două sesiuni) nu poate fi reprodusă într-un test pgTAP, care rulează într-o singură tranzacție. Verificat manual pe 8 oct 2026, local: sesiunea A apelează funcția și ține tranzacția deschisă 4 s; sesiunea B apelează cu altă dată. B așteaptă lock-ul și primește versiunea imediat următoare (A=2, B=3, B întârziat cu 4 s).

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
| B8 | RPC pe funcțiile de credențiale cu JWT de admin sau fără sesiune; `select=*` pe `source_connections`; `Accept-Profile: vault`; PATCH `credential_status`; POST cu `vault_secret_id`; contorul de apeluri pentru client și admin T2 | 401/403/406, tokenul nu apare; control pozitiv cu service role |

## C. Funcția server `source-credentials`

Teste unitare (`supabase/functions/source-credentials/handler.test.ts`, `npm run test:connectors`):
- fără JWT, JWT invalid sau cheie service/anon folosită ca Bearer: 401;
- strategist: 403; utilizator fără rol în tenantul conexiunii: 404 (nu confirmă existența);
- răspunsul nu conține niciodată tokenul;
- validarea: un singur apel, contorizat înainte de a fi făcut; 401/403 → `invalid`; 429 și 5xx nu schimbă starea; la 10/10 nu se apelează furnizorul.

Verificat cap-coadă pe Supabase local (7 oct 2026), cu `scripts/set-source-token.ts`, login real și un token Clarity fals:
- strategist și admin din alt tenant refuzați;
- admin: setare, validare (403 de la Clarity → `invalid`), rotire;
- audit `credential_set` / `credential_validated` / `credential_rotated` cu actorul;
- `provider_api_calls` = 1;
- tokenul nu apare în `audit_events` și nici în logurile funcției, Postgres sau PostgREST.

**Rerulare:** `supabase functions serve source-credentials`, apoi pașii din README (secțiunea „Tokenul unei surse").

## D. Atacuri pe Edge Function prin HTTP real (`tests/security/edge-credentials.test.mjs`)

Obiective: tokenul în clar nu poate fi obținut, iar bugetul de apeluri al altui brand nu poate fi consumat. Rulează cu `npm run test:security`.

| ID | Vector | Rezultat așteptat |
|---|---|---|
| D1 | Fără Authorization; cheia anon sau service role ca Bearer; JWT semnat cu alt secret; `alg: none`; JWT expirat (toate cu `sub` = admin T1), pe `set_token` și `validate` | 401; contorul și tokenul 1A neschimbate |
| D2 | JWT valid de **agency_admin din T2** pe conexiunea din T1: `set_token`, `validate`, claims injectate (`tenant_id`, `app_metadata.role`) | 404 (nu confirmă existența); tokenul 1A neschimbat; bugetul 1A neconsumat; tokenul nu apare |
| D3 | strategist, account și client din T1; admin T1 cu membership revocat | 403 (revocat: 403/404); fără efecte |
| D4 | `connection_id` cu filtre PostgREST (`&tenant_id=neq.x`, listă, `not.is.null`, gol); token de 9.000 de caractere; acțiuni inexistente (`get_token`, `read`, `export`, `status`); GET/PUT/DELETE cu `Origin` străin | 400 / 422 (token existent neschimbat) / 400 (nu există cale de citire) / 405 |
| D5 | Validare proprie a adminului T1 | Răspunsul nu conține tokenul; +1 apel pe 1A, 0 pe 2A |
| D5 | Contorul 1A la 10/10 | `budget_exhausted`, niciun apel la Clarity, contorul rămâne 10 |
| D5 | Validare 2A cu 1A la 10/10 | Bugetele sunt independente: 2A reușește |

**CORS.** Local, gateway-ul (Kong) adaugă `Access-Control-Allow-Origin: *` pe toate răspunsurile funcțiilor. Handler-ul nu setează CORS cât timp `ANALYZATOR_APP_ORIGIN` lipsește. Nu e o vulnerabilitate: autentificarea se face cu Bearer (fără cookie-uri), iar `Allow-Credentials` nu e trimis, deci o pagină străină nu poate acționa în numele utilizatorului. Testul D4 verifică faptul că originea străină nu e reflectată și că `Allow-Credentials` lipsește. Pe staging trebuie verificat ce face gateway-ul hosted.

## Scurgerea tokenului pe căi laterale (verificat manual, 7 oct 2026, local)

Am setat un token cu valoare unică prin `rpc/set_source_token` (service role), l-am citit cu `rpc/get_source_token` și am provocat o eroare cu tokenul în parametri (token prea lung, HTTP 400). Tokenul **nu** apare în:
- `extensions.pg_stat_statements` (PostgREST trimite parametri legați; `pg_stat_statements.track = top`);
- `pg_stat_activity`;
- logurile containerelor Postgres, PostgREST și Kong;
- `audit_events` și `source_connections`;
- `vault.secrets.secret` (criptat).

Setări locale relevante: `log_statement = ddl`, `log_min_duration_statement = -1`, `log_parameter_max_length = -1`, `log_parameter_max_length_on_error = 0`. `anon` și `authenticated` au SELECT pe `extensions.pg_stat_statements`, dar schema nu e expusă prin API (`PGRST_DB_SCHEMAS = public,graphql_public`). Vezi S8.

## M. Mutații (`scripts/test-guard-mutations.sh`, `npm run test:guards`)

Ultima rulare: 7 oct 2026, 13/13 mutații prinse.

| ID | Mutație | Prinsă de | Teste picate |
|---|---|---|---|
| M1 | Funcție nelistată în `public` (chiar fără EXECUTE pentru clienți) | 04 (A10/A11, lista aprobată) | 2 |
| M2 | EXECUTE pe `get_source_token` pentru `authenticated` | 04 (A10, A11) | 2 |
| M3 | `private.assert_service_role` fără verificare | 05 (V3) | 4 |
| M4 | `private.has_brand_role` întoarce mereu `true` | 01 | 14 |
| M5 | `get_source_token` fără verificarea numelui secretului | 05 (V8) | 1 |
| M6 | RLS dezactivat pe `provider_api_calls` | 04 (A1) | 1 |
| M7 | Politică `using (true)` pe `provider_api_calls` | 04 (A3) | 1 |
| M8 | EXECUTE pentru `anon` pe `record_source_validation` (funcție aprobată) | 04 (A10, A11) | 2 |
| M9 | Funcție în `metrics` care citește `public.brands` | 04 (A15) | 2 |
| M10 | Funcție SECURITY DEFINER în `metrics` | 04 (A15) | 2 |
| M11 | `metrics.ratio` întoarce 0 la numitor zero | 06 (R1, R13) | 6 |
| M12 | Variația relativă pe bază zero devine infinit | 06 (R8) | 3 |
| M13 | Rank absent tratat ca poziția 100 | 06 (R11) | 4 |

## Neverificat (7 oct 2026)

- **Gateway-ul hosted:** CORS și limita de mărime a corpului pentru Edge Functions sunt verificate doar local.
- **Scriptul `set-source-token.ts` cu login real pe staging:** testat doar local (vezi S5).
- **MFA pentru `agency_admin`** (spec cap. 28): nu e configurat; scriptul folosește login cu parolă.

- **Vault și logurile pe staging (hosted):** Drepturile lui `postgres` pe `vault.*` și absența tokenului din logurile Postgres sunt verificate doar local. Pe staging: repetă testul cap-coadă și caută tokenul de test în Logs Explorer.
- **Două validări simultane** pot trece amândouă de verificarea bugetului (fără blocare). Impactul e de cel mult un apel peste buget; acceptat pentru pilot.
- **Apeluri pierdute la contorizare:** dacă worker-ul cade după apelurile la Clarity și înainte de `provider_api_calls`, acele apeluri nu sunt contorizate.

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
| S5 | Medie | `scripts/set-source-token.ts` acceptă orice `SUPABASE_URL`, inclusiv `http://` pe o adresă non-locală. Parola contului și tokenul ar circula necriptate. Verificat: scriptul nu are nicio verificare de schemă. | Refuz dacă URL-ul nu e `https://`, cu excepția `127.0.0.1` / `localhost`. |
| S6 | Scăzută | Ștergerea unei conexiuni șterge în cascadă rândurile ei din `provider_api_calls`. Verificat: contorul trece de la 10 la 0. Un `agency_admin` care șterge și recreează conexiunea în aceeași zi poate trece de 10 validări (Clarity va răspunde 429), iar istoricul apelurilor se pierde. Impact doar în propriul tenant. | FK `on delete restrict` sau `set null` cu păstrarea `external_account_id` pe rândul de contor; bugetul se calculează pe proiect, nu pe ID-ul conexiunii. |
| S7 | Scăzută | Contorul e pe conexiune, nu pe proiectul Clarity. `unique (tenant_id, provider, external_account_id)` împiedică duplicatele doar în același tenant. Verificat: același `external_account_id` e acceptat în doi tenanți, deci două conexiuni cu același token ar avea bugete separate de câte 10. Nu permite accesul la datele altui tenant (fiecare are nevoie de token). | Contorizare pe `(provider, external_account_id)` sau unicitate globală pe `(provider, external_account_id)` pentru furnizorii cu buget per proiect. |
| S8 | Informativă | Local, `log_parameter_max_length = -1` (parametrii se loghează integral **dacă** o instrucțiune e logată), iar `anon` și `authenticated` au SELECT pe `extensions.pg_stat_statements` (neexpus prin API). Azi tokenul nu ajunge în loguri, dar o schimbare de `log_statement` sau `log_min_duration_statement` pe staging l-ar putea scrie. | Pe staging și production: verifică setările de log în dashboard și caută tokenul de test în Logs Explorer după testul cap-coadă; `revoke select on extensions.pg_stat_statements from anon, authenticated` dacă nu e folosit. |

## Constatări rezolvate

| # | Data | Constatare | Rezolvare |
|---|---|---|---|
| R1 | 7 oct 2026 | `[auth.email] enable_signup = false` din `config.toml` (Prompt 1) dezactiva **complet** login-ul cu email, nu doar înregistrarea publică. Descoperit la testul cap-coadă. | `[auth.email] enable_signup = true`; înregistrarea publică rămâne blocată de `[auth] enable_signup = false` (verificat: `signup_disabled`). |
| R2 | 7 oct 2026 | Funcția trigger nouă `private.prevent_update` primea EXECUTE pentru PUBLIC (revocarea din Prompt 1 acoperea doar funcțiile existente). Prinsă de garda A10. | `revoke` explicit în migrație. |


## E. Import CSV prin HTTP real (`tests/security/csv-import.test.mjs`)

| ID | Vector | Rezultat așteptat |
|---|---|---|
| E1 | fără JWT, cheia anon / service role ca Bearer, JWT cu alt secret, `alg: none`, expirat | 401, nimic scris |
| E2 | account fără brand_access; strategist și client_viewer cu acces; client fără acces; admin din alt tenant; revocare de acces între previzualizare și confirmare | 404 / 403; nimic scris în `import_batches` sau `paid_daily` |
| E3 | flux complet cu audit (cine a încărcat, cine a confirmat); fișier identic; `confirm` / `report` pe lotul altui brand sau tenant; RLS pe datele importate și pe loturi; scriere / modificare / ștergere directă în `paid_daily` și `import_batches`; același fișier în T2 | 409 / 404; datele din T1 neschimbate |
| E4 | ID-uri cu filtre PostgREST, acțiuni necunoscute (`get_token`, `drop_tables`), monedă și fus nedeclarate, sursă necunoscută, scurgeri de chei | 400 / 422 |
| E5 | reimport de mențiuni cu sentiment revizuit de un om | sentimentul rămâne; textul se actualizează |

**Neverificat (B6):** fișierele reale ale platformelor (niciun export real; alias-urile sunt neconfirmate); fișiere de zeci de mii de rânduri pe Edge Function în producție (limita de timp / memorie); stocarea fișierului brut; rollback pe lot.


## F. Analize, acțiuni și farmacovigilență prin HTTP real (`tests/security/insights-pv.test.mjs`)

| ID | Vector | Rezultat așteptat |
|---|---|---|
| F1 | statusul / autorul setat la inserare sau modificat direct (autor, admin); draft citit de client / admin T2 / account fără acces; tranziții de client, admin T2, strategist T2, account; corp falsificat (tenant, brand, actor, from_status); publicare fără dovezi; metrică necunoscută; editarea / ștergerea unei analize publicate (inclusiv service role); modificarea unui snapshot | 400 / 403; datele neschimbate; clientul vede doar `published`, dovezile și snapshotul (valoarea = `metrics.compute`), nu jurnalul |
| F2 | responsabil din afara agenției; status direct; tranziție ilegală; tranziții de client / alt tenant; vizibilitatea acțiunilor pentru client | 400 / 403; clientul vede doar acțiunile agreate |
| F3 | marcare PV de client / account fără acces / admin T2; câmpuri falsificate (tenant, autor, status); vizibilitatea marcajelor, jurnalului, cozii și contactelor; modificarea / ștergerea marcajelor; scrierea evenimentelor de sistem de către utilizatori; contacte PV de non-admin sau pe alt tenant; `notify` fără contacte, ca client, fără JWT, cu JWT expirat | 403 / 401; coada rămâne `pending`; nu se trimite nimic |
| F4 | izolare între branduri (account cu acces la 1B pe 1A; strategist 1A pe 1B) | refuzat / gol |

**Neverificat (B7):** trimiterea reală prin Resend (niciun cont, deci doar teste cu `fetch` simulat; documentația nu descrie codurile de eroare); conținutul e-mailului față de procedura reală de farmacovigilență (neprimită); comportamentul cu zeci de mii de marcaje în coadă; expirarea cheii `Idempotency-Key` după 24 h (o retrimitere după 24 h ar putea produce un duplicat); restrângerea `notify` la rate limiting.


## G. Statusul surselor și alertele prin HTTP real (`tests/security/refresh-status.test.mjs`)

| ID | Vector | Rezultat așteptat |
|---|---|---|
| G1 | `source_status`, `sync_history`, `source_dataset_days` citite de strategist, account, admin, admin T2, client cu și fără acces; scriere în view-uri | agenția vede doar brandurile ei; clientul și alt tenant: gol; scrierea refuzată |
| G2 | `source_freshness` pentru client (brandul lui), client fără acces, alt tenant; coloanele expuse | doar `tenant_id, brand_id, source, data_as_of, grace_days, freshness`; fără erori sau conexiuni |
| G3 | `alert_contacts` și `ops_notifications` de non-admin, client, admin T2; modificarea cozii de utilizatori | refuzat / gol; coada rămâne `pending` |

**Neverificat (B8):** rularea orchestratorului pe conectorii reali cu surse reale (doar adaptoare cu conexiuni lipsă și runneri simulați); trimiterea reală a alertelor prin Resend; comportamentul cu zeci de branduri (view-ul `source_status` face câte un lateral join pe sursă și brand; neprofilat); ora de vară pentru cron.

## H. Utilizatori prin HTTP real (`tests/security/edge-users.test.mjs`)

Funcția server `users` (excepția E10). Rulează cu `npm run test:security`; conturile create de test se șterg la final.

| ID | Vector | Rezultat așteptat |
|---|---|---|
| H1 | `identities` cerut de admin T1, admin T2, strategist, account, client cu și fără acces; fără sesiune, cheia anon, JWT semnat greșit; `tenant_people_for`, `find_user_for_invite`, `grant_invited_access` apelate direct prin REST de admin T1 | fiecare admin vede doar tenantul lui; ceilalți: listă goală; 401 fără sesiune validă; apelurile directe refuzate și nimic scris |
| H2 | invitație fără sesiune / cu cheia anon; de strategist, client, admin T2 în T1; cu un brand din T2; invitație validă; cont activ existent; același cont a doua oară | 401 / 403 / 404 / 422 fără cont creat; invitația creează contul, rolul, accesul la brand și auditul cu actorul real, vizibile doar în T1; contul activ primește doar accesul; a doua oară 409, rolul neschimbat |
| H3 | `create` fără sesiune / cu cheia anon; de strategist, client, admin T2 în T1; cu un brand din T2; pentru un cont existent din același client și din alt client; parolă scurtă; creare validă; autentificare cu parola temporară; încercarea clientului de a șterge marcajul prin `PUT /auth/v1/user` | 401 / 403 / 404 / 422 fără cont creat; cont existent: 409, parola veche merge, cea din cerere nu; creare validă: cont activ fără email (Mailpit), rol, brand, audit `user_created` fără parolă, `temporary_password` vizibil doar în T1; sesiunea poartă marcajul; `app_metadata` din client: 403, `user_metadata` nu atinge marcajul |
| H4 | `change_temporary_password` pe un cont fără marcaj; fără sesiune; cu aceeași parolă; cu o parolă nouă; a doua oară | 409 `not_temporary`, parola neschimbată; 401; 422 `same_password`, marcajul rămâne; 200: marcajul dispare, sesiunea curentă se reîmprospătează fără marcaj, parola temporară nu mai merge, cea nouă da; a doua oară 409 |

**Neverificat (E-4):** livrarea emailului de invitație în producție (local îl prinde Mailpit); șablonul și limita de emailuri ale serverului SMTP din proiectul Supabase; durata linkului din invitație în producție.

**Neverificat (E-5):** politica de parole a proiectului Supabase din producție (local, minimum 6 caractere; aplicația cere 8). Dacă proiectul cere mai mult, GoTrue refuză cu `weak_password`, iar mesajul din interfață e cel generic. „Secure password change” din producție: dacă e activ, schimbarea parolei temporare merge doar într-o sesiune recentă, ceea ce e cazul la prima intrare.
