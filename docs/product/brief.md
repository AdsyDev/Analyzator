# Analyzator Brief de lansare

Ce livrăm pe 26 octombrie 2026, cine face ce și ce rămâne pentru etapa următoare

Document de lucru pentru Victor Ionescu și echipa de proiect

Pilot STADA România cu Urinal, Minimartieni și Proenzi

Versiunea 1.2 din 30 septembrie 2026

**Termen: luni, 26 octombrie 2026 (18 zile lucrătoare, 1-26 octombrie)**

Acest brief definește versiunea de lansare: scopul pe niveluri, responsabilii, deciziile de arhitectură pentru pilot, calendarul și criteriile de acceptare. Specificația completă a produsului (module, indicatori, reguli de calcul, arhitectură țintă) este în documentul separat **Analyzator Specificație de produs v1.2** și se citește pe măsură ce se implementează fiecare modul. Unde cele două diferă, briefull are prioritate pentru versiunea din 26 octombrie.

Pe scurt

- Construim Analyzator ca platformă de Brand Intelligence pentru clienții AdSymphony: datele de marketing ale brandului, date publice despre trei competitori per brand, dovezi la nivel de sursă și interpretarea agenției, într-un dashboard configurat de AdSymphony.

- Dezvoltare internă, cu abonamentele și resursele existente: SEOmonitor, Planable, GA4, Search Console, platformele de ads, Supabase și Claude Code. Fără programe de finanțare și fără furnizori noi în această etapă.

- Pe 26 octombrie livrăm o versiune de lansare acceptată intern: trei spații de brand cu date reale, module automatizate pentru AI, SEO, trafic și sinteză, module pe bază de import pentru paid, social și listening, două refreshuri săptămânale verificate și câte o analiză publicată per brand.

- Scopul este împărțit pe trei niveluri: A automatizat și reconciliat cu sursa, B pe bază de import CSV, C după lansare. Ce nu este în A sau B nu se construiește înainte de 26 octombrie.

- Victor este alocat integral. Claudia preia importul CSV, tabelele de nivel B și testarea. Claudiu, Bibi și Bianca dețin sursele de date. Alex decide scopul, prioritățile și acceptarea.

- Accesul clientului STADA se activează după primul call condus din platformă, nu în ziua lansării (capitolul 1.3).

## 1 Obiectiv și definiția lansării

### 1.1 Ce este Analyzator

Analyzator răspunde la cinci întrebări pentru fiecare brand: unde crește sau scade vizibilitatea, cine câștigă în fața lui, ce mesaje și conținut funcționează, ce rezultate de marketing obținem și ce acțiuni merită prioritizate. Clientul filtrează, explorează, deschide dovezile și citește analizele publicate de agenție. Sursele, competitorii, șabloanele și metodologia sunt administrate de AdSymphony; un buton „Solicită ajustare” creează o cerere internă, fără editarea directă a configurației.

Un client contractual este un tenant. STADA România este primul tenant și conține trei spații de brand: Urinal, Minimartieni și Proenzi. Un utilizator poate avea acces la un brand, la mai multe sau la portofoliul aprobat. Același șablon trebuie să poată fi reutilizat pentru următorul client fără copierea aplicației.

### 1.2 Ce înseamnă „gata” pe 26 octombrie

Versiunea de lansare este acceptată intern când toate condițiile de mai jos sunt îndeplinite:

- Fiecare dintre cele trei branduri are un dashboard cu date reale din sursele de nivel A și tabele cu date importate pentru nivelul B. Fiecare valoare arată sursa, „Date până la”, „Importat la” și acoperirea.

- Izolarea pe tenant și brand este demonstrată prin teste: API, view-uri, funcții, storage, export și URL modificat.

- Refreshurile din 13 și 20 octombrie sunt reconciliate cu sursele, pentru o săptămână și o lună, în aceeași monedă și același timezone.

- Fiecare brand are cel puțin o analiză publicată de echipă, cu autor, perioadă, dovezi și limite.

- Fluxul de farmacovigilență este definit și butonul de marcare funcționează înainte ca modulul Listening să fie vizibil (capitolul 6).

- Backup și restaurare testate, runbook-ul săptămânal predat, echipa de account poate conduce un call din platformă.

- Lista automatizărilor active și a limitelor se predă odată cu produsul. Un modul fără sursă nu este declarat complet doar pentru că există interfața.

### 1.3 Accesul clientului

26 octombrie este lansare internă, cu demo ghidat pentru echipa de account și strategie. Conturile STADA se creează după ce echipa a condus primul call real din platformă, cu țintă în prima jumătate a lunii noiembrie. Motivul: un client cheie nu primește acces self-service la o platformă cu două refreshuri în spate și fără o discuție reală purtată pe ea.

> Dacă există un angajament față de STADA pentru 26 octombrie, Alex decide și briefull se actualizează. În acest caz, ce vede clientul în acea zi (demo condus de agenție, nu cont propriu) se scrie explicit în capitolul 3.

### 1.4 Statutul informațiilor

- **Confirmat de Alex:** trei branduri STADA, trei competitori per brand, personalizare exclusiv de agenție, analiză de marketing, refresh săptămânal, dezvoltare internă cu resursele existente, termen 26 octombrie 2026.

