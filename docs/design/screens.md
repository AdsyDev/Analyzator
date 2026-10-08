# Ecrane: note de conținut și comportament

Note care trebuie păstrate până se construiește interfața. Textele sunt în română.

## Administrare → Surse

Acces: doar `agency_admin`. Ceilalți utilizatori nu văd ecranul. Strategist și account văd starea surselor în pagina de status, dar fără acțiuni pe credențiale.

### Lista conexiunilor (per brand)

| Coloană | Sursă | Note |
|---|---|---|
| Sursă | `provider` | „Clarity", „GA4" etc. |
| Cont / proiect | `external_account_id`, `display_name` | |
| Stare credențial | `credential_status` | `missing` = „Token neconfigurat"; `unverified` = „Token salvat, netestat"; `valid` = „Conexiune funcțională"; `invalid` = „Token refuzat de furnizor" |
| Ultima testare | `last_validated_at`, `last_validation_error` | Data în Europe/Bucharest. Eroarea arată doar codul (de exemplu „HTTP 403"). |
| Configurat de | `credential_updated_by`, `credential_updated_at` | |
| Apeluri azi | suma `provider_api_calls.calls` pentru conexiune și ziua UTC curentă | Format „X / 10" |

### Setare sau rotire token

- Câmp de tip parolă, fără afișare și fără „copiază". După salvare câmpul se golește. Tokenul **nu se mai afișează niciodată**: frontend-ul primește doar starea.
- Apel: Edge Function `source-credentials`, `{ action: "set_token", connection_id, token }`.
- Mesaj după salvare: „Token salvat. Testează conexiunea pentru a confirma că funcționează."
- Rotirea folosește același formular; în audit apare ca `credential_rotated`.

### Butonul „Testează conexiunea"

- Text lângă buton, obligatoriu: **„Testarea consumă 1 din cele 10 apeluri zilnice. Azi: X folosite."**
- Butonul e dezactivat când X ≥ 10, cu explicația „Bugetul zilnic e consumat. Se resetează la 00:00 UTC (03:00 ora României vara, 02:00 iarna)".
- Apel: `{ action: "validate", connection_id }`. Afișează `message` din răspuns și actualizează „Azi: X folosite" din `calls_today`.
- Rezultate: `valid` (verde), `invalid` (roșu, cu indicația de a genera un token nou), `rate_limited` și `provider_error` (galben: starea tokenului nu s-a schimbat), `budget_exhausted` (testul nu a rulat).
- Nu se testează automat la salvare: fiecare test consumă buget.

---

# Ecrane din designul Claude Design

Extras din `docs/design/reference/Analyzator.dc.html` (referință vizuală, nu cod). Ruta e cea din spec cap. 12 și 22: `/brands/:brandId/<modul>`, cu `period`, `compare` și filtrele modulului în query string; brandul și filtrele din URL sunt singura sursă de adevăr. Textele de mai jos sunt în română și rămân așa în UI. Valorile din design (branduri, competitori, cifre) sunt ilustrative și nu intră în aplicație în afara modului de previzualizare.

## Cadrul comun (shell)

- **Sidebar** colapsabil (sticlă): Overview, AI Visibility, SEO și Search, Trafic și conversii, Paid Media, Social, Listening, Concurență, Analize și acțiuni. Secțiunea **Administrare** (doar agenție): Clienți și site-uri, Surse, Utilizatori, Configurare.
- **Topbar** (sticlă): selector de brand (lista „Spații de brand accesibile", cu categoria; linkul „Clienți și site-uri" doar pentru agenție), titlul paginii, comutator temă, meniul utilizatorului (nume, rol și organizație, email, „Vezi interfața ca" client/agenție doar în previzualizare, „Ieși din cont").
- **FilterBar**: perioadă (Ultimele 7 zile, Ultimele 28 de zile, Luna curentă, Interval personalizat, cu intervalul afișat), comparație („vs perioada anterioară" implicit, „vs anul trecut"), filtre specifice modulului (Trafic: Device și Canal), chipuri pentru filtrele active și „Resetează filtrele".
- **Linia de proveniență**: „Date până la <data>" · „Ultimul refresh <acum 2 ore>".
- Titlul paginii are o frază-subtitlu per modul (vezi `PAGES` în referință).

## Login (`/login`)

Fără signup. Patru stări în același cadru: **autentificare** (email de serviciu, parolă, „Ai uitat parola?", „Ține-mă minte pe acest dispozitiv", eroare inline), **activare invitație** („Alege-ți parola. Invitația e valabilă până pe <data>", cine a invitat, rol și branduri, email prefilled doar-citire, nume complet, parolă nouă cu indicator de putere), **resetare parolă** („Îți trimitem pe email un link valabil 30 de minute"), **link trimis** („Dacă <email> are cont în Analyzator, linkul de resetare a ajuns deja", „Retrimite linkul"). Subsol: „Accesul se face doar pe bază de invitație", contact suport, Confidențialitate, Termeni de utilizare.

## Overview (`/brands/:id/overview`)

1. 6 KpiCards: AI Mention Rate, clicks din search, sessions, key events, cost paid, mențiuni eligibile (+ AI SoV în design). Fiecare deschide EvidenceDrawer.
2. „Acoperirea indicatorilor": rezumat pe stări de acoperire.
3. „Evoluție sincronizată": TrendChart indexat (prima zi = 100), serii comutabile din legendă.
4. „Ultima analiză publicată": titlu, autor, perioadă, rezumat, dovezi atașate, „Limite", „Vezi toate analizele".
5. „Comparație cu competitorii": tabel brand + C1-C3; cea mai bună valoare pe rând evidențiată; N/A explicat („pentru <competitori> nu avem sursă de Listening conectată").
6. „Oportunități": max 3, cu titlu, motiv, responsabil, „Deschide dovezile".

