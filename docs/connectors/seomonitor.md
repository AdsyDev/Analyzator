# SEOmonitor

**Ce aduce:** pentru fiecare brand: rankuri zilnice desktop și mobile, visibility, prezența brandului în răspunsurile AI (ChatGPT, Gemini, Perplexity) și în Google AI Overview, citări și concurenți. Ultimele 35 de zile se reimportă la fiecare rulare.

**Timp:** ~20 de minute per client, plus maparea grupurilor.

**Ce se face unde:**
- tokenul se obține din SEOmonitor și se pune **din aplicație** (Administrare → Surse → „Conturile clientului”);
- maparea grupurilor pe branduri se face deocamdată din **SQL**;
- testul înseamnă o **rulare manuală** (nu există buton de test).

**De ce e diferit de Clarity:** un cont SEOmonitor acoperă **toate brandurile unui client**. Brandurile se despart prin grupurile de keywords din SEOmonitor, de aceea conexiunea e la nivel de client, nu de brand: apare în Surse, la „Conturile clientului”, pentru oricare brand al clientului.

## 1. Obține tokenul și ID-ul companiei

1. În SEOmonitor: **Account Settings → Edit Profile → API Token**. Copiază tokenul. Tokenul e legat de utilizatorul tău; ideal folosește un utilizator dedicat agenției, ca să nu se oprească colectarea când pleacă cineva.
2. **ID-ul companiei** (`company_id`): îl afli de la SEOmonitor sau din contul tău. Analyzator îl folosește doar ca etichetă a conexiunii (unică per client); colectarea vede toate campaniile la care are acces tokenul.
3. Notează, pentru fiecare campanie a clientului, **ID-ul campaniei** și **grupurile de keywords** (ID-ul fiecărui grup). Le găsești în Rank Tracker → grupuri. Echipa tehnică le poate lista și prin API, la cerere.

## 2. Conectează contul (din aplicație)

1. Administrare → **Surse** (cu oricare brand al clientului ales sus) → **„Conturile clientului”** → cardul **SEOmonitor**.
2. Completează **ID-ul companiei** și **tokenul**, apoi **Salvează**. Tokenul nu se mai afișează după salvare.
3. Pentru un token nou (rotire): același card → „Rotește tokenul”.

Pentru maparea de la pasul 3 îți trebuie ID-ul clientului și ID-ul conexiunii:

```sql
select t.id as tenant_id, t.name, c.id as id_conexiune
from public.tenants t
join public.source_connections c on c.tenant_id = t.id and c.provider = 'seomonitor' and c.brand_id is null
order by t.name;
```

## 3. Mapează grupurile pe branduri (SQL)

Fără mapare **nu se atribuie nimic** niciunui brand. Fiecare grup SEOmonitor primește un tip:

- **`brand`**: grupul aparține unui brand, cu `brand_type`:
  - `branded`: keywords cu numele brandului;
  - `nonbranded`: restul.
  
  Cel mult un grup per brand are `is_primary_visibility = true`: din el vine cifra principală de visibility.
- **`multi_brand`**: grupul amestecă branduri; nu se atribuie automat.
- **`excluded`**: ignorat intenționat.

Afli ID-urile brandurilor:

```sql
select id, slug, name from public.brands where tenant_id = '<tenant_id>' order by name;
```

Adaugi maparea (un rând per grup; `version` = 1 la prima mapare):

```sql
insert into public.seomonitor_group_mappings
  (tenant_id, source_id, campaign_id, group_id, version, effective_from, mapping_kind, brand_id, brand_type, is_primary_visibility, note)
values
  ('<tenant_id>', '<id-conexiune>', '<campaign_id>', '<group_id>', 1, current_date, 'brand', '<brand_id>', 'branded', true,  'Brand X - branded'),
  ('<tenant_id>', '<id-conexiune>', '<campaign_id>', '<group_id>', 1, current_date, 'brand', '<brand_id>', 'nonbranded', false, 'Brand X - nonbranded'),
  ('<tenant_id>', '<id-conexiune>', '<campaign_id>', '<group_id>', 1, current_date, 'excluded', null, null, false, 'Grup de test');
```

**Maparea nu se editează.** O schimbare înseamnă un rând nou pentru același grup, cu `version` mai mare și `effective_from` = data de la care se aplică. Istoricul rămâne.

Maparea curentă apare în Administrare → **Configurare** → „Grupuri SEOmonitor → brand”.

## 4. Testează: rulare manuală

GitHub → Actions → **seomonitor-weekly** → Run workflow. Durează câteva minute.

Verifică în Administrare → Surse (pe fiecare brand mapat) → „Istoricul sincronizărilor”: câte o rulare SEOmonitor per brand.

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
| `campaign_not_found` | Campania nu mai e urmărită în SEOmonitor | Verifică Tracked Campaigns. |
| Grup în coada de verificare | Grup nou, nemapat, sau `multi_brand` | Mapează-l (pasul 3). |
| 429 | Limita SEOmonitor (10 cereri/secundă, 10.000/zi) | Rularea reîncearcă singură după 1, 5, 15 minute. |
