# Evaluarea propunerii „Specificația dashboardurilor pentru clienți” (10 nov. 2026)

Răspunsul la cele patru întrebări din mesajul lui Alex, pentru call. Corespunde **Etapei 1** din propunere („Validarea situației existente”) și notează cererea de scop cu impact în timp și cost (regula 6 din `CLAUDE.md`; intrarea F din `docs/decisions.md`).

- **Ce s-a verificat:** codul, migrațiile, contractele, testele și jurnalul de decizii din acest repo, la commitul din 10 nov. 2026.
- **Ce nu s-a verificat:** datele reale din aplicația live (app.analyzator.ro). Sesiunea nu a avut acces la baza de date, deci coloanele „date primite” și „reconciliat” se citesc din aplicație înainte de call (secțiunea 6 spune de unde).
- **Exemplul pentru Proenzi:** `docs/design/reference/dashboard-client-proenzi.html`, o simulare a propunerii cu date demonstrative marcate permanent, plus matricea de pregătire din secțiunea 6.

> **Actualizare, 10 nov. 2026:** secțiunile 1–7 descriu aplicația dinainte de Etapa 2. Ce s-a construit între timp și ce a rămas e în secțiunea 8.

## Pe scurt

1. Majoritatea modulelor propuse există și rulează pe date reale: accesul pe brand, Overview, AI Visibility, SEO, Trafic, User experience, Paid, Social, Listening cu farmacovigilență, Concurență, Analize și acțiuni (doar citire).
2. Reconcilierea automată cu sursa există doar pentru GA4 (toleranță 1 %) și Search Console (0,5 %). Pentru celelalte surse nu putem spune „reconciliat” până nu o construim sau o facem manual.
3. Lipsesc complet: AdSy AI (chat, generare, controale, politică de brand), inspecția de indexare, exporturile și Rapoartele, vederea de portofoliu, rolul client manager cu acceptarea recomandărilor, editorul de analize în interfață.
4. Regula „o singură rută pentru aceleași date de ads” nu e impusă de schemă. Azi dublarea e evitată doar când cheile coincid; trebuie o constrângere explicită înainte de a activa a doua rută.
5. Recomandarea pentru prima versiune prezentabilă: nucleul din Etapa 2 pe un singur brand, cu valori reale, fără AdSy AI. Estimare de lucru: 19–28 de zile după Etapa 1. Întregul document: 82–124 de zile, de reestimat după Etapa 1.
6. Costul per brand trebuie recalculat: sinteza săptămânală, raportul lunar validat și callul lunar cer mai mult decât cele 4 ore de specialist din exemplul propunerii.

## 1. Starea actuală

Legendă: **Funcționează** = în producție pe date reale. **Parțial** = există, cu limitele notate. **De construit** = nu există cod.

