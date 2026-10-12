# Import CSV: Google Ads, Meta Ads, TikTok Ads, Planable

**Ce aduce:**
- **Ads:** cost, afișări, clicks și conversii pe zi, pe cont, campanie, grup și reclamă.
- **Planable:** postări sociale și performanța lor (analytics), mențiuni (listening).

**Status azi:** importul există pe server (funcția `csv-import`, cu validare și previzualizare), dar **ecranul de încărcare nu e gata**. Butonul „Importă CSV” din aplicație duce deocamdată la cardul **Import CSV** din pagina site-ului, fără formular. Până la ecran, fișierele pregătite după acest ghid se dau echipei tehnice, care le importă.

## Pregătirea fișierului

Fiecare sursă are un **șablon** (doar antetul) și un **contract** cu toate coloanele, explicate:

| Sursă | Șablon | Contract |
|---|---|---|
| Google Ads | `docs/templates/csv/google_ads.csv` | `docs/contracts/csv-google-ads.md` |
| Meta Ads | `docs/templates/csv/meta_ads.csv` | `docs/contracts/csv-meta-ads.md` |
| TikTok Ads | `docs/templates/csv/tiktok_ads.csv` | `docs/contracts/csv-tiktok-ads.md` |
| Planable Analytics | `docs/templates/csv/planable_analytics.csv` | `docs/contracts/csv-planable-analytics.md` |
| Planable Listening | `docs/templates/csv/planable_listening.csv` | `docs/contracts/csv-planable-listening.md` |

Ai două variante:

- **Exportul nativ al platformei.** Coloanele uzuale (de ex. `Day`, `Campaign`, `Cost`, `Impr.`) sunt recunoscute automat, iar rândurile de introducere și rândul „Total” se ignoră. Recunoașterea alias-urilor nu e confirmată pe exporturi reale, așa că verifică previzualizarea.
- **Șablonul**, completat cu coloanele din contract.

**Exportul din platformă (pe zile):**

- **Google Ads:** Campaigns → interval → Segment → Time → **Day** → Download → CSV.
- **Meta Ads Manager:** Reports → Export table data → .csv, cu Breakdown → By time → **Day**.
- **TikTok Ads Manager:** Reporting → Create report → dimensiune **Day** → Export → CSV.

## Reguli care resping cel mai des un fișier

- **Moneda și fusul orar se declară la încărcare** (de ex. `RON`, `Europe/Bucharest`); nu se deduc din fișier.
- **Numere fără separator de mii, cu punct zecimal:** `1234.56`. Formele `1.234,56` și `1,234.56` sunt respinse intenționat, ca să nu se citească greșit.
- **O celulă goală înseamnă „necunoscut”, nu zero.** Pune `0` doar unde valoarea e chiar zero.
- **Datele din viitor** se resping.
- **Limitele:** 10 MB și 50.000 de rânduri per fișier.

## Ce se întâmplă la import

1. **Previzualizare:** fiecare rând e validat. Primești numărul de rânduri acceptate și respinse, cu motivul fiecărui rând respins. Nimic nu intră încă în date.
2. **Confirmare:** rândurile acceptate intră în date.
   - Un reimport pe aceeași perioadă **înlocuiește** rândurile, fără dubluri.
   - Același fișier de două ori e refuzat.

Pot importa doar `agency_admin` și `account`, cu acces la brand.

## Conectare prin API

Toate cele patru surse au conector API: [Planable](planable.md), [Meta Ads](meta-ads.md), [Google Ads](google-ads.md) și [TikTok Ads](tiktok-ads.md). CSV-ul rămâne o variantă de rezervă, în aceleași tabele.
