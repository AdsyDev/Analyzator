# Analyzator Specificație de produs

Referința produsului complet: module, indicatori, reguli de calcul și arhitectură țintă

Pilot STADA România cu Urinal, Minimartieni și Proenzi

Versiunea 1.2 din 30 septembrie 2026

**Se citește împreună cu Analyzator Brief de lansare v1.2, care definește versiunea din 26 octombrie 2026**

Acest document descrie produsul țintă. Ce se livrează pe 26 octombrie 2026, cine face ce, calendarul și deciziile de arhitectură pentru pilot sunt în brief, care are prioritate pentru versiunea de lansare. Capitolele de aici se citesc la implementarea fiecărui modul, nu înainte de a începe. Capitolul 02 strânge într-un singur loc regulile de calcul și interpretare valabile pentru toate modulele; restul capitolelor le presupun și nu le repetă.

Statutul informațiilor

- **Confirmat de Alex:** trei branduri STADA, trei competitori per brand, personalizare exclusiv de agenție, analiză de marketing, refresh săptămânal, dezvoltare internă cu resursele existente.

- **Verificat documentar:** capabilitățile publice ale furnizorilor, listate în capitolul 32 (S01-S33). Accesul în cont, tarifele contractuale și payloadurile se verifică în probele din 1-2 octombrie.

- **Propus:** specificațiile Analyzator de mai jos sunt propuneri proprii de implementare; se ajustează după primele payloaduri reale.

**Repere:** 01 obiective; 02 reguli; 03-10 surse și metodologie; 11 indicatori; 12-22 dashboarduri și experiență; 23 AdSy AI; 24-29 arhitectură, date, operare, securitate și verificare; 30 configurarea pilotului; 31 pagina publică; 32 surse.

## 01 Obiective și limitele produsului

Analyzator trebuie să răspundă la cinci întrebări: unde crește sau scade vizibilitatea brandului, cine câștigă în fața lui, ce mesaje și conținut funcționează, ce rezultate de marketing obținem și ce acțiuni merită prioritizate.

Structura comercială și de acces

Un client contractual este un tenant. STADA este primul tenant și conține trei spații de brand. Un utilizator poate avea acces la un brand, la mai multe branduri sau la portofoliul aprobat. Agenția administrează sursele, competitorii, șabloanele și metodologia.

Clientul poate filtra, explora, deschide dovezi și citi analize publicate. Modificarea layoutului, formulelor, integrărilor și competitorilor se face de AdSymphony. Un buton „Solicită ajustare” creează o cerere internă, fără editarea directă a configurației.

Ce conține produsul complet

| **Arie**               | **Rezultat pentru client**                                                        |
|------------------------|-----------------------------------------------------------------------------------|
| **AI și search**       | Prezență în răspunsuri, citări, recomandări, poziții și oportunități de conținut. |
| **Marketing propriu**  | Trafic, key events, campanii plătite, conținut și performanță socială.            |
| **Reputație și piață** | Mențiuni, sentiment, articole, reviewuri și activitate publicitară observată.     |
| **Concurență**         | Comparații cu trei branduri pe aceleași date publice și aceleași eșantioane.      |
| **Interpretare**       | Concluzii asumate de agenție, dovezi, priorități și urmărirea acțiunilor.         |

Limite explicite

- Datele de trafic, cost și conversie ale concurenților nu sunt accesibile prin conturile clienților. CRM și e-commerce rămân extensii ulterioare, cu contracte de date separate.

- Nu includem plăți, abonamente self-service, publicarea de reclame, optimizarea automată a bugetelor, răspunsuri publice automate sau prognoze prezentate ca certitudini.

- **Succesul pilotului:** fiecare brand are date verificabile în modulele conectate; orice lipsă este explicată; o ședință de client se poate conduce din platformă; același șablon se reutilizează pentru următorul client fără copierea aplicației.

## 02 Reguli de calcul și interpretare

Regulile de mai jos se aplică tuturor modulelor și tuturor versiunilor. Formulele se execută în cod sau SQL, fără a delega aritmetica unui model AI. Fiecare regulă are un test în registrul de metrici sau în suita de verificare (capitolul 29).

### 2.1 Surse și proveniență

- Fiecare metrică are o singură sursă principală per brand și perioadă: cost și conversii paid din platforma de ads; trafic din GA4; clicks și impressions search din GSC; ranks din SEOmonitor; social organic din Planable dacă payloadul este suficient.

- Aceeași postare sau campanie poate apărea în mai multe surse. Se mapează ID-urile native; importul Planable nu se adună cu importul direct Meta. Sursele alternative servesc reconcilierii, nu dublării totalului.

- O schimbare de furnizor sau de metodologie primește dată de intrare în vigoare și notă în grafic. Comparabilitatea istorică nu se presupune.

- „Toate informațiile” înseamnă operațional „informațiile din sursele conectate și monitorizate”. Niciun ecran nu sugerează acoperirea integrală a internetului sau a conversațiilor private.

- Câmpurile absente sunt null cu motiv, nu zero. Rândurile excluse sau anonimizate de sursă nu se completează cu AI.

- Fiecare valoare afișată arată sursa, „Date până la”, „Importat la” și acoperirea. Pe observații se păstrează source_id, native_id, observed_at, collected_at, collection_method, quality_status, payload_hash și schema_version; pe corecții se păstrează originalul, override-ul și motivul.

### 2.2 Nul, zero și lipsă

- Numitor zero produce null și „Nu se poate calcula”. Lipsa accesului produce „Sursă neconectată”. Zero real apare doar dacă interogarea a reușit, acoperirea este confirmată și nu există evenimente eligibile.

- Eroarea tehnică, refuzul valid al unui motor AI și absența brandului sunt trei stări diferite; eroarea tehnică nu devine absență de brand.

- Rank absent nu primește artificial poziția 100. Valorile nule nu se înlocuiesc în interfață cu zero.

### 2.3 Agregare și comparații

- Sumele sunt permise doar pe intervale disjuncte și cu aceeași definiție: cost, clicks, impressions, sessions.

- Ratele (CTR, CPC, CPM, CPA) se recalculează din numărător și numitor agregat, nu ca medie a ratelor. Tipul de click trebuie să fie același în ambele perioade.

- Reach și active users se iau din raportul pe intervalul întreg; nu se însumează zilele sau platformele. Fără raport pe interval, valoarea este indisponibilă.

- Followers și rating cumulat: ultima observație validă înainte de sfârșitul intervalului. Sursele lifetime se stochează ca snapshots separate.

- O observație săptămânală nu se transformă în șapte observații zilnice identice. Snapshotul AI rămâne la data crawlului; lunile arată numărul efectiv de crawluri.

- Diferențele între procente se exprimă în puncte procentuale. Variația relativă se calculează separat; bază zero produce „Bază zero”, nu procente infinite.

- Comparația implicită este perioada anterioară de aceeași lungime. YoY apare doar cu istoric comparabil. MTD și YTD folosesc aceeași porțiune din perioada de referință și se marchează „perioadă incompletă”.

- Procentele se normalizează doar după confirmarea unității; valorile deja exprimate procentual nu se înmulțesc cu 100.

- Currency se normalizează doar cu curs, dată și regulă versionate. Timezone-ul sursei se înregistrează; datele agregate de furnizor în alt fus nu se convertesc fără granularitate orară, ci se compară ca atare, cu diferența afișată.

### 2.4 Concurență

- Comparațiile folosesc aceleași definiții, același panel, aceleași surse și aceleași intervale pentru cele patru branduri.

- Trafic, cost, conversii, reach privat și venituri ale competitorilor nu sunt accesibile; nu se construiesc estimări prezentate ca rezultate reale.

- Un domeniu corporate care reprezintă mai multe produse se mapează pe pagini și entități; traficul lui general nu devine performanța unui singur produs. Simpla prezență a domeniului nu dovedește vizibilitatea produsului; sunt necesare aliasuri, grupuri și reguli pe URL.

- Setul de competitori este versionat (competitor_set_version, dată efectivă). Istoricul anterior nu se rescrie; pentru comparații în timp se alege setul vechi sau o cohortă comună.

- O diferență de acoperire împiedică formularea automată a unui clasament. Specialistul poate publica o interpretare cu limitele explicate.

### 2.5 AI și search

- Un brand prezent de cinci ori într-un răspuns contează o dată la Mention Rate. O mențiune într-o listă de surse nu este recomandare. O citare corporate nu este automat citare a paginii produsului.

- Google AI Overviews și Gemini nu se amestecă. În model există engine, surface și collection_method distincte, inclusiv valoarea unknown.

- Share of Voice al furnizorului rămâne etichetat ca metrică a furnizorului și nu se confundă cu rata de menționare Analyzator.

- SEOmonitor rank nu este average position din GSC; se păstrează numele complet al fiecăruia. Volumele de căutare nu se adună peste keywords sinonime pentru a declara audiență unică.

- Eșantionul măsoară răspunsuri la întrebările urmărite, nu numărul de utilizatori expuși brandului. Volumul Google folosit ca pondere este un proxy de interes, nu volum de interogări în ChatGPT.

- Un răspuns obținut prin API se etichetează ca atare, cu model și tools, și nu se prezintă ca observație a interfeței consumer. Dacă întrebarea exactă sau versiunea modelului nu este disponibilă, se afișează „indisponibil”, fără reconstrucție prezentată drept original.

- O schimbare de visibility poate veni din ranking, din compoziția panelului sau din ponderile de search volume; concluzia „am pierdut vizibilitate” se însoțește de evoluția pe cohorta stabilă.

### 2.6 Paid și atribuire

- Conversiile platformelor se afișează separat de key events GA4. Aceeași persoană poate fi atribuită de mai multe platforme; rezultatele nu se însumează într-un total de „clienți obținuți”.

- Fără venituri și o metodă de atribuire adecvată nu se afirmă rentabilitate comercială.

- O campanie multi-brand rămâne în categoria „shared” sau primește o regulă explicită de alocare; bugetul nu se copiază integral la fiecare brand.

- Fără buget planificat se arată costul, nu o depășire inventată. Costurile se însumează în sinteză doar după normalizarea monedei.

- „Posibilă oboseală creativă” este o etichetă cu dovezi (frecvență în creștere, CTR în scădere sau CPA în creștere pe perioade comparabile), nu un diagnostic automat; schimbarea audienței, bugetului sau obiectivului poate explica evoluția.

- Nu se inferă spend, CTR, CPA sau conversii din numărul de reclame publice ale competitorilor. O creativă folosită mult timp nu dovedește eficiență.

### 2.7 Social, listening, reviews și presă

