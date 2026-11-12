# AdSy AI: controale și chat pe dovezi

Etapa 4, prima felie (deciziile M din `docs/decisions.md`). Migrația `20261112090000_stage4_adsy_ai_controls_chat.sql`, funcția server `supabase/functions/adsy-ai`. Specificația: `docs/product/spec.md`, cap. 23.

Forma apelului către model e cea din SDK-ul oficial `@google/genai` (v3.1.0), confirmată pe un cont real la 11 nov. 2026. Până când serverul nu are cheia, AdSy AI răspunde „neconfigurat” și nu pleacă nicio cerere.

## Controale

Trei controale pe brand: **chat** (întrebări către AdSy AI), **generare** (ciorne de analize scrise de AdSy AI) și **afișare** (conținutul generat e vizibil).

| Tabel | Ce ține | Cine scrie | Cine citește |
|---|---|---|---|
| `ai_brand_policies` | Politica brandului: cele trei controale și `monthly_token_cap` (implicit 2.000.000) | Doar `agency_admin`; fără `DELETE`; inserarea și schimbarea se auditează | Oricine are acces la brand |
| `ai_user_preferences` | Preferința personală pe brand: `chat_enabled`, `display_enabled` | Fiecare utilizator, doar rândul lui | Doar utilizatorul |
| `ai_requests` | Jurnalul cererilor către model și răspunsul validat (cache) | Doar funcția server (service role) | Utilizatorul își vede cererile; `agency_admin` le vede pe toate ale brandului |

Reguli:

- **Fără politică salvată, toate trei sunt oprite.** AI-ul pornește doar printr-o decizie explicită a administratorului.
- **Politica bate preferința.** Preferința poate doar să restrângă; generarea nu are preferință personală.
- Cu totul oprit, dashboardurile și analizele scrise de echipă rămân neschimbate.

### `brand_ai_settings(p_brand_id)`

Regimul E8 (`SECURITY INVOKER`, `has_brand_access` în corp).

```json
{
  "tenant_id": "…",
  "policy": { "chat": true, "generation": false, "display": true, "monthly_token_cap": 2000000, "updated_at": "…" },
  "preference": { "chat": true, "display": true },
  "effective": { "chat": true, "generation": false, "display": true },
  "can_edit_policy": false,
  "month_tokens": null
}
```

`effective` = politică ȘI preferință. `month_tokens` (tokenii brandului în luna curentă, Europe/Bucharest) e `null` pentru cine nu e `agency_admin`.

## Funcția server `adsy-ai`

`POST` cu sesiunea utilizatorului (`Authorization: Bearer …`).

| Acțiune | Corp | Răspuns |
|---|---|---|
| `status` | `{ action, brand_id }` | `{ configured, model_id, prompt_version }`; doar pentru cine are acces la brand |
| `chat` | `{ action, brand_id, question, period: { start, end }, comparison?: "previous" \| "year_ago" }` | `{ status, answer?, blocked_by?, cached?, model_id?, prompt_version?, request_id? }` |

Întrebarea are 3–1.000 de caractere; perioada, cel mult 400 de zile. Erori: `401` fără sesiune, `403` fără acces la brand, `400` cerere invalidă.

### Ordinea verificărilor (toate pe server)

1. Sesiunea, la GoTrue.
2. Accesul la brand și controalele, prin `brand_ai_settings` chemat **cu sesiunea utilizatorului**. Cu chatul oprit, funcția răspunde `ai_off` și se oprește: nu citește date și nu cheamă modelul.
3. Configurarea: `GEMINI_API_KEY` în mediul funcției; modelul are o valoare implicită, pe care `ADSY_AI_MODEL` o înlocuiește. Fără cheie: `not_configured`.
4. Contextul, citit tot cu sesiunea utilizatorului (RLS): `brand_metrics` pentru 18 metrici din registru (cifrele ajung la model cu cel mult două zecimale; verificarea le acceptă și pe cele exacte; un indicator în procente care are variație vine cu `absolute_change_unit: "puncte procentuale"`, după `docs/contracts/metric-response.md`), numele lor din `metric_definitions_current` și cel mult cinci analize **publicate** din `brand_insights`. Modelul vede doar ce vede utilizatorul. Nu primește mențiuni brute, răspunsuri AI brute, nume de autori, e-mailuri sau chei.
5. Cache: aceeași întrebare, pe aceleași date, cu același model și aceeași versiune de prompt întoarce răspunsul salvat, fără apel și fără tokeni.
6. Plafoane: tokenii lunii pe brand (`monthly_token_cap`) și 60 de cereri pe utilizator în 24 de ore. Depășire: `budget_exhausted`, respectiv `rate_limited`.
7. Un singur apel `generateContent`, fără unelte, cu răspuns JSON după schemă.
8. Verificarea răspunsului, apoi scrierea în `ai_requests`.