- **Verificat documentar:** capabilitățile publice ale furnizorilor, listate în specificație, capitolul 32. Accesul efectiv, entitlementurile și payloadurile se probează în 1-2 octombrie.

- **Propus pentru execuție:** nivelurile, alocarea, calendarul și deciziile de arhitectură de mai jos. Victor confirmă fezabilitatea pe 2 octombrie; blocajele se raportează lui Alex în aceeași zi.

## 2 Echipa și responsabilii

Rolurile de mai jos sunt nominale. Într-un plan de 18 zile, o responsabilitate fără nume nu se execută.

| **Persoană**                                  | **Rol în proiect**   | **Responsabilități în sprint**                                                                                                                             | **Disponibilitate**                                                                  |
|-----------------------------------------------|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| **Alex Grivei**                               | Product owner        | Decide scopul, prioritățile, bugetul și acceptarea. Deblochează accesuri și decizii în aceeași zi. Conduce punctele de control.                            | Zilnic, 30 de minute rezervate pentru proiect                                        |
| **Victor Ionescu**                            | Lead developer       | Arhitectură, fundație, conectorii de nivel A, ecranele, QA tehnic, runbook și handover. Singurul care scrie în repo pe backend.                            | Integral, 1-26 octombrie                                                             |
| **Claudia Pistol**                            | Developer            | Importul CSV asistat, tabelele de nivel B, stările fără date, testarea UAT în 19-23 octombrie, landing page-ul după lansare.                               | Propunere: 50% în 1-16 octombrie, integral în 19-23 octombrie (de confirmat de Alex) |
| **Claudiu Fota**                              | SEO, GEO și tracking | SEOmonitor: campanii, grupuri, add-ons AI, token API. GA4 și Search Console: acces, key events. Clusterele de keywords. Validarea reconcilierii SEO și AI. | Zilnic în 1-9 octombrie, apoi la cerere; 13 și 20 octombrie pentru validare          |
| **Bianca Vlagali (Bibi)**                     | Media buy digital    | Conturile Google Ads, Meta și TikTok: exporturi standard, cereri de acces API, reguli de naming, bugete aprobate, validarea reconcilierii paid.            | 1-2 octombrie pentru accesuri; 12-13 și 19-20 octombrie pentru exporturi și validare |
| **Bianca Blidari**                            | Social media         | Planable: workspaces, tokenuri API, exporturi Analytics, Listening și Competitors. Taxonomia de conținut pentru postări.                                   | 1-2 octombrie pentru accesuri; 12-13 și 19-20 octombrie pentru exporturi și validare |
| **Account STADA (nume de confirmat de Alex)** | Account              | Competitorii, documentele aprobate, fișa de onboarding per brand, procedura de farmacovigilență obținută de la client, calendarul primului call.           | Fișe până pe 2 octombrie; zilnic 15 minute                                           |
| **Strategie (nume de confirmat de Alex)**     | Strategie            | Aprobarea panelului de keywords AI, interpretările și analizele publicate per brand.                                                                       | Panel până pe 2 octombrie; 14-20 octombrie pentru analize                            |

Reguli de colaborare

- Feedback pe orice întrebare a lui Victor în maximum o zi lucrătoare; blocajele se raportează lui Alex în aceeași zi.

- Sursele de date au un owner care livrează accesul sau exportul; Victor nu urmărește accesuri.

- Orice cerere de scop în plus se notează separat, cu impact în timp și cost, și intră în reestimarea din 27 octombrie.

- Fiecare etapă se încheie cu diff, teste relevante, reconciliere cu sursa și demonstrație pe un brand.

## 3 Scopul pe niveluri

Calendarul de 18 zile este un buget de timp pentru nivelurile A și B. Nivelul C nu se construiește înainte de 26 octombrie, indiferent de cât de mic pare un task. Ordinea de implementare în interiorul nivelului A este cea din calendar (capitolul 8).

### 3.1 Nivelul A: automatizat și reconciliat cu sursa

| **Modul**               | **Livrare pe 26 octombrie**                                                                                                                                                                                         | **Sursă și owner de date**                       |
|-------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| **Fundație**            | Autentificare pe invitație, roluri (agency admin, strategist, account, client viewer), tenant STADA cu trei spații de brand, izolare cu RLS, statusul surselor, configurare de agenție cu versiune.                 | Supabase (Victor)                                |
| **Overview**            | Bara de context, 6 KPI cards, evoluții prioritare (maximum 3), trenduri sincronizate pentru AI, search, trafic și mențiuni, comparație cu C1-C3, ultima analiză publicată, oportunități.                            | Agregate din modulele de mai jos (Victor)        |
| **AI Visibility**       | Mention Rate, Recommendation Rate, Owned Citation Rate, SoV în set, răspunsuri valide și acoperire; trenduri pe engine; matrice topic și competitor; surse citate; Answer Explorer cu răspunsul original sanitizat. | SEOmonitor AI Search Tracking prin API (Claudiu) |
| **SEO și Search**       | GSC clicks, impressions, CTR; SEOmonitor visibility; keywords în Top 3 și Top 10; keyword table cu rank mobile și desktop și competitor prezent; landing pages; content gaps.                                       | SEOmonitor ranks și GSC API (Claudiu)            |
| **Trafic și conversii** | Sessions, active users, engaged sessions, key events selectate; canale; landing pages; AI referrals pe bază de listă de reguli; tracking quality.                                                                   | GA4 Data API (Claudiu)                           |
| **Analize și acțiuni**  | Insight cu statusuri draft, in_review, published, superseded; recomandare; acțiune cu responsabil și status; snapshot de date la publicare. Clientul vede doar ce este publicat.                                    | Echipa (Strategie, Account)                      |