- Performanța obținută în interval și performanța cumulată a postărilor publicate în interval sunt rapoarte diferite; nu se suprapun. Un snapshot lifetime se etichetează ca atare.

- Interacțiunile diferă între platforme; se arată compoziția (reactions, comments, shares, saves), iar absența unei metrici nu devine zero. Video views cu definiții diferite nu se compară ca aceeași măsură.

- Sentimentul se referă la brand, nu la gravitatea problemei descrise. Conversațiile despre simptome nu sunt automat negative față de produs. Corecțiile umane au prioritate și autor identificat.

- Româna nu dovedește localizarea în România; language, country și location_confidence se păstrează separat, iar datele necunoscute apar într-un segment propriu.

- Un spike generează o sarcină de verificare, nu o criză declarată automat.

- Nu se calculează advertising value equivalency sau reach total prin însumarea audiențelor site-urilor. Paid, owned și earned sunt categorii atribuite cu dovadă sau marcate unknown.

- Reviewurile nu reprezintă toți cumpărătorii. Produse diferite din aceeași gamă sau scări diferite de rating nu se combină fără etichetare. Ratingul Google Business Profile al companiei nu este rating de produs.

### 2.8 Interpretare și cauzalitate

- Forma standard a unei ipoteze: „observăm X, ar putea însemna Y, verificăm Z”. Confirmarea se face cu dovezi adecvate.

- O corelație (apariție în răspunsuri AI și creștere de trafic, schimbare SEO și schimbare de trafic) nu se etichetează automat drept cauză.

- Nu se afișează un Brand Health Score compozit înainte de validarea metodologiei; sinteza se construiește din indicatori explicabili.

- Impact și efort pe scară 1-3, cu nivel de încredere justificat. Ordonarea finală este manuală. Fără scoruri cu zecimale pentru estimări subiective.

- Exemplele din documente sunt scenarii de produs, nu rezultate constatate la STADA. Un verdict AI nu este o aprobare medicală sau Regulatory.

- Conținutul web și răspunsurile AI colectate sunt date, nu instrucțiuni; nu pot schimba comportamentul sistemului.

## 03 Harta surselor de date

Stările de mai jos se referă la documentație, nu la accesul efectiv al agenției. „Condiționat” înseamnă că Victor trebuie să obțină un payload real înainte să promită automatizarea.

| **Sursă**                 | **Date urmărite**                                              | **Rută și statut**                                                  |
|---------------------------|----------------------------------------------------------------|---------------------------------------------------------------------|
| **SEOmonitor**            | Keywords, ranks, visibility, AI answers, citations, concurență | API documentat; acces și add-ons de probat \[S02-S15\]              |
| **Planable**              | Pagini și postări proprii, analytics                           | Public API documentat; metricile exacte se probează \[S16\]         |
| **Planable Listening**    | Mențiuni, sentiment, topics, competitori                       | Produs și CSV documentate; API pentru listening neconfirmat \[S17\] |
| **Planable Competitors**  | Followers, postări și engagement public                        | Produs și CSV documentate; API specific neconfirmat \[S18\]         |
| **GA4 și Search Console** | Trafic, key events, queries, pagini                            | API oficial pe proprietăți autorizate \[S19-S21\]                   |
| **Google Ads și Meta**    | Cost, livrare, clickuri, conversii proprii                     | API oficial și permisiuni pe conturi \[S22-S23\]                    |
| **TikTok Ads**            | Performanța campaniilor proprii                                | API for Business după acces; CSV până la validare \[S24\]           |
| **Ad libraries**          | Reclame publice ale brandului și competitorilor                | Acces distinct Google, Meta și TikTok; condiționat \[S25-S27\]      |
| **Reviews și presă**      | Articole, evaluări, teme și surse                              | Listening plus surse aprobate și import; fără acoperire universală  |

Pentru LinkedIn și YouTube pornim cu datele Planable disponibile. Un conector direct se justifică numai pentru un câmp necesar și inaccesibil acolo. Nu se construiesc conectori fără conturi sau utilizare confirmată.

## 04 Integrarea SEOmonitor pentru SEO

API 3.0 este baza. Serverul documentat este https://apigw.seomonitor.com/v3. Headerul Authorization conține tokenul brut, fără prefix Bearer. Tokenul rămâne exclusiv în backend. \[S02\]

Rutele de mai jos se adaugă la serverul de bază; toate sunt GET. Parametrii, tipurile și limitele reale se verifică în documentația fiecărui endpoint și pe contul agenției.

| **Rută relativă**                          | **Utilizare în Analyzator**                                        |
|--------------------------------------------|--------------------------------------------------------------------|
| /dashboard/v3.0/campaigns/tracked          | Descoperirea campaniilor autorizate și maparea brandurilor \[S02\] |
| /rank-tracker/v3.0/groups                  | Grupe, foldere și ID-uri pentru clustere de analiză \[S04\]        |
| /rank-tracker/v3.0/keywords                | Keywords și date asociate pentru intervalul cerut \[S05\]          |
| /rank-tracker/v3.0/keywords/daily-ranks    | Istoric desktop și mobile, inclusiv pe domeniul concurent \[S06\]  |
| /rank-tracker/v3.0/groups/daily-visibility | Visibility și rank agregat pentru grup sau keywords \[S07\]        |

Contractul minim al conectorului

Păstrăm campaign_id, keyword_id, grupurile, keyword_text, market, language, device, data observației, domeniul, URL-ul dacă există, rank, search_volume și valorile originale ale metricilor.

La onboarding citim campaniile și grupele. Agenția alege explicit ce grupuri aparțin fiecărui brand, cu aliasuri de brand, grupuri și reguli pe URL pentru brandurile aflate pe același domeniu.

**Istoric:** la lansare se importă istoricul disponibil în cont, cu data reală de început afișată în interfață. Backfill-ul de 13 luni este obiectiv după lansare, unde există istoric și drept de acces. Nu presupunem că toate campaniile au fost deja configurate.

Probe de acceptare

- Un grup cu cel puțin 20 de keywords poate fi importat și comparat cu exportul SEOmonitor pe același interval și device.

- Paginarea trece de prima pagină; rularea repetată nu dublează observațiile.

- Rank absent, keyword arhivat și grup schimbat sunt tratate distinct.

- Un grup multi-brand nu atribuie automat toate rezultatele brandului selectat.

Documentația publică nu confirmă pentru contul AdSymphony tariful, entitlementurile sau acoperirea românească a fiecărui modul. Acestea intră în raportul de acces din 2 octombrie.

## 05 Integrarea SEOmonitor pentru AI

Documentația actuală descrie ChatGPT, Gemini și Perplexity, cu urmărire săptămânală prin add-ons și istoric separat de la activare. Snapshotul gratuit nu înlocuiește trackingul recurent. Întrebarea derivată din keyword poate fi păstrată între crawluri; localizarea și configurația campaniei trebuie verificate. Claude nu apare în lista documentată. \[S03\]

| **Rută GET după serverul de bază**                       | **Date și rol**                                                        |
|----------------------------------------------------------|------------------------------------------------------------------------|
| /rank-tracker/v3.0/keywords/ais                          | Răspuns, citări și semnale de brand; include suport per engine \[S08\] |
| /rank-tracker/v3.0/keywords/daily-ranks/ais              | Istoric AI săptămânal, în ciuda numelui daily-ranks \[S09\]            |
| /rank-tracker/v3.0/keywords/competition/ais              | Prezența și pozițiile de citare ale competitorilor \[S10\]             |
| /rank-tracker/v3.0/groups/daily-visibility/ais-mentions  | Metrică agregată de mențiuni, per grup sau keywords \[S11\]            |
| /rank-tracker/v3.0/groups/daily-visibility/ais-citations | Metrică agregată de citări \[S12\]                                     |
| /rank-tracker/v3.0/share-of-voice                        | Share of Voice calculat de furnizor pentru AIO și AIS \[S13\]          |
| /rank-tracker/v3.0/keywords/aio                          | Conținut și citări din Google AI Overviews \[S14\]                     |
| /rank-tracker/v3.0/ais/stats                             | Motoare configurate, stare și statistici de prezență \[S15\]           |

Detalii pentru implementare

- Pe endpointurile care îl documentează, trimitem ai_search_llm explicit. Exemplul oficial folosește openai; Victor preia din schema curentă valorile celorlalte motoare, fără să le deducă din numele afișat. Endpointul stats are propriul contract și parametrul gpt_provider; nu aplicăm un parametru uniform tuturor rutelor.

- Pentru răspunsuri păstrăm textul, citările, data crawlului, keyword_id și engine. Conținutul HTML sau base64 se decodează și sanitizează înainte de afișare.

- Panelul la lansare este setul de keywords din campanie, grupat nonbranded și branded; indicatorii de vizibilitate spontană se calculează doar pe grupurile nonbranded (brief, capitolul 5).

> **Test tehnic critic (1-2 octombrie):** 20 de keywords pe fiecare engine activ, două crawluri și trei competitori. Se verifică datele, citările, unitățile, conținutul integral și lipsurile. Pagina goală la AIO poate însemna absența AIO pe keywords, nu lipsa lor din campanie; enumerarea se reconciliază cu inventarul de keywords. \[S14\]

## 06 Integrarea Planable

Public API are baza https://api.planable.io/api/v1 și oferă acces la workspaces, pages, posts și analytics. Documentația indică tokenuri cu scop Read și limitare pe workspaces. Schema completă nu este publică; Victor inspectează referința interactivă pentru rutele, schemele și ferestrele efectiv disponibile și nu presupune existența unor endpointuri de listening până nu le vede în schemă. \[S16\]

Trei fluxuri separate

| **Flux**                 | **Ce implementăm**                                                                              |
|--------------------------|-------------------------------------------------------------------------------------------------|
| **Organic analytics**    | Inventar de pagini și postări; metrici la nivel de postare și pagină; sincronizare săptămânală. |
| **Competitor analytics** | Trei profiluri relevante per brand; import API dacă este disponibil, altfel CSV controlat.      |
| **Social listening**     | Mențiuni și metadate; import API numai după probă; CSV recurent ca alternativă funcțională.     |

Planable descrie comparații publice pentru până la cinci competitori per pagină și export CSV. Datele disponibile diferă între platforme. AI Visibility din Planable nu se combină cu măsurătorile SEOmonitor; folosim un singur sistem de referință pentru seria principală. \[S18\]

Listeningul documentat acoperă postări publice și web, permite export de mențiuni și agregate, iar sincronizarea declarată diferă între brand și topics. Produsul are limite de keywords, competitori și interval vizibil. \[S17\]

