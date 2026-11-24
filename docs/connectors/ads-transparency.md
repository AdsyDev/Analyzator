# Google Ads Transparency (reclamele competitorilor)

**Ce aduce, pentru fiecare brand:** reclamele advertiserilor configurați pentru competitorii lui, afișate în România, cu formatul, perioada de afișare declarată de Google și linkul spre pagina reclamei. Apar în **Competiție**: rândurile „Reclame Google” din matrice și lista „Reclamele competitorilor”.

**Nu aduce:** buget, clickuri, reach sau performanța reclamelor competitorilor (Google nu le publică și nu le estimăm).

**Timp:** ~15 minute o dată (proiectul Google Cloud), plus ~5 minute per competitor (ID-ul advertiserului). Contract tehnic: `docs/contracts/ads-transparency.md`.

## 1. Proiectul Google Cloud care plătește interogarea (o dată per client)

Datele vin din setul public BigQuery al Google. Interogarea o plătește proiectul service account-ului pe care clientul îl folosește deja pentru GA4 și Search Console ([google.md](google.md)).

1. În Google Cloud Console, proiectul din câmpul `project_id` al fișierului JSON: **APIs & Services → Enable APIs** → **BigQuery API**.
2. **IAM** → service account-ul (adresa `…@….iam.gserviceaccount.com`) → rolul **BigQuery Job User**.
3. Primul 1 TB procesat pe lună e gratuit și se poate folosi fără facturare activă (documentația BigQuery). Colectarea citește cel mult `ADS_TRANSPARENCY_MAX_GB` (implicit 100 GB) pe rulare, o dată pe săptămână; facturarea e necesară doar peste 1 TB pe lună în proiect.

Dacă alt proiect trebuie să plătească, setează în GitHub variabila `ADS_TRANSPARENCY_BILLING_PROJECT` = ID-ul proiectului (service account-ul are nevoie de rol acolo).

## 2. ID-ul de advertiser al fiecărui competitor

1. Deschide [adstransparency.google.com](https://adstransparency.google.com), regiunea **România**, caută competitorul.
2. Deschide pagina advertiserului. Adresa conține `/advertiser/AR…`: ID-ul e partea `AR` urmată de cifre.
3. Un competitor poate avea mai mulți advertiseri (de ex. distribuitorul și producătorul): notează-i pe toți, cel mult 10.

## 3. Pune ID-urile în setul de competitori

Setul de competitori e versionat: ID-urile intră într-o **versiune nouă**, de azi sau din viitor, creată de echipa tehnică cu `create_competitor_set_version` (contractul în `docs/security-tests.md`, E4). Fiecare competitor primește `ads_advertiser_ids`, de exemplu:

```json
[{ "name": "Prostamol", "domain": "prostamol.ro", "ads_advertiser_ids": ["AR01234567890123456789"] }]
```

În aplicație, Administrare → **Configurare** → „Competitori” arată, pe fiecare competitor, ID-urile salvate.

## 4. Pornește colectarea

- **Manual:** GitHub → Actions → **ads-transparency-weekly** → Run workflow.
- **Automat:** marțea la 05:00 UTC, după ce variabila `CONNECTOR_ADS_TRANSPARENCY_ENABLED = true`.

## 5. Verifică

Pagina site-ului → „Istoricul sincronizărilor”: rularea `ads_transparency`, cu status, rânduri și nota „BigQuery: N GB facturați”.

## Probleme frecvente

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| `not_connected`: „service account Google neconfigurat” | Clientul nu are cheia Google sau e marcată invalidă | [google.md](google.md), pasul cu fișierul JSON. |
| `accessDenied` / „BigQuery Job User” | Rolul lipsește sau API-ul BigQuery e oprit | Pasul 1. |
| `bytesBilledLimitExceeded` | Interogarea ar citi peste plafon | Crește `ADS_TRANSPARENCY_MAX_GB` doar după ce verifici costul; anunță echipa tehnică. |
| `schema_changed` | Tabelul Google nu mai are un câmp obligatoriu; mesajul listează câmpurile găsite | Anunță echipa tehnică cu mesajul exact. |
| Notă „câmpuri absente din creative_stats” | Unele câmpuri opționale (de ex. linkul reclamei) nu există; valorile lor rămân goale | Nimic urgent; anunță echipa tehnică. |
| Competitor „N/A” în matrice | Nu are ID de advertiser în setul în vigoare | Pașii 2 și 3. |
| Celulă „parțial” | Un advertiser nou nu a fost încă interogat, sau perioada trece de ultima colectare | Rulează colectarea. |
