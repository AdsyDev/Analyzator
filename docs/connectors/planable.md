# Planable (social propriu și Listening)

**Ce aduce, pentru fiecare brand:**
- **Social:** pe zi și pe pagină: urmăritori, afișări, reach, interacțiuni, aprecieri, comentarii, distribuiri, vizualizări video. Plus postările publicate, cu metricile lor.
- **Listening:** mențiunile brandului (Instagram, TikTok, Facebook, X, YouTube, Reddit), cu sentimentul dat de Planable.
- **Listening pe competitori:** mențiunile cuvintelor de tip **„competitor”**, numărate pe competitor în Concurență (mențiuni și share of voice). Doar rețeaua, linkul, data și sentimentul Planable; fără textul și autorul mențiunii.
- **Planable Competitors:** profilurile publice ale competitorilor urmărite pe paginile brandului (Instagram, Facebook, YouTube, TikTok, LinkedIn): urmăritori, postări și interacțiuni pe zi. Apar în Concurență („Social public”) și în Social („Concurență publică”).

Ultimele 35 de zile se reimportă la fiecare rulare.

**Timp:** ~10 minute per client, plus ~2 minute per brand. **Totul din aplicație**, cu buton de test.

**Ai nevoie de:**
- plan Planable **Pro** sau **Enterprise** (pe Basic nu se pot crea tokenuri);
- rol de **Owner** sau **Administrator** al companiei în Planable;
- pentru Listening: cuvintele brandului urmărite în Planable, de tip **„brand”**.
- pentru Listening pe competitori: cuvintele competitorilor urmărite în Planable, de tip **„competitor”**;
- pentru Planable Competitors: add-on-ul **Analytics** activ și competitorii adăugați pe paginile brandului (Analytics → pagina → Competitors).

## 1. Creează tokenul în Planable (o dată per client)

1. În Planable: profilul tău → **Integrations** → cardul **Public API** → **Company settings → API tokens** → token nou. Denumirile meniurilor pot varia puțin între versiuni.
2. Alege:
   - **Nume:** de ex. `analyzator`;
   - **Scope:** **Read**, pentru că Analyzator doar citește;
   - **Workspace-uri:** cele ale brandurilor clientului, sau toate;
   - **Expirare:** 1 an sau „Never”. La o expirare scurtă, colectarea se oprește când expiră tokenul.
3. Copiază tokenul (începe cu `pln_`). E o parolă: nu-l trimite pe email sau chat.

## 2. Salvează tokenul în Analyzator

1. Pagina site-ului (Administrare → Clienți și site-uri → **Editează și surse**) al oricărui site al clientului → cardul **Planable** → **Conectează** → pasul 1, „Tokenul Planable al clientului”.
2. Completează **numele companiei** (doar o etichetă) și **tokenul**, apoi **Salvează**.
3. Apasă **Testează conexiunea**:

| Rezultat | Ce înseamnă | Ce faci |
|---|---|---|
| Verde, „Conexiune funcțională” | Planable a acceptat tokenul. | Treci la pasul 3. |
| Roșu, „Token refuzat de furnizor” | Token greșit, expirat sau șters. | Creează un token nou și salvează-l („Rotește tokenul”). |
| Galben | Planable n-a răspuns normal (limită sau eroare). | Încearcă mai târziu. |

Testul e limitat la 20 pe zi pentru fiecare cont.

## 3. Leagă fiecare brand de workspace-ul lui