| Zonă din propunere | Stare | Ce există | Ce lipsește față de propunere |
|---|---|---|---|
| Autentificare, branduri, izolare | Funcționează | Acces pe invitație sau cont creat de admin; 4 roluri; un utilizator poate avea mai multe branduri și mai mulți clienți; RLS pe toate tabelele; selectorul listează doar brandurile permise | Ultimul brand se reține doar pe filă (`sessionStorage`), nu între sesiuni. Numele clientului nu apare în bara de context |
| Schimbarea brandului | Funcționează (corectat acum) | Datele, filtrele și competitorii urmează brandul din URL | Până azi, primul cadru după schimbare putea arăta cifrele brandului precedent. Corectat în `useAsync`, cu test |
| Filtre și comparații | Parțial | 7 zile, 28 de zile, luna curentă, interval personalizat; comparație cu perioada anterioară; filtrele stau în URL | Trimestru și an. „Anul trecut” e dezactivat în interfață. Reper ales |
| Overview | Parțial | Bara de context, 6 carduri, evoluție pe taburi, ultima analiză publicată, comparație cu competitorii, până la 3 acțiuni deschise | Două carduri („Cost paid”, „Mențiuni eligibile”) nu au definiție în registru și arată permanent „Sursă neconectată”. Lipsesc cardurile „Ce s-a schimbat”, efortul și KPI-ul pe acțiune, data publicării analizei, data sincronizării pe card |
| Dovezi din fiecare indicator | De construit | Sertarul de dovezi există ca interfață | Pe date reale întoarce „Dovezile pentru această metrică nu sunt încă disponibile”. Propunerea cere drumul de la indicator la sursă |
| Vizibilitate AI | Parțial | Mention Rate, Owned Citation Rate, SoV, răspunsuri valide; pe engine; topic × competitor; surse citate; Answer Explorer cu textul păstrat și citările | Toate cele 5 metrici AI sunt `draft`. Recommendation Rate nu are semnal în SEOmonitor. AI Overviews intră în aceleași rate cu chatboții (propunerea cere separare). Claude și Copilot nu se colectează. Lipsesc filtrele de intenție și brand/non-brand, limba și locația în Answer Explorer |
| SEO | Parțial | Clicks, impressions, CTR din Search Console; keywords Top 3 și Top 10; tabel de keywords cu rank mobil și desktop; landing pages | Visibility SEOmonitor e `draft` (unitatea neconfirmată). Content gaps nu are date (pozițiile competitorilor nu se colectează) |
| Indexare | De construit | — | URL Inspection, inventarul de URL-uri, starea inspecției, canonical |
| Social listening | Parțial | Mențiuni din Planable, sentiment doar după revizuire umană, feed cu URL, „Cont propriu”, marcaj și jurnal de farmacovigilență | KPI-urile de listening nu sunt în registru (există doar `mentions_count`). Fără topicuri, subiecte emergente, praguri de alertă. Fără SoV: mențiunile competitorilor nu se colectează |
| Social media | Parțial | Postări, followers, creștere netă, interacțiuni, carduri „ca pe rețea” | Fără format și temă (Planable nu le trimite). Fără engagement rate în registru. Fără date despre competitori. Reach pe perioadă e indisponibil |
| Trafic | Parțial | Sessions, active users, engaged sessions, key events; canale | Funnelul. Rata sesiunilor cu key event (azi colectăm numărul de evenimente). „AI referrals” și „Calitatea trackingului” nu au reguli definite. GA4 nu e colectat pe device |
| Experiență pe site (Clarity) | Parțial | Rage clicks, dead clicks, quick backs, scroll, pe device; colectare zilnică | Cele 4 metrici sunt `draft`. Fără vedere pe pagină în interfață. Zilele pierdute nu se pot recupera |
| Paid media | Parțial | Cost, impressions, clicks, CTR, CPC, conversii, CPA; tabel pe zi, platformă, cont și campanie; conectori Google Ads, Meta, TikTok | Buget și pacing (nu există tabel). Conversii Meta (acțiunea nu e aleasă). Fără separarea acțiunilor GA4 de rezultatele platformei. Fără reconciliere automată. Ecranul de încărcare CSV nu e gata |
| Concurență | Parțial | Matrice brand + C1–C3 pe AI, SEO, social public, listening, cu N/A explicit; set de competitori cu versiune | Majoritatea celulelor competitorilor sunt N/A din lipsa surselor. Fără conținut și reclame observate, fără profil de competitor |
| Analize și acțiuni | Parțial | Statusuri (draft, în review, publicat, înlocuit), snapshot la publicare, acțiuni cu responsabil și termen; clientul vede doar ce e publicat | Interfața e doar de citire: analizele se scriu direct în baza de date. Fără status „generată automat”. Clientul nu poate comenta sau accepta |
| AdSy AI | De construit | Nimic (exclus intenționat până la 26 oct.) | Chat, generare, afișare, politica brandului, baza de context, verificarea dovezilor, plafon de cost |
| Rapoarte și export | De construit | — | Export PDF/CSV, pagina Rapoarte |
| Portofoliu, „Solicită ajustare” | De construit | — | — |
| Starea surselor per modul | Parțial | „Date până la” și „Ultimul refresh” global; pentru agenție: stare, acoperire, istoric și motivul „Parțial” per sursă | „Următoarea actualizare estimată”. Clientul nu poate deosebi „neconectat” de „fără date” |
| Operare | Parțial | Cron în GitHub Actions, reimport pe 35 de zile, alerte la eșec și la parțial, audit | Backup cu restaurare testată (în runbook: „de completat”). Retenția nu are job. Fără coadă pentru generări |

