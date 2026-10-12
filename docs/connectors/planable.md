# Planable (social propriu și Listening)

**Ce aduce, pentru fiecare brand:**
- **Social:** pe zi și pe pagină: urmăritori, afișări, reach, interacțiuni, aprecieri, comentarii, distribuiri, vizualizări video. Plus postările publicate, cu metricile lor.
- **Listening:** mențiunile brandului (Instagram, TikTok, Facebook, X, YouTube, Reddit), cu sentimentul dat de Planable.

Ultimele 35 de zile se reimportă la fiecare rulare.

**Timp:** ~10 minute per client, plus ~2 minute per brand. **Totul din aplicație**, cu buton de test.

**Ai nevoie de:**
- plan Planable **Pro** sau **Enterprise** (pe Basic nu se pot crea tokenuri);
- rol de **Owner** sau **Administrator** al companiei în Planable;
- pentru Listening: cuvintele brandului urmărite în Planable, de tip **„brand”**.

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
2. În Analyzator: pagina site-ului → cardul **Planable** → pasul 2 → la „Workspace Planable” pune **ID-ul workspace-ului**.
3. Cardul conexiunii arată „Cheia clientului”: nu are token propriu, ci folosește tokenul de la pasul 2.

Repetă pasul 3 pentru fiecare brand.

## 4. Pornește colectarea

- **Manual, ca să vezi date azi:** GitHub → Actions → **planable-weekly** → Run workflow.
- **Automat:** marțea la 04:00 UTC, după ce `CONNECTOR_PLANABLE_ENABLED = true` (vezi [README](README.md), „Înainte de prima sursă”).

## 5. Verifică

Pagina site-ului → „Istoricul sincronizărilor”: pentru fiecare site apar două rulări, **Planable** (social) și **Listening**, cu status și număr de rânduri.

## Prima rulare

API-ul Planable e nou și câteva lucruri nu sunt clare din documentație: dacă un snapshot de pagină înseamnă o zi, ce câmp de urmăritori folosește Facebook, cât de mari pot fi paginile de rezultate. Lista completă e în `docs/contracts/planable.md`, „De confirmat la prima rulare reală”. După prima rulare, trimite echipei tehnice data rulării; cifrele se verifică pe un brand față de ce arată Planable.

## Probleme frecvente

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| `not_connected`: „token Planable neconfigurat” | Lipsește tokenul clientului | Pasul 2. |
| `access_denied` pe ambele rulări | Token expirat sau șters; tokenul e marcat refuzat | Token nou, „Rotește tokenul”. |
| `workspace_not_found` | ID-ul workspace-ului e greșit sau tokenul nu are acces la el | Verifică ID-ul (pasul 3) și workspace-urile tokenului (pasul 1). |
| Listening `not_connected`: „niciun cuvânt de tip brand” | Workspace-ul nu urmărește cuvinte de tip „brand” | Adaugă cuvintele în Planable Listening. Cele de tip „topic” și „competitor” nu se colectează. |
| 403 pe metricile unei pagini | Add-on-ul Analytics e inactiv sau tokenul nu vede pagina | Verifică abonamentul Planable și accesul tokenului. |
| Pagină sărită („nu e conectată în Planable”) | Canalul social e deconectat în Planable | Reconectează canalul în Planable. |

Importul CSV (`docs/connectors/csv.md`) rămâne o variantă de rezervă și scrie în aceleași tabele. O mențiune venită din ambele surse nu se dublează. Sentimentul corectat de echipă nu e suprascris nici de API, nici de CSV.