1. **Află ID-ul workspace-ului.** Cel mai sigur e documentația interactivă Planable:
   - deschide [api.planable.io/api/v1/docs](https://api.planable.io/api/v1/docs);
   - autorizează-te cu tokenul;
   - rulează **GET /workspaces**.

   Fiecare workspace are un `id` și un `name`.
2. În Analyzator: pagina site-ului → cardul **Planable** → pasul 2 → alegi workspace-ul din listă (aplicația o cere Planable cu tokenul clientului și îl propune pe cel cu numele site-ului). Manual, dacă e nevoie: **ID-ul workspace-ului**.
3. Cardul conexiunii arată „Cheia clientului”: nu are token propriu, ci folosește tokenul de la pasul 2.

Repetă pasul 3 pentru fiecare brand.

## 4. Pornește colectarea

- **Manual, ca să vezi date azi:** GitHub → Actions → **planable-weekly** → Run workflow.
- **Automat:** marțea la 04:00 UTC, după ce `CONNECTOR_PLANABLE_ENABLED = true` (vezi [README](README.md), „Înainte de prima sursă”).

## 5. Verifică

Pagina site-ului → „Istoricul sincronizărilor”: pentru fiecare site apar rulările **Planable** (social), **Listening** și, dacă există, **Planable Listening (competitori)** și **Planable Competitors**, cu status și număr de rânduri.

## Competitorii în Listening

1. În Planable Listening, adaugă pentru fiecare competitor cuvintele lui, de tip **„competitor”**.
2. Cuvântul se leagă de competitor după text, fără diferență de majuscule: implicit, cuvântul trebuie să fie **numele competitorului din setul de competitori** (Administrare → Configurare → „Competitori”). Dacă în Planable urmărești alte cuvinte (de ex. „Prostamol Uno”), le pui pe competitor din Administrare → **Configurare** → „Competitori” → **Versiune nouă**, câmpul „Cuvinte Planable Listening”. Un cuvânt aparține unui singur competitor.
3. Un cuvânt de tip „competitor” care nu corespunde niciunui competitor din set se colectează, dar nu apare nicăieri.
4. Mențiunile se colectează de la prima rulare (ultimele 35 de zile); pentru perioade mai vechi, celula competitorului e „parțial” sau N/A, nu zero.

## Competitorii în Planable Competitors

1. În Planable, pe fiecare pagină a brandului (Instagram, Facebook, YouTube, TikTok, LinkedIn): Analytics → **Competitors** → adaugă profilurile competitorilor. Planable le preia în câteva ore.
2. Profilul se leagă de competitorul din set după nume: numele afișat sau handle-ul trebuie să corespundă numelui competitorului (fără diacritice, majuscule, spații). Altfel, pui handle-urile pe competitor din Administrare → **Configurare** → „Competitori” → **Versiune nouă**, câmpul „Profiluri Planable Competitors”.
3. Colectarea citește ultimele 35 de zile, zi cu zi (aproximativ 37 de cereri pe pagină). Planable spune că interacțiunile competitorilor sunt colectate din pagina publică, iar ale paginii proprii sunt raportate de platformă, deci comparația e orientativă.

## Prima rulare

API-ul Planable e nou și câteva lucruri nu sunt clare din documentație: dacă un snapshot de pagină înseamnă o zi, ce câmp de urmăritori folosește Facebook, cât de mari pot fi paginile de rezultate. Lista completă e în `docs/contracts/planable.md`, „De confirmat la prima rulare reală”. După prima rulare, trimite echipei tehnice data rulării; cifrele se verifică pe un brand față de ce arată Planable.

## Probleme frecvente

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| `not_connected`: „token Planable neconfigurat” | Lipsește tokenul clientului | Pasul 2. |
| `access_denied` pe ambele rulări | Token expirat sau șters; tokenul e marcat refuzat | Token nou, „Rotește tokenul”. |
| `workspace_not_found` | ID-ul workspace-ului e greșit sau tokenul nu are acces la el | Verifică ID-ul (pasul 3) și workspace-urile tokenului (pasul 1). |
| Listening `not_connected`: „niciun cuvânt de tip brand” | Workspace-ul nu urmărește cuvinte de tip „brand” | Adaugă cuvintele în Planable Listening. Cele de tip „topic” nu se colectează; cele de tip „competitor” au rularea lor. |
| `planable_listening_competitors` `not_connected` | Workspace-ul nu urmărește cuvinte de tip „competitor” | „Competitorii în Listening”, pasul 1. |
| `planable_competitors` `not_connected` | Nicio pagină a brandului nu urmărește competitori | „Competitorii în Planable Competitors”, pasul 1. |
| `planable_competitors` `access_denied` | Add-on-ul Analytics e inactiv sau tokenul nu vede pagina | Verifică abonamentul Planable și accesul tokenului. |
| Competitor „N/A” la Social public | Niciun profil urmărit nu corespunde numelui lui | „Competitorii în Planable Competitors”, pasul 2. |
| Competitor „N/A” la Mențiuni | Niciun cuvânt urmărit nu are numele lui sau un cuvânt atribuit lui | „Competitorii în Listening”, pasul 2. Jurnalul rulării (Actions → planable-weekly) listează, pe brand, ce cuvânt și ce profil a mers la care competitor și ce a rămas neatribuit. |
| 403 pe metricile unei pagini | Add-on-ul Analytics e inactiv sau tokenul nu vede pagina | Verifică abonamentul Planable și accesul tokenului. |
| Pagină sărită („nu e conectată în Planable”) | Canalul social e deconectat în Planable | Reconectează canalul în Planable. |
| Listening: puține mențiuni față de Planable | Planable trimite mențiuni fără URL sau fără dată; acestea nu pot fi scrise | Jurnalul rulării arată „N mențiuni sărite din <rețea>: <motiv>”. Rândurile se numără acolo, nu se pierd în tăcere; dacă o rețea întreagă e sărită, anunță echipa tehnică. |

Importul CSV (`docs/connectors/csv.md`) rămâne o variantă de rezervă și scrie în aceleași tabele. O mențiune venită din ambele surse nu se dublează. Sentimentul corectat de echipă nu e suprascris nici de API, nici de CSV.