Cheia de service scrie și citește doar `ai_requests`, mereu cu `tenant_id` și `brand_id` în filtru sau în rând. Cheia modelului se trimite doar în antetul cererii către Google.

### Contractul răspunsului

Modelul întoarce `finding_type` (`answer`, `insufficient_evidence`, `out_of_scope`), `summary`, `evidence_ids`, `metric_keys`, `limitations`, `proposed_action`. Serverul adaugă `period` (cea cerută) și `requires_review: true` (mereu).

Un răspuns e `ok` doar dacă:

- JSON-ul respectă contractul;
- fiecare `evidence_id` există în contextul trimis (`metric:<cheie>` sau `insight:<id>`), deci e al acestui brand și al acestei perioade;
- fiecare cheie din `metric_keys` e printre dovezile citate (cu sau fără prefixul `metric:`);
- **fiecare număr din text** se regăsește în dovezile citate (valoare, valoare de comparație, variație absolută sau relativă, comparate la zecimalele scrise, cel mult patru), în întrebare, în anii ori lungimea perioadei sau în numele indicatorilor. Datele calendaristice sunt scoase din text înainte de verificare.
- **unitatea variației e cea din date**: variația absolută a unui indicator în procente e în puncte procentuale. Un text care o scrie ca procent („a crescut cu 5,24 %”, „5,24 la sută”, „5,24 procente”) e respins (`points_as_percent`), chiar dacă cifra e corectă. Nu se respinge un număr care e și procent adevărat într-o dovadă citată (valoarea unei rate, o variație relativă).

Altfel:

| `status` | Când | Ce primește utilizatorul |
|---|---|---|
| `insufficient_evidence` | Dovadă necunoscută, fără dovezi, număr nesusținut, variație în puncte procentuale scrisă ca procent, sau modelul spune că nu are date | Fără concluzie; doar `limitations`, dacă nici ele nu aduc cifre nesusținute |
| `out_of_scope` | Întrebarea nu e despre datele brandului | Fără concluzie |
| `rejected` | JSON în afara contractului | Fără text de la model |
| `model_error` | Apelul a eșuat sau a fost blocat; `code`: `auth`, `rate_limited`, `model_not_found`, `blocked`, `truncated`, `unavailable`, `invalid_response` | Fără detalii de la furnizor |

Motivul intern al respingerii (`rejection_reason`) rămâne în `ai_requests`.

### Cache și cost

`data_snapshot_id` = SHA-256 al contextului trimis modelului. `cache_key` = SHA-256 din tenant, brand, sarcină, `data_snapshot_id`, `model_id`, `prompt_version` și întrebarea normalizată. Căutarea în cache e mereu pe `tenant_id` și `brand_id`. Fiecare cerere are `prompt_tokens`, `output_tokens` (inclusiv tokenii de „gândire”) și `total_tokens`; cele din cache au zero.

`model_id` și `prompt_version` nu sunt fixate în cod pentru totdeauna: modelul vine din `ADSY_AI_MODEL` sau din valoarea implicită, iar versiunea promptului (`chat-v5` la chat, `insight-v3` la ciorne) se schimbă odată cu promptul și intră în cheia de cache.

## Ce pleacă spre furnizorul modelului

