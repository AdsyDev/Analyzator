# Contract: persoanele cu acces și invitarea (funcția `users`)

Decizia E-4, excepția de securitate E10. Funcția server `supabase/functions/users` (Edge Function, cu verificarea JWT la poartă). Teste: `supabase/functions/users/handler.test.ts`, `supabase/tests/database/21_people_invite.test.sql`, `tests/security/edge-users.test.mjs`.

Rolurile și accesul la branduri se citesc și se modifică în continuare prin RLS (`memberships`, `brand_access`). Funcția acoperă doar ce clientul nu poate face singur: citirea emailului și numelui din `auth.users` și crearea contului la invitație.

## Acțiuni

Toate sunt `POST /functions/v1/users` cu JWT-ul utilizatorului. Actorul e utilizatorul sesiunii (`/auth/v1/user`), niciodată un câmp din corp.

### `{ action: "identities" }`

Răspuns `200 { people: [{ tenant_id, user_id, email, full_name, last_sign_in_at }] }`, doar pentru membrii tenanților în care actorul e `agency_admin` activ, într-un tenant activ. Pentru orice alt rol, lista e goală (fără eroare). Rândurile revocate apar și ele, ca în lista de acces.

- `full_name`: `full_name` sau `name` din metadatele contului, cel mult 120 de caractere. E declarat de persoană; null dacă lipsește.
- `last_sign_in_at`: null = persoana nu a intrat încă (invitație neacceptată).

### `{ action: "invite", tenant_id, email, full_name?, role, brand_ids }`

- **Validare:** `tenant_id` UUID (400); email de cel mult 254 de caractere, normalizat cu litere mici (422); `full_name` de cel mult 120 de caractere, fără caractere de control (422); `role` ∈ `agency_admin`, `strategist`, `account`, `client_viewer` (422); `brand_ids` listă de UUID-uri, maximum 50, fără dubluri (422).
- **Autorizare:** actorul trebuie să fie `agency_admin` activ în tenant. Fără niciun rol acolo: 404, fără să confirme existența clientului. Cu alt rol: 403. Brandurile trebuie să fie active și din același tenant (422); asta se verifică **înainte** de orice email.
- **Cont:** `find_user_for_invite` caută adresa.
  - Cont inexistent sau neactivat: `POST /auth/v1/invite?redirect_to=<APP_BASE_URL>/login` (cheia de service), cu `data.full_name`.
  - Cont activat: fără email.
- **Persoana e deja în lista clientului:**
  - Cont activat: 409, nimic scris.
  - Cont neactivat: invitația se retrimite (`resent`). Rolul și brandurile nu se schimbă.
- **Acces:** `grant_invited_access` reverifică actorul și brandurile, apoi scrie atomic membership, `brand_access` (`granted_by` = actor) și evenimentul de audit `user_invited`.
- **Răspuns:** `200 { status: "invited" | "access_granted" | "resent", user_id }`.

| Status | Când |
|---|---|
| 400 | corp JSON invalid, acțiune necunoscută, `tenant_id` invalid |
| 401 | fără sesiune validă |
| 403 | actorul nu e `agency_admin` în tenant |
| 404 | actorul nu are niciun rol în tenant |
| 409 | persoana activă e deja în listă; adresa refuzată de serverul de autentificare |
| 422 | email, nume, rol sau branduri invalide |
| 429 | limita de emailuri a serverului de autentificare |
| 500 | eroare internă (fără detalii în răspuns) |

## Secrete și configurare (doar pe server)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`: furnizate de Supabase.
- `APP_BASE_URL`: adresa aplicației; linkul din invitație duce la `<APP_BASE_URL>/login`. Fără ea, Supabase folosește Site URL.
- `ANALYZATOR_APP_ORIGIN`: originea permisă pentru CORS.
- Pașii din Supabase (SMTP, șablonul emailului, durata linkului) sunt în `docs/runbook.md`, „Utilizatori și invitații”.
