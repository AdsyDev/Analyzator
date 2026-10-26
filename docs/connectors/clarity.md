# Microsoft Clarity

**Ce aduce:** pe zi, pentru fiecare brand: sesiuni, utilizatori, pagini per sesiune, plus defalcări pe device, sursă de trafic și pagină. Metricile de comportament (rage clicks, dead clicks, quick backs, scroll depth) se confirmă la prima rulare reală (vezi „Prima rulare”).

**Timp:** ~5 minute per brand. **Totul din aplicație.**

**Ai nevoie de:** rol de **admin** pe proiectul Clarity al site-ului (doar adminii pot genera tokenul) și rol `agency_admin` în Analyzator.

Un proiect Clarity = un site = un brand. Fiecare brand are tokenul lui.

## 1. Obține ID-ul proiectului și tokenul

1. Intră în [clarity.microsoft.com](https://clarity.microsoft.com) și deschide proiectul site-ului.
2. **ID-ul proiectului:** Settings → Overview → „Project ID” (un șir scurt, de ex. `abc12de3fg`). Apare și în adresa paginii, după `/projects/view/`.
3. **Tokenul:** Settings → **Data Export** → „Generate new API token”. Dă-i un nume ușor de recunoscut (de ex. `analyzator-<brand>`), apoi copiază-l imediat: Clarity nu îl mai arată a doua oară.

Tokenul e o parolă: nu îl trimite pe email sau chat și nu îl pune în documente. Îl lipești direct în aplicație.

## 2. Conectează în Analyzator

1. Alege brandul din bara de sus.
2. Pagina site-ului (Administrare → Clienți și site-uri → **Editează și surse**) → cardul **Microsoft Clarity** → **Conectează**:
   - **Sursă:** Microsoft Clarity
   - **Cont sau proiect:** ID-ul proiectului de la pasul 1
   - **Nume afișat:** opțional (de ex. „Clarity site principal”)
3. Pe cardul conexiunii nou apărute: **Setează tokenul** → lipește tokenul → **Salvează tokenul**. Starea devine „Token salvat, netestat”.

## 3. Testează

Apasă **Testează conexiunea**.

| Rezultat | Ce înseamnă | Ce faci |
|---|---|---|
| Verde, „Conexiune funcțională” | Clarity a acceptat tokenul. | Gata. |
| Roșu, „Token refuzat de furnizor” | Token greșit, expirat, șters sau din alt proiect. | Verifică ID-ul proiectului; generează un token nou și salvează-l. |
| Galben (limită / eroare furnizor) | Clarity nu a răspuns normal; tokenul nu s-a schimbat. | Încearcă mai târziu. |
| Buget epuizat | Azi s-au folosit deja toate apelurile. | Reîncearcă după 00:00 UTC (03:00 ora României vara, 02:00 iarna). |

**Atenție la buget:** Clarity permite **10 apeluri pe zi per proiect**. Un test consumă 1, o colectare consumă 4. Nu testa de mai multe ori „ca să fii sigur”.

## 4. Pornește colectarea

- **Automat:** zilnic la 22:05 UTC (01:05 noaptea ora României vara), după ce `CONNECTOR_CLARITY_ENABLED = true` (vezi [README](README.md), „Înainte de prima sursă”). Fiecare rulare scrie ziua precedentă.
- **Manual, ca să vezi date azi:** GitHub → Actions → **clarity-daily** → Run workflow. Consumă 4 din cele 10 apeluri ale zilei.

## 5. Verifică

Pagina site-ului → „Istoricul sincronizărilor”: o rulare **Microsoft Clarity** cu status „Reușit” sau „Parțial” și numărul de rânduri.

## Prima rulare

Clarity nu documentează numele exacte ale câmpurilor pentru rage clicks, dead clicks, quick backs și scroll depth. La prima rulare reală:

1. Rulează manual, pe un singur brand dacă se poate.
2. Trimite echipei tehnice ID-ul rulării. Echipa citește notele `parser_unconfirmed_field` din `sync_runs.errors` și completează maparea (vezi `docs/runbook.md`, „Colectare zilnică Clarity”).

Până atunci, aceste metrici apar ca „indisponibile”, nu ca zero. Sesiunile și utilizatorii vin de la prima rulare.

## Probleme frecvente

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| „Salvează tokenul” dă eroare de rețea | `ANALYZATOR_APP_ORIGIN` nu e setat la domeniul aplicației | Vezi [README](README.md), pasul 3. |
| „Există deja o conexiune pentru acest cont” | ID-ul proiectului e deja conectat (poate la alt brand) | Folosește conexiunea existentă. |
| Sincronizare „Eșuat”, `insufficient_budget` | Sub 4 apeluri rămase azi | Așteaptă ziua următoare (UTC). |
| Sincronizare „Parțial”, `empty_payload` | Clarity nu are date pentru o defalcare (site fără trafic în fereastră) | Normal pentru site-uri mici; restul datelor au intrat. |
| „Parțial”, „Clarity nu a înregistrat nicio vizită” (zi după zi) | Toate defalcările (dispozitiv, sursă, pagină) vin goale și totalul are 0 afișări: Clarity nu primește trafic de la site (Minimartieni, 23–25 oct. 2026) | În Clarity → Settings → Setup, verifică dacă tag-ul e instalat pe site și dacă proiectul e cel din conexiune; dacă site-ul cere consimțământ, verifică și că Clarity se încarcă după acceptare. |
| Paginile par trunchiate | Clarity dă maximum 1.000 de rânduri per răspuns | Limită a furnizorului. |

**Schimbarea tokenului** (rotire): generează unul nou în Clarity, apoi pe card **Rotește tokenul** → lipește → Salvează → Testează. Șterge tokenul vechi din Clarity.