### 3.2 Nivelul B: import CSV cu aceleași contracte de date ca viitorii conectori

| **Modul**          | **Livrare pe 26 octombrie**                                                                                                                                                    | **Sursă și owner de date**                                                      |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| **Paid media**     | Tabel pe zi, platformă, cont și campanie: spend, impressions, clicks, conversii pe acțiune, CTR, CPC, CPA; buget aprobat și pacing liniar. Fără galerie de creatives.          | Exporturi Google Ads, Meta, TikTok (Bibi); importer (Claudia)                   |
| **Social propriu** | Postări publicate, followers la sfârșit de interval, creștere netă, interacțiuni, reach unde există; content performance cu textul postării și data.                           | Export Planable Analytics (Bianca); importer (Claudia)                          |
| **Listening**      | Mențiuni eligibile, distribuție de sentiment revizuită uman, surse distincte, mention feed cu URL. Butonul „Marchează pentru farmacovigilență” este obligatoriu (capitolul 6). | Export Planable Listening (Bianca); importer (Claudia); flux PV (Account, Alex) |
| **Concurență**     | Matrice comparativă brand și C1-C3 pe AI, SEO și social public, cu N/A explicit unde sursa lipsește; competitor_set_version cu dată efectivă.                                  | Date din nivelul A și export Planable Competitors (Bianca)                      |

### 3.3 Nivelul C: după 26 octombrie, reestimare pe 27 octombrie

| **Arie**                   | **Ce intră**                                                                                                                                                           |
|----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Module noi**             | Presă și PR, Reviews, galeria de ads publice (Google, Meta, TikTok ad libraries), taxonomia de mesaje a competitorilor.                                                |
| **AdSy AI**                | Rezumate săptămânale în draft, extragere de entități și topics, verificarea afirmațiilor față de documentele aprobate. Gemini API cu plafon de cost și validare umană. |
| **Conectori direcți**      | Google Ads, Meta, TikTok, Planable API (Analytics, Listening, Competitors), LinkedIn și YouTube dacă brandurile le folosesc.                                           |
| **Metodologie AI proprie** | Panelul de întrebări per brand cu cohorte trimestriale (specificație, capitolul 10), adaptor Claude, set de evaluare pentru clasificări.                               |
| **Produs**                 | Landing page analyzator.ro, versiune mobilă, export PDF și CSV, editor de șabloane, notificări prin e-mail, backfill extins la 13 luni.                                |
| **Operare**                | Coadă de joburi cu checkpoint și lease, API REST versionat pentru consumatori externi, test de scalare la 30 de branduri.                                              |

Ce se întâmplă dacă nu încape

Un modul de nivel A fără sursă funcțională pe 6 octombrie se escaladează în aceeași zi; Alex decide între export validat cu aceeași definiție a metricilor și scoaterea modulului din lansare. Un modul de nivel B fără export utilizabil pe 13 octombrie rămâne în produs ca „Sursă neconectată”, cu interfața și contractul de date pregătite, fără date demo.

## 4 Decizii de arhitectură pentru pilot

Deciziile de mai jos sunt luate pentru versiunea de lansare. Arhitectura țintă este descrisă în specificație, capitolele 24-27; diferențele față de ea sunt intenționate și se rezolvă după lansare.

| **Decizie**                       | **Alegere pentru pilot**                                                                                                                                                                                                                                                               | **Motiv**                                                                                                    |
|-----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| **Stack**                         | React și TypeScript pentru interfață. Supabase (Postgres, Auth, Storage privat) într-un proiect al agenției. GitHub ca repository canonic. Medii development, staging și production.                                                                                                   | Stack cunoscut din ERP-ul intern; Postgres și RLS acoperă izolarea.                                          |
| **Instrument de lucru**           | Claude Code este instrumentul principal, pe repo-ul GitHub. Lovable se poate folosi cel mult pentru scaffold-ul de UI în 1-2 octombrie; după sincronizare nu se mai editează din Lovable. Un singur instrument scrie în repo la un moment dat.                                         | Două instrumente pe același repo produc conflicte și cod rescris; în 18 zile nu există timp de reconciliere. |
| **Unde rulează importurile**      | Scripturi programate în afara browserului: GitHub Actions cu cron sau un serviciu mic (Railway sau Cloud Run), la alegerea lui Victor pe 1 octombrie. Sincronizare marți la 06:00 Europe/Bucharest pentru săptămâna anterioară, luni-duminică.                                         | Supabase nu găzduiește procese lungi; funcțiile edge au limită de timp.                                      |
| **Modelul de sincronizare**       | Tabel sync_runs (sursă, brand, interval, status, rânduri, erori), scripturi idempotente cu upsert pe cheie naturală, reimport al ultimelor 35 de zile pentru sursele mutabile, retry simplu la erori tranzitorii cu respectarea Retry-After.                                           | Trei branduri și un refresh săptămânal nu justifică o coadă cu lease-uri și checkpointuri.                   |
| **Accesul la date din interfață** | RLS pe toate tabelele expuse, view-uri și funcții SQL (RPC) pentru metrici, prin Supabase. Contractul unei metrici rămâne cel din specificație: value, unit, numerator, denominator, comparison_value, absolute_change, relative_change, status, data_as_of, coverage, evidence_query. | API-ul REST versionat cu anvelopă se construiește când apare un consumator extern.                           |
| **Model de date**                 | tenant_id pe toate entitățile de business, brand_id pe cele de brand, ID-urile furnizorilor ca text, proveniență pe observații (source_id, native_id, observed_at, collected_at, collection_method, payload_hash). Tabele tipizate, nu un JSON generic.                                | Ieftin acum, scump de adăugat mai târziu.                                                                    |
| **Secrete și roluri**             | Tokenurile furnizorilor doar în worker și în funcțiile server. Service role doar în worker, cu verificarea explicită a tenantului. Niciun secret în frontend, în prompturi sau în documente.                                                                                           | Cerință ISO 27001 și condiție de pilot.                                                                      |
| **AI**                            | AdSy AI nu intră în lansare. Când intră, folosește Gemini API pe un cont de billing separat (Gemini din Google Workspace nu oferă API), cu model_id și prompt_version configurabile.                                                                                                   | Analizele publicate la lansare sunt scrise de echipă; validarea umană era oricum integrală.                  |
| **Date demo**                     | Niciun set de date demo în staging sau production. Un modul fără date afișează „Sursă neconectată” și motivul.                                                                                                                                                                         | O lipsă acoperită de date demo nu mai este vizibilă la punctele de control.                                  |