**Registrul de metrici.** Active: GA4 (sessions, active users, engaged sessions, key events), Search Console (clicks, impressions, CTR, average position), SEOmonitor Top 3 și Top 10, cele 18 metrici de ads, `mentions_count`. Draft: Visibility SEOmonitor, 4 metrici Clarity, 5 metrici AI. Fără definiție: tot ce ține de social, sentiment, SoV listening și rata sesiunilor cu key event.

## 2. Acces și limite pe sursă

| Sursă | Autentificare | Câmpuri colectate | Istoric | Frecvență | Reconciliere | Limite și puncte deschise |
|---|---|---|---|---|---|---|
| Search Console | Service account pe client; o proprietate pe brand | clicks, impressions, CTR, position pe dată, device, query, pagină; doar date finale | 16 luni la backfill; Domain property are date doar de la crearea ei | Săptămânal, marți 04:00 UTC | Automată, 0,5 % | Plafon 40 × 25.000 de rânduri. URL Inspection nefolosit: 2.000 de inspecții pe zi și proprietate, deci inventar definit, nu tot site-ul |
| GA4 | Același service account; proprietate pe brand | sessions, active users (nesumabili), engaged sessions, key events; pe canal, source/medium, landing page | 35 de zile înapoi de la prima rulare; fără backfill | Săptămânal | Automată, 1 % | Fără device. Fără rata sesiunilor cu key event. Numele câmpurilor neconfirmate una câte una |
| SEOmonitor SEO | Token pe client; grupuri mapate pe brand | rank zilnic desktop și mobil, volum, visibility pe grup | 35 de zile; fără backfill | Săptămânal | Nu | 10.000 de apeluri pe zi. Unitatea visibility neconfirmată |
| SEOmonitor AI | Același token | răspunsuri, text original, citări, prezența brandurilor, pe ChatGPT, Gemini, Perplexity; AI Overviews desktop și mobil | 35 de zile; colectare săptămânală | Săptămânal | Nu | Claude neverificat în abonament. Fără semnal de recomandare. Costul add-onului se ia din Billing |
| Planable | Token pe client; workspace pe brand | followers, impressions, reach, interacțiuni pe zi; postări cu rezultate lifetime; mențiuni pentru cuvintele de tip „brand” | 35 de zile; propunerea citează o fereastră de 30 de zile la listening | Săptămânal | Nu | Fără competitor analytics, fără listening pe competitori și topicuri, fără format și temă. Limita de rată nu e documentată. De probat separat REST, MCP și CSV |
| Clarity | Token pe brand | sesiuni, scroll, semnale de fricțiune pe total, device, sursă, pagină | Doar ultimele 1–3 zile; fără recuperare | Zilnic | Nu | 10 apeluri pe zi, 4 pe rulare. O zi pierdută rămâne lipsă |
| Meta Ads | System user în Business Manager | cost, impressions, clicks pe zi și reclamă | 35 de zile | Săptămânal | Nu (doar verificare manuală) | Conversiile sunt NULL până se alege acțiunea pe brand |
| Google Ads | OAuth pe MCC + developer token | cost, impressions, clicks, conversii pe zi și campanie | 35 de zile | Săptămânal | Nu | Aplicația OAuth în mod Testing dă tokenuri de 7 zile. D-9 de revăzut |
| TikTok Ads | OAuth | cost, impressions, clicks, conversii pe zi și campanie | 35 de zile | Săptămânal | Nu | Detalii de API neconfirmate pe rulare reală |
| Airbyte | Postgres read-only al agenției | Doar inspecție: tabele, conturi, interval | — | Manual | — | Colectorul în Paid Media (etapa 2 din E-6) nu e construit |
| Supermetrics | — | — | — | — | — | Nu apare nicăieri în repo |
| CSV | Utilizator de agenție | ads, Planable analytics, Planable listening | Orice dată trecută | Manual | Nu | Serverul există; ecranul de încărcare nu |

**Ruta pentru ads.** Recomandare: API direct pentru Google Ads, Meta și TikTok (conectorii există), fără Supermetrics și fără etapa 2 din Airbyte, dacă nu apare un cont la care nu avem acces direct. Motive: zero cost de licență și o singură cale de date. Înainte de orice a doua rută trebuie o regulă în schemă de tipul „o metodă de colectare pe cont și platformă”. Azi:

- cheia naturală din `paid_daily` nu include metoda de colectare, deci un rând CSV și unul API cu aceeași cheie se înlocuiesc, nu se adună;
- dacă granularitatea diferă (Meta prin API e la nivel de reclamă, un CSV poate fi la nivel de campanie), rândurile **se adună**;
- nimic nu împiedică legarea aceluiași cont și direct, și prin Airbyte.

**Permisiuni.** Cheile stau la nivel de client în Vault și nu ajung în browser. Sursele și credențialele le vede doar `agency_admin`.

**De verificat în operare:** `weekly-refresh.yml` și workflow-urile pe sursă pornesc la aceeași oră. Upserturile sunt idempotente, deci datele nu se dublează, dar se pot consuma apeluri de două ori.

## 3. Etape, efort și costuri

Efortul e în zile de lucru ale unui dezvoltator cu Claude Code, ca la estimările anterioare (D-0, E-1…E-7). Sunt ordine de mărime; se reestimează după Etapa 1, cum cere și propunerea. Nu propun un termen.

### Ce reutilizăm

Fundația de acces și RLS, registrul de metrici și contractul de răspuns, toți conectorii, orchestrarea și alertele, componentele de interfață cu stările lor, fluxul de analize cu snapshot, farmacovigilența, versiunea mobilă și tema dark, suita de securitate.

### Etapa 1: validare (2–3 zile)

- Matricea din secțiunea 6 completată din aplicația live pentru fiecare site STADA.
- Reconciliere GA4 și Search Console pe o săptămână și o lună, pe un brand.
- Probe la furnizori: modelele AI active în abonamentul SEOmonitor (inclusiv Claude și AI Overviews), ruta Planable pentru competitor analytics și listening pe competitori, costul per brand din paginile de Billing.

### Etapa 2: nucleul prezentabil în ședință (19–28 de zile)

| Lucrare | Zile | Depinde de |
|---|---|---|
| Overview după propunere: cardurile noi cu definiții în registru, „Ce s-a schimbat”, efort și KPI pe acțiune | 4–6 | Definițiile aprobate de strategie |
| Dovezile din spatele indicatorilor principali | 3–4 | — |
| Editor de analize și acțiuni în interfață | 4–6 | — |
| Trimestru, an, comparația cu anul anterior, backfill GA4 | 3–5 | Istoricul disponibil pe sursă |
| AI: AI Overviews separat, filtre, ieșirea din `draft` după o săptămână reconciliată | 3–4 | Proba din Etapa 1 |
| Starea surselor pe modul, „Următoarea actualizare”, numele clientului, brandul reținut | 2–3 | — |

Criteriul de ieșire rămâne cel din propunere: un call intern complet pe un brand, cu valori reale și verificabile.

### Etapa 3: inteligență competitivă și marketing integrat (34–52 de zile)

| Lucrare | Zile | Depinde de |
|---|---|---|
| Indexare: inventar, URL Inspection, ecran | 4–6 | Lista de URL-uri prioritare |
| Planable: competitori, listening pe competitori și topicuri | 4–7 | Ruta dovedită în Etapa 1; altfel import CSV declarat |
| Paid: rută unică impusă, buget și pacing, conversii Meta, reconciliere | 5–7 | Bugetele și acțiunea de conversie de la client |
| Funnel, rata sesiunilor cu key event, AI referrals, calitatea trackingului | 4–6 | Key events confirmate pe brand |
| Social: taxonomie editorială, două moduri de raportare | 3–4 | Taxonomia de la echipă |
| Matrice de competitori completă și content gaps | 3–5 | Pozițiile competitorilor în SEOmonitor |
| Client manager, comentarii, acceptarea recomandării, „Solicită ajustare” | 4–6 | Decizia de roluri |
| Export PDF și CSV, Rapoarte | 5–8 | — |
| Vedere de portofoliu | 2–3 | — |

### Etapa 4: AdSy AI (23–35 de zile)