Ce confirmă Victor și Bianca în prima săptămână

- Abonamentul include Analytics și Listening pentru workspaces relevante? Ce cost suplimentar presupune fiecare brand?

- API-ul expune time series, doar snapshots sau ambele? Ce perioadă maximă, paginare și limite de apel există?

- Există rute documentate pentru listening și competitor analytics? Dacă da, exportăm câte un payload și schema; dacă nu, importul CSV rămâne ruta.

- Datele social paid se pot separa de organic? Ce ID-uri native permit reconcilierea cu platformele?

- Exporturile includ postări publicate în afara Planable? Ce istoric de dinaintea conectării se poate recupera?

Alternativa CSV trebuie să fie utilizabilă

Accountul încarcă exportul, alege brandul și intervalul, vede previzualizarea și primește un raport de rânduri acceptate sau respinse. Reimportul aceluiași fișier nu dublează datele. Interfața afișează „importat manual” și perioada acoperită. Datele anuale se construiesc prin arhivarea recurentă a exporturilor, nu prin presupunerea că există un export anual.

## 07 Analytics și campaniile proprii

GA4 și Search Console

GA4 Data API furnizează rapoarte pe proprietățile autorizate. Folosim sessions, activeUsers, engagedSessions și keyEvents cu dimensiuni compatibile precum date, sessionDefaultChannelGroup, sessionSourceMedium și landingPagePlusQueryString. Compatibilitatea se verifică înaintea implementării fiecărui raport. \[S19-S20\]

Search Console Search Analytics API oferă clicks, impressions, CTR și position, cu grupări pe date, query, page, country și device. Rândurile returnate nu constituie toate căutările; totalurile și detaliile pe query se păstrează distinct. \[S21\]

Paid media

Google Ads și Meta Marketing API se folosesc numai pentru conturile autorizate ale clientului. TikTok necesită integrarea API for Business. Pe fiecare cont păstrăm currency, timezone, obiectivul și configurația atribuirii. Până la validarea API, exporturile standard au aceeași definiție a coloanelor. \[S22-S24\]

| **Sursă**      | **Dataset minim pentru pilot**                                                                               |
|----------------|--------------------------------------------------------------------------------------------------------------|
| **Google Ads** | Zi, account, campaign, ad group, ad unde este disponibil; cost, impressions, clicks, conversions pe acțiune. |
| **Meta Ads**   | Zi, account, campaign, ad set, ad; spend, impressions, reach pe interval valid, link clicks și actions.      |
| **TikTok Ads** | Zi și entități de campanie disponibile; spend, impressions, clicks, rezultate și definiția lor.              |
| **GA4**        | Trafic și key events pe site, canal și landing page; raport separat pe event name.                           |
| **GSC**        | Totaluri search și tabele de query și page, cu acoperirea documentată.                                       |

Campaniile unui cont STADA comun se mapează prin ID-uri, naming și validare umană. Performance pentru LinkedIn Ads poate fi adăugată într-o etapă ulterioară dacă brandurile folosesc canalul.

## 08 Reclamele competitorilor și sursele publice

Acest modul descrie activitatea publicitară observată. Metricile de eficiență ale campaniilor proprii rămân în Paid media. Modulul este etapă ulterioară lansării.

| **Platformă**                 | **Ce este documentat**                                                                             | **Decizie**                                                                                              |
|-------------------------------|----------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Google Transparency**       | Căutare advertiser și reclame; acces API pentru date despre ads din SEE \[S25\]                    | Victor verifică procedura și condițiile efective de acces. Până atunci, linkuri și înregistrări manuale. |
| **Meta Ad Library**           | API pentru ads de orice tip difuzate în UE și UK în ultimul an; /ads_archive și autorizare \[S26\] | Probă cu advertiseri și România; stocarea câmpurilor efectiv returnate.                                  |
| **TikTok Commercial Content** | API cu date despre ads și advertiseri, acces prin aplicație și aprobare \[S27\]                    | Cerere de acces; test România; import manual dacă nu este aprobat.                                       |

Înregistrarea standard a unei reclame

source, native_ad_id, advertiser_id, advertiser_name, payer dacă există, brand_mapping_status, country_scope, format, creative_text, media_reference, landing_url, source_url, first_seen, last_seen, delivery_start și delivery_end dacă sunt furnizate, collected_at, tematizare și dovada asocierii cu brandul.

first_seen și last_seen descriu observațiile noastre, distinct de intervalul de difuzare declarat de sursă. O reclamă dispărută dintr-un răspuns incomplet nu este automat „oprită”; starea „activă” se afișează numai dacă sursa o confirmă.

Ce poate vedea clientul

Galerie de creatives, mesaje și CTA; reclame noi observate; format și canal; teme recurente; continuitate aparentă; destinații; informații de distribuție publicate de platformă. Valorile geografice pentru întreaga UE nu se afișează ca reach România.

Acoperirea reviews și web

Pentru fiecare brand selectăm explicit site-uri, retaileri și pagini relevante. Colectarea folosește feed, API sau export autorizat, monitoring permis ori import uman. O listă de retailer reviews nu se presupune accesibilă din GA4, SEOmonitor sau Planable. Fiecare integrare publică primește o fișă cu scop, țări, istoric, drept de păstrare și limitări; dacă ruta nu este demonstrată, modulul rămâne disponibil cu import documentat și acoperire vizibilă, fără eticheta „monitorizare completă”.

## 09 Calendarul datelor și agregarea

**Configurație:** sincronizare marți la 06:00 Europe/Bucharest pentru săptămâna anterioară, luni-duminică. Joburile verifică și datele publicate târziu. În interfață afișăm „Date până la” și „Importat la”.

Granularitatea stocată

Pentru sursele zilnice importăm rânduri zilnice chiar dacă jobul rulează săptămânal. AI se păstrează la data crawlului. La sursele lifetime stocăm snapshots separate.

| **Tip metrică**                         | **Săptămână, lună și an**                                                                   |
|-----------------------------------------|---------------------------------------------------------------------------------------------|
| **Cost, clicks, impressions, sessions** | Sumă pe intervale disjuncte și aceeași definiție.                                           |
| **CTR, CPC, CPM, CPA**                  | Recalculare din numărător și numitor agregat; nu media ratelor.                             |
| **Reach și active users**               | Raport pentru intervalul întreg; nu suma zilelor sau platformelor.                          |
| **Followers și rating cumulat**         | Ultima observație validă înainte de sfârșitul intervalului.                                 |
| **AI presence și citation rate**        | Numărări pe răspunsurile eligibile din cohorta comparabilă; se afișează n.                  |
| **SEO visibility furnizor**             | Linie de observații și medie temporală etichetată, fără însumare.                           |
| **Mențiuni și articole**                | Număr de înregistrări distincte publicate în interval; importul nu schimbă data publicării. |

Comparații

Preseturi: ultima săptămână completă, ultimele 4 sau 13 săptămâni, lună calendaristică, an, interval personalizat. O săptămână care traversează două luni se distribuie pe zile pentru metricile zilnice; snapshotul AI rămâne la data lui și nu se repartizează artificial între luni.

Corecții și date întârziate

Reimportăm ultimele 35 de zile pentru sursele mutabile. Pentru conversii extindem intervalul la fereastra de atribuire relevantă, verificată pe cont. Istoricul poate fi revizuit; un raport discutat în call păstrează snapshotul și data publicării.

## 10 Metodologia de monitorizare AI (etapa următoare)

> La lansare, panelul este setul de keywords din SEOmonitor, cu grupuri nonbranded și branded (brief, capitolul 5). Metodologia de mai jos descrie panelul propriu de întrebări, colectat de agenție, și se implementează după 26 octombrie, după alegerea rutei de colectare și testarea costului.

Separăm două eșantioane: **panelul de descoperire**, fără numele brandului în întrebare, și **panelul de verificare a informațiilor**, în care brandul este numit intenționat. Mențiunile din panelul de verificare nu intră în indicatorul de vizibilitate spontană.

Panelul propus pentru fiecare brand

120 de întrebări de descoperire: 40 despre categorie și nevoi, 30 despre criterii de alegere, 30 despre comparații între tipuri de soluții și 20 despre disponibilitate sau parcursul de cumpărare. Alte 30 de întrebări verifică informații explicite despre brand, produse și surse. Sunt propuneri de volum, de ajustat după cost și acoperire.

Pornim din keywords și clustere validate de echipa SEO. Păstrăm câte un topic principal per întrebare; dublurile semantice nu trebuie să domine rezultatul. Keywords fără volum de căutare pot rămâne în panelul neponderat, fără volume inventate.

Panelul se aprobă de strategie și se fixează pentru un trimestru. Intrările noi formează un panel extins, separat de cohorta stabilă folosită în comparații. Schimbarea întrebării, locației, engine-ului sau modului de colectare creează o versiune nouă.

Coverage înseamnă observații tehnic valide împărțite la observații planificate. Propunem minimum 80% coverage și 50 de răspunsuri pentru un semnal agregat; sub 20 de răspunsuri pe topic etichetăm rezultatul exploratoriu. Comparațiile folosesc aceleași întrebări observate în ambele perioade. Refuzul valid intră în numitor și este raportat separat; erorile tehnice sunt excluse. Nu ponderăm automat motoarele după presupuse cote de piață.

Execuția și dovezile

- România și limba română; sesiuni independente, fără istoric personal; întrebare și configurație păstrate când sursa le expune.

- Un răspuns săptămânal pentru fiecare combinație prompt și engine; dacă un furnizor oferă alt ritm, îl păstrăm ca atare.

- Statusuri distincte: valid, refuz, fără răspuns tehnic, necolectat, fără citări, configurație indisponibilă.

- Citările se păstrează la nivel URL și domeniu.

Claude și modelele suplimentare

Pentru Claude implementăm un adaptor separat numai după alegerea rutei de colectare și testarea costului. Un răspuns prin API se etichetează „Claude API”, cu model și tools. Până atunci, un audit manual documentat poate acoperi un subset, separat de scorul automat.

## 11 Dicționarul indicatorilor

Fiecare metrică are metric_key, definiție, unitate, sursă, granularitate, filtre, formulă, versiune și regulă de agregare. Formulele se execută în cod sau SQL.

