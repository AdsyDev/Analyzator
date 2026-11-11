# Ecrane: note de conținut și comportament

Note care trebuie păstrate până se construiește interfața. Textele sunt în română.

## Sursele unui site (`/admin/clients/:brandId`)

Din 12 oct. 2026 sursele nu mai au o pagină comună: fiecare site are pagina lui (Administrare → Clienți și site-uri → „Editează și surse”), cu detaliile site-ului, un card per sursă și istoricul sincronizărilor. Cardul sursei are pașii: (1) cheia clientului, doar pentru sursele care o folosesc, salvată o dată și refolosită automat de celelalte site-uri ale clientului; (2) contul sau proiectul site-ului. `/admin/sources` rămâne doar ca redirecționare spre site-ul ales (e ținta întoarcerii OAuth). Restul secțiunii descrie conexiunile și testarea tokenului, valabile în cardurile surselor.

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

- **Sidebar** colapsabil (sticlă; sub 1024 px, sertar deschis din butonul de meniu al topbarului): Overview, AI Visibility, SEO și Search, Trafic și conversii, Paid Media, Social, Listening, Concurență, Analize și acțiuni. Secțiunea **Administrare** (doar agenție): Clienți și site-uri (cu pagina fiecărui site și sursele lui), Utilizatori, Configurare.
- **Topbar** (sticlă): selector de brand (lista „Spații de brand accesibile", cu categoria; linkul „Clienți și site-uri" doar pentru agenție), titlul paginii, comutator temă, meniul utilizatorului (nume, rol și organizație, email, „Vezi interfața ca" client/agenție doar în previzualizare, „Ieși din cont").
- **FilterBar**: perioadă (Ultimele 7 zile, Ultimele 28 de zile, Luna curentă, Interval personalizat, cu intervalul afișat), comparație („vs perioada anterioară" implicit, „vs anul trecut"), filtre specifice modulului (Trafic: Device și Canal), chipuri pentru filtrele active și „Resetează filtrele".
- **Linia de proveniență**: „Date până la <data>" · „Ultimul refresh <acum 2 ore>".
- Titlul paginii are o frază-subtitlu per modul (vezi `PAGES` în referință).

## Login (`/login`)