| Lucrare | Zile | Depinde de |
|---|---|---|
| Politica brandului, preferințele personale, cele trei controale | 3–4 | Decizia din secțiunea 5, punctele 2 și 3 |
| Chat pe dovezi: context pe brand, contract de răspuns, verificarea dovezilor pe server, cache, plafon de cost | 10–15 | Modelul și termenii de procesare validați |
| Analize generate cu status și revizuire; baza de documente aprobate | 6–10 | Documentele de la client |
| Set de evaluare, teste de izolare pentru AI, injecție de prompt | 4–6 | 100 de exemple etichetate pe brand |

### Transversal (4–6 zile)

Backup cu restaurare testată, job de retenție, suita de izolare extinsă la export, chat și cache.

**Total:** 82–124 de zile de lucru. Vechea estimare a nivelului C era 60–90 de zile, fără acest document.

### Costuri recurente

| Cost | Cât știm | De confirmat |
|---|---|---|
| Infrastructură (Supabase, Cloudflare, domeniu, e-mail) | 100–250 EUR pe lună pentru tot pilotul (brief, cap. 13) | Baza avea 1.465 MB pe 4 nov., peste limita planului gratuit de 500 MB notată în runbook: planul curent și creșterea lunară |
| Planable | 99 USD pe lună pe workspace pentru listening (brief, cap. 13); propunerea citează și 14 USD pentru analytics, plus abonamentul | Contractul agenției |
| SEOmonitor | Abonament existent plus add-on AI | Consumul per brand la 50–100 de topicuri × modele |
| AdSy AI | 20–80 EUR pe lună la pilot (brief) | Se măsoară per cerere și brand după construire |
| Supermetrics | 0, dacă rămânem pe API direct | — |
| GitHub Actions, Resend | Neglijabil la volumul pilotului | — |

**Orele de specialist.** Exemplul din propunere pune 4 ore pe lună și brand. Pachetul promite sinteză săptămânală, raport lunar validat, call lunar și registrul acțiunilor. O socoteală simplă: 4 sinteze × 1 oră, raport 3 ore, call cu pregătire 2 ore, deci în jur de 9 ore. La 50 EUR pe oră înseamnă 450 EUR, nu 200, iar marja din exemplu scade de la 550 la circa 300 EUR înainte de overhead. De calibrat pe o lună reală de lucru pe un brand.

## 4. Acceptare

| Ce verificăm | Ce există deja | Ce adăugăm |
|---|---|---|
| Izolarea brandurilor | `npm run test:security`: pgTAP pe RLS, atacuri prin API (ID-uri străine, JWT falsificat, revocare, RPC, storage, GraphQL), funcțiile server, 13 mutații care slăbesc protecțiile și trebuie prinse. În interfață: brand nepermis în URL = același mesaj ca brand inexistent, fără nicio cerere | Aceleași atacuri pentru fiecare suprafață nouă înainte de livrare: export, link de fișier, chat, căutare semantică, cache. Azi aceste suprafețe nu există, deci nu au ce testa. Un test manual cu două conturi de client de test în aplicația live |
| Corectitudinea metricilor | Formule doar în SQL, testate pe reguli (CTR agregat din numărători, puncte procentuale, bază zero, reach nesumabil, eșantion minim). Reconciliere automată GA4 și Search Console | Lista celor zece metrici principale, fiecare reconciliată pe o săptămână și o lună cu exportul sursei, cu toleranță și cauză notate. Reconciliere pentru ads și SEOmonitor |
| Stări fără date | 8 statusuri de metrică; `null`, zero și eroare sunt distincte și testate pe fiecare componentă și ecran. Un build cu date fictive pentru production sau staging eșuează | Stările noi din propunere: „integrare oprită”, „permisiune insuficientă”, „AI oprit” |
| Actualizarea surselor | Importuri idempotente testate cu rulare dublă; reimport pe 35 de zile pentru date întârziate; alerte la eșec și parțial | Marcajul vizibil pentru date corectate; „Următoarea actualizare estimată”; test pe o zi Clarity pierdută |
| AI ON/OFF | Nimic | Cu chat OFF nu pleacă nicio cerere (verificat pe server, nu doar în interfață). Politica brandului bate preferința personală. Cu totul oprit, dashboardurile și analizele umane rămân. Fiecare afirmație numerică din răspuns are o dovadă care există, e a brandului și a perioadei; altfel răspunsul e respins. Un text ostil dintr-o mențiune nu schimbă instrucțiunile |

