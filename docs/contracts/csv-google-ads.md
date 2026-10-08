# Contract import CSV: Google Ads

> Generat din `supabase/functions/_shared/csv-import/contracts.ts` (`npm run docs:csv`). Nu se editează de mână.

Sursă: `google_ads` · Tabel țintă: `paid_daily` (cheie unică cu `tenant_id`, `brand_id`, `source`, cont, campanie, grup, reclamă, dată, defalcare, atribuire)
Șablon: `docs/templates/csv/google_ads.csv` (doar antetul; nu conține date).

## Formatul platformei

Formatul nativ nu e documentat oficial. Alias-urile (`Day`, `Campaign`, `Ad group`, `Cost`, `Impr.`, `Clicks`, `Conversions`) vin din ghiduri terțe și sunt neconfirmate. Exportul din UI are de obicei rânduri introductive și un rând „Total”; acestea se ignoră. Exporturile pot fi UTF-16 cu TAB (detectat automat).

## Declarații pe lot (la încărcare)

- `currency`: moneda costurilor (ISO 4217). **Obligatorie**; fișierul nu o stabilește.
- `timezone`: fusul orar al datelor (IANA, de ex. `Europe/Bucharest`). **Obligatoriu**.
- `attribution_config`: configurația de atribuire a conversiilor (de ex. `7d_click_1d_view`). Opțional; implicit `unspecified`. Face parte din cheia unică.
- `click_type`: tipul de click (de ex. `all`, `link`). Opțional; implicit `unspecified`. Comparațiile cer același tip în ambele perioade.

## Coloane

| Coloană | Tip | Obligatorie | Descriere | Exemplu | Alias-uri (neconfirmate) |
|---|---|---|---|---|---|
| `date` | date | da | Ziua (YYYY-MM-DD), în fusul declarat pe lot. | `2026-10-05` | `Day` |
| `account_id` | text | nu | ID-ul contului de ads. Recomandat: face parte din cheia naturală. | `123-456-7890` | `Customer ID` |
| `account_name` | text | nu | Numele contului. | `Cont Brand A` | `Account` |
| `campaign_id` | text | condiționat | ID-ul campaniei. Obligatoriu dacă lipsește campaign_name; dacă lipsește, ID-ul devine `name:<campaign_name>`. | `98765` | `Campaign ID` |
| `campaign_name` | text | condiționat | Numele campaniei. Obligatoriu dacă lipsește campaign_id. | `Toamna 2026` | `Campaign` |
| `ad_group_id` | text | nu | ID-ul grupului de reclame / ad set. Gol = export la nivel de campanie. | `55501` | `Ad group ID` |
| `ad_group_name` | text | nu | Numele grupului de reclame / ad set. | `Audiență 25-44` | `Ad group` |
| `ad_id` | text | nu | ID-ul reclamei. Gol = export la nivel de grup. | `777001` | `Ad ID` |
| `ad_name` | text | nu | Numele reclamei. | `Banner 1` | `Ad name` |
| `spend` | decimal | da | Costul zilei, în moneda declarată pe lot. Punct zecimal, fără separator de mii. | `152.40` | `Cost` |
| `impressions` | integer | nu | Afișări. Gol = necunoscut (NULL), nu 0. | `10450` | `Impr.` |
| `clicks` | integer | nu | Clicks; tipul de click se declară pe lot (click_type) și trebuie să fie același între perioade comparate. | `312` | `Clicks` |
| `conversions` | decimal | nu | Conversii pentru acțiunea și fereastra de atribuire declarate pe lot. Gol = necunoscut (NULL), nu 0. | `14` | `Conversions` |
| `currency` | text | nu | Codul monedei (ISO 4217) al rândului. Dacă există, trebuie să coincidă cu moneda declarată pe lot. | `RON` | `Currency code` |
| `breakdown` | text | nu | Defalcarea rândului (de ex. `device=mobile`). Gol = fără defalcare (`none`). Rândurile cu defalcare nu intră în totaluri. |  |  |

## Cheia naturală (upsert)

`account_id`, `campaign_id`, `ad_group_id`, `ad_id`, `date`, `breakdown`, `attribution_config`. Reimportul aceleiași chei înlocuiește rândul; nu îl dublează.

## Reguli

- Moneda și fusul orar se declară la încărcare (nu se deduc din fișier). Un fișier fără monedă declarată e refuzat.
- Numere: punct zecimal, fără separator de mii (`1234.56`). Formele `1.234,56` și `1,234.56` sunt respinse, ca să nu se interpreteze greșit.
- Un rând cu aceeași cheie naturală de două ori în fișier: primul se păstrează, următoarele se resping ca duplicate.
- Un reimport al aceleiași chei înlocuiește rândul existent (upsert). Un fișier identic (același hash) nu se importă de două ori.
- Un rând fără nicio metrică (cost, afișări, clicks, conversii) se respinge.
- O dată în viitor (în fusul declarat) se respinge.
- Rândurile al căror prim câmp începe cu „Total” (rândul de total din export) se ignoră, nu se resping.
- Codificare: UTF-8 (cu sau fără BOM), UTF-16 sau windows-1252 (detectat). Delimitator: virgulă, punct și virgulă sau TAB (detectat).
- Limite: 10 MB și 50.000 de rânduri per fișier.

## Flux

1. `preview`: validare rând cu rând; lotul și rândurile (acceptate / respinse, cu motivul) se păstrează în `import_batches` și `import_batch_rows`.
2. `confirm`: rândurile acceptate se scriu idempotent în tabelul țintă. Un fișier identic (același hash) nu se importă de două ori pentru același brand și aceeași sursă.
3. Doar rolurile `agency_admin` și `account`, cu `brand_access`, pot importa (verificat la fiecare acțiune). Fiecare previzualizare și confirmare intră în `audit_events`.
