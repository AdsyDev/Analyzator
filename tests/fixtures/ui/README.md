# Fixtures pentru previzualizarea design

Date **fictive**, folosite doar când `VITE_DESIGN_PREVIEW=true` (vezi README-ul rădăcinii). Nu sunt date de client, nu sunt măsurători și nu trebuie să ajungă în staging sau production (regula 1 din `CLAUDE.md`).

- Domeniile folosesc TLD-ul rezervat `.example`; competitorii au nume inventate.
- Fiecare fișier are `_marker`; testele de build verifică absența lui din bundle-urile fără flag.
- Metricile din registru (`ga4_*`, `gsc_*`, `seomonitor_*`, `clarity_*`) folosesc cheile reale. Cheile `ai_*`, `listening_*`, `paid_*`, `social_*` nu sunt încă în registru; definițiile lor din `definitions.json` sunt doar pentru previzualizare.
- Statusurile sunt împărțite între branduri ca toate cele opt să apară: **Urinal** (brandul implicit) are `partial`, `stale` și `not_connected` pe fiecare ecran cu date; **Minimartieni** e în mare parte `ok`, cu `unavailable`; **Proenzi** are `insufficient_sample`, `base_zero` și `cannot_compute`.
- Paid Media și Social sunt `not_connected` pe toate brandurile: sunt module pe bază de import, iar starea lor implicită fără import e „Sursă neconectată" (UI-4).