## AI Visibility (`/brands/:id/ai`)

KPI-uri; „Mention Rate pe engine" (card per engine, cu variație și număr de răspunsuri valide); „Subiecte și competitori" (matrice cu intensitate de culoare = prezență, plus valoare numerică în celulă); „Surse citate" (domenii, tip, număr); „Answer Explorer" (listă întrebare, engine, rezultat; drawer cu răspunsul original sanitizat de date personale, brandurile evidențiate inline, citări numerotate cu domeniu, titlu și marcaj „Owned"; buton „Marchează pentru farmacovigilență").

## SEO și Search (`/brands/:id/seo`)

„Keywords urmărite" (keyword, URL, volum, rank mobil, rank desktop, trend de poziții, competitor în top 10 sau „Niciun competitor în top 10", paginare); „Landing pages din search" (clicks, CTR, poziție); „Content gaps" (căutări în care un competitor e în top 10, iar brandul nu are pagină: volum lunar, competitor, poziție).

## Trafic și conversii (`/brands/:id/traffic`)

Filtre Device și Canal; „Canale" (sessions, pondere, variație); „AI referrals" (sursă, sessions, key events, rată); „Comportament" (Microsoft Clarity, pe device: rage clicks, dead clicks, quick backs, scroll depth, cu definiția fiecărei metrici) cu banner de sursă întârziată („Sincronizarea Clarity eșuează din <data>: ... Afișăm ultimele date importate.", „Reconectează în Surse"); „Tracking quality" (listă de verificări zilnice cu titlu, notă, status).

## Paid Media (`/brands/:id/paid`) și Social (`/brands/:id/social`)

