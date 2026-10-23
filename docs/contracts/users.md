# Contract: persoanele cu acces, invitarea și contul creat direct (funcția `users`)

Deciziile E-4 și E-5, excepția de securitate E10. Funcția server `supabase/functions/users` (Edge Function, cu verificarea JWT la poartă). Teste: `supabase/functions/users/handler.test.ts`, `supabase/tests/database/21_people_invite.test.sql`, `supabase/tests/database/22_people_create_account.test.sql`, `tests/security/edge-users.test.mjs`.

Rolurile și accesul la branduri se citesc și se modifică în continuare prin RLS (`memberships`, `brand_access`). Funcția acoperă doar ce clientul nu poate face singur: citirea emailului și numelui din `auth.users`, crearea contului (la invitație sau direct, cu parolă temporară) și ștergerea marcajului de parolă temporară.

## Acțiuni

Toate sunt `POST /functions/v1/users` cu JWT-ul utilizatorului. Actorul e utilizatorul sesiunii (`/auth/v1/user`), niciodată un câmp din corp.

### `{ action: "identities" }`

Răspuns `200 { people: [{ tenant_id, user_id, email, full_name, last_sign_in_at, temporary_password }] }`, doar pentru membrii tenanților în care actorul e `agency_admin` activ, într-un tenant activ. Pentru orice alt rol, lista e goală (fără eroare). Rândurile revocate apar și ele, ca în lista de acces.

- `full_name`: `full_name` sau `name` din metadatele contului, cel mult 120 de caractere. E declarat de persoană; null dacă lipsește.
- `last_sign_in_at`: null = persoana nu a intrat încă (invitație neacceptată sau cont creat, nefolosit).
- `temporary_password`: `true` doar dacă `app_metadata.must_change_password` e exact `true` (contul creat direct, cu parola temporară încă neschimbată). Interfața arată „Parolă temporară”, fără „Retrimite invitația”.

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

### `{ action: "create", tenant_id, email, full_name?, role, brand_ids, password }` (E-5)

Contul creat direct de administrator, fără email trimis.

- **Validare:** ca la `invite`, plus `password`: cel puțin 8 caractere, cel mult 72 de octeți, fără caractere de control; nu se normalizează (422, `code: "weak_password"`).
- **Autorizare:** ca la `invite` (404 / 403; brandurile verificate înainte de orice cont).
- **Doar adrese fără cont:** dacă `find_user_for_invite` găsește **orice** cont (activ, invitat sau din alt client), răspunsul e 409 și nu se schimbă nimic. Parola unui cont existent nu se schimbă niciodată pe această cale; pentru un cont existent se folosește `invite`.
- **Cont:** `POST /auth/v1/admin/users` (cheia de service) cu `email_confirm: true`, `user_metadata.full_name` și `app_metadata.must_change_password: true`. Contul e activ imediat; nu pleacă niciun email. Doar service role scrie `app_metadata`: clientul primește 403 dacă încearcă.
- **Acces:** `grant_invited_access(..., p_audit_action => 'user_created')`, atomic, cu auditul `user_created` și actorul real. Dacă acordarea eșuează, contul tocmai creat se șterge (`DELETE /auth/v1/admin/users/{id}`), iar eroarea inițială rămâne.
- **Răspuns:** `200 { status: "created", user_id }`. Parola nu apare în răspuns, în audit sau în loguri.

### `{ action: "change_temporary_password", password }` (E-5)

Prima parolă aleasă de persoană după crearea directă. Doar pentru propriul cont.

- **Condiție:** utilizatorul sesiunii, citit din GoTrue (`/auth/v1/user`, nu din JWT), are `app_metadata.must_change_password = true`; altfel 409, `code: "not_temporary"` (o parolă nouă se cere prin „Am uitat parola”).
- **Validare:** ca la `create` (422, `weak_password`).
- **Schimbare:** `PUT /auth/v1/user` cu **sesiunea persoanei**: GoTrue aplică politica de parole, refuză aceeași parolă (422, `code: "same_password"`) și păstrează sesiunea curentă. Sesiune refuzată: 401, `code: "session_expired"`.
- **Marcaj:** abia după ce parola s-a schimbat, `PUT /auth/v1/admin/users/{id}` cu `app_metadata: { must_change_password: null }` (cheia de service) șterge marcajul.
- **Răspuns:** `200 { status: "password_changed" }`. Clientul reîmprospătează sesiunea, care nu mai poartă marcajul.

Erorile cu un `code` stabil îl trimit lângă mesaj: `{ error, code }`. Celelalte trimit doar `{ error }`.

| Status | Când |
|---|---|
| 400 | corp JSON invalid, acțiune necunoscută, `tenant_id` invalid |
| 401 | fără sesiune validă |
| 403 | actorul nu e `agency_admin` în tenant |
| 404 | actorul nu are niciun rol în tenant |
| 401 | (`change_temporary_password`) sesiunea refuzată de GoTrue la schimbarea parolei (`session_expired`) |
| 409 | persoana activă e deja în listă; adresa refuzată de serverul de autentificare; (`create`) adresa are deja un cont; (`change_temporary_password`) contul nu are parolă temporară (`not_temporary`) |
| 422 | email, nume, rol sau branduri invalide; parolă prea scurtă, prea lungă sau refuzată de politică (`weak_password`); aceeași parolă ca cea temporară (`same_password`) |
| 429 | limita de emailuri sau de cereri a serverului de autentificare |
| 500 | eroare internă (fără detalii în răspuns) |

## Secrete și configurare (doar pe server)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`: furnizate de Supabase.
- `APP_BASE_URL`: adresa aplicației; linkul din invitație duce la `<APP_BASE_URL>/login`. Fără ea, Supabase folosește Site URL.
- `ANALYZATOR_APP_ORIGIN`: originea permisă pentru CORS.
- Pașii din Supabase (SMTP, șablonul emailului, durata linkului) sunt în `docs/runbook.md`, „Utilizatori și invitații”.
