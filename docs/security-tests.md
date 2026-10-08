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
| A11 | Nicio funcție RPC în `public`. **O funcție nouă trebuie revizuită și adăugată explicit.** |
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
