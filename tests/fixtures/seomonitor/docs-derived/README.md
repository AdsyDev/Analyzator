# Fixtures SEOmonitor derivate din documentație: NECONFIRMATE

Construite din [SEOmonitor API 3.0](https://api-docs.seomonitor.com) (paginile markdown din `llms.txt`, citite 2026-10-08), **fără un apel real**.

- Câmpurile și tipurile vin din schemele OpenAPI ale fiecărei rute; **valorile sunt sintetice** (campania 102933, domeniul `www.brand1a.test`).
- Fiecare fișier are `_header`, `_source` (pagina documentației), `_request`, `_note` și `payload` (răspunsul).
- **Diferențe față de documentație:** pentru `daily-ranks`, `groups/daily-visibility`, `competition/ais`, `ais-mentions` și `ais-citations`, schema descrie rădăcina ca obiect (un singur element), iar exemplele sunt obiecte; aici sunt liste. Parserul acceptă ambele forme.
- **Neconfirmate:** unitatea visibility (0.53 față de 53.3 în exemple), valoarea rankului pentru „nu se clasează” la `daily-ranks`, existența unui semnal de refuz al motorului AI.

Se înlocuiesc cu răspunsuri reale după prima rulare cu token.
