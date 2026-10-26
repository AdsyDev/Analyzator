# SEOmonitor

**Ce aduce:** pentru fiecare brand: rankuri zilnice desktop și mobile, visibility, prezența brandului în răspunsurile AI (ChatGPT, Gemini, Perplexity) și în Google AI Overview, citări și concurenți. Ultimele 35 de zile se reimportă la fiecare rulare.

**Timp:** ~20 de minute per client, plus maparea grupurilor.

**Ce se face unde:**
- tokenul se obține din SEOmonitor și se pune **din aplicație**, în pagina site-ului (Administrare → Clienți și site-uri → **Editează și surse**) → cardul SEOmonitor → pasul 1;
- maparea grupurilor pe site se face **din același card**, la pasul 2: aplicația citește campaniile și grupurile direct din SEOmonitor, cu tokenul clientului;
- dacă lista de campanii apare, tokenul funcționează; datele vin la prima rulare.

**De ce e diferit de Clarity:** un cont SEOmonitor acoperă **toate brandurile unui client**. Brandurile se despart prin grupurile de keywords din SEOmonitor, de aceea conexiunea e la nivel de client, nu de brand: se salvează din pagina oricărui site al clientului și e refolosită de celelalte.

## 1. Obține tokenul

1. În SEOmonitor: **Account Settings → Edit Profile → API Token**. Copiază tokenul. Tokenul e legat de utilizatorul tău; ideal folosește un utilizator dedicat agenției, ca să nu se oprească colectarea când pleacă cineva.
2. **Numele contului**: o etichetă liberă (de ex. numele clientului), ca să recunoști contul. Colectarea vede toate campaniile la care are acces tokenul.

## 2. Conectează contul (din aplicație, o dată per client)

1. Pagina site-ului (Administrare → Clienți și site-uri → **Editează și surse**) al oricărui site al clientului → cardul **SEOmonitor** → **Conectează** → pasul 1.
2. Completează **numele contului** și **tokenul**, apoi **Salvează**. Tokenul nu se mai afișează după salvare.
3. Pentru un token nou (rotire): același card → „Schimbă cheia”.

## 3. Mapează grupurile pe site (din card, per site)

Fără mapare **nu se colectează nimic** pentru site: conectorul cere datele doar pentru grupurile mapate.

**Automat:** la fiecare colectare, un site activ fără nicio mapare primește grupul **„All keywords”** al campaniei cu același domeniu, ca grup principal și „Mixt” (branded și nonbranded). Apare în card cu eticheta „Automat”. Ce schimbi și salvezi în card are prioritate: regula nu atinge niciodată un site care are deja o mapare, nici una exclusă. Două campanii cu același domeniu sau o campanie fără „All keywords” înseamnă că nu se mapează nimic automat, iar rularea notează motivul.

Pentru o mapare mai fină, de mână:

1. Cardul **SEOmonitor** al site-ului → pasul 2. Aplicația listează campaniile tokenului și o propune pe cea cu domeniul site-ului.
2. Apar grupurile campaniei (cu folderele și subgrupurile lor). Bifezi grupurile site-ului și alegi, pentru fiecare:
   - **Branded**: keywords cu numele brandului; **Nonbranded**: restul. Aplicația propune Branded pentru grupurile cu „brand” în nume.
   - **Principal**: exact un grup bifat; din el vine indicatorul „Visibility SEOmonitor”.
3. **Salvează maparea.** Fiecare grup schimbat primește o versiune nouă, în vigoare de **ieri**, ca prima rulare să o aplice. Nimic nu se șterge: un grup debifat devine „exclus” (ignorat), iar istoricul rămâne.
4. Un grup mapat deja pe alt site al clientului apare „Mapat pe <site>” și nu se poate bifa. Grupurile care amestecă branduri (`multi_brand`) se marchează, deocamdată, din SQL.

Toate mapările clientului sunt în Administrare → **Configurare** → „Grupuri SEOmonitor → brand”.

## 4. Testează: rulare manuală

GitHub → Actions → **seomonitor-weekly** → Run workflow. Durează câteva minute.

Verifică în pagina fiecărui site mapat → „Istoricul sincronizărilor”: câte o rulare SEOmonitor per brand.

După test, colectarea automată rulează **marțea la 04:00 UTC** (06:00 vara, 05:00 iarna, ora României), după ce `CONNECTOR_SEOMONITOR_ENABLED = true`.

## Prima rulare

Câteva lucruri nu sunt clare din documentația SEOmonitor și se confirmă pe date reale:

- unitatea visibility (fracție sau procent);
- ce valoare are rankul unui keyword care nu se clasează.

Până la confirmare, visibility apare ca „draft”, nu ca cifră finală. Trimite echipei tehnice data rulării; lista completă e în `docs/contracts/seomonitor.md`, „De confirmat la prima rulare reală”.

## Probleme frecvente

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| Nicio rulare pe brand | Grupurile nu sunt mapate pe brand | Pasul 3. |
| `access_denied` (401/403), rularea se oprește | Token invalid sau revocat; tokenul e marcat refuzat | Token nou din Edit Profile → API Token, apoi „Rotește tokenul” (pasul 2). |
| `mapped_group_missing`, rulare „Parțial” | Grupul a fost șters sau mutat în SEOmonitor | Mapare nouă (versiune nouă) pentru grupul corect. |
| `ai_originals_not_saved`, rulare „Parțial” | Baza de date nu a scris textele originale AI la timp (57014) | Datele (poziții, vizibilitate, răspunsuri AI) au intrat; originalele se scriu la rularea următoare. Dacă se repetă, verifică încărcarea bazei de date în Supabase. |
| „Eșuat” pe un singur site, `exception` | Eroare neașteptată la acel site | Celelalte site-uri ale clientului s-au colectat (D-26); motivul apare în istoricul site-ului. |
| `campaign_not_found` | Campania nu mai e urmărită în SEOmonitor | Verifică Tracked Campaigns. |
| Grup în coada de verificare | Grup nou, nemapat, sau `multi_brand` | Mapează-l (pasul 3). |
| 429 | Limita SEOmonitor (10 cereri/secundă, 10.000/zi) | Rularea reîncearcă singură după 1, 5, 15 minute. |