| **Indicator**                        | **Definiție operațională**                                                                                  |
|--------------------------------------|-------------------------------------------------------------------------------------------------------------|
| **AI Mention Rate**                  | 100 × răspunsuri valide de descoperire cu brandul menționat / toate răspunsurile valide de descoperire      |
| **AI Recommendation Rate**           | 100 × răspunsuri valide de descoperire care recomandă explicit brandul / răspunsuri valide de descoperire   |
| **Owned Citation Rate**              | 100 × răspunsuri valide cu cel puțin o citare eligibilă a brandului / răspunsuri valide                     |
| **Citation Opportunity Rate**        | 100 × răspunsuri care citează brandul / răspunsuri care oferă orice citare; se etichetează separat          |
| **AI SoV în setul urmărit**          | 100 × prezențe ale brandului / suma prezențelor celor 4 branduri, câte maximum una per brand și răspuns     |
| **Listening SoV**                    | 100 × prezențe ale brandului în mențiuni eligibile / suma prezențelor celor 4 branduri în aceeași acoperire |
| **CTR**                              | 100 × clicks / impressions; tipul de click trebuie să fie același în ambele perioade                        |
| **CPC și CPM**                       | Spend / clicks; respectiv 1000 × spend / impressions                                                        |
| **CPA**                              | Spend / conversii pentru aceeași acțiune, platformă și fereastră de atribuire                               |
| **Social ER by reach**               | 100 × interacțiuni definite / reach pentru aceeași unitate de raportare                                     |
| **Social ER by followers**           | 100 × interacțiuni publice ale postării / followers la observație; se separă de ER by reach                 |
| **Rating mediu al reviewurilor noi** | Suma ratingurilor reviewurilor eligibile noi / numărul lor; separat de ratingul cumulativ al paginii        |

**Exemplu de test:** 24 de răspunsuri cu brand din 80 valide dau 30%. Dacă numărul total de prezențe ale celor patru branduri este 60, SoV în set este 40%. Cele două procente răspund la întrebări diferite. Cazurile de nul, zero și lipsă sunt în capitolul 2.2.

## 12 Dashboardul de sinteză (Overview)

**Rută:** /brands/{brandId}/overview. **Întrebarea principală:** ce s-a schimbat și unde trebuie să ne concentrăm în următoarea discuție?

| **Componentă**             | **Conținut și interacțiune**                                                                                        |
|----------------------------|---------------------------------------------------------------------------------------------------------------------|
| **Bara de context**        | Client, brand, România, perioadă, comparație, data ultimei actualizări și acoperirea surselor.                      |
| **6 KPI cards**            | AI Mention Rate pe engine selectat, organic clicks, sessions, key events selectate, paid spend, mențiuni eligibile. |
| **Evoluții prioritare**    | Maximum 3 schimbări semnificative, cu valoare, bază de comparație și link către dovadă.                             |
| **Trenduri**               | Patru grafice mici sincronizate: AI, search, trafic, mențiuni; fiecare cu unitatea proprie.                         |
| **Concurență**             | Brand plus C1, C2, C3 pentru AI, SEO, social public și listening; lipsurile rămân vizibile.                         |
| **Interpretarea agenției** | Ultima analiză publicată, autor, perioadă, concluzii și acțiuni.                                                    |
| **Oportunități**           | Listă scurtă cu tema, dovada, prioritatea și statusul acțiunii.                                                     |

Comportament

Clickul pe un KPI deschide modulul cu aceleași filtre. Pe hover sau click, „Cum se calculează” arată definiția, sursa, numitorul și data observației. O sursă întârziată nu blochează întregul dashboard; cardul afectat arată intervalul real.

Semnale inițiale propuse

Pentru AI, o schimbare de minimum 5 puncte procentuale pe cohorta stabilă este candidat la analiză dacă n este suficient. Pentru trafic și clicks, minimum 20% și un prag absolut configurat. Pentru reputație, atât numărul, cât și proporția mențiunilor negative. Pragurile se calibrează după 8 săptămâni.

Acceptare

Un brand manager identifică perioada și acoperirea fără să deschidă setări și ajunge de la un semnal la înregistrarea sursă în maximum trei interacțiuni. Un card cu date lipsă nu pare o performanță de zero. Nu apare nicio valoare agregată între branduri sau engine-uri fără definiție.

**Exemplu de concluzie permisă:** „Vizibilitatea a scăzut în 12 întrebări despre criterii de alegere; în 8 dintre ele apar acum alte două branduri. Propunem verificarea paginilor citate.”

## 13 Dashboardul AI Visibility

**Rută:** /brands/{brandId}/ai. **Scop:** să arate unde brandul este numit, recomandat sau citat și ce informații circulă despre el.

| **Componentă**                  | **Specificație**                                                                                      |
|---------------------------------|-------------------------------------------------------------------------------------------------------|
| **Filtre**                      | Engine, suprafață sau mod, panel, topic, intenție, branded sau nonbranded, cohortă și crawl.          |
| **KPI cards**                   | Mention Rate, Recommendation Rate, Owned Citation Rate, SoV în set, răspunsuri valide și acoperire.   |
| **Trenduri**                    | Serii separate pe engine și cohortă, cu marcaje pentru schimbări de panel sau metodologie.            |
| **Matrice topic și competitor** | Rată de menționare pe topic pentru cele 4 branduri; n și acoperire în tooltip.                        |
| **Surse citate**                | Domenii și URL-uri, frecvență în răspunsuri, owned sau third party, brand asociat.                    |
| **Answer Explorer**             | Întrebare disponibilă, keyword, engine, dată, branduri, recomandări, citări și verdict de verificare. |
| **Informații de verificat**     | Afirmații marcate, dovezi aprobate de brand și statusul revizuirii umane (după lansare, cu AdSy AI).  |

Detaliul unui răspuns

Panoul lateral afișează răspunsul original sanitizat, sursa colectării, citările și segmentele în care apar brandurile. Un specialist poate corecta etichetele cu motiv; păstrăm atât rezultatul inițial, cât și corecția. Când furnizorul numește o suprafață „Gemini AI Mode”, păstrăm eticheta și cerem clarificarea rutei de colectare.

Verificarea informațiilor (după lansare)

Extragem afirmații atomice și le comparăm numai cu documentele aprobate și valabile pentru produsul respectiv. Statusuri: susținută, contradicție probabilă, dovezi insuficiente, nerelevantă, revizuită uman. Clientul vede constatările validate de echipă; propunerile automate rămân în lucru până la revizuire. Nu calculăm „acuratețe 100%” dacă s-a verificat doar o parte din răspunsuri.

Acceptare

Rata de menționare se poate reproduce din răspunsurile afișate. Citările se deschid la URL-ul original. Refuzurile, erorile și datele necolectate nu sunt confundate. Un audit manual sau un răspuns prin API apare separat, cu acoperirea lui, și nu modifică seria SEOmonitor.

## 14 Dashboardul SEO și Search

**Rută:** /brands/{brandId}/search. **Scop:** să identifice cererea relevantă, vizibilitatea în Google și paginile unde merită intervenit.

| **Componentă**             | **Specificație**                                                                                            |
|----------------------------|-------------------------------------------------------------------------------------------------------------|
| **Filtre**                 | Brand sau nonbrand, cluster, keyword, landing page, device, țară și cohortă de keywords.                    |
| **KPI cards**              | GSC clicks, impressions, CTR, SEOmonitor visibility, keywords în Top 3 și Top 10.                           |
| **Cerere și sezonalitate** | Volumele furnizorului și evoluția lor, cu data și perioada de calcul.                                       |
| **Keyword table**          | Keyword, cluster, volum, rank mobile și desktop, schimbare, URL, competitor prezent, AI sau AIO disponibil. |
| **Landing pages**          | Clicks, impressions, CTR, queries asociate și key events GA4 când maparea este validă.                      |
| **Content gaps**           | Topics unde concurența apare și brandul lipsește; link către rezultate și conținutul comparat.              |
| **Pagini de investigat**   | Pierderi de clicks sau rank, suprapuneri de pagini și schimbări de URL observate.                           |

Oportunități explicabile

Reguli inițiale: keywords pe pozițiile 4-15 cu cerere relevantă; queries cu impressions suficiente și CTR sub propriul istoric comparabil; pagini care primesc trafic relevant fără key events; surse terțe frecvent citate de AI și relevante pentru outreach. Prioritatea se acordă de specialist; ordonarea automată arată componentele folosite și nu inventează potențial comercial.

Acceptare

Aceleași filtre produc aceleași totaluri ca raportul sursă, în limitele explicate ale API-ului. Un URL comun mai multor branduri se marchează shared. Clientul poate deschide keywordul, pagina și observația concurentului. O secțiune tehnică SEO se adaugă ulterior dacă există sursă pentru crawling și indexare; nu deducem erori tehnice doar din scăderea pozițiilor.

## 15 Dashboardul Paid Media

**Rută:** /brands/{brandId}/paid. **Scop:** să explice utilizarea bugetului și rezultatele de marketing ale conturilor autorizate. La lansare, datele vin din exporturi standard (brief, nivel B).

| **Componentă**        | **Specificație**                                                                      |
|-----------------------|---------------------------------------------------------------------------------------|
| **Filtre**            | Platformă, cont, obiectiv, campanie, ad set sau ad group, reclamă, conversion action. |
| **KPI cards**         | Spend, impressions, clicks de tip declarat, CTR, CPC, conversii selectate și CPA.     |
| **Buget și pacing**   | Spend cumulat față de bugetul aprobat încărcat de agenție; intervalul planului.       |
| **Performance table** | Entități native, cost, livrare, rezultate, obiectiv, attribution window și trend.     |
| **Creatives proprii** | Preview autorizat, format, mesaj, audiență disponibilă și performanță (după lansare). |
| **Evoluție**          | Spend și rezultate în grafice separate sau cu axe clar marcate.                       |
| **Observații**        | Modificări de campanie notate de echipă și ipoteze pentru următoarele teste.          |

Pacing

Progresul liniar este un reper: spend / buget și zile trecute / zile planificate. Dacă media planul are distribuție săptămânală, comparăm cu planul încărcat. Evenimentele de tip view-through și click-through se identifică unde sursa permite.

Campaniile Performance Max, lead generation și awareness au indicatori diferiți. Șablonul permite ascunderea CPA când nu este relevant și alegerea rezultatului urmărit. Fiecare card își arată definiția.

Acceptare

Pentru o săptămână și o lună, costurile se reconciliază cu exportul platformei pe aceeași monedă și timezone. Diferențele de conversii sunt explicate prin fereastra de atribuire și data reimportului. Clientul nu poate edita campanii, muta bugete sau modifica obiective din Analyzator.

## 16 Dashboardul Trafic și Conversii

**Rută:** /brands/{brandId}/traffic. **Scop:** să conecteze vizibilitatea și activitatea de marketing cu comportamentul observat pe site.