Gate-ul fiecărei livrări rămâne cel din `CLAUDE.md`: `typecheck`, `test` complet și `test:security`.

## 5. Ce merită ajustat în propunere

1. **Trafic și User experience.** Propunerea le unește; pe 23 oct. s-a cerut și livrat meniu separat (E-1). De ales una.
2. **Cine poate opri AI-ul.** Mesajul spune „clientul”; tabelul de roluri dă preferințele personale doar client managerului. Propun: orice utilizator își poate opri chatul și afișarea; politica brandului o setează agency admin.
3. **Ce blochează politica brandului.** Chat și generare, sigur. De decis dacă ascunde și insighturile deja generate. Simularea le ascunde.
4. **„Acțiuni importante”.** Rata sesiunilor cu key event cere un raport GA4 nou. Până atunci cardul poate arăta numărul de key events, cu eticheta corectă.
5. **„Performanță socială”.** Engagement rate trebuie definit pe platformă și numitor. Nu toate platformele trimit reach prin Planable.
6. **Recommendation Rate.** Fără semnal la furnizor, cere clasificare proprie și validare umană. Se mută în etapa AdSy AI; până atunci „indisponibil”.
7. **AI Overviews.** Azi intră în ratele AI. Separarea schimbă valorile afișate clientului; se face cu versiune nouă de definiție.
8. **Istoric anual.** Search Console are 16 luni. GA4 și SEOmonitor au doar de la prima rulare, până construim backfill. Clarity și listeningul Planable nu se pot reconstrui. Filtrul „an” va arăta lipsa explicit.
9. **Retenție.** Propunerea spune 13 luni pentru agregate; specificația v1.2 spune 24. De ales una.
10. **Cadență.** Colectarea e săptămânală (marți), Clarity zilnic. Dacă oferta spune „zilnic” pentru social sau ads, se schimbă programarea și se verifică limitele furnizorilor.
11. **Supermetrics.** Nu există în aplicație și nu e necesar pe rutele actuale.
12. **Denumiri.** Aplicația folosește „AI Visibility”, „SEO și Search”, „Listening”, „Concurență”. Redenumirea e ieftină, dar schimbă ce vede deja clientul din pilot.

## 6. Matricea de pregătire, exemplu pentru Proenzi

Formatul cerut la Etapa 1: autorizat, conectat, date primite, reconciliat, istoric, limitări. Coloanele „din repo” sunt fapte verificate aici. „De citit” înseamnă valoare din aplicația live, luată din Administrare → Clienți și site-uri → Proenzi (cardul sursei și „Istoricul sincronizărilor”) și din `source_reconciliations`.

| Sursă | Autorizat și conectat | Date primite | Reconciliat | Istoric | Limitări pentru Proenzi |
|---|---|---|---|---|---|
| Search Console | Da, din repo: Domain property pentru proenzi.ro (D-27) | Da, din repo | De citit (automat, 0,5 %) | URL prefix 3 iul. 2025 – 10 oct. 2026; Domain property din 11 oct. 2026 | Fără inspecție de URL |
| GA4 | De citit | De citit | De citit (automat, 1 %) | Cel mult de la prima rulare minus 35 de zile | Fără device; key events ca număr de evenimente |
| SEOmonitor SEO | Token pe client; rulare pe cele cinci site-uri STADA la 20 oct. (D-26) | De citit | Nu există reconciliere | De la prima rulare | Visibility `draft` |
| SEOmonitor AI | Același token | De citit | Nu există | De la prima rulare, săptămânal | Metrici `draft`; modelele active de confirmat |
| Planable analytics | De citit | De citit | Nu există | 35 de zile la prima rulare | Fără format, temă, competitori |
| Planable listening | De citit | De citit | Nu există | Fereastră de 30 de zile la furnizor | Doar cuvinte de tip „brand”; procedura de farmacovigilență obligatorie |
| Clarity | De citit | De citit | Nu există | Doar de la pornirea colectării zilnice | Zilele pierdute rămân lipsă |
| Google Ads, Meta, TikTok | De citit | De citit | Nu există | 35 de zile la prima rulare | Conversii Meta NULL; fără buget |