Numele brandului, perioada, valorile agregate ale celor 18 indicatori, textele analizelor publicate de echipă, fragmentele documentelor aprobate care potrivesc întrebarea și întrebarea utilizatorului. Nu pleacă: date personale, mențiuni sau răspunsuri AI brute, chei, identificatori de utilizator. Termenii de procesare ai furnizorului trebuie validați înainte de pornirea politicii pe un brand.

## Ciorne generate (a doua felie, deciziile O)

Migrația `20261112120000_stage4_generated_insights.sql`. Acțiunea `generate_insight`:

| Corp | Răspuns |
|---|---|
| `{ action, brand_id, period: { start, end }, comparison? }` | `{ status, insight_id?, existing?, cached?, model_id?, prompt_version?, request_id? }` |

`status`: `ok`, `insufficient_evidence`, `rejected`, `ai_off`, `not_configured`, `budget_exhausted`, `rate_limited`, `model_error`. La orice alt status decât `ok` nu se salvează nimic. Textul ciornei nu vine în răspuns: interfața îl citește din lista de analize.

Ordinea verificărilor:

1. Sesiunea, apoi `brand_ai_settings` cu sesiunea utilizatorului. `can_generate` fals (client): `403`. Politica fără generare sau fără afișare, ori preferința fără afișare: `ai_off`, fără nicio altă citire.
2. Configurarea, apoi contextul: aceiași 18 indicatori ca la chat, **fără** analizele anterioare. Fără niciun indicator cu valoare: `insufficient_evidence`, fără apel.
3. Cache pe `tenant_id`, `brand_id`, date, model și `insight-v3`: ciorna existentă se întoarce (`existing: true`); una ștearsă se reface din răspunsul salvat, cu o cerere nouă în jurnal, fără tokeni.
4. Plafoanele, apelul către model, verificarea (`verifyDraft`): contractul JSON, cele patru texte completate, dovezi care sunt indicatori din context, cel mult trei recomandări cu prioritate 1–3 și **fiecare cifră din orice text** regăsită în indicatorii citați, cu aceeași regulă de unitate ca la chat (o variație în puncte procentuale scrisă ca procent oprește ciorna, `points_as_percent`). Dovezile ciornei sunt indicatorii cu valoare ale căror cifre apar în text; fără niciunul, ciorna nu se salvează.
5. Jurnalul (`ai_requests`, `task = generate_insight`), apoi scrierea, **cu sesiunea utilizatorului**: `insights` (ciornă, `origin = adsy_ai`, `ai_request_id`), `evidence_links` (SEOmonitor cu `device = desktop`), `recommendations`. Dacă dovezile sau recomandările nu se pot scrie, ciorna se șterge.

Funcția nu trimite nimic la review și nu publică nimic. Fluxul de după e cel din `docs/contracts/insights.md`.

### Proveniența

| Câmp pe `insights` | Reguli |
|---|---|
| `origin` | `human` (implicit) sau `adsy_ai`. Nu se modifică după inserare, nici cu cheia de service |
| `ai_request_id` | Obligatoriu la `adsy_ai`, interzis altfel. La inserare, baza cere ca cererea să existe, să fie `generate_insight` cu `status = ok`, a aceluiași utilizator, brand și perioadă (`42501` altfel). O cerere produce o singură ciornă |

Versiunea nouă a unei analize generate (`supersedes_id`) moștenește ambele câmpuri, orice ar trimite clientul.

### Controlul „afișare”

`brand_insights` întoarce `origin` pe fiecare analiză și **omite analizele cu `origin = adsy_ai`** când afișarea efectivă e oprită: politica brandului (`display_enabled`, fals fără politică) ȘI preferința utilizatorului (`display_enabled`, adevărat fără preferință). Se aplică tuturor rolurilor și oricărui status. Analizele scrise de echipă nu sunt afectate. E un control de prezentare: RLS pe `insights` rămâne cel vechi.

`brand_ai_settings` întoarce în plus `can_generate` (rolurile care scriu analize pe brand).

## Modelul și erorile temporare