| **Componentă**          | **Specificație**                                                                             |
|-------------------------|----------------------------------------------------------------------------------------------|
| **KPI cards**           | Sessions, active users pe interval, engaged sessions, engagement rate, key events selectate. |
| **Canale**              | Canal, source medium, sessions, engagement și key events; organic, paid, referral, direct.   |
| **Landing pages**       | Intrări, canal, engagement și evenimente relevante.                                          |
| **Parcursuri definite** | Pași numai dacă trackingul îi furnizează; altfel afișăm evenimente separate.                 |
| **AI referrals**        | Trafic identificabil din domenii și surse AI cunoscute, cu lista regulilor versionată.       |
| **Tracking quality**    | Evenimente lipsă, schimbări de naming, creșteri neobișnuite și perioade necomparabile.       |

Evenimentele de marketing ale pilotului

Agenția alege pentru fiecare site evenimente precum accesarea unei pagini relevante, click către retailer, interacțiune cu un instrument sau contact. Numele exacte se preiau din GA4 și se mapează. Un key event poate fi o acțiune repetată de aceeași persoană; pentru o rată pe sesiuni folosim metrica de sesiuni corespunzătoare, nu numărul brut de evenimente împărțit la sessions.

AI referrals și mapare multi-brand

Lista de domenii și regulile UTM sunt versionate. Traficul fără referrer poate ajunge în Direct; dashboardul arată doar partea identificabilă. Pentru un site comun, segmentarea poate folosi hostname, path și evenimente; sesiunile care traversează mai multe branduri nu se însumează la nivel de portofoliu ca utilizatori unici.

Acceptare

Valorile pe interval sunt validate în GA4 cu aceleași filtre și aceeași identitate de raportare. Stocăm metadatele de thresholding, sampling sau pierdere de date dacă API-ul le furnizează; un interval afectat este marcat. Configurația trackingului este livrabil separat de platformă când lipsesc evenimentele; Analyzator semnalează lipsa, nu produce retroactiv evenimente.

## 17 Dashboardul Social Media Propriu

**Rută:** /brands/{brandId}/social. **Scop:** să arate ce publicăm, ce reacții obținem și ce teme merită dezvoltate.

| **Componentă**          | **Specificație**                                                                               |
|-------------------------|------------------------------------------------------------------------------------------------|
| **Filtre**              | Platformă, profil, format, topic, etichetă de campanie, organic sau paid.                      |
| **KPI cards**           | Postări publicate, followers la sfârșit de interval, creștere netă, interacțiuni, reach valid. |
| **Content performance** | Postări cu preview, dată, format, temă și metricile disponibile.                               |
| **Topic și format**     | Frecvență și performanță mediană per postare, cu n și perioadă de observare.                   |
| **Calendar**            | Publicări observate și etichete din Planable; data publicării efective.                        |
| **Concurență publică**  | Cadence, followers și interacțiuni publice; fără reach privat al concurentului.                |

Comparabilitate și analiză de conținut

Pentru analiza formatelor preferăm o fereastră de maturizare comună, de exemplu 7 zile de la publicare, dacă sursa oferă datele necesare. În lipsa lor, afișăm vârsta postării și nu clasăm un post de ieri împotriva unuia cu trei luni de expunere fără avertizare contextuală.

AdSy AI poate propune ulterior etichete de topic, mesaj, format și CTA; agenția le validează pe un eșantion. Taxonomia finală se aplică și competitorilor.

Acceptare

O postare importată din Planable și identificată în Meta apare o singură dată în biblioteca de conținut. Metricile organice și paid nu se dublează. Postările fără analytics pot rămâne în calendar cu status „date de performanță indisponibile”. Publicarea și aprobarea creativelor rămân în Planable; Analyzator folosește conținutul doar pentru analiză.

## 18 Dashboardul Listening și Reputație

**Rută:** /brands/{brandId}/listening. **Scop:** să identifice teme, schimbări de percepție și conversații care cer atenția echipei.

| **Componentă**             | **Specificație**                                                                                                                  |
|----------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| **Filtre**                 | Brand, platformă, sursă, topic, sentiment, tip de autor public, limbă, locație cunoscută.                                         |
| **KPI cards**              | Mențiuni eligibile, SoV în set, distribuție sentiment, surse distincte, cazuri de verificat.                                      |
| **Trend**                  | Volum și sentiment în timp, cu marcarea schimbărilor de acoperire.                                                                |
| **Mention feed**           | Fragment, dată publicare, sursă, URL, branduri, topic, sentiment, starea validării și butonul de marcare pentru farmacovigilență. |
| **Topic map**              | Frecvență și exemple pentru teme; nu un word cloud fără context.                                                                  |
| **Analiza competitorilor** | Aceleași queries, surse și perioade pentru cele 4 branduri.                                                                       |

Relevanță și deduplicare

Pentru fiecare brand configurăm aliasuri, grafii fără diacritice, variante frecvente și excluderi. Potrivirea ambiguă merge la revizuire. Identificatorul nativ și URL-ul canonical sunt prima cheie de deduplicare; copiile unui comunicat se grupează într-un cluster, păstrând publicațiile distincte. O mențiune cu două branduri este o înregistrare și două asocieri de entitate; definiția SoV folosește aceste asocieri.

Cazuri sensibile

Sentimentul se etichetează față de brand, cu opțiunile mixed sau unknown în modelul intern. O relatare care pare să necesite evaluare de siguranță a produsului se marchează și se transmite prin fluxul de farmacovigilență definit în brief, capitolul 6, înainte de activarea modulului. Analyzator nu stabilește diagnostice și nu răspunde public.

Acceptare

Totalurile sunt calculate din corpusul efectiv importat și eligibil. Dacă totalurile Planable includ surse excluse din export, păstrăm diferența documentată. Marcarea pentru farmacovigilență creează înregistrarea, trimite notificarea și apare în jurnal.

## 19 Dashboardul Presă și Reviews (după lansare)

**Rută:** /brands/{brandId}/reputation. Două taburi distincte, pentru că un articol și o evaluare de produs au contexte și unități diferite.

Tabul Presă și PR

| **Componentă**          | **Specificație**                                                                     |
|-------------------------|--------------------------------------------------------------------------------------|
| **KPI cards**           | Articole distincte, publicații distincte, mențiuni cu link, mesaje cheie preluate.   |
| **Publication table**   | Titlu, publicație, dată, URL, branduri, topic, linkuri și clasificare editorială.    |
| **Message penetration** | 100 × articole eligibile care includ mesajul aprobat / articole eligibile analizate. |
| **Timeline**            | Publicări și evenimente de comunicare introduse de echipă.                           |
| **Source analysis**     | Publicații care apar și ca surse citate de AI; dovadă la nivel URL.                  |

Tabul Reviews

| **Componentă**        | **Specificație**                                                                       |
|-----------------------|----------------------------------------------------------------------------------------|
| **Inventar de surse** | Retailer, produs exact, URL, țară, metodă de import și acoperire.                      |
| **KPI cards**         | Reviewuri noi, distribuție rating, rating mediu nou, rating cumulat publicat de sursă. |
| **Review explorer**   | Fragment, rating, dată, produs, sursă, topic și link.                                  |
| **Teme**              | Motive de satisfacție și nemulțumire, cu exemple și număr de reviewuri.                |
| **Concurență**        | Produse comparabile și aceeași scară de evaluare; diferențele de corpus sunt vizibile. |

Pentru duplicatele sindicalizate folosim source_review_id, text hash și produs, păstrând proveniența. Dacă data publicării nu există, înregistrarea intră la „dată necunoscută”. Fiecare articol și review are URL sau dovadă de import; orice total poate fi reconstituit.

## 20 Dashboardul Concurență

**Rută:** /brands/{brandId}/competition. **Scop:** să compare brandul cu trei competitori validați, folosind aceleași definiții, și să identifice diferențe care pot conduce la acțiuni.

| **Dimensiune**    | **Comparație permisă**                                                          |
|-------------------|---------------------------------------------------------------------------------|
| **AI**            | Menționare, recomandare și citare pe același panel și engine.                   |
| **SEO**           | Poziții și visibility pe aceleași keywords și device.                           |
| **Social public** | Cadence, followers observați, interacțiuni publice și teme.                     |
| **Listening**     | Mențiuni și sentiment în aceleași surse și intervale.                           |
| **Presă**         | Publicații, teme, mesaje și linkuri observate (după lansare).                   |
| **Ads publice**   | Creatives, mesaje, formate, destinații și distribuție publicată (după lansare). |
| **Reviews**       | Produse și surse comparabile, cu n și scara de rating (după lansare).           |

Ecranul principal este o matrice comparativă cu metrici explicate, trenduri separate și un tabel „Unde apare concurența și noi lipsim”. Clickul pe o celulă deschide dovezile aferente. Matricea arată N/A când sursa nu oferă o metrică; aceleași filtre se aplică tuturor celor patru branduri.

Taxonomia mesajelor (nevoie, beneficiu comunicat, motiv de încredere, audiență, format și CTA) se propune automat și se revizuiește; clasificarea descrie mesajul observat, nu validează adevărul unei promisiuni publicitare. C1, C2 și C3 sunt sloturi până când accountul, strategia și clientul confirmă numele, domeniile, paginile și advertiserii.

## 21 Analize și acțiuni ale agenției

**Rută:** /brands/{brandId}/insights. Analiza umană este un livrabil vizibil al AdSymphony, cu autor și versiune. Clientul deosebește valoarea numerică, ipoteza automată și recomandarea asumată de echipă.

După sincronizare, sistemul calculează metricile și propune schimbări de investigat. Accountul verifică contextul campaniilor; strategia formulează concluziile. Analiza publicată apare în dashboard și devine punctul de pornire al callului. Acțiunile agreate se urmăresc în continuare.

| **Înregistrare**   | **Câmpuri obligatorii**                                                          |
|--------------------|----------------------------------------------------------------------------------|
| **Insight**        | Titlu, perioadă, constatare, interpretare, dovezi, limite, autor, status.        |
| **Recomandare**    | Problemă, acțiune propusă, beneficiu urmărit, metrică de verificare, prioritate. |
| **Acțiune**        | Responsabil, termen, status, data implementării și rezultat urmărit.             |
| **Raport de call** | Snapshot de date, analize incluse, decizii și următorul punct de verificare.     |

Statusuri

Insight: draft, in_review, published, superseded. O recomandare publicată nu se modifică în tăcere; se creează revizie. Acțiune: proposed, agreed, in_progress, done, measured sau cancelled, cu motiv. Clientul vede acțiunile publicate; editarea rămâne la echipă.

