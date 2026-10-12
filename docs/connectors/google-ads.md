# Google Ads

**Ce aduce:** pe zi și pe campanie (inclusiv Performance Max): **cost**, **afișări**, **clickuri** și **conversii**, în moneda contului. Ultimele 35 de zile se reimportă la fiecare rulare.

**Plug and play:** după configurarea o singură dată a agenției, fiecare client se conectează cu **„Conectează cu Google”**.

## O singură dată, pentru agenție (echipa tehnică)

1. **Developer token:** în contul de manager (MCC) al agenției → **Admin → API Center** → cere un developer token, cu acces **Basic** (aprobarea Google durează de la câteva zile la câteva săptămâni). Cu acces „Test account” nu se pot citi conturi reale.
2. **Aplicația OAuth:** [console.cloud.google.com](https://console.cloud.google.com):
   - activează **Google Ads API**;
   - **APIs & Services → OAuth consent screen**: tip External, cu numele aplicației;
   - **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized redirect URI:** `https://<proiect>.supabase.co/functions/v1/oauth/callback/google_ads`.
3. **Secrete** (nu în chat sau în repo):
   - Supabase → Edge Functions → Secrets: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `APP_BASE_URL` = `https://app.analyzator.ro`, `ANALYZATOR_APP_ORIGIN` = aceeași adresă;
   - GitHub → environment `staging`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`.

Cât timp aplicația OAuth e în modul „Testing”, Google permite până la 100 de utilizatori de test și refresh token-uri valabile 7 zile. Pentru folosire continuă, aplicația trebuie publicată („In production”). Scopul Google Ads poate cere verificarea aplicației la Google.

## Pentru fiecare client (din aplicație)

1. Pagina site-ului (Administrare → Clienți și site-uri → **Editează și surse**) al unui site al clientului → cardul **Google Ads** → **Conectează** → pasul 1.
2. Completează **ID-ul contului de manager (MCC)**, de exemplu `123-456-7890`, apoi **Conectează cu Google**.
3. Te loghezi cu un cont Google care are acces la MCC și accepți accesul la Google Ads. Revii în pagina site-ului cu mesajul „Google Ads a fost conectat”; la pasul 2 pui Customer ID-ul site-ului.

## Pentru fiecare brand

Brandul ales sus → **„Adaugă conexiune”** → **Google Ads** → **Customer ID**-ul contului brandului (sus, în Google Ads, lângă numele contului). Contul trebuie să fie sub MCC-ul de la pasul anterior.

## Rulare și verificare

GitHub → Actions → **google-ads-weekly** → Run workflow; automat marțea, după `CONNECTOR_GOOGLE_ADS_ENABLED = true`. În „Istoricul sincronizărilor” apare o rulare Google Ads per brand.

## Probleme frecvente

| Simptom | Cauză | Soluție |
|---|---|---|
| „Conectarea Google Ads nu e configurată pe server” | Lipsesc secretele OAuth în Supabase | Pasul 3 de la agenție. |
| „Link de conectare expirat sau deja folosit” | Au trecut peste 10 minute sau pagina s-a reîncărcat | Pornește din nou conectarea. |
| „Google nu a dat acces permanent” | Accesul n-a fost acceptat complet | Reconectează și acceptă toate permisiunile. |
| `permission_denied` cu `DEVELOPER_TOKEN_NOT_APPROVED` | Developer token-ul nu are încă acces Basic | Așteaptă aprobarea Google. |
| `permission_denied` cu `USER_PERMISSION_DENIED` | Contul brandului nu e sub MCC sau contul Google n-are acces | Leagă contul de MCC; reconectează cu un utilizator care vede MCC-ul. |
| `not_connected`: „Reconectează contul Google Ads” | Refresh token revocat sau expirat (de ex. aplicație în „Testing”, 7 zile) | Reconectează; publică aplicația OAuth. |