## 5 Măsurarea vizibilității AI la lansare

AI Visibility este modulul cu care se deschide orice discuție cu clientul și primul pe drumul critic. La lansare funcționează astfel:

- **Sursa unică:** SEOmonitor AI Search Tracking prin API 3.0, cu motoarele documentate de furnizor (ChatGPT, Gemini, Perplexity) și Google AI Overviews. Claude nu este disponibil la furnizor; un audit manual documentat poate acoperi un subset, separat de scorul automat.

- **Panelul:** setul de keywords din SEOmonitor per brand, organizat în grupuri nonbranded (categorie și nevoi, criterii de alegere, comparații, disponibilitate) și branded (verificare). Indicatorii de vizibilitate spontană (Mention Rate, Recommendation Rate, SoV în set) se calculează exclusiv pe grupurile nonbranded.

- **Punctul de plecare:** auditurile de AI visibility și SEO tehnic din august 2026 pentru urinal.ro, minimartieni.ro și proenzi.ro, plus clusterele din specificație, capitolul 30. Claudiu propune, Strategia aprobă până pe 2 octombrie.

- **Activare:** add-ons-urile AI sunt active pe cele trei campanii până pe 2 octombrie. Crawlurile sunt săptămânale; activate la timp, la 26 octombrie există trei sau patru observații per keyword. Fiecare săptămână de întârziere înseamnă o observație în minus la lansare.

- **Cost:** prețul add-ons-urilor pentru trei branduri și motoarele active se confirmă în cont până pe 2 octombrie; nu este inclus în abonamentul de bază.

- **Etichetare:** Share of Voice al furnizorului rămâne metrica furnizorului; rata de menționare Analyzator se calculează separat din răspunsuri și se poate reproduce din Answer Explorer.

- **Metodologia proprie** (întrebări formulate de echipă, cohortă trimestrială, praguri de coverage) rămâne în specificație, capitolul 10, ca etapă următoare. Nu se implementează un colector propriu înainte de 26 octombrie.

## 6 Farmacovigilență și date sensibile

STADA este client farma. Când cineva din agenție citește mențiuni, reviews sau răspunsuri AI despre un produs, o relatare care seamănă cu o reacție adversă intră sub procedura de farmacovigilență a clientului, de regulă cu transmitere în cel mult o zi lucrătoare. Este o obligație contractuală, nu o funcție opțională.

Înainte de activarea modulului Listening

- Account STADA obține de la client procedura: contactul de farmacovigilență, formularul sau informațiile minime cerute, termenul de transmitere.

- Alex confirmă fluxul intern: cine citește mențiunile, cine transmite, unde se loghează.

În platformă (nivel B, obligatoriu)

- Buton „Marchează pentru farmacovigilență” pe orice mențiune, review sau răspuns AI.

- Înregistrare cu data, utilizatorul, linkul, snapshotul textului și statusul; notificare prin e-mail către lista de contacte configurată de agenție; jurnal vizibil pentru agency admin.

- Analyzator nu stabilește dacă este reacție adversă, nu răspunde public și nu înlocuiește procedura clientului.

Date personale

- Nu se construiesc profiluri individuale de sănătate. Textul brut al mențiunilor se păstrează 90 de zile, agregatele 24 de luni; politica efectivă se configurează per sursă înainte de activare.

- Datele personale inutile se maschează în analize și exporturi; conținutul eliminat de sursă nu se mai afișează ca dovadă.

- Datele STADA nu se folosesc public (landing page, demo) fără acordul clientului.

## 7 Checklist pentru ziua 0: accesuri și decizii

Tot ce este mai jos se pornește pe 1 octombrie și se închide până pe 2 octombrie, cu excepțiile marcate. Fără elementele pentru nivelul A, punctul de control din 2 octombrie nu trece.