Exemplu: „Actualizăm pagina pentru topicul T deoarece 8 răspunsuri citează surse concurente pe acest subiect. Verificăm peste patru crawluri dacă apar citări relevante, cu același panel.”

Acceptare

O analiză în draft nu poate fi citită de client nici prin URL direct sau API. O analiză publicată are autor, timestamp și dovezi accesibile acelui utilizator. La schimbarea perioadei, platforma nu prezintă o concluzie veche ca fiind generată pentru noul interval. Exportul PDF al sintezei și CSV al datelor sunt extensii după lansare; generarea automată de PowerPoint nu este necesară.

## 22 Experiența de utilizare și configurarea

Navigația

La autentificare, utilizatorul vede brandurile permise. În interiorul brandului: Overview, AI Visibility, SEO și Search, Paid Media, Trafic și Conversii, Social Media, Listening, Presă și Reviews, Concurență, Analize și Acțiuni. Administrația agenției are separat Clienți, Branduri, Surse, Importuri, Șabloane, Utilizatori și Starea datelor.

Un marketing manager STADA poate avea o pagină de portofoliu cu trei rânduri comparabile și statusurile brandurilor, fără însumare de reach sau audiențe și fără clasificarea automată a unor categorii de produse diferite.

Componente reutilizabile

KpiCard, TrendChart, ComparisonTable, EvidenceDrawer, CoverageBadge, FilterBar, InsightCard, SourceStatus și EmptyState. Fiecare are stări loading, ready, partial, stale, unavailable și error. Numele sunt repere pentru implementare, nu mesaje afișate clientului.

Limba interfeței este română, cu termenii de marketing uzuali în engleză. Tooltipurile explică KPI-urile. Separator și format de dată consecvente, moneda lângă valoare, puncte procentuale distinct de procente.

Layout și design tokens

Desktop cu navigație laterală și grilă de 12 coloane; carduri de sinteză în două rânduri pe ecrane medii. 1440 px și 1024 px sunt dimensiunile de verificare vizuală pentru pilot; versiunea mobilă (390 px) este etapă ulterioară. Fundal dark sobru, suprafețe cu contrast moderat, text deschis și cyan pentru accent. Culorile competitorilor rămân stabile. Sensul nu se comunică numai prin culoare; hoverul are alternativă prin click și tastatură. Exporturile folosesc fundal alb. Identitatea finală a rebrandingului se aplică prin design tokens.

Personalizare administrată de agenție

dashboard_templates definește modulele și ordinea; brand_dashboard_config activează componente, targets, filters, logo și paletă în limite controlate. Nu permitem clientului SQL, scripturi, formule arbitrare ori încărcare de widgeturi. O modificare de template primește versiune și preview, se aplică explicit brandurilor alese și permite revenirea la versiunea anterioară. Schimbarea designului nu modifică datele.

Acceptare

Filtrele pot fi păstrate în URL și distribuite numai utilizatorilor autorizați. Navigarea înapoi păstrează contextul. Fiecare grafic are tabel alternativ. Starea fără date explică motivul și următorul pas util, fără mesaje tehnice despre stack.

## 23 AdSy AI și contextul de brand (după lansare)

AdSy AI este stratul de analiză dezvoltat de AdSymphony pe Gemini API, cu output structurat și context recuperat din documentele brandului. Nu este necesar fine-tuning per produs. Model candidat: un model din familia Flash-Lite disponibil în cont la momentul implementării; Victor verifică disponibilitatea și îl compară pe setul de evaluare înainte de alegere. model_id și versiunea promptului sunt configurabile, nu hardcodate. Output structurat nu garantează adevărul; validarea rămâne necesară. \[S28-S29\]

Baza de cunoștințe

Documentele aprobate au brand_id, product_id unde este cazul, țară, limbă, tip, versiune, owner, approved_at, valid_from și valid_to. Documentele expirate nu intră implicit în context. Încărcarea unui fișier nu îi conferă statut de document aprobat. Textele se împart în fragmente cu referință de pagină sau secțiune; căutarea returnează numai fragmentele brandului autorizat și valabile pentru întrebare. Separăm datele observate în piață de sursele care definesc adevărul aprobat al produsului.

Funcții în prima etapă AI

- Extragere de entități, topics, sentiment și recomandări explicite din răspunsuri și mențiuni.

- Propunerea unui rezumat săptămânal pe baza agregatelor calculate de sistem și a dovezilor relevante.

- Semnalarea afirmațiilor care necesită comparație cu documentația aprobată.

- Formularea de ipoteze și recomandări în draft pentru echipă. Butonul „Explică această evoluție” este disponibil întâi doar echipei.

Contractul de răspuns

JSON validat cu finding_type, summary, evidence_ids, metric_keys, period, limitations, proposed_action și requires_review. Serverul verifică dacă dovezile există, aparțin brandului și perioadei și sunt accesibile; dacă lipsesc, respinge concluzia sau o etichetează „Dovezi insuficiente”.

Modelul nu primește secrete și nu poate executa SQL, schimba conturi, trimite mesaje ori accesa liber URL-uri. Analizele se regenerează după import ori corecții relevante, nu la fiecare deschidere a paginii. Cache-ul include tenant, brand, data_snapshot_id, model_id și prompt_version. Costul se măsoară per cerere, task și brand, cu plafon și alerte.

## 24 Arhitectura țintă

O aplicație modulară cu o singură bază de cod, un backend administrat de agenție și procese de import separate de cererile clientului. Un pilot de trei branduri nu justifică microservicii. Deciziile pentru versiunea de lansare sunt în brief, capitolul 4; tabelul de mai jos descrie ținta.

| **Strat**          | **Alegere și responsabilitate**                                                                                                                                                              |
|--------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Interfață**      | React și TypeScript; componente reutilizabile și contracte tipizate.                                                                                                                         |
| **Backend**        | Proiect Supabase propriu agenției pentru Postgres, Auth și Storage privat.                                                                                                                   |
| **API aplicație**  | La pilot: RLS, view-uri și funcții SQL prin Supabase. Țintă: funcții server pentru autorizare, interogări, configurare, import și AI, expuse și ca API versionat pentru consumatori externi. |
| **Procesare**      | La pilot: scripturi programate (GitHub Actions sau un serviciu mic) cu sync_runs. Țintă: coadă persistentă în Postgres, worker cu checkpoint și lease, scheduler separat.                    |
| **Metrici**        | Tabele normalizate și agregate materializate sau cache-uri autorizate.                                                                                                                       |
| **AI**             | Adaptor Gemini server-side cu limite, validare JSON și audit de cost (după lansare).                                                                                                         |
| **Cod și livrare** | GitHub ca repository canonic; dezvoltare cu Claude Code; Lovable cel mult pentru scaffold-ul inițial de UI, apoi înghețat.                                                                   |

Fluxul datelor

Conectorul descarcă datele în storage privat temporar. Workerul validează și normalizează. Deduplicarea și maparea pe brand preced agregarea. Sunt calculate metricile, apoi, după lansare, drafturile AdSy AI. Interfața citește datele pregătite; deschiderea dashboardului nu declanșează apeluri la furnizori. Joburile lungi nu rulează în browser și nu în funcții cu limită de timp.

Repository și medii

Foldere: apps/web, server, connectors, analytics, ai, supabase/migrations, tests și docs. Un fișier de contract comun definește metricile și răspunsurile. Migrations și fixtures sunt versionate. Medii separate pentru development, staging și production; fără date demo în staging și production. Secretele și tokenurile de producție nu intră în prompturi.

## 25 Modelul de date

Toate entitățile de business au tenant_id; cele specifice unui brand au și brand_id. Relațiile folosesc chei care împiedică asocierea accidentală a unui brand cu alt tenant. ID-urile furnizorilor se păstrează ca text.

| **Grup de tabele**                                         | **Granularitate și câmpuri principale**                                                         |
|------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| **tenants, brands, memberships, brand_access**             | Client, brand, user, rol, acces explicit și status.                                             |
| **brand_entities, entity_aliases, competitor_sets**        | Branduri și produse, domenii, profiluri, aliasuri, versiunea setului de competitori.            |
| **source_connections, source_mappings**                    | Provider, cont extern, secret reference, timezone, currency și reguli de mapare.                |
| **sync_runs, import_batches**                              | Job, sursă, brand, interval, status, încercări, erori, număr de rânduri, hash al fișierului.    |
| **keywords, keyword_groups, rank_observations**            | Keyword și grup, date, domain, device, rank, volum și payload reference.                        |
| **ai_panels, prompts, ai_runs, ai_answers**                | Panel și versiune, întrebare, engine, surface, dată, răspuns și status.                         |
| **ai_brand_observations, ai_citations, claims**            | Asociere brand per răspuns, recomandare, sentiment, URL și revizuire.                           |
| **web_daily, paid_daily, social_period_metrics**           | Metrici la granularitatea declarată; fără amestec de intervale suprapuse.                       |
| **content_items, content_observations**                    | Postare sau reclamă, ID nativ, conținut și snapshots de metrici.                                |
| **mentions, articles, reviews, entity_mentions, pv_flags** | Înregistrare canonică, asocieri cu branduri sau produse, marcaje de farmacovigilență cu jurnal. |
| **documents, document_versions, chunks**                   | Document aprobat, versiune, interval de valabilitate și referințe.                              |
| **insights, evidence_links, actions**                      | Interpretări, dovezi, publicare și urmărirea acțiunilor.                                        |
| **metric_definitions, dashboard_configs, audit_events**    | Semantica indicatorilor, șabloane și modificări auditabile.                                     |

Cheie unică propusă pentru paid_daily: tenant, source, account, campaign, ad_group, ad, date, breakdown_signature, attribution_config. Pentru AI: tenant, brand, provider, engine, panel_version, prompt_id, crawl_at și replicate_id. Identitatea exactă depinde de payload, dar trebuie stabilită înainte de upsert. Indicii pornesc cu tenant și brand, apoi date sau native_id. Datele nealocate merg într-o coadă de verificare, nu în brandul implicit. Payloadul brut ajută auditul; tabelele tipizate permit formule, filtre și teste stabile.

## 26 Contractele de date și API

La pilot, interfața citește prin Supabase (RLS, view-uri, funcții SQL). Rutele de mai jos sunt contractul țintă pentru un API versionat, util când apare un consumator extern; structura răspunsurilor se folosește de acum în funcțiile SQL.