În design există doar starea implicită, un EmptyState: titlu „Sursă neconectată", motiv („Google Ads și Meta Ads nu sunt conectate pentru <brand>. Până la conectare nu afișăm cifre, nici estimate." respectiv Planable pentru Social), acțiune „Conectează <sursă>" pentru agenție și „Cere conectarea" pentru client (toast: „Am trimis cererea de conectare către echipa AdSymphony."). Conținutul cu date (cap. 15 și 17) nu e proiectat și vine în UI-4.

## Listening (`/brands/:id/listening`)

„Distribuția sentimentului" (bară segmentată pozitiv/neutru/negativ, cu număr și procent; „Fiecare sentiment e verificat de un om din echipa AdSymphony"); filtre sentiment și sursă; feed de mențiuni (sursă, autor, dată, text, sentiment, „Revizuit de <nume>", „Deschide sursa", PharmacovigilanceButton cu stare „Marcat pentru farmacovigilență <data>"); stare goală „Nicio mențiune pentru filtrele alese"; „Jurnal de farmacovigilență" (marcat la, item, utilizator, notificat, status), vizibil doar agenției și contactelor PV.

## Concurență (`/brands/:id/competition`)

Antet cu „Set de competitori v<n>", „Efectiv din <data>", „Date până la <data>"; ComparisonTable mare grupată pe surse (AI, SEO, social public), cu „Sursă: <sursă>" per grup, N/A explicat în notă, cea mai bună valoare marcată.

## Analize și acțiuni (`/brands/:id/insights`)

Taburi (agenție: „Flux editorial" și vederea publicată; client: doar publicate); tabel cu titlu, autor, perioadă, status (Draft, În review, Publicat, Înlocuit), actualizat; detaliu cu rezumat, dovezi atașate, „Limite", tabel „Acțiuni" (acțiune, responsabil, termen, status); „Analiză nouă" pentru agenție.

## Administrare (doar agenție)

- **Clienți și site-uri** (`/admin/clients`): carduri de client (status, industrie, număr de spații, utilizatori, contacte PV, „Client din <data>"), tabel de spații de brand (domeniu, surse, utilizatori, ultimul import, status, acțiune „Deschis acum"/„Deschide"), „Adaugă client" și „Adaugă site" ca wizard cu pași (client, brand, competitori cu versiune v1, conectare surse „din 8 surse conectate", utilizatori).
- **Surse** (`/admin/sources`): grila de SourceStatus (monogramă, nume, ce aduce, stare, „Date până la", „Importat la", acțiuni Reîncearcă / Reconectează / Conectează) și „Istoricul sincronizărilor" (sursă, dată, durată, rânduri, status). Specificația completă a conexiunilor și a testării tokenului e în secțiunea de la începutul acestui fișier și are prioritate față de design.
- **Utilizatori** (`/admin/users`): „Persoane cu acces" (persoană cu avatar și email, rol, branduri, ultima activitate), „Trimite invitație" (invitațiile sunt valabile 7 zile; cititorii văd doar analizele publicate).
- **Configurare** (`/admin/config`): în design doar EmptyState. Conținutul (competitori cu versiune și dată efectivă, aliasuri, grupuri SEOmonitor → brand) vine în UI-6.

## Componente transversale (din „Sistem UI")

EvidenceDrawer (sticlă): pagină, indicator, definiție, valoare, variație, sursă, interval, „Date până la", acoperire, „Cum se calculează", „Înregistrări sursă" (ultimele N din total, cu „Importat la", payload hash și „Copiază hash"), stare fără înregistrări. Dialogul de farmacovigilență: „Verifică ce se înregistrează. Marcajul rămâne în jurnal și nu poate fi șters, doar adnotat.", data și ora, utilizator, link, snapshot text, „Ce urmează" (notificare imediată către contactele PV configurate), „Anulează" / „Marchează și notifică". Toast pentru confirmări.

---

# Rute și acces (implementat în `apps/web/src/routing`)

| Rută | Cine o vede | Comportament |
|---|---|---|
| `/login` | oricine | Cu sesiune activă duce la adresa cerută inițial (doar adrese interne, din starea routerului) sau la `/`. Fără signup. |
| `/` | autentificat | Duce la Overview-ul ultimului brand permis, sau al primului. Fără brand alocat: „Nu ai acces la niciun spațiu de brand". |
| `/brands/:brandId` | autentificat | Duce la `/brands/:brandId/overview`. |
| `/brands/:brandId/<modul>` | autentificat, doar branduri permise | Module: `overview`, `ai`, `seo`, `traffic`, `paid`, `social`, `listening`, `competition`, `insights`. Un brand din afara listei permise (sau inexistent) arată același mesaj „Spațiu de brand indisponibil" și nu declanșează nicio cerere de date pentru el. |
| `/admin/clients`, `/admin/sources`, `/admin/users`, `/admin/config` | doar `agency_admin` | Spec cap. 28 pune clienții, brandurile, invitațiile, sursele și drepturile la Agency admin; Surse e doar pentru `agency_admin`. Orice alt rol (inclusiv `strategist` și `account`) e redirecționat la `/`, fără să afle dacă pagina există. |
| orice altceva | autentificat | „Pagina nu există". |

- Brandul și filtrele vin din URL: `period` (`7d`, `28d`, `month`, `custom` cu `from` și `to`), `compare`, plus filtrele din allowlist-ul modulului (Trafic: `device`). Valorile implicite nu se scriu în URL; valorile necunoscute cad pe implicit.
- Schimbarea modulului păstrează perioada și comparația, nu și filtrele modulului. Schimbarea brandului păstrează modulul și parametrii comuni.
- Gărzile din UI sunt comoditate: autoritatea e RLS pe server. Un user client care cunoaște adresa unei pagini de administrare nu o poate folosi, fiindcă datele ei nu sunt expuse lui.
- În previzualizare, utilizatorul e fictiv, cu rol comutabil din meniul contului („Vezi interfața ca"); la comutare, ecranele se reîncarcă cu datele noului rol.
- „Conectează <sursă>" (Paid, Social) apare doar pentru `agency_admin` și duce la Surse. Pentru ceilalți nu există acțiune: nu există încă un canal real de cerere a conectării, iar designul arăta un toast care ar fi pretins o trimitere inexistentă.

---

# Diferențe față de design (UI-2: login, shell, Overview)

Ce s-a implementat diferit de designul din `docs/design/reference/` și de ce. Nu sunt decizii de design noi: sunt lipsuri de date, de contract sau de canal.

## Login

| Design | Implementat | Motiv |
|---|---|---|
| „Link valabil 30 de minute" la resetare | „Valabil o perioadă limitată" | `supabase/config.toml` are `otp_expiry = 3600`; nu afirmăm o durată pe care serverul nu o garantează. |
| Card cu inițiatorul invitației, rol și branduri | Doar emailul invitației, readonly | Supabase nu transmite aceste date prin linkul de invitație; nu există un contract pentru ele. |
| Buton „Activează-ți contul" pe ecranul de autentificare | Text „Folosește linkul din emailul de invitație" | Invitația se acceptă din linkul din email, nu dintr-un formular public (fără signup). În previzualizare există „Vezi activarea invitației". |
| Email de suport și linkuri Confidențialitate / Termeni | Emailul apare doar dacă `VITE_SUPPORT_EMAIL` e setat; fără linkuri | Nu există adresa confirmată și nici paginile; nu afișăm linkuri moarte. |
| Card cu sticlă | Card solid | Regula de aur: sticla doar pe sidebar, topbar, drawere, modale, popovere. |
| Indicator de putere a parolei | Orientativ; cerința minimă e 8 caractere | Serverul acceptă 6 (`minimum_password_length`); configurarea recomandă 8 sau mai mult. |

## Overview

| Design / spec cap. 12 | Implementat | Motiv |
|---|---|---|
| „Evoluții prioritare" (max 3 schimbări semnificative) | Lipsește | Nu există sursă de semnale, nici praguri configurate; calculul „semnificativ" nu are voie să stea în UI (regula 4). Cere un contract server. |
| „AI Mention Rate pe engine selectat", „key events selectate" | Fără selectoare | Contractul nu are dimensiune de engine și nici selecție de key events. |
| Un grafic cu serii indexate (prima zi = 100) | O serie pe rând, cu unitatea ei, plus comparația punctată | Indexarea e o transformare calculată în UI; spec cere „fiecare cu unitatea proprie". |
| Oportunități cu „de ce" și prioritate | Titlu, responsabil, termen, status, „Deschide dovezile" | `InsightAction` din contract nu are motiv sau prioritate. Dovezile vin din analiza părinte. |
| Comparație cu C1-C3 pe AI, SEO, social, listening | Brandul are valori unde există; competitorii sunt N/A cu motiv | Nu există o sursă de date pentru competitori (metrici sau API). Fără rând de social: nicio cheie în registru. |
| Cardurile `ai_mention_rate`, `paid_spend`, `listening_mentions` cu valori | `not_connected`, fără definiție | Cheile nu sunt în `metric_definitions`; tooltipul spune că definiția nu e încă în registru. |
| Etichete scrise de designer | `name_ro` din registru când există definiția | Registrul e sursa textelor; eticheta slotului din spec e doar rezerva. |

---

# Diferențe față de design (UI-3: AI Visibility, SEO și Search)

| Design / spec | Implementat | Motiv |
|---|---|---|
| Rută `/brands/{id}/search` (spec cap. 14) | `/brands/:id/seo` | Ruta din design și din navigație (UI-1). |
| Rank absent „Peste 100" | „Fără rank" | Spec 2.2: rank absent nu primește poziția 100. |
| Competitor „în top 10" | „Niciun competitor prezent" | Datele nu spun că pragul e top 10. |
| Iconuri de engine din CDN extern | Monogramă text (CH, GE, PE, AI) | Nicio dependență externă în interfață. |
| Cardurile KPI AI cu valori | „Sursă neconectată" pe toate cinci | `ai_*` nu sunt în registru. Pagina nu are valori reale până atunci; listele (engine, matrice, răspunsuri) se văd doar în previzualizare. |
| Filtre: engine, suprafață, panel, topic, intenție, brand/nonbrand, cohortă, crawl | Engine și grup (AI); brand/nonbrand (SEO) | Restul nu au sursă în contractele de date. |
| Trenduri cu marcaje de schimbare de panel | Fără marcaje | Contractul nu are evenimente de metodologie. |
| „Cerere și sezonalitate", „Pagini de investigat", „Informații de verificat" | Lipsesc | Nu sunt în cerința UI-3; „Informații de verificat" e după lansare (cu AdSy AI). |
| Detaliu răspuns cu citări | Citările sunt linkuri validate; răspuns refuzat/eroare/necolectat au explicație proprie | Spec 2.2 și 28. |
| Corectarea etichetelor de un specialist (cu motiv) | Nu e implementată | Cere un contract de scriere și audit; nu există. |
| Marcarea PV pe răspuns | Pentru răspunsurile valide (cu text) | Un răspuns fără text nu are ce se înregistra. |
