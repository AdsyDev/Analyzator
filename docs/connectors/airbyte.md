# Ghid: Airbyte (Paid Ads din destinația Postgres)

Pentru agenție (`agency_admin`). Airbyte-ul AdSymphony sincronizează deja conturile Meta, Google Ads și TikTok într-o bază Postgres. Analyzator se conectează la ea cu un utilizator **doar de citire**, arată ce tabele, conturi și metrici găsește, iar tu legi conturile de site-uri. Colectarea datelor în Paid Media e etapa 2 (încă nefăcută, decizia E-6). Detalii tehnice: `docs/contracts/airbyte.md`.

## 1. Pe serverul Postgres (o singură dată)

Funcțiile server Supabase se conectează doar criptat și verifică certificatul serverului pe nume. Ai nevoie de:

1. **Un nume de domeniu** pentru server, de exemplu `airbyte-db.adsymphony.ro`. Un IP nu merge, pentru că certificatul se verifică pe nume.
2. **TLS activ în Postgres, cu un certificat valid pentru acel nume.** Două variante:
   - **Certificat public (recomandat):** Let's Encrypt (certbot) pentru `airbyte-db.adsymphony.ro`, apoi în `postgresql.conf`: `ssl = on`, `ssl_cert_file = '.../fullchain.pem'`, `ssl_key_file = '.../privkey.pem'` (cheia citibilă doar de utilizatorul `postgres`). Repornește sau reîncarcă Postgres. Certificatul se reînnoiește la 90 de zile; reîncarcă Postgres după reînnoire.
   - **Autoritate proprie (CA):** creezi un CA și un certificat de server semnat de el, cu numele în `subjectAltName`. La pasul 3 atașezi certificatul CA (doar partea publică). Comenzi orientative:
     ```bash
     openssl req -new -x509 -days 3650 -nodes -subj "/CN=AdSymphony Airbyte CA" -keyout ca.key -out ca.crt \
       -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
     openssl req -new -nodes -subj "/CN=airbyte-db.adsymphony.ro" -keyout server.key -out server.csr
     printf "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:airbyte-db.adsymphony.ro\n" > server.ext
     openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 825 -out server.crt -extfile server.ext
     ```
     `server.crt` și `server.key` merg în Postgres. `ca.crt` se lipește în aplicație. `ca.key` rămâne offline.
   - **Nu merge:** un certificat self-signed simplu (`openssl req -x509` pentru server, fără CA separat) și nici serverul fără TLS.
3. **Portul deschis din internet** (de obicei 5432) și o regulă în `pg_hba.conf` pentru utilizatorul read-only, cu `hostssl` (doar conexiuni criptate) și `scram-sha-256`. Funcțiile server Supabase nu au IP-uri de ieșire fixe garantate, deci regula e pe utilizator, parolă și TLS, nu pe IP: `hostssl airbyte analyzator_ro 0.0.0.0/0 scram-sha-256` (și `::/0` pentru IPv6).

## 2. Utilizatorul read-only

Rulează ca administrator al bazei Airbyte (înlocuiește schemele cu cele în care scrie Airbyte, de obicei namespace-ul fiecărei conexiuni):

```sql
create role analyzator_ro login password '<parolă lungă, generată>';
alter role analyzator_ro set default_transaction_read_only = on;
revoke all on database airbyte from analyzator_ro;
grant connect on database airbyte to analyzator_ro;
grant usage on schema meta, google_ads, tiktok to analyzator_ro;
grant select on all tables in schema meta, google_ads, tiktok to analyzator_ro;
-- tabelele create mai târziu de Airbyte (fluxuri noi), automat:
alter default privileges for role airbyte_user in schema meta, google_ads, tiktok grant select on tables to analyzator_ro;
```

`airbyte_user` e utilizatorul cu care scrie Airbyte. Nu da drept pe `airbyte_internal` (tabelele brute) și nici pe alte baze.

**Mai mulți clienți în aceeași bază?** Fiecare client din Analyzator are cheia lui. Dacă destinația ține conturile mai multor clienți AdSymphony, creează câte un utilizator read-only per client, cu `grant` doar pe schemele (namespace-urile) conexiunilor Airbyte ale acelui client. Altfel inspecția clientului A ar lista și conturile clientului B (vizibile doar pentru `agency_admin`, dar tot nu e cazul).

## 3. În aplicație

1. Pagina oricărui site al clientului → cardul **Airbyte (Paid Ads)** → **Conectează**.
2. **Pasul 1, destinația clientului:** un nume (etichetă), connection string-ul și, la nevoie, certificatul CA:
   `postgresql://analyzator_ro:<parolă>@airbyte-db.adsymphony.ro:5432/airbyte?sslmode=require`
   Parola trebuie codată în URL dacă are caractere speciale (`@` → `%40`, `:` → `%3A`, `/` → `%2F`). Câmpul se golește după salvare, iar connection string-ul nu se mai poate citi din aplicație.
3. **Inspectează datele:** vezi tabelele găsite pe platforme (raport sau catalog de nume), conturile, perioada, ultima sincronizare Airbyte și metricile. Ai 30 de inspecții pe zi per client.
4. **Pasul 2, conturile site-ului:** alegi contul din listă (propus după numele site-ului) → **Adaugă conexiunea**. Formularul rămâne pentru următorul cont (de exemplu Meta și Google Ads pe același site). Manual: `meta_ads:<ID>`, `google_ads:<ID fără cratime>`, `tiktok_ads:<ID>`.
5. Celelalte site-uri ale clientului refolosesc destinația. La ele faci doar pasul 2.

Conexiunea contului apare cu „Colectare neactivă” până la etapa 2.

## Când ceva nu merge

| Mesaj (rezultat) | Ce faci |
|---|---|
| Conexiunea trebuie să fie criptată (`tls_required`) | Scoate `sslmode=disable/prefer`; folosește `require`. |
| Folosește numele de domeniu (`invalid_dsn`) | Pune numele serverului, nu IP-ul (pasul 1.1). |
| Adresa serverului e internă / privată (`host_not_allowed`) | Numele trebuie să se rezolve doar în IP-uri publice. |
| Conexiunea TLS a eșuat (`tls_failed`) | TLS e oprit în Postgres, certificatul nu are numele în `subjectAltName`, a expirat, sau e emis de un CA neatașat. Verifică: `openssl s_client -starttls postgres -connect airbyte-db.adsymphony.ro:5432 -servername airbyte-db.adsymphony.ro`. |
| Serverul a refuzat utilizatorul sau parola (`auth_failed`) | Parola, codarea ei în URL, sau lipsa regulii `hostssl` din `pg_hba.conf`. |
| Serverul nu răspunde pe portul… (`unreachable`, `timeout`) | Firewall, port închis, Postgres ascultă doar pe localhost (`listen_addresses`). |
| Utilizatorul nu vede niciun tabel… (`ok` fără tabele) | Lipsesc `grant usage` / `grant select` pe schemele Airbyte. |
| Tabelul nu a răspuns la timp | Tabelul e foarte mare (de obicei rapoartele pe anunț). Restul se citește; conturile apar din celelalte tabele. |
| Limita de 30 de inspecții (`budget_exhausted`) | Revino mâine (ziua UTC). |