Fără signup. Cinci stări în același cadru: **autentificare** (email de serviciu, parolă, „Ai uitat parola?", „Ține-mă minte pe acest dispozitiv", eroare inline), **activare invitație** („Alege-ți parola. Invitația e valabilă până pe <data>", cine a invitat, rol și branduri, email prefilled doar-citire, nume complet, parolă nouă cu indicator de putere), **resetare parolă** („Îți trimitem pe email un link valabil 30 de minute"), **parolă temporară** (E-5: „Schimbă parola temporară", pentru contul creat de administrator; email doar-citire și parolă nouă, fără nume), **link trimis** („Dacă <email> are cont în Analyzator, linkul de resetare a ajuns deja", „Retrimite linkul"). Subsol: „Accesul se face doar pe bază de invitație", contact suport, Confidențialitate, Termeni de utilizare.

## Overview (`/brands/:id/overview`)

**După macheta din propunere (11 nov. 2026, N).** Titlu „Imaginea completă a brandului”, calea „Brand Intelligence / Overview”, „Exportă raportul”. Rând de șase indicatori compacți (AI Share of Voice, Mențiuni în AI, Vizibilitate SEO, Sentiment pozitiv, Trafic organic, Poziție competitivă), fiecare cu numele exact al indicatorului dedesubt, tooltip cu definiția și legătură spre detaliu; cei din registru deschid dovezile. Apoi „Evoluția vizibilității AI” (2/3) și „Vizibilitate pe platforme” (1/3); „SEO și trafic”, „Social listening” (inel cu sentimentul mențiunilor revizuite) și „Competitori”. Dedesubt: bara de context, „Ce s-a schimbat”, „Prioritățile următoare”, „Interpretarea AdSymphony”. Lângă titlu, comutatorul „AI insights” deschide sidebarul AdSy AI din dreapta (închis la început, reținut pe dispozitiv): „Pașii recomandați” din ultima analiză publicată și întrebarea rapidă, cu buton de închidere; pe ecrane înguste acoperă pagina. Graficul de evoluție are curbă netedă, arie în degrade, puncte la capete și comutator 28 / 90 zile pentru perioada paginii; „SEO și trafic” are o linie mică fără axe; inelul de sentiment arată mențiunile revizuite. Tema implicită e cea închisă, cu paleta din machetă (N-7). Descrierea de mai jos e a versiunii anterioare.

Structura de mai jos e cea din propunerea din 10 nov. 2026 („Overview pentru decizii rapide"), construită în Etapa 2 (deciziile G). Designul inițial (spec cap. 12) e păstrat în tabelul de diferențe.

1. „Starea datelor" (pe orice modul cu surse): date până la, pe sursă; ultima sincronizare unde utilizatorul o poate vedea; următoarea actualizare estimată.
2. Bara de context: client, brand, țară, perioadă, comparație, acoperirea indicatorilor.
3. Șase carduri, fiecare cu întrebarea la care răspunde, numele exact al metricii și link spre detaliu cu aceleași filtre: Vizibilitate AI (AI Mention Rate), Vizibilitate organică (Visibility SEOmonitor), Conversații relevante (mențiuni + ponderea negativă revizuită, cu numere absolute), Performanță socială (interacțiuni), Trafic pe site (sesiuni), Acțiuni importante (key events). Fiecare deschide EvidenceDrawer.
4. „Ce s-a schimbat": Oportunitate și Risc (cea mai mare variație favorabilă și nefavorabilă, de cel puțin 5 %, etichetate „semnal automat, neconfirmat") și Decizie (prima acțiune deschisă din ultima analiză publicată). Fiecare cu mărime, sursă, perioadă și confirmare.
5. „Evoluția brandului": patru grafice pe aceeași perioadă (AI, search, trafic, mențiuni), fiecare cu scara ei.
6. „Poziția față de competitori": un rând pe AI, SEO și conversații din matricea de Concurență, cu locul în set pe fiecare dimensiune. Fără scor general.
7. „Prioritățile următoare": max 3 acțiuni deschise, cu responsabil, termen și, unde sunt completate, efort și KPI urmărit; „Deschide dovezile".
8. „Interpretarea AdSymphony": ultima analiză publicată, cu autor, perioadă, data publicării, dovezi, „Limite", „Vezi toate analizele".

## AI Visibility (`/brands/:id/ai`)

KPI-uri; „Mention Rate pe engine" (card per engine, cu variație și număr de răspunsuri valide); „Subiecte și competitori" (matrice cu intensitate de culoare = prezență, plus valoare numerică în celulă); „Surse citate" (domenii, tip, număr; 10 pe pagină, paginate pe loc din lista încărcată o dată, cel mult 200 de domenii, ca să nu întindă coloana sub matrice); „Answer Explorer" (listă întrebare, engine, rezultat; drawer cu răspunsul original sanitizat de date personale, brandurile evidențiate inline, citări numerotate cu domeniu, titlu și marcaj „Owned"; buton „Marchează pentru farmacovigilență").

## SEO și Search (`/brands/:id/seo`)

„Keywords urmărite" (keyword, URL, volum, rank mobil, rank desktop, trend de poziții, competitor în top 10 sau „Niciun competitor în top 10", paginare); „Landing pages din search" (clicks, CTR, poziție); „Content gaps" (căutări în care un competitor e în top 10, iar brandul nu are pagină: volum lunar, competitor, poziție).

## SEO → Indexare (`/brands/:id/indexing`)

**Etapa 3 (11 nov. 2026, L).** Submeniu al SEO, fără bară de perioadă (arată ultima stare cunoscută). „Starea indexării”: cinci numere din lista inspectată (URL-uri inspectate, În index, În afara indexului, Stare necunoscută, Canonical diferit), cu ziua inspecției; fără inspecții: „Nicio inspecție încă”. „URL-uri inspectate”: tabel cu URL, Prioritar, Stare, Motiv (Google), Ultima accesare, Canonical, Canonical ales de Google, Inspectat la; export CSV. „URL-uri prioritare”: lista agenției, cu „Neinspectat încă” pe cele noi; echipa agenției adaugă și șterge, clientul doar vede.

## Trafic și conversii (`/brands/:id/traffic`)

Filtre Device și Canal; „Canale" (sessions, pondere, variație); „AI referrals" (sursă, sessions, key events, rată); „Tracking quality" (listă de verificări zilnice cu titlu, notă, status).