| **Element**                                                                                                                                                                              | **Owner**          | **Termen**                 | **Observații**                                                                 |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------|----------------------------|--------------------------------------------------------------------------------|
| Repo GitHub Analyzator, proiect Supabase pe organizația AdSymphony, medii dev, staging și production, domeniu app.analyzator.ro cu DNS                                                   | Victor             | 1 oct                      | Conturi pe organizația agenției, nu personale                                  |
| SMTP pentru invitațiile Supabase Auth și notificări, pe domeniul adsymphony.ro                                                                                                           | Victor, Alex       | 2 oct                      | Necesar pentru invitații și notificările de farmacovigilență                   |
| SEOmonitor: token API 3.0, lista campaniilor și grupurilor pentru cele trei branduri, add-ons AI active pe fiecare campanie                                                              | Claudiu            | 2 oct                      | Costul add-ons-urilor confirmat în cont                                        |
| GA4: acces Viewer pentru service account pe cele trei proprietăți; lista key events per site                                                                                             | Claudiu            | 2 oct                      | Evenimentele lipsă devin livrabil separat de tracking                          |
| Search Console: acces pentru service account pe cele trei proprietăți                                                                                                                    | Claudiu            | 2 oct                      |                                                                                |
| Google Ads: cerere de developer token (Basic access) și acces la MCC; până la aprobare, export standard pe zi, campanie și ad group                                                      | Bibi               | Cerere 1 oct, export 2 oct | Aprobarea poate dura zile; nu blochează lansarea, paid este nivel B            |
| Meta: app și system user în Business Manager cu acces la conturile STADA; până atunci export standard                                                                                    | Bibi               | Cerere 1 oct, export 2 oct | Idem                                                                           |
| TikTok Ads: export standard; cerere API for Business doar dacă există campanii active                                                                                                    | Bibi               | 2 oct                      |                                                                                |
| Planable: tokenuri API (Read) per workspace; exporturi Analytics, Listening și Competitors pe cele trei branduri; confirmarea modulelor incluse în abonament și a costului per workspace | Bianca             | 2 oct                      | Listening este documentat la 99 USD per workspace lunar dacă se adaugă separat |
| Fișa de onboarding per brand: owneri, aliasuri, produse, domenii, conturi sociale, ID-uri advertiser, trei competitori cu domenii și profiluri, documente aprobate cu valabilitate       | Account STADA      | 2 oct                      | Șablonul este în specificație, capitolul 30                                    |
| Procedura de farmacovigilență STADA: contact, format, termen                                                                                                                             | Account STADA      | 9 oct                      | Blochează activarea Listening, nu fundația                                     |
| Panelul de keywords AI aprobat (nonbranded și branded) per brand                                                                                                                         | Claudiu, Strategie | 2 oct                      | Vezi capitolul 5                                                               |
| Bugetele aprobate per campanie, pentru pacing                                                                                                                                            | Bibi               | 12 oct                     |                                                                                |
| Gemini API: nu în sprint                                                                                                                                                                 | Alex               | după 26 oct                | Cont de billing separat, doar la intrarea AdSy AI                              |

## 8 Calendarul până la 26 octombrie

Execuția începe joi, 1 octombrie: 18 zile lucrătoare, fără ore suplimentare sau weekenduri presupuse. Refreshurile de validare sunt marți, 13 și 20 octombrie, pentru săptămânile încheiate pe 11 și 18 octombrie; următorul refresh operațional este pe 27 octombrie. Calendarul folosește Europe/Bucharest.

| **Interval**                    | **Zile** | **Livrabil verificabil la finalul intervalului**                                                                                                                                                                                                         | **Tichete**     |
|---------------------------------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|
| **1-2 octombrie (joi, vineri)** | 2        | Repo, Supabase, migrations de bază, autentificare pe invitație, primul test de izolare. Probe API SEOmonitor (ranks și AI, 20 de keywords), GA4 și GSC. Exporturi primite pentru paid, social și listening. Decizie API sau export pentru fiecare sursă. | ANZ01-05        |
| **5-6 octombrie**               | 2        | Flux complet pe un brand: import SEOmonitor, registru de metrici, Overview cu dovezi, izolare testată. Șablon reutilizabil pentru celelalte două branduri.                                                                                               | ANZ06-08, ANZ10 |
| **7-9 octombrie**               | 3        | AI Visibility, SEO și Search, Trafic și conversii cu date reale pe primul brand; conector GA4 și GSC; reconciliere cu sursa. Claudia: importer CSV cu preview și validare.                                                                               | ANZ09, ANZ11-14 |
| **12-13 octombrie**             | 2        | Replicare pe celelalte două branduri; primul refresh verificat (date până pe 11 octombrie); tabelele paid și social din importuri.                                                                                                                       | ANZ15-16, ANZ21 |
| **14-16 octombrie**             | 3        | Listening cu butonul de farmacovigilență, matricea de concurență, Analize și acțiuni, administrare de agenție și status surse. Toate modulele în forma de lansare. Feature freeze pe 16 octombrie.                                                       | ANZ17-20        |
| **19-20 octombrie**             | 2        | Al doilea refresh (date până pe 18 octombrie); reconciliere completă pe trei branduri; teste de permisiuni; o analiză publicată per brand.                                                                                                               | ANZ21-22        |
| **21-23 octombrie**             | 3        | UAT (Claudia, Account), revizie de securitate, backup și restaurare, corecții, runbook. Candidat de lansare acceptat de Alex pe 23 octombrie.                                                                                                            | ANZ22-23        |
| **26 octombrie (luni)**         | 1        | Publicare în producție, smoke test, conturi de agenție active, demo ghidat pentru account și strategie, predarea repo-ului și a procedurii săptămânale.                                                                                                  | ANZ23           |