Modelul implicit e `gemini-3.5-flash-lite` (`DEFAULT_MODEL_ID` în `gemini.ts`, decizia O-9); `ADSY_AI_MODEL` îl înlocuiește. Fără `GEMINI_API_KEY`, funcția rămâne „neconfigurat”. O eroare temporară a furnizorului (500, 503, rețea, timeout de 25 s) se reîncearcă o singură dată; 429 și erorile de cheie nu.

## Documente aprobate (a treia felie, deciziile P)

Migrația `20261112150000_stage4_brand_documents.sql`.

| Tabel | Ce ține | Cine scrie | Cine citește |
|---|---|---|---|
| `brand_documents` | Titlu, `doc_type` (`product_info`, `claims`, `brand_guidelines`, `faq`, `other`), `product` (opțional), `country`, `language`, `version`, `owner` (cine răspunde la brand), `status`, `approved_at`, `approved_by`, `valid_from`, `valid_to` | `agency_admin`, `strategist`, `account`; se auditează | Echipa: toate. Clientul: doar `approved` |
| `brand_document_fragments` | `position`, `section_ref`, `content` (cel mult 4.000 de caractere; cel mult 400 pe document) și indexul de căutare | Aceiași, doar cât documentul e ciornă | Ca documentul |

Statusul are un singur drum, verificat de trigger:

| De la → la | Cine | Condiții |
|---|---|---|
| (inserare) → `draft` | `agency_admin`, `strategist`, `account` | Statusul și aprobarea trimise de client se ignoră |
| `draft → approved` | `strategist`, `agency_admin` | `owner`, `valid_from` și cel puțin un fragment; completează `approved_at` și `approved_by` |
| `approved → retired` | `strategist`, `agency_admin` | Doar statusul se schimbă |

Un document `approved` sau `retired` nu se editează și nu se șterge (nici cu cheia de service), iar fragmentele lui nu se adaugă, nu se schimbă și nu se șterg. O ciornă se poate șterge, cu fragmentele ei.

### `brand_document_search(p_brand_id, p_query, p_on, p_limit)`

Regimul E8. Întoarce cel mult `p_limit` (implicit 5, maximum 10) fragmente ale documentelor `approved` și valabile la `p_on` (implicit azi, Europe/Bucharest): `fragment_id`, `document_id`, `title`, `doc_type`, `version`, `section_ref`, `content`, `valid_from`, `valid_to`. Căutare lexicală: cuvintele întrebării de 4–40 de caractere, fără diacritice, oricare dintre ele; ordinea e a potrivirii. Fără cuvinte utilizabile, listă goală.

### În chat

Funcția `adsy-ai` cheamă `brand_document_search` cu sesiunea utilizatorului și întrebarea lui. Fragmentele intră în `DATE.documents` (cel mult cinci, 1.500 de caractere fiecare), cu `evidence_id = doc:<fragment_id>`. În răspuns, dovada are `kind: "document"`, eticheta „titlu · secțiune” și `document_id`. Documentele intră în amprenta datelor, deci un document nou aprobat sau retras invalidează răspunsurile din cache. Promptul e `chat-v4`.

Spre furnizorul modelului pleacă, pe lângă cele de mai sus, textul fragmentelor potrivite întrebării. **Documentele nu trebuie să conțină date personale.**

## Evaluare (deciziile Q)

`npm run eval:ai` rulează cazurile din `tests/fixtures/adsy-ai/eval-cases.json` pe modelul real și judecă ce ar ajunge la utilizator după `verifyAnswer`. Fiecare caz are `context`, `question`, `expected` (statusurile acceptate), `must_cite` și `must_not_include`. Cod de ieșire 1 la orice caz nesigur sau sub 85 % reușite. Cere `GEMINI_API_KEY` în mediu; opțiuni: `--model a,b`, `--cases cale.json`, `--group nume`. Se rulează înainte de a schimba modelul sau promptul.

## Neconstruit încă

Încărcarea de fișiere, căutarea semantică, setul de 100 de exemple etichetate pe brand și un set de evaluare pentru ciornele generate.
