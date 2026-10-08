# Contract: refresh săptămânal, statusul surselor și alerte

Surse: brief cap. 4 (sincronizare marți 06:00 Europe/Bucharest), spec cap. 9 și 27, `docs/contracts/metric-response.md` (`data_as_of`, `coverage`).

## Orchestratorul (`connectors/orchestrator`)

`npm run refresh:weekly [-- --only seomonitor,ga4,gsc]` · workflow `weekly-refresh.yml` (marți 04:00 UTC, dezactivat prin `REFRESH_ENABLED`, `workflow_dispatch` activ).

- **Ordinea:** `seomonitor → ga4 → gsc`. Clarity are colectare zilnică proprie (`clarity-daily.yml`, buget de 10 apeluri/zi) și nu intră în refresh-ul săptămânal.
- **Flag-uri:** `CONNECTOR_SEOMONITOR_ENABLED`, `CONNECTOR_GOOGLE_ENABLED` (ga4 și gsc), `CONNECTOR_CLARITY_ENABLED`; citite **doar** din `connectors/shared/flags.ts`. Un conector dezactivat e sărit (fără sync_run); doar valoarea `true` activează.
- **Izolare:** eșecul sau excepția unei surse nu le oprește pe celelalte. O excepție (înainte ca un conector să-și fi scris `sync_runs`) se înregistrează ca rulare `failed` (`orchestrator_exception`) pentru fiecare brand afectat: conexiunile active ale sursei; una la nivel de client (SEOmonitor) afectează toate brandurile active ale clientului.
- **Statusuri:** `succeeded`, `partial`, `failed` vin de la conectori. O rulare parțială nu e `succeeded` și nu e eșec, dar primește alertă; `not_connected` nu e eșec (fără sync_run, fără alertă). Exit code 1 doar la `failed` sau excepție; parțialele apar ca avertismente în log și în alerte.
- **Alerte:** pentru fiecare rulare `failed` (inclusiv excepții) **și** `partial` se pune o alertă în `ops_notifications` (`refresh_failed` / `refresh_partial`), idempotent pe `sync_run_id` + tip. O rulare parțială e o sursă cu date lipsă pe care cineva trebuie s-o vadă. La final se încearcă trimiterea.

## Statusul surselor (view-uri `security_invoker`)

Fără funcții noi în `public` (garda A10/A11): statusul se citește din view-uri, cu RLS-ul tabelelor.

| View | Cine | Conținut |
|---|---|---|
| `source_status` | agenția (`agency_admin`, `strategist`, `account`) cu acces la brand | per brand × 9 surse: `state`, `reason`, `connected`, `credential_status`, ultima rulare (`last_run_at`, `last_run_status`, `last_run_rows`, `last_run_error_count`), `last_success_at`, `data_as_of`, `grace_days`, `covered_days`, `expected_days` (35), `coverage` |
| `source_freshness` | oricine are acces la brand, inclusiv clientul | `data_as_of`, `grace_days`, `freshness`: `no_data` · `current` · `delayed`. Fără erori, conexiuni sau costuri |
| `sync_history` | agenția | istoricul `sync_runs`: perioadă, rânduri, `error_count`, `error_codes`, `duration_seconds`, `coverage` |
| `source_dataset_days` | cine are acces la brand | zilele cu date reale per sursă (baza `data_as_of` și a acoperirii) |

### `state` (agenția)

| state | Condiție |
|---|---|
| `not_connected` | fără conexiune, credential lipsă, SEOmonitor fără mapare grup → brand, sau sursă CSV fără import confirmat (`reason`: `no_connection`, `credential_missing`, `no_mapping`, `no_import`) |
| `error` | credential invalid (`credential_invalid`) sau ultima rulare `failed` |
| `partial` | ultima rulare `partial` |
| `no_data` | conectat, dar fără nicio zi cu date |
| `stale` | `data_as_of` mai vechi decât ieri − toleranța sursei |
| `ok` | altfel |

Prioritatea e cea din tabel (de sus în jos). Toleranța (`grace_days`) vine din registrul de metrici: maximul `freshness_grace_days` al metricilor sursei (GA4 2, GSC 3, Clarity 1, SEOmonitor 7), implicit 14 pentru sursele CSV.

### `data_as_of` și `coverage` (forma din `MetricResponse.meta`)

- `data_as_of` = ultima zi cu date reale; `coverage` = zile cu date în ultimele 35 de zile (până ieri, Europe/Bucharest) / 35.
- O zi contează doar dacă are valoarea primară nenulă (GA4 `sessions`, GSC `clicks`, Clarity `sessions` pe dimensiunea `all`, cost la paid). Zilele fără rânduri sau cu valoare `NULL` sunt **neconfirmate**, nu zero.
- Mențiunile (Planable Listening) nu au acoperire pe zile (`coverage` null): o zi fără mențiuni e legitimă.
- Acoperirea pe o perioadă oarecare se calculează din `source_dataset_days`; fiecare rulare își păstrează și propria acoperire în `sync_runs.coverage` (per set de date).

## Alerte de eșec

- `alert_contacts` (e-mail, nume, activ): contacte interne, configurate de `agency_admin`; separate de `pv_contacts`.
- `ops_notifications`: o alertă per `sync_run` eșuat sau parțial și per tip (`refresh_failed`, `refresh_partial`); `status` `pending` → `sending` → `sent` | `failed`; vizibilă doar `agency_admin`.
- Mecanismul e cel de la farmacovigilență: fără `RESEND_API_KEY` / `OPS_FROM_EMAIL` (sau `PV_FROM_EMAIL`) nu se încearcă nimic, iar alertele rămân `pending`; fără contacte active rămân `pending` (`last_error = no_contacts`); erori tranzitorii: reîncercare, apoi `failed` după 5 încercări (vizibil, reluabil). `Idempotency-Key` = `ops-notification-<id>`.
- Textul (diferit pentru eșec și pentru rulare parțială) conține sursa, brandul, ID-ul rulării și primele 5 coduri de eroare / note (mesaje de maximum 200 de caractere); fără tokenuri sau date de client.
- Reluare: `npm run send:ops-notifications`.

## De făcut mai târziu

- **Acoperirea pe perioada selectată.** Acum acoperirea (`source_status.coverage`) e pe fereastra fixă de 35 de zile. Când UI-ul cere acoperire pe perioada aleasă de utilizator: view/funcție parametrizat pe perioadă (o funcție executabilă de utilizatori în `public` cere extinderea gărzii A10/A11, deci decizie de securitate; alternativ, UI-ul numără din `source_dataset_days`, care e deja citibil). Notat și în `docs/decisions.md`, C-7.