Puncte de control

- **2 octombrie:** accesuri și probe. Victor confirmă ce sursă merge pe API și ce merge pe export, plus lista funcțiilor de nivel A. Alex confirmă numele lipsă, alocarea Claudiei, competitorii și bugetul de add-ons.

- **6 octombrie:** traseul sursă, indicator, dovadă funcționează pe un brand. Dacă nu, se opresc integrările noi și lansarea se reduce la nivelul A pe trei branduri, cu nivelul B în tabele simple. Decizia se ia în aceeași zi, nu se amână.

- **16 octombrie:** feature freeze. După această dată intră doar corecții, completări de date și lansarea. Intervalul 21-23 octombrie este rezerva pentru validare și defecte, nu pentru funcții noi.

- **23 octombrie:** acceptare. Problemele de izolare a datelor, acces neautorizat sau calcule esențiale greșite blochează lansarea până la remediere. Orice altceva intră în release notes.

- **27 octombrie:** primul refresh operațional și reestimarea nivelului C, cu owner, efort și termen pentru fiecare element.

## 9 Backlogul

Tichetele se execută în intervalele din capitolul 8. Fiecare păstrează criteriul de acceptare și dovada testării.

| **Tichet**                                      | **Nivel** | **Owner**                      | **Interval** | **Rezultat verificabil și dependențe**                                                                                                                                                  |
|-------------------------------------------------|-----------|--------------------------------|--------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ANZ01 Inventar și mapping**                   | A         | Claudiu, Bibi, Bianca, Account | 1-2 oct      | ID-uri reale de campanii SEOmonitor, proprietăți GA4 și GSC, conturi de ads și workspaces Planable pentru cele trei branduri; fișele de onboarding.                                     |
| **ANZ02 Probe SEOmonitor**                      | A         | Victor, Claudiu                | 1-2 oct      | 20 de keywords per engine activ, payload real pentru ranks și AI, raport de acces și entitlements. Depinde de ANZ01.                                                                    |
| **ANZ03 Probe GA4 și GSC**                      | A         | Victor, Claudiu                | 1-2 oct      | Un raport pe fiecare proprietate prin API, comparat cu interfața. Depinde de ANZ01.                                                                                                     |
| **ANZ04 Autentificare și roluri**               | A         | Victor                         | 1-5 oct      | Invitații, brand_access, revocare aplicată și sesiunilor existente, teste cross-tenant. Independent de surse.                                                                           |
| **ANZ05 Model de date și migrations**           | A         | Victor                         | 2-6 oct      | Tabele, constrângeri, RLS pe toate tabelele expuse, fixtures de test. Depinde de ANZ04.                                                                                                 |
| **ANZ06 Sincronizare și proveniență**           | A         | Victor                         | 5-6 oct      | sync_runs, upsert idempotent pe cheie naturală, scheduler, reimport 35 de zile, coverage per sursă. Depinde de ANZ05.                                                                   |
| **ANZ07 Registru de metrici**                   | A         | Victor                         | 5-6 oct      | Formule în cod sau SQL, unități, semantică null și zero, teste de agregare (CTR, reach, snapshots). Depinde de ANZ05.                                                                   |
| **ANZ08 Conector SEOmonitor**                   | A         | Victor                         | 5-8 oct      | Ranks, visibility, AI answers, citations, competition; refresh săptămânal; istoricul disponibil în cont. Depinde de ANZ02, ANZ06.                                                       |
| **ANZ09 Conector GA4 și GSC**                   | A         | Victor                         | 8-9 oct      | Trafic, key events, queries și pagini; reconciliere cu sursa pe același interval. Depinde de ANZ03, ANZ06.                                                                              |
| **ANZ10 Shell și Overview**                     | A         | Victor                         | 6-9 oct      | Navigare, filtre de perioadă și comparație, KPI cards, EvidenceDrawer, stări loading, partial, stale, unavailable. Depinde de ANZ07.                                                    |
| **ANZ11 Ecran AI Visibility**                   | A         | Victor                         | 7-9 oct      | KPI, trenduri pe engine, matrice topic și competitor, surse citate, Answer Explorer. Depinde de ANZ08, ANZ10.                                                                           |
| **ANZ12 Ecran SEO și Search**                   | A         | Victor                         | 8-9 oct      | KPI, keyword table, landing pages, content gaps. Depinde de ANZ08, ANZ09.                                                                                                               |
| **ANZ13 Ecran Trafic și conversii**             | A         | Victor                         | 9-12 oct     | KPI, canale, landing pages, AI referrals, tracking quality. Depinde de ANZ09.                                                                                                           |
| **ANZ14 Import CSV asistat**                    | B         | Claudia                        | 5-13 oct     | Upload, mapare de coloane, preview, validare (encoding, delimitatori, timezone, unități, duplicate), raport de rânduri acceptate și respinse, rollback pe lot, audit. Depinde de ANZ06. |
| **ANZ15 Paid media din export**                 | B         | Claudia, Bibi                  | 12-13 oct    | Tabel și KPI din exporturile Google, Meta și TikTok; pacing față de bugetul aprobat. Depinde de ANZ14.                                                                                  |
| **ANZ16 Social propriu din export**             | B         | Claudia, Bianca                | 12-13 oct    | Postări, followers, interacțiuni din Planable Analytics; deduplicare pe ID nativ. Depinde de ANZ14.                                                                                     |
| **ANZ17 Listening și flux de farmacovigilență** | B         | Victor, Bianca, Account        | 14-15 oct    | Mențiuni din Planable Listening, sentiment revizuit, buton și jurnal de farmacovigilență, notificare prin e-mail. Depinde de ANZ14 și de procedura clientului.                          |
| **ANZ18 Concurență**                            | B         | Victor                         | 14-15 oct    | Matrice brand și C1-C3 pe AI, SEO și social public; competitor_set_version; N/A explicit. Depinde de ANZ11, ANZ12, ANZ16.                                                               |
| **ANZ19 Analize și acțiuni**                    | A         | Victor                         | 14-16 oct    | Draft, review, publish, superseded; acțiuni; snapshot de date la publicare; clientul vede doar published, inclusiv prin URL direct. Depinde de ANZ10.                                   |
| **ANZ20 Administrare și status surse**          | A         | Victor                         | 15-16 oct    | Clienți, branduri, surse, utilizatori, importuri; „Date până la” și „Importat la” per sursă; acțiuni reîncearcă și reconectează. Depinde de ANZ06.                                      |
| **ANZ21 Trei branduri și refreshuri**           | A         | Victor, Claudiu                | 12-20 oct    | Șablonul aplicat pe celelalte două branduri; refreshurile din 13 și 20 octombrie reconciliate cu sursele. Depinde de ANZ08-13.                                                          |
| **ANZ22 QA pilot**                              | A         | Victor, Claudia                | 19-23 oct    | Testele din capitolul 10, revizie de securitate, backup și restaurare, corecții. Depinde de ANZ10-21.                                                                                   |
| **ANZ23 Lansare internă**                       | A         | Victor                         | 23-26 oct    | Deploy în producție, smoke test, runbook săptămânal, release notes cu limitele, demo, handover. Depinde de ANZ22.                                                                       |

