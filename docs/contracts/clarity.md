# Contract Clarity (Data Export API)

Endpoint: `GET https://www.clarity.ms/export-data/api/v1/project-live-insights`
Autentificare: `Authorization: Bearer {token}` (un token per proiect, doar server-side).
Limite: 10 apeluri/zi per proiect (bugetul stabilit pentru pilot). După documentația Microsoft, `numOfDays` acceptă 1–3 și maximum 3 dimensiuni (`dimension1..3`); **de confirmat** pe documentația curentă.

Fixtures: `tests/fixtures/clarity/{brand_slug}-totals.json` (`numOfDays=1`) și `{brand_slug}-device.json` (`numOfDays=1&dimension1=Device`), generate de `npm run probe:clarity`.

> **Status: de completat manual după rularea probei.** Valorile de mai jos nu sunt presupuse; se trec doar ce apare în fixtures.

## Observații înainte de probă

- 7 oct 2026: un token inexistent primește **403**, nu 401 (testat cu un token fals; nu consumă bugetul vreunui proiect).

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

## Forma payload-ului

- _de completat:_ structura de nivel superior (listă de blocuri `{ metricName, information[] }`?), tipul valorilor (string sau număr), câmpuri lipsă sau null, intervalul de timp acoperit de `numOfDays=1` (UTC sau fusul proiectului?), dacă răspunsul include data.

## Semantică null / zero / eroare

- _de completat după probă:_ cum apare o metrică fără date (bloc lipsă, listă goală, valoare `0`, `null`).
