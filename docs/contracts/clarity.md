# Contract Clarity (Data Export API)

Endpoint: `GET https://www.clarity.ms/export-data/api/v1/project-live-insights`
Autentificare: `Authorization: Bearer {token}` (un token per proiect, doar server-side).
Sursa: [Clarity Data Export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api), pagină actualizată 2025-12-05, citită 2026-10-07.

## Din documentație (verificat 2026-10-07)

- **Limite:** 10 apeluri/zi per proiect; maximum 3 dimensiuni per apel; **maximum 1.000 de rânduri per răspuns, fără paginare**.
- **`numOfDays`:** 1, 2 sau 3 = **ultimele 24, 48 sau 72 de ore de la momentul apelului**, nu zile calendaristice. Rezultatele sunt în **UTC**.
- **Dimensiuni valide (exact):** `Browser`, `Device`, `Country/Region`, `OS`, `Source`, `Medium`, `Campaign`, `Channel`, `URL`.
- **Alegerea pentru pilot:** sursă de trafic = `Source`; pagini = `URL`. `Channel` și `Medium` sunt alternative documentate, nefolosite.
- **Metrici listate:** Scroll Depth, Engagement Time, Traffic, Popular Pages, Browser, Device, OS, Country/Region, Page Title, Referrer URL, Dead Click Count, Excessive Scroll, Rage Click Count, Quickback Click, Script Error Count, Error Click Count. Acestea sunt etichete din documentație; valorile exacte ale `metricName` se iau doar din fixtures.
- **Exemplul din documentație** (`metricName: "Traffic"`): câmpurile `totalSessionCount`, `totalBotSessionCount`, `distantUserCount` vin ca **string**, iar `PagesPerSessionPercentage` ca număr; dimensiunea apare ca o cheie cu numele ei (de exemplu `"OS": "Android"`). **De confirmat în fixtures.**
- **Erori documentate:** 400 parametri invalizi · 401 token lipsă, invalid sau expirat · 403 token fără drept pe operație · 429 limită zilnică depășită. Nu sunt documentate `Retry-After` sau 5xx.

## Ordinea apelurilor zilnice (prioritate)

| # | Dimensiune | `dimension` în `clarity_daily` | Fixture |
|---|---|---|---|
| 1 | (fără) | `all` | `{brand_slug}-totals.json` |
| 2 | `Device` | `device` | `{brand_slug}-device.json` |
| 3 | `Source` | `source` | `{brand_slug}-source.json` |
| 4 | `URL` | `page` | `{brand_slug}-page.json` |

La buget epuizat se pierd dimensiunile de la coada listei; run-ul devine `partial`, iar ce nu s-a colectat apare în `sync_runs.errors`.

Fixtures se generează cu `npm run probe:clarity`: 4 apeluri per proiect, fără retry.

> **Status: de completat manual după rularea probei.** Valorile de mai jos nu sunt presupuse; se trec doar ce apare în fixtures.

## Observații înainte de probă

- 7 oct 2026: un token inexistent primește **403**, nu 401 (testat cu un token fals; nu consumă bugetul vreunui proiect). Conectorul tratează 401 și 403 identic: eroare de acces, fără retry.

## Decizii deschise

- **Fereastra de 24 h față de ziua calendaristică.** `numOfDays=1` înseamnă ultimele 24 de ore de la apel, în UTC. Ziua înregistrată (ziua anterioară în Europe/Bucharest) coincide cu fereastra doar dacă apelul se face la 00:00 ora României; la 25 octombrie ziua are 25 de ore. De decis: ora rulării și cum se marchează în date că valoarea e o fereastră de 24 h aproximativă.
- **Limita de 1.000 de rânduri pentru `URL`** poate trunchia paginile pe un site mare. De verificat în fixture dacă `page` are exact 1.000 de rânduri.

## Rulare

| Data rulării | Proiecte (brand_slug) | Coduri HTTP | Observații |
|---|---|---|---|
| _de completat_ | | | |

## Metrici disponibile

| metricName (exact) | Câmpuri în `information` | Unitate / tip | Prezent în totals | Prezent în device | Observații |
|---|---|---|---|---|---|
| _de completat_ | | | | | |

## Dimensiuni

| Dimensiune (exact) | Validată în probă | Valori observate | Observații |
|---|---|---|---|
| Device | _de completat_ | | |
| Source | _de completat_ | | |
| URL | _de completat_ | | Atenție la limita de 1.000 de rânduri |

## Forma payload-ului

- _de completat:_ structura de nivel superior (listă de blocuri `{ metricName, information[] }`?), tipul valorilor (string sau număr), câmpuri lipsă sau null, intervalul de timp acoperit de `numOfDays=1` (UTC sau fusul proiectului?), dacă răspunsul include data.

## Semantică null / zero / eroare

- _de completat după probă:_ cum apare o metrică fără date (bloc lipsă, listă goală, valoare `0`, `null`).
