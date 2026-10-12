# Google Analytics 4 și Search Console

**Ce aduce:**
- **GA4:** sesiuni, sesiuni angajate, key events, utilizatori activi, pe canal, sursă / mediu și landing page.
- **Search Console:** clicks, impresii, CTR, poziție medie, pe device, query și pagină.

Ultimele 35 de zile se reimportă la fiecare rulare.

**Timp:** ~30 de minute prima dată per client (contul tehnic Google), apoi ~5 minute per brand.

**Ce se face unde:**
- contul tehnic se creează în Google Cloud;
- cheia și proprietățile GA4 și Search Console se pun **din aplicație** (Administrare → Surse);
- testul înseamnă o **rulare manuală**.

## Cum funcționează accesul

Analyzator nu se loghează cu contul tău Google. Folosește un **service account**: un utilizator tehnic Google, cu o adresă de forma `analyzator@<proiect>.iam.gserviceaccount.com` și o cheie JSON.

- **Un service account per client.** Îl adaugi ca utilizator **doar cu drept de citire** pe fiecare proprietate GA4 și Search Console a brandurilor clientului.
- Clientul poate oricând să-i scoată accesul, din GA4 sau Search Console.

## 1. Creează service account-ul (Google Cloud, o dată per client)

1. [console.cloud.google.com](https://console.cloud.google.com) → creează un proiect (de ex. `analyzator-<client>`) sau folosește unul existent al agenției.
2. **APIs & Services → Library**, activează:
   - **Google Analytics Data API**
   - **Google Search Console API**
3. **IAM & Admin → Service Accounts → Create service account.** Nume: `analyzator`. Nu îi da niciun rol în proiect (nu are nevoie).
4. Deschide service account-ul → **Keys → Add key → Create new key → JSON**. Se descarcă un fișier `.json`.

   Fișierul e o parolă: nu îl trimite pe email, nu îl pune în Drive sau în repo, și șterge-l de pe calculator după pasul 3 de mai jos.
5. Copiază adresa service account-ului (`…@….iam.gserviceaccount.com`).

> Dacă Google refuză crearea cheii („Key creation is disabled”), organizația are politica `iam.disableServiceAccountKeyCreation`. Un administrator al organizației Google Cloud trebuie să facă o excepție pentru proiectul respectiv.

## 2. Dă acces service account-ului (pentru fiecare brand)

- **GA4:** Admin → Property → **Property access management** → „+” → Add users → adresa service account-ului → rol **Viewer** → fără notificare pe email → Add.
- **Search Console:** proprietatea site-ului → Settings → **Users and permissions** → Add user → adresa service account-ului → permisiune **Restricted** → Add.

## 3. Încarcă cheia în Analyzator (o dată per client)

1. Administrare → **Surse** (cu oricare brand al clientului ales sus) → secțiunea **„Conturile clientului”** → cardul **Google (GA4 și Search Console)**.
2. **Încarcă cheia JSON** → alege fișierul descărcat la pasul 1. Aplicația verifică fișierul în browser și îți arată adresa service account-ului; un fișier greșit (de ex. un „OAuth client”) e refuzat cu explicație.
3. **Salvează cheia.** Starea devine „Token salvat, netestat”, iar adresa service account-ului apare pe card, cu butonul „Copiază adresa” (îți trebuie la pasul 2, dacă nu l-ai făcut).
4. **Șterge fișierul `.json`** de pe calculator.

Cheia nu se mai poate citi din aplicație. Pentru o cheie nouă (rotire), încarci alt fișier pe același card.

## 4. Adaugă proprietățile (din aplicație, per brand)

Alege brandul din bara de sus → Administrare → **Surse** → „Adaugă conexiune”.

| Sursă | Cont sau proiect | Unde îl găsești |
|---|---|---|
| Google Analytics 4 | **Property ID** (doar cifre, de ex. `412345678`) | GA4 → Admin → Property → Property details. **Nu** e Measurement ID-ul `G-…`. |
| Search Console | **Exact** cum apare proprietatea | Domain property: `sc-domain:exemplu.ro`. URL prefix: `https://www.exemplu.ro/` (cu `/` la final). |

La GA4 și Search Console **nu există token pe card**: ele folosesc cheia clientului de la pasul 3 (eticheta „Cheia clientului”).

Fusul orar al conexiunii GA4 e implicit `Europe/Bucharest`. Dacă proprietatea GA4 e în alt fus, rularea semnalează `timezone_mismatch`; cere echipei tehnice să corecteze fusul conexiunii.

## 5. Testează: rulare manuală

GitHub → Actions → **google-weekly** → Run workflow (opțional `only` = `ga4` sau `gsc`). Durează câteva minute.

Verifică în Administrare → Surse → „Istoricul sincronizărilor”: rulări „Google Analytics 4” și „Search Console”.

Colectarea automată rulează **marțea la 04:00 UTC**, după ce `CONNECTOR_GOOGLE_ENABLED = true`.

## Probleme frecvente

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| Rularea spune `not_connected`, fără date | Lipsește cheia clientului sau a fost refuzată | Pasul 3 (cardul Google din „Conturile clientului”). |
| `access_denied` pe un brand | Service account-ul nu are acces la proprietatea acelui brand | Pasul 2 pentru acea proprietate. Cheia rămâne validă pentru celelalte branduri. |
| GA4 nu găsește proprietatea | S-a pus Measurement ID (`G-…`) în loc de Property ID | Conexiune nouă cu Property ID-ul numeric. |
| Search Console nu găsește site-ul | `site_url` nu e exact ca în Search Console | `sc-domain:` pentru domain property; URL complet cu `/` pentru URL prefix. |
| „Parțial”, `ga4_thresholding` sau `ga4_sampled` | GA4 ascunde sau eșantionează date (Google Signals, volume mici) | Limită a GA4; cifrele sunt marcate. |
| „Parțial”, `gsc_truncated` | Site foarte mare, peste plafonul de pagini | Totalurile sunt complete; detaliile pe query sunt trunchiate. |
| Ultimele 2-3 zile lipsesc în Search Console | Google publică datele finale cu întârziere | Normal; apar la rularea următoare. |
