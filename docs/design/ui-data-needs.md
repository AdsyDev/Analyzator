# Seturi de date de care are nevoie interfața (UI-3)

Ecranele **AI Visibility** și **SEO și Search** citesc, în afara metricilor din registru, liste și agregate pentru care **nu există încă un contract de server** (`docs/contracts/` are doar `metric-response.md` și `clarity.md`, iar tabelele `ai_answers`, `keywords`, `rank_observations` din spec cap. 25 nu sunt în baza de date). Tipurile din `apps/web/src/contracts/ai.ts` și `search.ts` sunt cerințele UI-ului, nu un contract: se aliniază la cel real când există, la fel cum s-a făcut cu `MetricResponse`.

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
