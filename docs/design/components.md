# Componente

Referința pentru `apps/web/src/components`. Sursa vizuală: `docs/design/reference/` (formatul `.dc.html` nu se portează; contează aspectul, textele și stările). Tokens: `docs/design/tokens.css`.

## Reguli comune

- **Sticla** (`--glass*`, `backdrop-filter`) doar pe sidebar, topbar, drawere, modale și popovere (inclusiv tooltip și toast). Orice suprafață cu cifre e solidă (`--surface`).
- **Null, zero și eroare** sunt trei stări distincte, vizibil diferite: zero e o cifră; lipsa datelor e un gol marcat (hașură în grafic, „Fără date" în tooltip); sursa neconectată e un contur cu textul „Sursă neconectată" și motivul; eroarea are mesaj și „Reîncearcă".
- Sensul nu se comunică doar prin culoare (iconiță și text lângă culoare). Hoverul are echivalent la focus și click. Fiecare grafic are tabel alternativ.
- Componentele primesc `MetricResponse` gata calculat și nu conțin formule. Formatarea (`lib/format.ts`) nu calculează: transformă valori existente în text. Textele sunt în română, sentence case. Numere în `ro-RO`; puncte procentuale (p.p.) distincte de procente.
- Starea fiecărei componente de date: `loading`, `ready`, `partial`, `stale`, `unavailable`, `error` (spec cap. 22), mapată din statusurile `MetricResponse` (tabelul de mai jos).

## Contractul de metrici în UI

Tipurile din `apps/web/src/contracts/metric.ts` oglindesc `public.metric_definitions` și `metrics.compute` / `metrics.build_response` (migrația `20261007140000_metric_registry.sql`). Dacă SQL-ul se schimbă, se schimbă întâi contractul și testele (`data/supabase/mapMetrics.test.ts`), apoi UI-ul. Mapperul aruncă `MetricContractError` la orice abatere (status sau unitate necunoscută, `coverage` în afara 0-1, câmp lipsă).

- `relative_change` e în **procente** (12,7 = +12,7%); `coverage` e **fracție 0-1**; `absolute_change` la `percent` înseamnă puncte procentuale.
- Unități: `count`, `percent`, `seconds`, `position`, `score` (se extind împreună cu registrul).
- Direcție: `higher_is_better`, `lower_is_better`, `neutral` (fără culoare pozitiv/negativ, fără „cea mai bună valoare").
- Serverul nu trimite text. Motivul stării vine din `lib/warnings.ts`, din status, acoperire și codurile din `warnings`; un cod necunoscut nu inventează o cauză.
- `build_response` nu pune `source`, versiunea și `warnings` pe metrică; mapperul le alipește din registru și din `meta`.
- Comparația: `Luna curentă` e MTD (aceeași porțiune din luna anterioară), restul intervalelor compară cu perioada anterioară de aceeași lungime, exact ca `metrics.comparison_period`. „Anul trecut" e dezactivat până când serverul îl calculează.

## Maparea statusurilor `MetricResponse` → afișare

Absența valorii se decide după `value`, nu după status: `partial` poate avea `value: null` (zero neconfirmat).

| `status` | Valoare | Badge | Notă afișată |
|---|---|---|---|
| `ok` | da | Complet | Sursă și „Date până la" |
| `partial` | da, sau null la `zero_not_confirmed` („Valoare neconfirmată") | Parțial `<coverage>%` | Acoperirea; rândurile excluse, dacă există |
| `stale` | da (ultima cunoscută) | Învechit | „Ultimele date sunt din <data>" |
| `insufficient_sample` | da, marcată | Parțial | Eșantion sub pragul minim din definiție |
| `base_zero` | da, fără variație relativă | Complet | „Variația relativă nu e definită: baza de comparație e 0." |
| `cannot_compute` | nu | Indisponibil | „Numitorul este zero" |
| `unavailable` | nu | Indisponibil | După cod: interogare eșuată, observații duplicate, raport pe interval lipsă, nicio observație, nicio zi confirmată |
| `not_connected` | nu | Indisponibil | „Sursa <nume> nu este conectată..." |
| eroare de încărcare | nu | – | Mesaj + „Reîncearcă" (nu e un status de metrică) |

Note secundare (din `warnings`): „Perioadă incompletă", „Comparația nu e disponibilă pentru perioada de referință", „Perioada de comparație are date parțiale", „Definiție provizorie: <nota>" pentru `lifecycle = draft`.

## Componente

### AppShell
Sidebar colapsabil (extins cu etichete, colapsat doar iconițe cu tooltip), topbar cu selector de brand, FilterBar, comutator de temă, linia „Date până la · Ultimul refresh". Variante: rol client (fără Administrare), rol agenție. Stări: sidebar extins/colapsat; meniuri deschise (brand, utilizator, perioadă) cu popover de sticlă; fără brand accesibil (EmptyState).

### KpiCard
Eticheta, `?` cu tooltip de definiție, valoare mare (Sora, cifre tabulare), variație cu săgeată și culoare după `higherIsBetter`, etichetă de comparație, sparkline cu zilele fără date ca întrerupere, rând de proveniență (sursă, „Date până la", CoverageBadge). Se deschide EvidenceDrawer la click/Enter. Stări: `ready`, `loading` (schelet), `partial` (notă galbenă), `stale` (notă gri), `unavailable`/`not_connected` (iconița „plugs", „Sursă neconectată" și motivul), `error`, plus `base_zero` și `insufficient_sample`.

### CoverageBadge
Pilulă de 20 px: Complet (verde), Parțial cu procent în mono (galben), Învechit (gri), Indisponibil (contur). Titlul explică starea.

### TrendChart
Linii pe grilă de 4 niveluri, legendă cu butoane comutabile (`aria-pressed`), prima serie mai groasă, serii dashed pentru bază de comparație, hover cu linie verticală, puncte și tooltip de sticlă cu valorile. Valorile `null` întrerup linia și marchează zona cu hașură („Fără date" în tooltip), nu coboară la zero. Formate: `int`, `pct`, `idx`. Tabel alternativ comutabil. Stări: `loading`, `ready`, `partial`, `unavailable`, `error`.

### ComparisonTable
Brand + C1..C3, rânduri pe metrică (opțional grupate pe sursă), cea mai bună valoare pe rând evidențiată (și marcată cu iconiță), celule `N/A` cu motiv („Sursă neconectată"), notă de subsol. Antet cu versiunea setului de competitori și data efectivă. Culorile competitorilor sunt stabile; agenția în teal, clientul în lavandă.

### EvidenceDrawer
Panou lateral de sticlă: pagină și indicator, definiție, valoare și variație, sursă, interval, „Date până la", acoperire, „Cum se calculează" (formula din registrul de metrici, citită, nu calculată în UI), „Înregistrări sursă" (ultimele N din total; „Importat la", payload hash cu „Copiază hash"), stare fără înregistrări, stare sursă neconectată cu acțiune. Se închide cu Esc și click pe scrim; focus capturat.

### FilterBar
Perioadă, comparație, filtre de modul, chipuri active cu „x", „Resetează filtrele". Citește și scrie doar în URL (`period`, `compare`, filtre), fără stare proprie. Interval personalizat cu două date în Europe/Bucharest.

### InsightCard
Titlu, autor (avatar și rol), perioadă, rezumat, „Dovezi atașate" (linkuri la EvidenceDrawer), „Limite". Badge de status (Draft, În review, Publicat, Înlocuit) doar pentru agenție; clientul vede doar „Publicat" fără badge.

### SourceStatus
Monogramă, nume, ce aduce, stare (Conectat, Parțial, Învechit, Eroare, Neconectat), „Date până la", „Importat la", acțiuni (Reîncearcă, Reconectează, Conectează) doar pentru agenție, notă de eroare. Starea credențialului pe baza `credential_status` (vezi `screens.md`, Administrare → Surse).

### EmptyState
Iconiță subțire, titlu, text cu motivul, acțiune opțională. Pentru module fără sursă: titlul „Sursă neconectată" și motivul concret (nu „În curând", nu mesaje despre stack); acțiunea „Conectează <sursă>" (agenție) sau „Cere conectarea" (client). Variantă „fără rezultate pentru filtre" cu „Resetează filtrele".

### PharmacovigilanceButton
Stări: nemarcat („Marchează pentru farmacovigilență", ton `--pv`), marcat („Marcat pentru farmacovigilență <data>", dezactivat, persistent), în curs. Dialogul de confirmare arată exact ce se înregistrează (data și ora, utilizator, link, snapshot text) și ce urmează (notificarea contactelor PV); acțiuni „Anulează" și „Marchează și notifică". Marcajul nu poate fi șters, doar adnotat.

### Primitive
- **Toast**: sticlă, jos-centru, dispare după câteva secunde, `role="status"`.
- **Tooltip**: sticlă, la hover, focus și click; text de definiție; `role="tooltip"`.
- **Dialog**: sticlă, scrim, Esc, focus capturat.
- **Chip**: filtru (activ inversat: fundal `--text`, text `--bg`) și status (Draft, În review, Publicat, Înlocuit).
- **Tabs**: segmentat, activ pe `--surface` cu `--sh-1`.
- **Tabel sortabil cu paginare**: antet lipicios, sortare cu `aria-sort`, „<a>-<b> din <n>", rânduri pe pagină; stare goală.
- **Avatar** cu inițiale (persoane) și monogramă (surse, branduri).
- **Butoane**: primar (`--accent-btn`), secundar (contur), ghost, periculos/PV (`--pv-btn`), cu stare disabled și loading.

## Stări lipsă din design față de contractul de metrici

Design-ul acoperă `normal`, `loading`, `partial`, `stale` și `unavailable` pe KpiCard. Lipsesc și se proiectează în UI-1 pe baza tokens existente:

1. **`error`** pe KpiCard, TrendChart, tabele (mesaj + „Reîncearcă"); designul are doar eroarea de la login.
2. **`insufficient_sample`** (spec cap. 26): marcaj „eșantion mic" și numitorul n.
3. **`base_zero`**: valoare afișată, variație relativă ascunsă cu explicație.
4. **`cannot_compute`**: diferit de `not_connected`; designul le amestecă sub „Sursă neconectată".
5. **`not_connected` vs `unavailable`**: designul folosește un singur text; distingem „Sursă neconectată" de „Fără date pentru interval".
6. **Tabel alternativ pentru grafice** (cap. 22): nu apare în design.
7. **Zero vs lipsă** în tabele și matrice (celula 0 vs celula goală): design-ul nu le diferențiază în matricea topic × competitor.
8. **Pagina de portofoliu** pe 3 branduri (cap. 22): nu e proiectată; rămâne în afara UI-1.
9. **Paid Media, Social, Configurare cu date**: doar EmptyState în design.
10. **„Evoluții prioritare"** (cap. 12, max 3 schimbări semnificative): nu apare în Overview-ul din design; de confirmat cu designul înainte de UI-2.
11. **Evidențiere în dark/light a „celei mai bune valori"** fără culoare: verificat doar pe culoare.
12. **Stări de focus pentru heatmap și rânduri de tabel** interactive: lipsesc.