## User experience (`/brands/:id/ux`)

Mutat din Trafic (E-1, varianta a): „Comportament" (Microsoft Clarity, pe device: rage clicks, dead clicks, quick backs, scroll depth, cu definiția fiecărei metrici) cu banner de sursă întârziată („Sincronizarea Clarity eșuează din <data>: ... Afișăm ultimele date importate.", „Reconectează în Surse"). Trafic trimite aici printr-un link.

**Etapa 3 (11 nov. 2026):** „AI referrals” și „Tracking quality” au date reale (J-1…J-3). Rata din „AI referrals” e ascunsă cât timp serverul nu o trimite. „Tracking quality” arată cinci verificări calculate din datele GA4 colectate, cu „Pe datele colectate la”, nu verificări zilnice.

## Paid Media (`/brands/:id/paid`) și Social (`/brands/:id/social`)

**Etapa 3 (11 nov. 2026):** „Buget și pacing” citește planul din `paid_budgets` (J-4). Echipa agenției are „Adaugă buget” / „Buget nou” (dialog: interval, sumă, monedă, notă) și „Șterge planul”; clientul vede bugetul, fără acțiuni. Fără plan: „Fără buget aprobat”. Cost în altă monedă decât planul: explicația, fără bara de spend.

În design există doar starea implicită, un EmptyState: titlu „Sursă neconectată", motiv („Google Ads și Meta Ads nu sunt conectate pentru <brand>. Până la conectare nu afișăm cifre, nici estimate." respectiv Planable pentru Social), acțiune „Conectează <sursă>" pentru agenție și „Cere conectarea" pentru client (toast: „Am trimis cererea de conectare către echipa AdSymphony."). Conținutul cu date (cap. 15 și 17) nu e proiectat și vine în UI-4.

## Listening (`/brands/:id/listening`)

„Distribuția sentimentului" (bară segmentată pozitiv/neutru/negativ, cu număr și procent; „Fiecare sentiment e verificat de un om din echipa AdSymphony"); filtre sentiment și sursă; feed de mențiuni (sursă, autor, dată, text, sentiment, „Revizuit de <nume>", „Deschide sursa", PharmacovigilanceButton cu stare „Marcat pentru farmacovigilență <data>"); stare goală „Nicio mențiune pentru filtrele alese"; Mențiunile apar ca postări (E-3): carduri cu platforma, autorul (cont propriu sau extern), data, textul complet, sentimentul și linkul spre original. Jurnalul PV are submeniul lui:

## Listening → Farmacovigilență (`/brands/:id/pharmacovigilance`)

E-2, varianta a. „Jurnal de farmacovigilență" (marcat la, item, utilizator, notificat, status), cu filtrele Status și Tip. Doar `agency_admin` (B7-14); celelalte roluri sunt redirecționate la Listening, fără cerere spre jurnal. Designul spunea „vizibil agenției și contactelor PV"; rămâne varianta îngustă din B7-14.

## Concurență (`/brands/:id/competition`)

Antet cu „Set de competitori v<n>", „Efectiv din <data>", „Date până la <data>"; ComparisonTable mare grupată pe surse (AI, SEO, social public), cu „Sursă: <sursă>" per grup, N/A explicat în notă, cea mai bună valoare marcată.

## Analize și acțiuni (`/brands/:id/insights`)

**Etapa 2 (10 nov. 2026):** agenția lucrează în pagină: „Analiză nouă" și „Editează" (titlu, perioadă, constatare, interpretare, limite, metrici citate), „Trimite la review", „Publică" și „Returnează la draft" (doar strategist și agency_admin, cu motiv), „Șterge ciorna", „Adaugă acțiune" (termen, efort, KPI urmărit) și pașii acțiunii în tabel (agreată, în lucru, finalizată, rezultat, anulare cu motiv). Clientul nu vede niciunul dintre controale. Din a doua rundă (H-4): „Recomandări” pe ciornă, „Versiune nouă” pe analiza publicată și selectorul de responsabil pentru `agency_admin`; recomandările apar în analiza publicată.

Designul inițial: Taburi (agenție: „Flux editorial" și vederea publicată; client: doar publicate); tabel cu titlu, autor, perioadă, status (Draft, În review, Publicat, Înlocuit), actualizat; detaliu cu rezumat, dovezi atașate, „Limite", tabel „Acțiuni" (acțiune, responsabil, termen, status); „Analiză nouă" pentru agenție.

## Rapoarte (`/brands/:id/reports`)

**Etapa 3 (11 nov. 2026, K-2).** Raportul perioadei alese, pentru oricine are acces la brand: antet (brand, client, perioadă, comparație, generat la), „Indicatori” (un tabel pe grup: Vizibilitate AI, SEO și Search, Trafic și conversii, Listening, Paid Media; valoare, variație, stare) și „Analize publicate” (constatare, interpretare, limite, recomandări, acțiuni). „Tipărește sau salvează ca PDF” deschide tipărirea browserului; la tipărire dispar meniul, bara de sus, filtrele și butoanele. „Exportă indicatorii (CSV)” scrie aceleași rânduri într-un fișier. Pagina nu are valori proprii: sunt cele din `brand_metrics` și `brand_insights`.

## Portofoliu (`/portfolio`)

**Etapa 3 (11 nov. 2026, K-3).** Toate brandurile permise utilizatorului, pe aceeași perioadă (filtrul de perioadă și comparație din URL), cu indicatorii de pe cardurile din Overview: valoare și variație, sau starea („Sursă neconectată”, „Fără date pentru interval”). Numele brandului duce la Overview-ul lui, cu aceeași perioadă. Un brand ai cărui indicatori nu pot fi citiți rămâne în listă, cu motivul. Linkul din meniu apare de la două branduri în sus.

## AdSy AI (`/brands/:id/assistant`)

**Etapa 4 (11 nov. 2026, M).** „Întreabă AdSy AI”: conversația sesiunii; fiecare răspuns are „Generat de AdSy AI”, „Nevalidat de echipă”, perioada, dovezile (o metrică deschide sertarul de dovezi, o analiză duce la Analize), limitele și, dacă există, propunerea pentru echipă. Stări fără răspuns: „Dovezi insuficiente”, „În afara datelor brandului”, „Răspuns respins”, „Plafonul lunar a fost atins”, „Prea multe întrebări azi”, „AdSy AI nu a putut răspunde”, „AdSy AI e oprit”, „AdSy AI nu e configurat încă”. „Controale AdSy AI”: preferința personală (Chat, Afișare) și, pentru `agency_admin`, politica brandului (Chat, Generare, Afișare, plafon lunar, consumul lunii); ceilalți văd politica, fără să o poată schimba.

**Ciorne generate (11 nov. 2026, O).** În „Analize și acțiuni”, echipa (nu clientul) are, cu generarea și afișarea pornite, o bandă „AdSy AI poate scrie o ciornă” cu butonul „Generează ciornă”. La reușită, lista trece pe ciorne și apare analiza nouă, cu eticheta „Generată de AdSy AI” și o notă că interpretarea și recomandările sunt ipoteze până la revizuire. Când nu se salvează nimic, pagina spune de ce (dovezi insuficiente, formă respinsă, oprit, neconfigurat, plafon, limită, eroare de model). După publicare, cardul păstrează eticheta și spune „revizuită și publicată de echipa AdSymphony”; o vede și clientul. Cu „afișare” oprită, analizele generate nu apar nicăieri (Analize, Overview, sidebarul AdSy AI).

## Administrare (doar agenție)

- **Clienți și site-uri** (`/admin/clients`): carduri de client (status, industrie, număr de spații, utilizatori, contacte PV, „Client din <data>"), tabel de spații de brand (domeniu, surse, utilizatori, ultimul import, status, acțiune „Deschis acum"/„Deschide"), „Adaugă client" și „Adaugă site" ca wizard cu pași (client, brand, competitori cu versiune v1, conectare surse „din 8 surse conectate", utilizatori).
- **Sursele unui site** (`/admin/clients/:brandId`, înlocuiește `/admin/sources`): un card per sursă (monogramă, nume, ce aduce, stare, „Date până la", „Importat la", acțiuni Reîncearcă / Reconectează / Conectează) și „Istoricul sincronizărilor" (sursă, dată, durată, rânduri, status). Specificația completă a conexiunilor și a testării tokenului e în secțiunea de la începutul acestui fișier și are prioritate față de design.
- **Utilizatori** (`/admin/users`): „Persoane cu acces" (persoană cu avatar și email, rol, branduri, ultima activitate), „Trimite invitație" (cititorii văd doar analizele publicate). Implementat (E-4): durata linkului din invitație e setarea din Supabase, nu 7 zile fixe; persoanele care nu au intrat încă apar „Invitație neacceptată", cu „Retrimite invitația". Implementat (E-5): secțiunea devine „Adaugă o persoană", cu două variante, „Trimite invitație pe email" (implicit) și „Creează contul cu parolă temporară" (parolă aleasă sau generată, afișată o singură dată într-o fereastră de confirmare cu „Copiază parola"). Conturile create apar „Parolă temporară", fără „Retrimite invitația", până la prima schimbare.
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
| `/admin/clients`, `/admin/clients/:brandId`, `/admin/users`, `/admin/config` (și redirecționarea `/admin/sources`) | doar `agency_admin` | Spec cap. 28 pune clienții, brandurile, invitațiile, sursele și drepturile la Agency admin; Surse e doar pentru `agency_admin`. Orice alt rol (inclusiv `strategist` și `account`) e redirecționat la `/`, fără să afle dacă pagina există. |
| orice altceva | autentificat | „Pagina nu există". |

- Brandul și filtrele vin din URL: `period` (`7d`, `28d`, `month`, `custom` cu `from` și `to`), `compare`, plus filtrele din allowlist-ul modulului (Trafic: `device`). Valorile implicite nu se scriu în URL; valorile necunoscute cad pe implicit.
- Schimbarea modulului păstrează perioada și comparația, nu și filtrele modulului. Schimbarea brandului păstrează modulul și parametrii comuni.
- Gărzile din UI sunt comoditate: autoritatea e RLS pe server. Un user client care cunoaște adresa unei pagini de administrare nu o poate folosi, fiindcă datele ei nu sunt expuse lui.
- În previzualizare, utilizatorul e fictiv, cu rol comutabil din meniul contului („Vezi interfața ca"); la comutare, ecranele se reîncarcă cu datele noului rol.
- „Conectează <sursă>" (Paid, Social) apare doar pentru `agency_admin` și duce la sursele site-ului. Pentru ceilalți nu există acțiune: nu există încă un canal real de cerere a conectării, iar designul arăta un toast care ar fi pretins o trimitere inexistentă.

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
| (10 nov. 2026) Rândurile de mai jos descriu Overview-ul dinainte de Etapa 2 | Vezi structura actuală în secțiunea „Overview (`/brands/:id/overview`)" și deciziile G | Păstrate ca istoric al diferențelor față de designul inițial |
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

---

# Diferențe față de design (UI-4: Trafic și conversii, Paid Media, Social)

| Design / spec | Implementat | Motiv |
|---|---|---|
| „Engagement rate" ca KPI (spec cap. 16) | „Sursă neconectată" | Cheia nu e în registru; rata nu se calculează în UI din sesiuni cu implicare și sesiuni. |
| „Key events selectate" | `ga4_key_events` | Nu există selecție de key events în contract. |
| Filtru Canal în Trafic | Doar Device | Designul îl aplica doar tabelului de canale, iar Device nu are corespondent în metricile din registru: secțiunea Canale spune explicit că KPI-urile rămân pe toate device-urile. |
| Landing pages din trafic, parcursuri definite (spec cap. 16) | Lipsesc | Nu sunt în cerința UI-4; nu au contract. |
| Comportament Clarity cu valori pe device | Coloana „Toate" din registru, device din provider; definițiile `draft` marcate „Provizoriu"; banner când sursa are probleme | Registrul are doar agregatul pe brand; defalcarea cere un view nou. Valorile Clarity rămân neconfirmate (`docs/contracts/clarity.md`). |
| „Reconectează în Surse" | Doar pentru `agency_admin` | Surse e doar pentru `agency_admin`. |
| Paid: „Observații" și „Creatives" | Lipsesc | Fără contract; creatives după lansare, iar designul cere fără galerie. |
| Paid/Social fără import: „Conectează Google Ads / Planable" | „Sursă neconectată" cu „Importă CSV" (agency_admin) | Cerința UI-4: modulele sunt pe bază de import; acțiunea doar intră în flux (cardul Import CSV din pagina site-ului), fără logica importului. Clientul și ceilalți nu primesc acțiune (nu există canal de cerere). |
| Pacing cu stare „în ritm / în urmă" | Două bare (spend față de buget, zile trecute din plan) și nota „reper, nu verdict" | Spec cap. 15: progresul liniar e un reper; nu emitem o judecată automată. |
| Postări cu preview imagine | Card ca pe rețea (E-3): platformă, dată, text, format, topic, interacțiuni, link validat; fără imagine | Nu există imagini autorizate (nu se importă); fără dependențe externe în interfață. Tabelul rămâne ca a doua vizualizare, pentru sortare. |
| Social: clasarea postărilor | Postările sub 7 zile marcate „date incomplete"; mediana doar din cele mature | Spec cap. 17: nu clasăm o postare de ieri împotriva uneia cu trei luni de expunere fără avertizare. |
| Cardul KPI se deschide în EvidenceDrawer | Doar pentru metricile din registru (Trafic); Paid și Social au `StatCard` cu definiție în tooltip | Datele importate nu sunt `MetricResponse` și nu au `evidence_query`. |
| Variație „−0 p.p." cu săgeată | „0 p.p." fără săgeată | Direcția se derivă din valoarea rotunjită, ca textul și săgeata să nu se contrazică. |


## Diferențe față de design (UI-5)

| Design | Implementat | Motiv |
|---|---|---|
| Trend al mențiunilor și topic map | Neimplementate | Fără sursă și fără contract de server; nu inventăm serii. |
| Analiza competitorilor în Listening | Neimplementată | Listening are date doar pentru brand; competitorii sunt `not_connected` în matrice. |
| Clic pe celulă în matrice → dovezi | Neimplementat | Celulele de Concurență nu sunt `MetricResponse` și nu au `evidence_query`. |
| Dimensiuni Presă / Ads / Reviews | Absente | Sunt după lansare. |
| Filtre Listening | Doar sentiment și sursă | Restul nu au cerință în spec cap. 18. |
| Sentiment pe fiecare mențiune | „Revizuit de <nume>" sau „Nerevizuit" | Un sentiment neverificat nu se afișează ca neutru. |
| Jurnal PV | Doar `agency_admin` | Spec cap. 28; la alte roluri nu se face nicio cerere. |

## Diferențe față de design (UI-6, seria 1)

| Design | Implementat | Motiv |
|---|---|---|
| Analize: editare de status și de acțiuni | Doar citire | Nu există tabele și nici scriere pentru analize; nu simulăm salvări. |
| Acțiuni: „termen depășit" | Doar data termenului | Marcajul ar fi o regulă calculată în UI; poate veni de la server. |
| Surse: stare „Învechit" pe date reale | Nederivată | Nu există o politică de prospețime aprobată. Apare doar în previzualizare. |
| Surse: „Conectează" pe Import CSV | Mesaj: importul de fișiere nu e disponibil încă | Logica de import nu face parte din UI-6. |
| Surse: test de conexiune pentru toate sursele | Doar Clarity | Funcția server validează doar Clarity (`DAILY_LIMIT`). Celelalte spun că testarea nu e disponibilă. |
| „Configurat de <persoană>" | „utilizator <id scurt>" | Numele utilizatorilor nu sunt citibile din client (nu există profil în schemă). |
| Filtrul de status al analizelor | Stare locală (taburi), nu în URL | E o vedere, nu perioadă sau filtru de date. |
| Brandurile reale în topbar | Citite din `brands` | Fără categorie (nu există în schemă). |

## Diferențe față de design (UI-6, seria 2)

| Design | Implementat | Motiv |
|---|---|---|
| „Trimite invitație" cu formular | Mesaj că invitarea nu e disponibilă | Nu există funcție server care să creeze contul și rolul; un formular ar pretinde o trimitere inexistentă. |
| Persoană cu nume și email | Nume și email când există; altfel „Utilizator <id scurt>" | Datele nu sunt citibile din client. |
| Configurare: doar EmptyState | Competitori (cu istoric de versiuni), aliasuri, maparea SEOmonitor | Cerința UI-6. Fără editare: versiunile sunt imutabile, iar crearea cere o funcție atomică pe server. |
| Aliasuri | „Sursă neconectată" pe date reale | Nu există tabel pentru ele. |
| Clienți și site-uri | Neconstruit (spune asta) | Nu face parte din UI-6. |
| Acces propriu | Rol și acces dezactivate pentru propriul rând | Previne blocarea contului; serverul trebuie să aplice și el regula. |
