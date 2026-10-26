# Meta Ads (Facebook și Instagram)

**Ce aduce:** pe zi și pe reclamă: **cost**, **afișări** și **clickuri**, în moneda contului de ads. Ultimele 35 de zile se reimportă la fiecare rulare. Conversiile nu se aduc încă automat: depind de obiectivul fiecărei campanii, iar acțiunea de conversie se alege per brand (vezi „Prima rulare”).

**Timp:**
- ~20 de minute **o singură dată** pentru agenție (aplicația și system user-ul);
- apoi ~5 minute per client și ~2 minute per brand.

**Totul din aplicație**, cu buton de test.

**Ai nevoie de:** rol de **admin** în Business Manager-ul agenției, iar conturile de ads ale clienților trebuie să fie partajate cu acest Business Manager.

## 1. Aplicația și system user-ul (o singură dată, în Business Manager-ul agenției)

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → tip **Business** → leag-o de Business Manager-ul agenției. Nu are nevoie de App Review: citim doar conturile pe care Business Manager-ul tău le are deja.
2. În aplicație adaugă produsul **Marketing API**.
3. [business.facebook.com](https://business.facebook.com) → **Business Settings → Users → System users → Add**:
   - nume `analyzator`;
   - rol **Employee** (nu e nevoie de Admin).
4. Pe system user: **Assign assets → Ad accounts**. Bifează conturile de ads ale clienților, cu permisiunea **View performance**, sau „Manage”, dacă „View” nu e disponibil.
5. Tot pe system user: **Generate new token**:
   - aplicația de la pasul 1;
   - permisiunea **`ads_read`**;
   - expirare **Never**.

   Copiază tokenul (începe de obicei cu `EAA`). E o parolă: nu-l trimite pe email sau chat.

Pentru un cont de ads nou, revii doar la pasul 4. Tokenul rămâne același.

## 2. Salvează tokenul în Analyzator (o dată per client)

1. Pagina site-ului (Administrare → Clienți și site-uri → **Editează și surse**) al oricărui site al clientului → cardul **Meta Ads** → **Conectează** → pasul 1.
2. **Business Manager** (o etichetă) și **tokenul** → **Salvează**.
3. **Testează conexiunea:**
   - verde = Meta acceptă tokenul;
   - roșu = token greșit sau expirat: generează altul (pasul 1.5) și „Rotește tokenul”.

Același token poate servi mai mulți clienți: îl salvezi pe fiecare client.

## 3. Leagă fiecare brand de contul lui de ads

1. ID-ul contului apare în Ads Manager, în selectorul de cont sau în adresă (`act=1234567890`), și în Business Settings → Accounts → Ad accounts.
2. Analyzator: pagina site-ului → cardul **Meta Ads** → pasul 2 → alegi contul de ads din lista conturilor atribuite system user-ului. Manual, dacă e nevoie: `act_1234567890`.
3. Conexiunea site-ului arată accesul (D-25): „Neverificat” până la prima colectare, apoi „Acces confirmat” (cu data și rândurile) sau „Acces refuzat” (contul nu e atribuit system user-ului: pasul 1.4).

## 4. Pornește colectarea

- **Manual:** GitHub → Actions → **meta-weekly** → Run workflow.
- **Automat:** marțea la 04:00 UTC, după ce `CONNECTOR_META_ENABLED = true`.

Verifici în pagina site-ului → „Istoricul sincronizărilor”: o rulare **Meta Ads** per site. Pe pagina **Paid Media**, cifrele apar când ecranul citește datele (legarea datelor la ecrane e o etapă separată).

## Prima rulare

- Compară costul total pe o săptămână cu Ads Manager, pe același cont și același interval. Diferențele mici pot veni din fusul orar.
- **Conversii:** stabilește cu echipa, pe fiecare brand, ce acțiune contează (de ex. `offsite_conversion.fb_pixel_purchase` sau `lead`). Până atunci, CPA rămâne „indisponibil”, nu zero.

## Probleme frecvente

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| `not_connected`: „token Meta neconfigurat” | Lipsește tokenul clientului | Pasul 2. |
| `access_denied` (cod 190) | Token expirat, revocat sau system user șters | Token nou (pasul 1.5), „Rotește tokenul”. |
| `permission_denied` (cod 200) pe un brand; conexiunea arată „Acces refuzat” | Contul de ads nu e atribuit system user-ului | Pasul 1.4 pentru acel cont. |
| `invalid_account_id` | ID scris greșit | Forma `act_` + cifre. |
| `rate_limited` | Limită Meta de utilizare | Rularea reîncearcă singură; dacă persistă, rulează mai târziu. |
| Cost diferit față de Ads Manager | Fus orar sau interval diferit | Contul are fusul lui; Analyzator folosește fusul contului. |
