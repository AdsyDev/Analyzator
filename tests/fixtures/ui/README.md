# Fixtures pentru previzualizarea design

Date **fictive**, folosite doar când `VITE_DESIGN_PREVIEW=true` (vezi README-ul rădăcinii). Nu sunt date de client, nu sunt măsurători și nu trebuie să ajungă în staging sau production (regula 1 din `CLAUDE.md`).

- Domeniile folosesc TLD-ul rezervat `.example`; competitorii au nume inventate.
- Fiecare fișier are `_marker`; testele de build verifică absența lui din bundle-urile fără flag.
- Datele fictive există **doar pentru cele 16 chei din registru** (`ga4_*`, `gsc_*`, `seomonitor_*`, `clarity_*`, vezi `docs/metrics/registry.md`). `definitions.json` e o copie a rândurilor din `metric_definitions`, iar un test o compară cu migrația. Orice cheie din afara registrului (`ai_mention_rate`, `paid_spend`, `listening_mentions` etc.) primește `not_connected` și nu are definiție, exact ca providerul real; cheile revin aici când intră în registru.
- Statusurile sunt împărțite între branduri ca toate cele opt să apară: **Urinal** (brandul implicit) are `partial`, `stale` și `not_connected` pe Overview, SEO și Trafic; **Minimartieni** e în mare parte `ok`, cu `unavailable` și un `partial` cu zero neconfirmat (`value: null`); **Proenzi** are `insufficient_sample`, `base_zero` și `cannot_compute`. `insufficient_sample` nu poate apărea încă la nivel A (`min_sample` e null în registru); apare aici doar ca să poată fi revăzută starea.
- Paid Media și Social nu au chei în registru, deci sunt `not_connected` pe toate brandurile: starea implicită fără import e „Sursă neconectată" (UI-4).
- `ai.json` și `search.json` alimentează listele (răspunsuri AI, matrice, surse citate, keywords, landing pages, content gaps). Nu sunt metrici din registru, deci nu au definiții. Ratele din AI se calculează din răspunsurile generate, ca să se poată reproduce din ce se afișează; un test o verifică. Vezi `docs/design/ui-data-needs.md`.