Interogare pentru coloanele „date primite” și „istoric”, de rulat ca administrator de bază de date (service role), cu clientul și brandul numite explicit. Nu a putut fi rulată în această sesiune.

```sql
select d.source, min(d.date) as prima_zi, max(d.date) as ultima_zi, count(*) as zile_cu_date
from public.source_dataset_days d
join public.brands b on b.tenant_id = d.tenant_id and b.id = d.brand_id
join public.tenants t on t.id = b.tenant_id
where t.slug = '<slug client>' and b.slug = 'proenzi'
group by d.source
order by d.source;

select r.source, r.metric, r.period_start, r.period_end, r.our_total, r.source_total, r.difference_pct, r.status, r.checked_at
from public.source_reconciliations r
join public.brands b on b.tenant_id = r.tenant_id and b.id = r.brand_id
join public.tenants t on t.id = b.tenant_id
where t.slug = '<slug client>' and b.slug = 'proenzi'
order by r.checked_at desc
limit 20;
```

## 7. Decizii de luat în call

1. Prima versiune prezentabilă este Etapa 2 pe un brand, fără AdSy AI?
2. Ruta pentru ads: API direct pentru toate cele trei platforme?
3. Punctele 1, 2, 3, 7 și 9 din secțiunea 5.
4. Cine validează definițiile metricilor noi din Overview și până când.
5. Cine aduce costul real per brand de la SEOmonitor și Planable.

## 8. Starea după construirea Etapei 2 (10 nov. 2026)

După evaluare, Etapa 2 a fost cerută direct în aplicație (deciziile G din `docs/decisions.md`). Tabelul compară cu lucrările din secțiunea 3.

| Lucrare din Etapa 2 | Stare | Ce s-a construit | Ce a rămas |
|---|---|---|---|
| Overview după propunere | Construit | Șase carduri cu întrebare, metrică exactă și link spre detaliu; „Ce s-a schimbat”; patru grafice aliniate; poziția față de competitori cu locul în set; priorități cu efort și KPI; interpretarea cu data publicării | Definiții în registru pentru engagement rate, rata sesiunilor cu key event și mențiuni eligibile (G-1). Pragurile semnalelor pe brand (G-3) |
| Dovezile din spatele indicatorilor | Construit | RPC `brand_metric_evidence` și sertarul de dovezi pe date reale | Ora importului și hash-ul payloadului pe observație |
| Editor de analize și acțiuni | Construit | Ciornă, editare, review, publicare, returnare, ștergere; recomandări; versiune nouă a unei analize publicate; acțiuni cu responsabil, termen, efort și KPI; pașii acțiunii până la rezultat | — |
| Trimestru, an, comparația cu anul anterior, backfill GA4 | Construit, mai puțin SEOmonitor | Perioade de 90 și 365 de zile; comparația cu anul trecut pe toate ecranele (H-1); reimport GA4 la cerere, până la 16 luni (H-3) | Reimport SEOmonitor: cere o decizie despre maparea folosită pentru zilele vechi. Reimportul GA4 trebuie rulat pe fiecare site |
| AI: AI Overviews separat, filtre, ieșirea din `draft` | Parțial | Metricile AI numără doar asistenții (versiunea 2); AI Overviews are metrica și cardul lui (H-2) | Ieșirea din `draft` (o săptămână reconciliată pe date reale); filtre pe intenție și brand/non-brand |
| Starea surselor pe modul, client, brand reținut | Construit | Fâșia „Starea datelor” pe fiecare modul; clientul vede „Date până la”; următoarea actualizare estimată; numele clientului; brandul reținut între sesiuni | „Sincronizat la” pentru client (decizie de securitate, G-7); „Acoperire” pe sursă pentru client |

Rămas din Etapa 2 după a doua rundă (deciziile H): reimportul SEOmonitor, ieșirea metricilor din `draft`, filtrele AI și cele trei definiții care așteaptă strategia. Estimare: 3–5 zile de lucru, toate condiționate de decizii sau de date reale.

Înainte de a arăta clientului: `npm run test:security` complet (rulează în `supabase-deploy` la merge) și o trecere pe date reale a noului Overview pentru fiecare brand, cu atenție la cardul de mențiuni și la poziția față de competitori.