| **Rută**                               | **Comportament**                                        |
|----------------------------------------|---------------------------------------------------------|
| GET /api/v1/brands                     | Returnează exclusiv brandurile permise utilizatorului.  |
| GET /api/v1/brands/{id}/overview       | KPI și semnale pentru perioada și cohorta cerute.       |
| GET /api/v1/brands/{id}/metrics        | Metrici aprobate, cu allowlist de dimensiuni și filtre. |
| GET /api/v1/brands/{id}/ai/answers     | Listă paginată de răspunsuri, filtrabilă.               |
| GET /api/v1/brands/{id}/evidence/{eid} | Dovadă sanitizată și metadate autorizate.               |
| GET /api/v1/brands/{id}/source-status  | Acoperire, ultima observație și probleme relevante.     |
| POST /api/v1/brands/{id}/imports       | Creează import pentru agenție; răspunde cu job_id.      |
| POST /api/v1/brands/{id}/insights      | Creează draft; publicarea este acțiune separată.        |
| POST /api/v1/brands/{id}/sync          | Cere reimport autorizat, cu limitare de frecvență.      |
| PATCH /api/v1/brands/{id}/config       | Modifică numai câmpurile permise rolului de agenție.    |

Structura unui răspuns

data plus meta. meta include tenant_id rezolvat pe server, brand_id, period, comparison_period, data_as_of, generated_at, sources, coverage, cohort_version, metric_definition_version și warnings. O metrică include value, unit, numerator, denominator, comparison_value, absolute_change, relative_change, status și evidence_query; pentru volume insuficiente, status poate fi insufficient_sample.

Filtre și erori

Datele sunt ISO în API și localizate în UI. Serverul validează intervalul, lista de metrici, dimensiunile și limitele de paginare. Cererile prea ample se execută asincron sau sunt limitate cu mesaj clar. Nu acceptăm fragmente SQL din client ori din AI. 401 autentificare necesară; 403 acces refuzat; 409 conflict de versiune sau job duplicat; 422 filtre incompatibile; 429 limită de apel; 503 sursă temporar indisponibilă. Lipsa rezultatelor cu interogare reușită este 200 cu listă goală și metadate explicite.

Cache key include tenant, brand, rolul sau aria de acces, filtrele și versiunea datasetului. Exporturile și linkurile semnate trec prin aceleași verificări ca interfața. **Acceptare:** modificarea brandId în URL, request sau job payload nu permite accesul la alte branduri; un user client nu poate apela configurarea chiar dacă îi cunoaște adresa.

## 27 Importuri și operarea săptămânală

Fiecare conector implementează aceleași operații interne: validateAccess, discoverResources, fetchPage, normalize, checkpoint și reportCoverage. API-urile externe rămân încapsulate; un dashboard nu se rescrie când se schimbă furnizorul.

Joburi

La pilot: fiecare rulare scrie în sync_runs (sursă, brand, interval, status queued, running, partial, succeeded, failed, rânduri, erori, durată) și este idempotentă prin upsert pe cheie naturală; o rulare întreruptă se reia de la început fără dubluri. Retry pentru erori tranzitorii: 1, 5 și 15 minute cu jitter și respectarea Retry-After. 401 cere verificarea tokenului, 403 verificarea permisiunilor; nu repetăm agresiv o cerere refuzată. Un job finalizat parțial nu este etichetat succeeded. Țintă: coadă persistentă cu sync_tasks, cursor, attempt_count, next_retry_at și lease_until, cu reluare de la checkpoint.

Publicarea datasetului

Rândurile noi trec prin validare și se publică atomic pe lot sau pe sursă. Agregatele nu combină jumătate de săptămână nouă cu jumătate veche fără status partial. Alte module rămân accesibile dacă o sursă a eșuat. Schema și unitățile sunt verificate la import; câmpurile necunoscute se păstrează în raw payload; dispariția unui câmp necesar oprește calculul afectat și generează incident intern. Backfillul folosește aceleași reguli ca refreshul săptămânal.

Contractul importului CSV

Câmpuri minime: source, brand, native_id sau source_url, date ori interval, metric_name și value pentru metrici; pentru mențiuni, text și published_at când există. Validatorul verifică encoding, delimitatori, timezone, unități, duplicate și maparea coloanelor. Utilizatorul vede un preview și un rezumat al erorilor înainte de confirmare. Originalul primește hash și import_batch_id. Un lot poate fi retras fără ștergerea altor loturi; agregatele afectate sunt recalculate. Exporturile CSV neutralizează formulele inițiate de conținut extern.

Panoul operațional al agenției

Ultimul import per brand și sursă, date până la, rânduri acceptate, erori, token expiring, cost estimat și acoperire. Acțiuni: reîncearcă, reconectează, încarcă CSV, verifică maparea. Clientul vede doar explicația utilă privind actualitatea datelor. Actualizările nu trimit automat e-mailuri clienților; notificările externe se activează după stabilirea destinatarilor și preferințelor. Singura notificare automată la lansare este cea de farmacovigilență, către lista internă configurată.

## 28 Acces și protejarea datelor

Separarea clienților este o condiție de funcționare. Supabase documentează Row Level Security și controlul granturilor; politica se aplică și asupra view-urilor, funcțiilor și storage-ului, nu doar asupra paginilor UI. \[S32\]

| **Rol**           | **Permisiuni în produs**                                                                             |
|-------------------|------------------------------------------------------------------------------------------------------|
| **Agency admin**  | Clienți, branduri, invitații, surse, șabloane, drepturi și jurnalul de farmacovigilență.             |
| **Strategist**    | Date pe brandurile alocate, documente aprobate, analize și publicare.                                |
| **Account**       | Date pe brandurile alocate, importuri permise, note, acțiuni și analize potrivit politicii agenției. |
| **Client viewer** | Date și analize publicate doar pentru brandurile alocate; filtre și explorare.                       |
| **Worker**        | Operații limitate la jobul și sursa autorizate; fără sesiune de client.                              |

Cerințe de implementare

- Acces pe invitație; fără signup public. Revocarea se aplică și sesiunilor existente, exporturilor și linkurilor semnate la următoarea verificare. MFA pentru administratorii agenției.

- Toate tabelele expuse au RLS și granturi minime. Dacă workerul folosește service role, verifică explicit tenantul și maparea sursei; folosirea cheii în browser este interzisă. Funcțiile cu privilegii ridicate nu acceptă tenant_id neverificat.

- Storage privat; linkuri cu expirare; accesul la dovezi și documente se verifică înainte de semnare. HTML extern este sanitizat; URL-urile se validează. Fetch-ul server-side blochează adresele locale și metadatele infrastructurii. Tokenurile nu se loghează.

Păstrare și audit

Propunere inițială: agregate 24 de luni, raw payloaduri 90 de zile, documente aprobate și analize pe durata contractului plus termenul agreat. Fiecare sursă poate impune altă păstrare; politica efectivă se configurează înainte de activare. După expirare, un agregat permis poate rămâne disponibil, dar textul eliminat nu se mai prezintă ca dovadă accesibilă.

Nu construim profiluri individuale de sănătate. Pentru listening limităm datele personale păstrate și mascăm datele inutile în analize și exporturi. Folosirea Gemini pentru datele clientului se configurează pe serviciul plătit și în condițiile aprobate de agenție și client. \[S33\] Auditul înregistrează cine a conectat o sursă, a schimbat un competitor, a corectat o etichetă, a publicat o analiză, a marcat un caz de farmacovigilență sau a exportat date. Backupurile și restaurarea sunt testate înainte de lansare.

## 29 Verificarea funcțională și calitatea AI

Victor pregătește un set mic de date controlate pentru formule și un set real autorizat pentru reconcilierea cu furnizorii. Testele verifică riscuri concrete, nu existența componentelor. Lista de lansare este în brief, capitolul 10; mai jos este suita completă.

| **Test**                         | **Rezultat așteptat**                                                                                |
|----------------------------------|------------------------------------------------------------------------------------------------------|
| **Izolare tenant și brand**      | Utilizatorul A nu accesează B prin API, storage, export, cache sau AI.                               |
| **Import repetat**               | Două importuri identice păstrează aceleași totaluri și număr de observații.                          |
| **Eroare după pagina a doua**    | Rularea reia și completează datasetul fără dubluri.                                                  |
| **Lunar peste două săptămâni**   | Costurile se alocă pe date; snapshots AI rămân la crawl.                                             |
| **CTR agregat**                  | Pentru 10 din 100 și 10 din 900, totalul este 20 din 1000, adică 2%.                                 |
| **Reach și active users**        | Nu se calculează prin suma zilelor; fără raport pe interval apar ca indisponibile.                   |
| **Nul și zero**                  | Lipsa accesului, zero real și eroarea sunt trei stări diferite.                                      |
| **AI fără dovadă**               | Concluzia este respinsă sau marcată insuficient susținută.                                           |
| **Prompt injection în mențiune** | Textul nu schimbă instrucțiunile, accesul sau acțiunile sistemului.                                  |
| **Raport publicat**              | Snapshotul rămâne reproductibil după un reimport și o corecție.                                      |
| **Farmacovigilență**             | Marcarea creează înregistrarea, notificarea și intrarea în jurnal; clientul nu vede jurnalul intern. |

Evaluarea clasificărilor (după lansare)

Construim un set etichetat uman de 100 de exemple per brand, din date autorizate sau sintetice marcate, cu cazuri ambigue, negații, mai multe branduri și texte medicale. Separăm setul de calibrare de setul de verificare finală. Ținte: cel puțin 95% precision pentru potrivirea brandului; cel puțin 90% precision pentru „recomandare explicită”; macro-F1 de minimum 0,80 pentru sentiment pe clase suficient reprezentate. Raportăm și recall, confuziile și dimensiunea eșantionului. Dacă pragurile nu sunt atinse, mai multe rezultate rămân în review uman. Pentru corectitudinea informațiilor de produs nu folosim un prag automat de publicare.

Cerințe nefuncționale

Pilot: 3 branduri, 9 competitori configurați, până la 20 de utilizatori. Test de creștere: 30 de branduri și 100 de utilizatori, ca scenariu de proiectare. Ținte: overview sub 3 secunde în p95 cu date pregătite, paginare server-side și importuri independente de sesiunea browserului. Pragurile se măsoară în staging.

## 30 Configurarea pilotului STADA

Primul tenant este STADA România. Spațiile de brand sunt Urinal, Minimartieni și Proenzi. Numărul de utilizatori, entitățile digitale și competitorii se confirmă în onboarding; nu presupunem că fiecare brand are conturi independente pe toate platformele.

