# Seturi de date de care are nevoie interfața (UI-3, UI-4)

Ecranele **AI Visibility**, **SEO și Search**, **Trafic și conversii**, **Paid Media** și **Social** citesc, în afara metricilor din registru, liste și agregate pentru care **nu există încă un contract de server** (`docs/contracts/` are doar `metric-response.md` și `clarity.md`, iar tabelele `ai_answers`, `keywords`, `rank_observations` din spec cap. 25 nu sunt în baza de date). Tipurile din `apps/web/src/contracts/ai.ts`, `search.ts`, `traffic.ts`, `paid.ts` și `social.ts` sunt cerințele UI-ului, nu un contract: se aliniază la cel real când există, la fel cum s-a făcut cu `MetricResponse`.

Interfețele sunt `AiVisibilityProvider` și `SearchProvider` (`contracts/providers.ts`). Providerul `supabase` întoarce `not_connected` cu motiv pentru toate; providerul `fixtures` (doar previzualizare) generează date fictive din `tests/fixtures/ui/ai.json` și `search.json`.

## Reguli pe care contractul de server trebuie să le păstreze

- **Fără formule în UI.** Ratele, numărătorii, clasificările și variațiile vin calculate. Textul răspunsului AI vine **segmentat** de server (text, brand, citare), UI-ul nu detectează branduri.
- **Stări distincte** (spec 2.2). Un răspuns are `outcome`: `recommended`, `mentioned`, `not_mentioned` (valide), `refused`, `error`, `not_collected`. Ultimele trei nu intră în numitorul niciunei rate și nu sunt „brand absent".
- **`null` ≠ 0.** Rank absent e `null` („Fără rank", nu 100); o celulă de matrice fără răspunsuri valide are `value: null`; `key_events: null` înseamnă „maparea GA4 nu e validată".
- **Reproductibilitate** (spec cap. 13, acceptare): `numerator` și `denominator` ale fiecărei celule din matrice, `valid_answers` și `total_answers` ale fiecărui engine permit refacerea ratei din răspunsurile afișate. Fixtures sunt testate pe asta.
- **URL-uri.** Citările au `url: string | null`; UI-ul le validează (`lib/safeUrl.ts`: doar http/https, fără credențiale) înainte de a deveni link, cu `rel="noopener noreferrer"`.
- **Acces.** Toate cererile primesc `brandId` și se verifică pe server (RLS); UI-ul nu face cereri pentru un brand din afara listei permise.

## AI Visibility

| Cerere | Răspuns | Note |
|---|---|---|
| `groups(brandId)` | `string[]` | Opțiunile filtrului „grup" (topicuri); filtru dinamic, cheia `group` din URL. |
| `engines(ctx, filters)` | `AiEngineStat[]` | `mention_rate` (%), `delta_pp`, `valid_answers`, `total_answers`, `status`. Respectă doar filtrul `group`. |
| `trends(ctx, filters)` | `AiEngineTrend[]` | Serie zilnică pe engine; zilele necolectate `null`. Marcajele de schimbare de panel/metodologie (spec) nu sunt încă în contract. |
| `topicMatrix(ctx, filters)` | `AiTopicMatrix` | `entities` (brand + competitorii setului versionat), `topics` (`n`, `coverage` 0-1), `cells[topic][entity]` cu `value`, `numerator`, `denominator`, `status`. |
| `citedSources(ctx, filters)` | `AiCitedSource[]` | `domain`, `kind` (owned / third_party), `count` în răspunsuri valide, `brand_id`. |
| `answers(ctx, filters, page)` | `Page<AiAnswerSummary>` | Întrebare, engine, grup, `collected_at`, `outcome`, `pv_flag`. |
| `answer(brandId, id)` | `AiAnswerDetail` | `segments`, `citations`, `entities_present/recommended`, `collection_note` (de ex. clarificarea rutei „Gemini AI Mode"). Gol pentru `refused`, `error`, `not_collected`. |

Filtrele ecranului: `engine` (`chatgpt`, `gemini`, `perplexity`, `aio`) și `group`, ambele în URL.

## SEO și Search

| Cerere | Răspuns | Note |
|---|---|---|
| `keywords(ctx, {keywordType})` | `SearchKeyword[]` | Lista de mărime de pilot; sortarea și paginarea sunt în UI. `rank_*` și `change_mobile` pot fi `null`; `competitor` cu etichetă și poziție; `shared` pentru URL comun mai multor branduri. |
| `landingPages(ctx)` | `LandingPage[]` | `clicks`, `impressions`, `ctr` (calculat de server), `position`, `key_events` (`null` dacă maparea nu e validată), `shared`. |
| `contentGaps(ctx)` | `ContentGap[]` | Keyword, volum, competitor și poziție. |

Filtrul ecranului: `kw` (`brand`, `nonbrand`), în URL. KPI-urile vin din registru (`gsc_*`, `seomonitor_*`).

## Ce lipsește din registrul de metrici

Cheile `ai_mention_rate`, `ai_recommendation_rate`, `ai_owned_citation_rate`, `ai_sov`, `ai_valid_answers` nu sunt în `metric_definitions`. Cardurile KPI ale paginii AI arată „Sursă neconectată", fără definiție inventată, până intră în registru (cu pragurile AI din spec: 50 de răspunsuri, acoperire minimă 80%).

---

# UI-4: Trafic și conversii, Paid Media, Social

Interfețele sunt `TrafficProvider`, `PaidProvider` și `SocialProvider`. Aceleași reguli ca mai sus (fără formule în UI, `null` ≠ 0, acces verificat pe server). În plus, pentru bani: **moneda vine din sursă și se afișează lângă valoare**, fără conversii (spec 2.3). Registrul nu are unitate monetară (`currency`); KPI-urile Paid nu sunt metrici din registru.

## Trafic și conversii

KPI-urile GA4 vin din registru (`ga4_sessions`, `ga4_active_users`, `ga4_engaged_sessions`, `ga4_key_events`). `ga4_engagement_rate` nu e în registru: cardul rămâne „Sursă neconectată" (rata nu se calculează în UI din două metrici).

| Cerere | Răspuns | Note |
|---|---|---|
| `channels(ctx, device)` | `TrafficChannels` | Pe grup de canale GA4: `sessions`, `share_pct` (cota în totalul filtrat), `change_pct` (relativă, în %), `engagement_rate`, `key_events`. Filtrul `device` (`desktop`, `mobile`, `tablet`) se aplică doar canalelor; KPI-urile rămân pe toate device-urile (UI-ul o spune explicit). |
| `aiReferrals(ctx)` | `AiReferrals` | Surse cu `sessions`, `key_events`, `conversion_rate` (calculată de server); `rules_version` și `rules_effective_from` (regulile sunt versionate, spec cap. 16). |
| `clarityDevices(ctx)` | `ClarityDevices` | Defalcarea pe device pentru cele patru metrici `clarity_*`. Coloana „Toate" vine din registru; `clarity_daily` are dimensiunea `device`, dar view-ul de observații o exclude, deci defalcarea cere un view nou. |
| `trackingQuality(ctx)` | `TrackingQuality` | Verificări cu `status` (`ok`, `warning`, `problem`, `unknown`), titlu și notă, plus `checked_at`. |

Starea sincronizării Clarity (bannerul „Sincronizarea Clarity are probleme") se citește din `SourcesProvider.statuses`, nu dintr-o cerere nouă.

## Paid Media

`summary` e poarta paginii: `not_connected` = niciun import pentru brand; pagina arată „Sursă neconectată" cu acțiunea „Importă CSV" (intrare în Administrare → Surse, doar `agency_admin`).

| Cerere | Răspuns | Note |
|---|---|---|
| `summary(ctx, {platform})` | `PaidSummary` | Șapte KPI (`spend`, `impressions`, `clicks`, `ctr`, `cpc`, `conversions`, `cpa`), fiecare cu `definition` (tooltip), `change` (relativă în %, la CTR în p.p.), `status`; moneda, `source_timezone`, `imported_at`, `data_as_of`. CTR, CPC, CPA din totaluri, nu medii de rate; CPA doar pentru campaniile cu conversii (awareness fără). |
| `budget(ctx)` | `PaidBudget` | `approved_budget` (încărcat de agenție), `spent`, zile trecute/planificate, `spend_pct` și `time_pct` calculate de server. UI-ul arată cele două procente fără verdict. |
| `series(ctx, {platform})` | `PaidSeries` | Spend și rezultate separate, cu zile `null` unde nu există import. |
| `rows(ctx, {platform})` | `PaidRow[]` | Câte un rând pe zi, platformă, cont, campanie, cu `attribution_window`. `conversions` și `cpa` sunt `null` unde nu se aplică. |

Nu sunt în UI (nu au contract): „Observații" (modificări de campanie notate de echipă) și „Creatives proprii" (după lansare; designul cere explicit fără galerie).

## Social propriu

`summary` e poarta paginii, ca la Paid (sursa: Planable).

| Cerere | Răspuns | Note |
|---|---|---|
| `summary(ctx, filters)` | `SocialSummary` | Cinci KPI (`posts`, `followers`, `net_growth`, `interactions`, `reach`) cu `definition`, `status` și `note`. Reach din raportul pe interval (nu se însumează); followers la sfârșit de interval. |
| `posts(ctx, filters)` | `SocialPost[]` | `mature` (fereastra comună de maturizare, 7 zile) decisă de server; `reach` și `interactions` `null` când lipsesc datele de performanță; `permalink` validat în UI. |
| `groups(ctx, filters)` | `SocialGroups` | Pe topic și pe format: `n`, `posts_per_week`, `median_interactions`. Mediana include doar postările mature cu date; perioada de observare e în răspuns. |
| `calendar(ctx, filters)` | `SocialCalendarItem[]` | Publicări observate; postările fără analytics rămân, cu `has_performance: false`. |
| `competitors(ctx)` | `SocialCompetitor[]` | Doar date publice (cadence, followers, interacțiuni pe postare); fără reach privat. |

Filtrele ecranului în URL: `platform` (`facebook`, `instagram`, `linkedin`) și `format` (`image`, `video`, `carousel`, `story`). La Paid: `platform` (`google_ads`, `meta_ads`).

## Listening și Concurență (UI-5)

### Listening — `MentionsProvider`

| Metodă | Răspuns | Cerință |
|---|---|---|
| `list(ctx, query)` | `Page<Mention>` | Filtre `sentiment` (`positive`, `neutral`, `negative`, `unreviewed`) și `source`. `sentiment: null` + `reviewed_by: null` = nerevizuit; nu se presupune neutru. |
| `sources(brandId)` | `string[]` | Sursele distincte ale brandului, independent de perioadă, pentru filtrul „Sursă". |
| `sentiment(ctx)` | `SentimentDistribution` | `total` = doar mențiunile revizuite; `unreviewed` separat; `shares` în procente calculate de provider (UI-ul nu împarte). |
| `pvPreview` / `pvFlag` | snapshot / marcaj | Starea „marcat" vine din răspunsul `list`, deci persistă la reîncărcare. |
| `pvLog(ctx)` | `PvLogEntry[]` | Doar `agency_admin` (brief cap. 6, spec cap. 28); UI-ul nu apelează metoda pentru alte roluri. Serverul trebuie să refuze oricum. |

KPI-urile `listening_mentions`, `listening_sov`, `listening_negative_share` nu sunt în registru: carduri `not_connected`, fără definiție.

### Concurență — `CompetitionProvider`

| Metodă | Răspuns | Cerință |
|---|---|---|
| `matrix(ctx)` | `CompetitionMatrix` | Entități (brand + competitori validați), grupuri AI / SEO / Social public / Listening, `set_version`, `effective_from`, `data_as_of`. Fiecare celulă are `status`, `coverage` și `reason`; N/A cu motiv, niciodată zero. |
| `gaps(ctx)` | `CompetitionGap[]` | Subiecte AI și căutări SEO în care apare un competitor și brandul lipsește sau e mai slab. |

Filtre Listening în URL: `sentiment`, `source`.

## Administrare → Surse și Analize (UI-6, seria 1)

### Surse — `SourcesProvider` (implementare reală, prin sesiunea utilizatorului / RLS)

| Metodă | Citește | Note |
|---|---|---|
| `connections(brandId)` | `source_connections` (coloanele publice) + `provider_api_calls` (ziua UTC curentă) | `calls_today` = suma pe conexiune. Fără `vault_secret_id`. |
| `syncRuns(brandId)` | `sync_runs`, ultimele 50 | `provider` = `sync_runs.source` (poate fi o sursă fără etichetă). `rows` e null cât timp jobul e în coadă. Mesajul de eroare = primul `code`/`message` din `errors`. |
| `statuses(brandId)` | derivat din conexiuni, `sync_runs`, `import_batches` | Vezi regulile de mai jos. |
| `createConnection` | insert în `source_connections` | `tenant_id` se ia din brand. Duplicat (23505) și lipsa dreptului (42501) au mesaje proprii. |
| `setToken`, `validate` | Edge Function `source-credentials` | Tokenul pleacă doar în corpul cererii și nu apare în rezultat. Erorile funcției (`{ error }`) se afișează ca atare. |

Reguli de derivare a stării (clasificare, nu metrică): fără conexiune → `not_connected`; token `invalid` → `error`; ultima sincronizare `failed` → `error` (cu ultimele date reușite păstrate); `partial` → `partial`; reușită → `connected`; conexiune fără nicio sincronizare cu date → `not_connected` (tokenul singur nu înseamnă date). `data_as_of` = `period_end` al ultimei rulări cu date, `imported_at` = `finished_at`. `stale` nu se derivă: **nu există o politică de prospețime aprobată**. Import CSV: `connected` dacă există un `import_batches` cu status `imported`.

`BrandsProvider.list` și `competitorSet` sunt acum reale (`brands`, `competitor_sets` + `competitor_set_members`; versiunea efectivă = cea mai mare `effective_from <= azi`, Europe/Bucharest).

### Analize și acțiuni — `InsightsProvider`

Doar citire. Nu există tabele pentru analize și acțiuni în `supabase/migrations`, deci providerul `supabase` rămâne `not_connected`. Ecranul funcționează pe fixtures în previzualizare. Server: clientul primește doar `published` (RLS); acțiunile vin împreună cu analiza lor.

## Administrare → Utilizatori și Configurare (UI-6, seria 2)

### Utilizatori — `UsersProvider` (real, prin sesiunea utilizatorului / RLS)

| Metodă | Tabele | Note |
|---|---|---|
| `people()` | `memberships` (+ `tenants.name`), `brand_access` | RLS: `agency_admin` vede toți membrii tenantului. `name` și `email` sunt **null**: trăiesc doar în `auth.users`, ilizibil din client. UI-ul afișează „Utilizator <id scurt>". |
| `setRole` | `update memberships set role` | Granturile permit `role` și `revoked_at`. Propriul rând e refuzat în provider și dezactivat în UI (nu te poți bloca singur). |
| `setMembershipActive` | `update memberships set revoked_at` | Revocarea nu șterge. |
| `setBrandAccess` | `brand_access` (insert cu `granted_by = utilizatorul curent` sau update `revoked_at`) | Unic pe (tenant, brand, user): un acces revocat se restabilește, nu se reinserează. Persoana trebuie să aibă membership în tenant (FK). |

**Cerințe server rămase:** (1) o sursă citibilă pentru nume și email (view/RPC de profil, pe tenant); (2) o funcție de invitare care creează utilizatorul, membership-ul și accesul într-un singur pas; (3) protecția „ultimul `agency_admin`" în server. Până atunci, „Trimite invitație" spune că nu e disponibilă.

### Configurare — `ConfigProvider`

| Metodă | Tabele | Note |
|---|---|---|
| `competitorVersions(brandId)` | `competitor_sets` + `competitor_set_members` | Citire. Versiunea în vigoare = cea mai mare `effective_from <= azi`. **Scriere disponibilă server-side** (UI încă nelegat): vezi „Versiune nouă” mai jos. |
| `aliases(brandId)` | — | Nu există tabel: `not_connected` cu motiv. |
| `seomonitorMappings()` | `seomonitor_group_mappings` | Doar citire; ultima versiune în vigoare per (campanie, grup). **Depinde de migrația `20261008120000_seomonitor.sql`, încă necomisă în repo la data scrierii.** |

**Versiune nouă a setului de competitori — funcția `create_competitor_set_version`** (migrația `20261009000100_competitor_set_version_fn.sql`; contractul complet și erorile în `docs/security-tests.md`, E4).

```ts
const { data, error } = await supabase.rpc('create_competitor_set_version', {
  p_brand_id: brandId,                 // uuid
  p_effective_from: '2026-11-01',      // ISO, ≥ azi (Europe/Bucharest), unică per brand
  p_note: 'Intră Competitor X',        // text | null, max 1000
  p_members: [{ name: 'Alfa', domain: 'alfa.ro', color: '#A1B2C3' }], // 1–10; domain și color opționale
})
// data: [{ competitor_set_id, version, effective_from, member_count }]
```

- Tranzacție unică: set + membri + audit, sau nimic. Rolul (agency_admin sau strategist cu acces la brand) este verificat în funcție și de RLS; UI-ul poate ascunde formularul pentru ceilalți, dar nu se bazează pe asta.
- `error.message` este în română și se poate afișa direct; `error.code`: `42501` (drept), `22023` (validare, mesaje „Membrul N: …”), `23505` (dată deja folosită).
- Domeniul se stochează normalizat (fără schemă și cale); formularul poate afișa valoarea normalizată din citirea ulterioară.
- Formularul „Versiune nouă” cu previzualizarea diferențelor față de versiunea curentă rămâne un task separat în `apps/web`.
