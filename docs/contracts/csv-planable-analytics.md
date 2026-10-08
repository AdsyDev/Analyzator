# Contract import CSV: Planable Analytics (social propriu)

> Generat din `supabase/functions/_shared/csv-import/contracts.ts` (`npm run docs:csv`). Nu se editează de mână.

Sursă: `planable_analytics` · Tabel țintă: `social_daily` (`level = daily`) și `social_posts` (`level = post`)
Șablon: `docs/templates/csv/planable_analytics.csv` (doar antetul; nu conține date).

## Formatul platformei

Documentația Planable descrie exportul de postări (CSV), nu și coloanele lui, și nu documentează un export de analytics. Contractul e un **șablon propriu**, cu un singur fișier pentru două niveluri (`level` = `daily` sau `post`). Nu există alias-uri.

## Declarații pe lot (la încărcare)

- `timezone`: fusul orar al datelor (IANA, de ex. `Europe/Bucharest`). **Obligatoriu**.

## Coloane

| Coloană | Tip | Obligatorie | Descriere | Exemplu | Alias-uri (neconfirmate) |
|---|---|---|---|---|---|
| `level` | enum: `daily`, `post` | da | `daily` = cont × zi; `post` = o postare (snapshot de metrici). | `daily` |  |
| `platform` | text | da | Platforma (`facebook`, `instagram`, `linkedin`, `tiktok`, `x`, `youtube`…). Litere mici, cifre, underscore. | `instagram` |  |
| `account_id` | text | da | ID-ul contului social. | `17841400000000000` |  |
| `account_name` | text | nu | Numele contului. | `Brand A` |  |
| `date` | date | condiționat | Ziua (YYYY-MM-DD). Obligatorie la `level = daily`. | `2026-10-05` |  |
| `post_id` | text | condiționat | ID-ul nativ al postării. Obligatoriu la `level = post`. | `18000000000000000` |  |
| `published_at` | datetime | condiționat | Momentul publicării (ISO 8601; fără offset = fusul declarat). Obligatoriu la `level = post`. | `2026-10-05T09:30:00+03:00` |  |
| `snapshot_date` | date | condiționat | Ziua în care s-au citit metricile postării. Obligatorie la `level = post`. | `2026-10-07` |  |
| `metrics_scope` | enum: `lifetime`, `period` | condiționat | `lifetime` (cumulat de la publicare) sau `period` (doar în interval). Obligatoriu la `level = post`; nu se amestecă. | `lifetime` |  |
| `post_url` | url | nu | Linkul postării. | `https://www.instagram.com/p/XXXX/` |  |
| `post_text` | text | nu | Textul postării. |  |  |
| `followers` | integer | nu | Urmăritori (snapshot, `level = daily`). Nu se însumează. | `5230` |  |
| `impressions` | integer | nu | Afișări. | `8400` |  |
| `reach` | integer | nu | Reach. Se stochează ca nesumabil (`reach_not_additive`): nu se adună pe zile sau platforme. | `6100` |  |
| `engagements` | integer | nu | Interacțiuni totale, dacă sursa le dă ca total. | `410` |  |
| `likes` | integer | nu | Aprecieri / reacții. | `300` |  |
| `comments` | integer | nu | Comentarii. | `40` |  |
| `shares` | integer | nu | Distribuiri. | `30` |  |
| `saves` | integer | nu | Salvări. | `40` |  |
| `link_clicks` | integer | nu | Clicks pe link. | `25` |  |
| `video_views` | integer | nu | Vizualizări video (definiția diferă între platforme; nu se compară ca aceeași măsură). |  |  |

## Cheia naturală (upsert)

`level`, `platform`, `account_id`, `date | post_id + snapshot_date + metrics_scope`. Reimportul aceleiași chei înlocuiește rândul; nu îl dublează.

## Reguli

- Fusul orar se declară la încărcare. Moneda nu se aplică.
- O metrică lipsă e NULL, nu 0 (spec 2.7).
- Performanța obținută în interval și cea cumulată a postărilor publicate în interval sunt rapoarte diferite; `metrics_scope` le separă în cheie.
- Un rând duplicat în fișier (aceeași cheie): primul se păstrează, restul se resping.
- Codificare: UTF-8 (cu sau fără BOM), UTF-16 sau windows-1252 (detectat). Delimitator: virgulă, punct și virgulă sau TAB (detectat).
- Limite: 10 MB și 50.000 de rânduri per fișier.

## Flux

1. `preview`: validare rând cu rând; lotul și rândurile (acceptate / respinse, cu motivul) se păstrează în `import_batches` și `import_batch_rows`.
2. `confirm`: rândurile acceptate se scriu idempotent în tabelul țintă. Un fișier identic (același hash) nu se importă de două ori pentru același brand și aceeași sursă.
3. Doar rolurile `agency_admin` și `account`, cu `brand_access`, pot importa (verificat la fiecare acțiune). Fiecare previzualizare și confirmare intră în `audit_events`.
