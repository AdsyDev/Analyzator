# Ghid: conectarea surselor

Ghiduri pas cu pas pentru agenție (rolul `agency_admin`): de unde obții cheia, ce completezi în aplicație, cum testezi și ce faci când ceva nu merge. Detaliile tehnice (tabele, reguli, coduri de eroare) rămân în `docs/contracts/` și `docs/runbook.md`; aici e doar drumul practic.

| Sursă | Ghid | Ce date aduce | Cât de simplu e azi |
|---|---|---|---|
| Microsoft Clarity | [clarity.md](clarity.md) | comportament pe site (sesiuni, rage clicks, scroll) | Complet din aplicație, cu buton de test |
| SEOmonitor | [seomonitor.md](seomonitor.md) | rankuri, visibility, AI Search, AI Overview | Contul din aplicație; maparea grupurilor pe branduri încă din SQL |
| Google Analytics 4 și Search Console | [google.md](google.md) | sesiuni, key events, clicks și impresii din căutare | Din aplicație: cheia clientului (fișier JSON) și proprietățile pe brand |
| Planable | [planable.md](planable.md) | social propriu (pagini, postări) și Listening | Din aplicație: tokenul clientului, cu test, și workspace-ul pe brand |
| Meta Ads | [meta-ads.md](meta-ads.md) | cost, afișări, clickuri pe zi și reclamă | Din aplicație: tokenul system user, cu test, și contul de ads pe brand |
| Google Ads | [google-ads.md](google-ads.md) | cost, afișări, clickuri, conversii pe zi și campanie | „Conectează cu Google” (OAuth), apoi customer ID-ul pe brand |
| TikTok Ads | [tiktok-ads.md](tiktok-ads.md) | cost, afișări, clickuri, conversii pe zi și campanie | „Conectează cu TikTok” (OAuth), apoi advertiser ID-ul pe brand |
| Orice platformă de ads, ca rezervă | [csv.md](csv.md) | cost, clicks, conversii | Import de fișier CSV |

## Înainte de prima sursă (o singură dată)

1. **Clientul și brandurile există în aplicație.** Administrare → **Clienți și site-uri** → „Adaugă client” (clientul și primul site) sau „Adaugă site” pe cardul unui client existent. Cine creează clientul devine administratorul lui.
2. **Ești `agency_admin`** pe clientul respectiv. Doar acest rol vede sursele, în pagina fiecărui site (Administrare → Clienți și site-uri → „Editează și surse”).
3. **Aplicația are voie să vorbească cu funcțiile server.** Salvarea tokenului din aplicație trece prin funcția `source-credentials`, care acceptă doar domeniul aplicației. În Supabase → Edge Functions → Secrets trebuie setat `ANALYZATOR_APP_ORIGIN` = adresa exactă a aplicației (de ex. `https://analyzator.exemplu.ro`, fără `/` la final). Fără ea, butonul „Salvează tokenul” dă eroare de rețea.
4. **Colectarea automată e pornită.** Conectorii rulează din GitHub Actions. În repo → Settings → Secrets and variables → Actions:
   - **Secrets** (environment `staging`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
   - **Variables:** `CONNECTOR_CLARITY_ENABLED`, `CONNECTOR_SEOMONITOR_ENABLED`, `CONNECTOR_GOOGLE_ENABLED`, `CONNECTOR_PLANABLE_ENABLED`, `CONNECTOR_META_ENABLED`, `CONNECTOR_GOOGLE_ADS_ENABLED`, `CONNECTOR_TIKTOK_ENABLED`, `REFRESH_ENABLED` = `true` pentru sursele pe care le folosești.

   Fără variabile, programarea pornește, dar jobul e sărit. Rularea manuală (Actions → workflow → Run workflow) merge oricând.

## Drumul comun pentru orice sursă cu API

1. **Obții cheia** de la furnizor (fiecare ghid spune unde).
2. **Creezi conexiunea:** în pagina site-ului, cardul sursei → **Conectează**. Pasul 1 e cheia clientului (doar dacă sursa o folosește; o salvezi o dată, celelalte site-uri ale clientului o refolosesc), pasul 2 e contul sau proiectul site-ului.
3. **Salvezi tokenul** pe cardul conexiunii. Tokenul intră în seiful serverului (Supabase Vault) și **nu se mai poate citi** din aplicație; dacă îl pierzi, generezi unul nou.
4. **Testezi** cu „Testează conexiunea” (Clarity, SEOmonitor, Planable, Meta), altfel rulezi manual workflow-ul sursei.
5. **Verifici rezultatul** în pagina site-ului → „Istoricul sincronizărilor”.

## Ce înseamnă stările

**Starea tokenului** (pe cardul conexiunii):

| Etichetă | Ce înseamnă | Ce faci |
|---|---|---|
| Token neconfigurat | Conexiunea există, dar nu are cheie. | Salvează tokenul. |
| Token salvat, netestat | Cheia e salvată; nu știm încă dacă furnizorul o acceptă. Colectarea o folosește. | Testează sau rulează manual sursa. |
| Conexiune funcțională | Furnizorul a acceptat cheia. | Nimic. |
| Token refuzat de furnizor | Furnizorul a răspuns 401/403. Colectarea **sare** conexiunea până la o cheie nouă. | Generează o cheie nouă și salveaz-o. |

**Starea unei sincronizări** (istoric):

| Etichetă | Ce înseamnă |
|---|---|
| Reușit | Toate datele așteptate au intrat, fără erori. |
| Parțial | O parte a intrat; restul apare la „errors”. Datele care lipsesc rămân lipsă, nu devin zero. |
| Eșuat | Nu a intrat nimic (cheie refuzată, buget epuizat, eroare a furnizorului). |

„Sursă neconectată” pe un ecran nu e o eroare: înseamnă că nu există conexiune, cheie sau date pentru brandul respectiv.

## Rularea comenzilor din terminal

Unii pași (marcați în ghiduri) se fac din terminal, în folderul proiectului, cu `.env.local` completat (`SUPABASE_URL`, `SUPABASE_ANON_KEY`; vezi `.env.example`). Parola contului tău și tokenul se tastează când sunt cerute; nu le pune în comandă, ca să nu rămână în istoricul terminalului.

Pașii marcați „SQL” se rulează în Supabase → SQL Editor, pe proiectul de staging. Înlocuiește valorile dintre `<…>`; ID-urile se citesc cu interogările date în fiecare ghid.
