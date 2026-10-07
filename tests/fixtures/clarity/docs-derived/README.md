# Fixtures Clarity derivate din documentație: NECONFIRMATE

Construite din [Clarity Data Export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api) (pagină actualizată 2025-12-05, citită 2026-10-08), **fără un apel real**.

- Forma (`[{ metricName, information[] }]`) și câmpurile blocului `Traffic` (`totalSessionCount`, `totalBotSessionCount` și `distantUserCount` ca string, `PagesPerSessionPercentage` ca număr) vin din exemplul oficial.
- Cheia dimensiunii are numele dimensiunii (exemplul oficial: `"OS": "Android"`).
- **Valorile sunt sintetice.** Celelalte metrici listate în documentație (Scroll Depth, Dead Click Count etc.) **nu apar aici**, pentru că documentația nu le dă câmpurile.
- Fiecare fișier are `_header`, `_source`, `_request`, `_note` și `payload` (răspunsul, exact cum l-ar întoarce API-ul).

Se înlocuiesc cu fixtures reale din `npm run probe:clarity` (`tests/fixtures/clarity/{brand_slug}-*.json`) când există un token.
