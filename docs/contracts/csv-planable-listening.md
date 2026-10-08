# Contract import CSV: Planable Listening (mențiuni)

> Generat din `supabase/functions/_shared/csv-import/contracts.ts` (`npm run docs:csv`). Nu se editează de mână.

Sursă: `planable_listening` · Tabel țintă: `mentions`
Șablon: `docs/templates/csv/planable_listening.csv` (doar antetul; nu conține date).

## Formatul platformei

Niciun format de export Listening nu e documentat public. Contractul e un **șablon propriu**. Fără câmp de autor (date personale minime). Nu există alias-uri.

## Declarații pe lot (la încărcare)

- `timezone`: fusul orar al datelor (IANA, de ex. `Europe/Bucharest`). **Obligatoriu**.

## Coloane

| Coloană | Tip | Obligatorie | Descriere | Exemplu | Alias-uri (neconfirmate) |
|---|---|---|---|---|---|
| `native_id` | text | nu | ID-ul mențiunii la sursă. Dacă lipsește, se folosește un hash al URL-ului. | `m-100234` |  |
| `url` | url | da | Linkul mențiunii (http/https). | `https://exemplu.ro/articol` |  |
| `source_name` | text | nu | Site-ul sau platforma sursă. | `exemplu.ro` |  |
| `published_at` | datetime | da | Momentul publicării (ISO 8601; fără offset = fusul declarat). | `2026-10-05T12:00:00+03:00` |  |
| `text` | text | nu | Textul mențiunii (extras). |  |  |
| `sentiment` | enum: `positive`, `neutral`, `negative`, `unknown` | nu | Sentimentul furnizorului față de **brand**. Gol = `unknown`. Se suprascrie la reimport doar dacă nu a fost revizuit de un om. | `neutral` |  |
| `language` | text | nu | Limba (ISO 639, litere mici). | `ro` |  |
| `country` | text | nu | Țara (ISO 3166-1 alpha-2, majuscule). Limba română nu dovedește localizarea în România. | `RO` |  |

## Cheia naturală (upsert)

`native_id (sau hash-ul URL-ului)`. Reimportul aceleiași chei înlocuiește rândul; nu îl dublează.

## Reguli

- Fusul orar se declară la încărcare. Moneda nu se aplică.
- Sentimentul din fișier este al furnizorului. Corecțiile umane (`sentiment_reviewed_by`, `sentiment_reviewed_at`) au prioritate și nu se suprascriu la reimport.
- Aceeași mențiune (același `native_id`) de două ori în fișier: prima se păstrează, restul se resping.
- Codificare: UTF-8 (cu sau fără BOM), UTF-16 sau windows-1252 (detectat). Delimitator: virgulă, punct și virgulă sau TAB (detectat).
- Limite: 10 MB și 50.000 de rânduri per fișier.

## Flux

1. `preview`: validare rând cu rând; lotul și rândurile (acceptate / respinse, cu motivul) se păstrează în `import_batches` și `import_batch_rows`.
2. `confirm`: rândurile acceptate se scriu idempotent în tabelul țintă. Un fișier identic (același hash) nu se importă de două ori pentru același brand și aceeași sursă.
3. Doar rolurile `agency_admin` și `account`, cu `brand_access`, pot importa (verificat la fiecare acțiune). Fiecare previzualizare și confirmare intră în `audit_events`.