## 10 Definition of Done și teste de acceptare

- Un tichet nu este complet dacă funcționează doar pe date hardcodate.

- Conectorii au payload real; importurile au contract de date explicit și aceleași tabele ca viitorii conectori.

- Ecranele au stări fără date; formulele au test; rutele, view-urile și funcțiile au autorizare verificată.

- Documentația consemnează limitele; codul generat este revizuit de Victor înainte de merge.

Testele de mai jos verifică riscuri concrete și se rulează înainte de acceptarea din 23 octombrie.

| **Test**                          | **Rezultat așteptat**                                                                                                                                     |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Izolare tenant și brand**       | Utilizatorul A nu accesează B prin API, view-uri, funcții, storage, export, cache sau URL cu ID modificat.                                                |
| **Import repetat**                | Două importuri identice păstrează aceleași totaluri și același număr de observații.                                                                       |
| **Eroare la mijlocul importului** | Rularea următoare completează datasetul fără dubluri; un lot parțial nu este publicat ca succes.                                                          |
| **Lună peste două săptămâni**     | Costurile se alocă pe zile; snapshots AI rămân la data crawlului.                                                                                         |
| **CTR agregat**                   | Pentru 10 din 100 și 10 din 900, totalul este 20 din 1000, adică 2%; nu media ratelor.                                                                    |
| **Reach și active users**         | Nu se însumează zilele; fără raport pe interval apar ca indisponibile.                                                                                    |
| **Nul și zero**                   | Lipsa accesului, zero real și eroarea sunt trei stări diferite în interfață.                                                                              |
| **Raport publicat**               | Snapshotul rămâne reproductibil după un reimport și o corecție.                                                                                           |
| **Reconciliere**                  | Pentru o săptămână și o lună, valorile din platformă corespund exportului sursei, în aceeași monedă și același timezone.                                  |
| **Farmacovigilență**              | Marcarea creează înregistrarea, trimite notificarea și apare în jurnal.                                                                                   |
| **Overview**                      | Un brand manager identifică perioada și acoperirea fără să deschidă setări și ajunge de la un semnal la înregistrarea sursă în maximum trei interacțiuni. |

## 11 Reguli care țin planul în termen

- Un singur șablon pentru cele trei branduri; personalizarea este configurare, nu cod.

- Importul CSV folosește aceleași tabele și contracte ca viitorii conectori; nu se construiesc două modele de date.

- Componente comune: KpiCard, TrendChart, ComparisonTable, EvidenceDrawer, CoverageBadge, FilterBar, InsightCard, SourceStatus, EmptyState. Designul suplimentar nu blochează lansarea; identitatea finală se aplică prin design tokens.

- Desktop la 1440 și 1024 px. Mobilul nu se verifică în sprint.

- Fără funcții noi după 16 octombrie. O cerere de scop se notează cu impact în timp și cost și intră în reestimarea din 27 octombrie.

