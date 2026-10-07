# Ecrane: note de conținut și comportament

Note care trebuie păstrate până se construiește interfața. Textele sunt în română.

## Administrare → Surse

Acces: doar `agency_admin`. Ceilalți utilizatori nu văd ecranul. Strategist și account văd starea surselor în pagina de status, dar fără acțiuni pe credențiale.

### Lista conexiunilor (per brand)

| Coloană | Sursă | Note |
|---|---|---|
| Sursă | `provider` | „Clarity", „GA4" etc. |
| Cont / proiect | `external_account_id`, `display_name` | |
| Stare credențial | `credential_status` | `missing` = „Token neconfigurat"; `unverified` = „Token salvat, netestat"; `valid` = „Conexiune funcțională"; `invalid` = „Token refuzat de furnizor" |
| Ultima testare | `last_validated_at`, `last_validation_error` | Data în Europe/Bucharest. Eroarea arată doar codul (de exemplu „HTTP 403"). |
| Configurat de | `credential_updated_by`, `credential_updated_at` | |
| Apeluri azi | suma `provider_api_calls.calls` pentru conexiune și ziua UTC curentă | Format „X / 10" |

### Setare sau rotire token

- Câmp de tip parolă, fără afișare și fără „copiază". După salvare câmpul se golește. Tokenul **nu se mai afișează niciodată**: frontend-ul primește doar starea.
- Apel: Edge Function `source-credentials`, `{ action: "set_token", connection_id, token }`.
- Mesaj după salvare: „Token salvat. Testează conexiunea pentru a confirma că funcționează."
- Rotirea folosește același formular; în audit apare ca `credential_rotated`.

### Butonul „Testează conexiunea"

- Text lângă buton, obligatoriu: **„Testarea consumă 1 din cele 10 apeluri zilnice. Azi: X folosite."**
- Butonul e dezactivat când X ≥ 10, cu explicația „Bugetul zilnic e consumat. Se resetează la 00:00 UTC (03:00 ora României vara, 02:00 iarna)".
- Apel: `{ action: "validate", connection_id }`. Afișează `message` din răspuns și actualizează „Azi: X folosite" din `calls_today`.
- Rezultate: `valid` (verde), `invalid` (roșu, cu indicația de a genera un token nou), `rate_limited` și `provider_error` (galben: starea tokenului nu s-a schimbat), `budget_exhausted` (testul nu a rulat).
- Nu se testează automat la salvare: fiecare test consumă buget.