| **Brand**        | **Clustere de pornire pentru validare**                                                         | **Particularități de configurat**                                                         |
|------------------|-------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| **Urinal**       | Informații despre categorie, criterii de alegere, informații despre gamă și surse de încredere. | Aliasuri și excluderi pentru potriviri lingvistice nerelevante; produse și pagini exacte. |
| **Minimartieni** | Informații căutate de părinți, diferențe între produse, criterii de alegere și disponibilitate. | Variante cu sau fără diacritice; subgame separate și documente valabile pentru fiecare.   |
| **Proenzi**      | Informare despre categorie, criterii de alegere, comparații și informații despre gamă.          | Produse și ambalaje distincte; separarea temei discutate de sentimentul față de brand.    |

Clusterele sunt teme de cercetare propuse, nu afirmații medicale sau indicații ale produselor. Auditurile de AI visibility și SEO tehnic din august 2026 pentru cele trei site-uri sunt punctul de plecare pentru grupurile de keywords.

Fișa obligatorie de onboarding per brand

- Owner client și owner agenție; utilizatori și drepturi; obiective și indicatori prioritari.

- Nume, aliasuri, produse, domenii, URL-uri eligibile, conturi sociale și ID-uri advertiser.

- Trei competitori cu domenii, profiluri și produse comparabile, validați de strategie și account.

- Conturi GA4, GSC și ads; campanii comune; reguli de naming și de alocare; key events.

- Campanie și grupuri SEOmonitor, add-ons AI active, workspaces și module Planable.

- Documentație aprobată, mesaje, claimuri permise, versiuni, perioade de valabilitate și responsabil pentru actualizare.

- Surse pentru reviews și presă; metode de colectare; excluderi și intervalul de păstrare permis.

- Procedura de farmacovigilență a clientului: contact, format, termen.

Datele de acces se configurează direct în instrumentele de administrare. Nu se includ parole sau tokenuri în fișă ori în documentele de brief.

Prima verificare cu clientul

După importuri, echipa parcurge pe fiecare brand o observație AI, un rezultat search, o campanie, o postare și o mențiune. Confirmă că sunt ale brandului corect, că perioada este clară și că explicația ajută o decizie. Abia apoi se extinde panelul și volumul.

## 31 Pagina publică (după lansare)

Pagina publică promovează astăzi două dashboarduri și pune accentul pe AI. Brief-ul de rebranding cere o reprezentare mai amplă a Brand Intelligence, bazată pe date, interpretare umană, tehnologie și creativitate. Landing page-ul se definitivează după validarea interfeței funcționale, ca să comunice exact ce este disponibil. \[S01\]

| **Element actual observat**           | **Modificare propusă**                                                               |
|---------------------------------------|--------------------------------------------------------------------------------------|
| Două dashboarduri prezentate          | O platformă cu module, organizate în jurul întrebărilor clientului.                  |
| Real time și actualizare continuă     | „Acces permanent la date actualizate săptămânal”.                                    |
| 6 plus platforme AI                   | Lista exactă a motoarelor active și a acoperirii demonstrate.                        |
| Previziuni precise și ROI măsurabil   | Concluzii de marketing cu dovezi și limite explicite.                                |
| Motor AI proprietar                   | „AdSy AI, stratul de analiză AdSymphony construit cu modele AI și context de brand”. |
| Înregistrare din pagina de login      | Acces pe bază de invitație pentru clienții agenției.                                 |
| Titlu tehnic Payload Website Template | Titlu și metadate specifice Analyzator.                                              |

**Text de lucru:** „Înțelege cum se vede brandul tău în digital.” „Analyzator reunește vizibilitatea în AI și search, performanța marketingului și semnalele din piață într-un dashboard configurat de AdSymphony. Vezi ce se schimbă, consultă sursele și discută cu echipa noastră ce merită făcut mai departe.” CTA principal „Discută cu AdSymphony”, CTA secundar „Intră în cont”. Fără analiză gratuită, cont public sau demo automat. Un exemplu vizual poate folosi date demonstrative etichetate; datele STADA se folosesc public numai cu acord.

Ordinea paginii: mesaj principal și imagine de produs; întrebările la care răspunde; module; exemplu de parcurs de la indicator la dovadă și recomandare; rolul echipei; sursele și ritmul de actualizare; contact și login.

## 32 Surse

Documentație publică consultată la 30 septembrie 2026. Linkurile susțin capabilitățile descrise; accesul în cont, tarifele contractuale și payloadurile se verifică în probele din 1-2 octombrie.

**S01 Analyzator pagina publică și autentificare**

[<u>https://analyzator.ro/</u>](https://analyzator.ro/)

**S02 SEOmonitor API 3 Overview**

[<u>https://api-docs.seomonitor.com/</u>](https://api-docs.seomonitor.com/)

**S03 SEOmonitor AI Search Tracking**

[<u>https://help.seomonitor.com/en/articles/12427191-ai-search-tracking</u>](https://help.seomonitor.com/en/articles/12427191-ai-search-tracking)

**S04 SEOmonitor Get Groups List**

[<u>https://api-docs.seomonitor.com/api-23256182</u>](https://api-docs.seomonitor.com/api-23256182)

**S05 SEOmonitor Get Keyword Data**

[<u>https://api-docs.seomonitor.com/api-23256180</u>](https://api-docs.seomonitor.com/api-23256180)

**S06 SEOmonitor Get Daily Keyword Ranks**

[<u>https://api-docs.seomonitor.com/api-23256188</u>](https://api-docs.seomonitor.com/api-23256188)

**S07 SEOmonitor Get Daily Group Visibility**

[<u>https://api-docs.seomonitor.com/api-23256191</u>](https://api-docs.seomonitor.com/api-23256191)

**S08 SEOmonitor Get Keyword AI Search Data**

[<u>https://api-docs.seomonitor.com/api-23256181</u>](https://api-docs.seomonitor.com/api-23256181)

**S09 SEOmonitor Get Weekly AI Search Keyword Ranks**

[<u>https://api-docs.seomonitor.com/api-23256190</u>](https://api-docs.seomonitor.com/api-23256190)

**S10 SEOmonitor Get Keywords Competition AI Search Data**

[<u>https://api-docs.seomonitor.com/api-23256185</u>](https://api-docs.seomonitor.com/api-23256185)

**S11 SEOmonitor AI Search Brand Mentions Visibility**

[<u>https://api-docs.seomonitor.com/api-24360284</u>](https://api-docs.seomonitor.com/api-24360284)

**S12 SEOmonitor AI Search Site Citations Visibility**

[<u>https://api-docs.seomonitor.com/api-24360285</u>](https://api-docs.seomonitor.com/api-24360285)

**S13 SEOmonitor Get Share of Voice**

[<u>https://api-docs.seomonitor.com/api-23256199</u>](https://api-docs.seomonitor.com/api-23256199)

**S14 SEOmonitor Get Keyword AI Overview Data**

[<u>https://api-docs.seomonitor.com/api-23257517</u>](https://api-docs.seomonitor.com/api-23257517)

**S15 SEOmonitor Get AI Search Stats**

[<u>https://api-docs.seomonitor.com/api-43153088</u>](https://api-docs.seomonitor.com/api-43153088)

**S16 Planable Public API, ghid și referință interactivă**

[<u>https://help.planable.io/hc/en-us/articles/27638359236508-How-to-connect-and-use-the-Planable-Public-API</u>](https://help.planable.io/hc/en-us/articles/27638359236508-How-to-connect-and-use-the-Planable-Public-API)

[<u>https://api.planable.io/api/v1/docs</u>](https://api.planable.io/api/v1/docs)

**S17 Planable Social Listening**

[<u>https://help.planable.io/hc/en-us/articles/29421245139356-Social-listening</u>](https://help.planable.io/hc/en-us/articles/29421245139356-Social-listening)

**S18 Planable Analytics**

[<u>https://help.planable.io/hc/en-us/articles/21715231495196-Planable-Analytics</u>](https://help.planable.io/hc/en-us/articles/21715231495196-Planable-Analytics)

**S19 Google Analytics Data API**

[<u>https://developers.google.com/analytics/devguides/reporting/data/v1/basics</u>](https://developers.google.com/analytics/devguides/reporting/data/v1/basics)

**S20 Google Analytics dimensiuni și metrici**

[<u>https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema</u>](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)

**S21 Search Console Search Analytics query**

[<u>https://developers.google.com/webmaster-tools/v1/searchanalytics/query</u>](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)

**S22 Google Ads API**

[<u>https://developers.google.com/google-ads/api</u>](https://developers.google.com/google-ads/api)

**S23 Meta Marketing API**

[<u>https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview.md/</u>](https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview.md/)

**S24 TikTok API for Business, portal de documentație**

[<u>https://business-api.tiktok.com/portal/docs</u>](https://business-api.tiktok.com/portal/docs)

**S25 Google Ads Transparency**

[<u>https://support.google.com/adspolicy/answer/13733850?co=GENIE.CountryCode%3DRO&hl=ro</u>](https://support.google.com/adspolicy/answer/13733850?co=GENIE.CountryCode%3DRO&hl=ro)

**S26 Meta Ad Library API**

[<u>https://br-fr.facebook.com/ads/library/api/?source=onboarding</u>](https://br-fr.facebook.com/ads/library/api/?source=onboarding)

**S27 TikTok Commercial Content API**

[<u>https://developers.tiktok.com/products/commercial-content-api?from_seo_redirect=1</u>](https://developers.tiktok.com/products/commercial-content-api?from_seo_redirect=1)

**S28 Gemini API pricing**

[<u>https://ai.google.dev/gemini-api/docs/pricing</u>](https://ai.google.dev/gemini-api/docs/pricing)

**S29 Gemini structured outputs**

[<u>https://ai.google.dev/gemini-api/docs/structured-output</u>](https://ai.google.dev/gemini-api/docs/structured-output)

**S30 Lovable și Supabase**

[<u>https://docs.lovable.dev/integrations/supabase</u>](https://docs.lovable.dev/integrations/supabase)

**S31 Lovable și GitHub**

[<u>https://docs.lovable.dev/integrations/github</u>](https://docs.lovable.dev/integrations/github)

**S32 Supabase Row Level Security**

[<u>https://supabase.com/docs/guides/database/postgres/row-level-security</u>](https://supabase.com/docs/guides/database/postgres/row-level-security)

**S33 Gemini billing și tratamentul datelor serviciului plătit**

[<u>https://ai.google.dev/gemini-api/docs/billing/</u>](https://ai.google.dev/gemini-api/docs/billing/)

Input intern utilizat: deciziile lui Alex din 30 septembrie 2026 și versiunea actualizată a Brief_rebranding_AdSymphony.docx. Nu au fost utilizate date private STADA pentru a simula rezultate.