- Lipsa unei surse într-o arie de nivel A se raportează în aceeași zi; nu se acoperă cu date demo.

- Limba interfeței este română, cu termenii de marketing uzuali în engleză; tooltipurile explică fiecare KPI.

## 12 Cum lucrăm cu Claude Code

Contextul persistent al proiectului

Victor creează în repository documente scurte pentru: product scope (acest brief), data contracts, metric definitions, connector capabilities și design tokens. În instrucțiunile proiectului stabilește: fără date demo în staging și production, fără secrete în frontend, fără acces cross-tenant, fără formule în UI, fără schimbarea schemelor fără migration, fără funcții din afara nivelurilor A și B înainte de 26 octombrie.

Prompt pentru un conector

> „Implementează conectorul SEOmonitor din specificație folosind documentația curentă și payloadurile validate din fixtures. Separă descoperirea resurselor de import. Folosește secrete server-side, paginare și upsert idempotent pe cheie naturală. Păstrează data crawlului și engine-ul. Nu deduce câmpuri lipsă. Adaugă teste pentru duplicare, pagină goală, token expirat și diferența dintre zero și null. Nu schimba definițiile metricilor fără actualizarea contractului și a testelor.”

Prompt pentru interfață

> „Construiește interfața Analyzator pentru clienții AdSymphony. Folosește React și TypeScript, un layout dark lizibil și componentele comune din repository. Utilizatorul alege un brand și o perioadă. Implementează Overview, AI Visibility, SEO și Search, Trafic și conversii conform specificației. Include stările loading, partial, stale și unavailable. Nu adăuga signup public, billing, chat, AdSy AI sau alte funcții. Respectă contractele din repository și păstrează source, data_as_of, coverage și evidence pe fiecare indicator.”

Prompt pentru securitate și verificare

> „Revizuiește autorizarea pe tenant și brand pentru fiecare view, funcție, job, export și obiect storage. Demonstrează prin teste că un client nu poate accesa alt brand schimbând ID-ul. Verifică și cache-ul, service role și orice context trimis unui model AI. Raportează exact ce ai testat și ce a rămas neverificat. Nu modifica permisiuni pentru a face testele să treacă.”

La începutul fiecărei etape: criterii, fixtures și migrații propuse. La final: diff, teste relevante, reconciliere cu sursa și demonstrație pe un brand. Nu sunt necesari agenți care scriu simultan în aceleași componente; disciplina contractelor și a testelor contează mai mult decât volumul de cod generat într-o sesiune.

## 13 Bugetul sprintului

| **Componentă**             | **Reper de planificare**                                                                                                                                                                        |
|----------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Dezvoltare**             | 18 zile Victor și zilele Claudiei la costul intern pe zi, plus contribuțiile Claudiu, Bibi, Bianca, Account și Strategie conform capitolului 2.                                                 |
| **Infrastructură**         | Rezervă 100-250 EUR lunar pentru pilot (Supabase, hosting pentru importuri, domeniu); de înlocuit cu oferta stackului ales.                                                                     |
| **SEOmonitor**             | Abonament existent plus add-ons AI pentru trei campanii; confirmat în cont până pe 2 octombrie.                                                                                                 |
| **Planable**               | Confirmarea modulelor incluse; Listening este documentat la 99 USD per workspace lunar dacă se adaugă separat (297 USD pentru trei workspaces).                                                 |
| **Claude Code și Lovable** | Licențele existente ale agenției; consumul se bugetează separat de rularea aplicației.                                                                                                          |
| **Gemini API**             | Nu în sprint. La intrarea AdSy AI: 20-80 EUR lunar la pilot, cu plafon, alerte și măsurare per brand.                                                                                           |
| **Nivelul C**              | Se bugetează separat după reestimarea din 27 octombrie. Cele 18 zile sunt capacitatea până la termen, nu costul produsului extins; nu se scade mecanic 18 din vechea estimare de 60-90 de zile. |

## 14 Ce decide Alex până pe 2 octombrie

1.  Numele pentru Account STADA și Strategie în acest brief.

2.  Alocarea Claudiei (propunere: 50% în 1-16 octombrie, integral în 19-23 octombrie).

3.  Confirmarea că 26 octombrie este lansare internă. Dacă există un angajament față de STADA, ce vede clientul în acea zi.

4.  Cei trei competitori per brand, validați cu Account și Strategie.

5.  Bugetul pentru add-ons AI SEOmonitor și, dacă este cazul, pentru Planable Listening.

6.  Solicitarea procedurii de farmacovigilență de la STADA, prin Account.

7.  Brandul cu care începe fluxul complet pe 5 octombrie (propunere: cel cu datele cele mai complete la 2 octombrie, la recomandarea lui Claudiu).

Istoricul versiunilor

**v1.1 (30 septembrie 2026):** specificație funcțională și tehnică extinsă, 36 de capitole.

**v1.2 (30 septembrie 2026):** împărțire în brief de lansare și specificație de produs; scop pe trei niveluri; responsabili nominali, inclusiv Claudia; checklist de accesuri pentru ziua 0; calendar și backlog recalibrate; decizii de arhitectură pentru pilot; farmacovigilența ca condiție de activare a Listening; AdSy AI, landing page, mobil și metodologia AI proprie mutate după lansare; accesul clientului după primul call.
