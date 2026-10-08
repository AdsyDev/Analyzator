# Contract: analize, recomandări, acțiuni și farmacovigilență

Surse: spec cap. 21 și 28, brief cap. 6. Fără UI în acest task. Tranzițiile se fac prin **tabele de tranziție** (fără funcții RPC noi în
`public`, ca garda A10/A11 să rămână neschimbată): un `INSERT` într-un tabel de tranziție declanșează un trigger `SECURITY DEFINER`
care verifică rolul, legalitatea și aplică efectele. Tabelele de tranziție sunt și jurnalul.

## Analize (`insights`)

| Câmp | Note |
|---|---|
| `title`, `period_start`, `period_end`, `period_kind` | `period_kind`: `custom`, `week`, `month`, `year`, `mtd`, `ytd` (intră în `metrics.compute`) |
| `summary` (constatare), `interpretation`, `limits` | obligatorii la trimiterea la review |
| `status` | `draft`, `in_review`, `published`, `superseded`; **nu se setează direct** |
| `author_id` | = utilizatorul curent la inserare; nu se schimbă |
| `version`, `supersedes_id`, `superseded_by_id` | versiunea nouă se creează cu `INSERT` cu `supersedes_id`; versiunea se calculează |

Dovezi: `evidence_links` (`kind = metric` cu `metric_key` și `options`, sau `kind = record` cu `record_table` + `record_id`). Opțiunea permisă: `device`
(`desktop` / `mobile`), obligatorie pentru metricile SEOmonitor. Recomandări: `recommendations` (problemă, acțiune, beneficiu, metrică de verificare, prioritate 1–3).
Dovezile și recomandările se modifică doar cât analiza e în `draft`.

### Tranziții (`insight_transitions`: `insight_id`, `to_status`, `reason`)

| De la → la | Cine | Condiții |
|---|---|---|
| `draft → in_review` | `agency_admin`, `strategist`, `account` cu acces la brand | titlu, constatare, interpretare, limite și cel puțin o dovadă |
| `in_review → draft` | `strategist`, `agency_admin` | motiv obligatoriu |
| `in_review → published` | `strategist`, `agency_admin` | calculează și îngheață metricile citate (`insight_snapshots`); dacă înlocuiește o versiune, aceasta devine `superseded` |

Orice altă tranziție e respinsă (`23514`). Fără rol/acces: `42501` cu același mesaj pentru „inexistent” și „fără acces”. Trigger-ul completează `tenant_id`,
`brand_id`, `from_status`, `actor_id`, `occurred_at`; valorile din corpul cererii pentru aceste câmpuri nu se iau în seamă.

### Reguli

- **Clientul citește doar `published`** (analiza, dovezile, snapshoturile, recomandările). Draftul nu se vede nici cu ID-ul direct.
- **O analiză publicată nu se mai editează și nu se șterge** (nici de service role: trigger). Se înlocuiește: `INSERT` cu `supersedes_id` creează un draft versiunea n+1,
  cu dovezile și recomandările copiate; la publicare, versiunea veche devine `superseded` și rămâne în istoric (vizibilă doar agenției).
- **Snapshot la publicare** (`insight_snapshots`): rezultatul `metrics.compute` pentru fiecare metrică citată, cu perioada și comparația implicită (perioada anterioară
  de aceeași lungime), conexiunea sursei și acoperirea. Imutabil. O metrică fără sursă conectată rămâne `not_connected`; una conectată, dar fără observații, `unavailable`;
  nu se inventează valori. Sursele de observații: `web_metric_observations`, `web_active_users_observations`, `search_metric_observations`, `clarity_metric_observations`,
  `seomonitor_metric_observations`, `paid_metric_observations`, `mentions_metric_observations`.
- Publicarea eșuează întreagă (fără snapshoturi parțiale) dacă o metrică e necunoscută, nu are încă sursă de observații sau SEOmonitor nu are `device`.

## Acțiuni (`actions`) și `action_transitions`

Câmpuri: `insight_id`, `recommendation_id?`, `title`, `description`, `responsible_user_id` (membru activ al agenției), `due_date`, `status`, `status_reason`, `implemented_at`, `result_note`.
`status` nu se setează direct. Tranzițiile (`action_transitions`: `action_id`, `to_status`, `reason`, `result_note`, `implemented_at`), pentru `agency_admin`, `strategist`, `account` cu acces la brand:

| De la | Către |
|---|---|
| `proposed` | `agreed`, `cancelled` (motiv obligatoriu) |
| `agreed` | `in_progress`, `cancelled` (motiv) |
| `in_progress` | `done` (completează `implemented_at`, implicit azi în Europe/Bucharest; nu în viitor), `cancelled` (motiv) |
| `done` | `measured` (`result_note` obligatoriu) |
| `measured`, `cancelled` | terminale: acțiunea nu se mai modifică |

Clientul vede acțiunile `agreed`, `in_progress`, `done` și `measured` ale analizelor publicate (nu propunerile interne, nu cele anulate). Editarea rămâne la echipă.

## Farmacovigilență

Analyzator nu stabilește dacă este o reacție adversă, nu răspunde public și nu înlocuiește procedura clientului.

- **Marcare:** `INSERT` în `pv_flags` (`brand_id`, `entity_type` = `mention` | `review` | `ai_answer`, `entity_ref`, `note`). Rolurile `agency_admin`, `strategist`, `account` cu acces la brand.
  Trigger-ul completează `tenant_id`, `flagged_by`, `flagged_at` și **snapshotul textului din entitate**: mențiune (`entity_ref` = `native_id`), răspuns AI (`entity_ref` = UUID-ul din `ai_answers`).
  Textul trimis de utilizator pentru acestea se ignoră. La **review** (încă fără tabel) textul și linkul vin de la utilizator și sunt etichetate `snapshot_source = user_provided`.
- **Marcajul e imutabil** (snapshot, link, autor, dată); nu se șterge. Clientul nu-l vede.
- **Coada:** fiecare marcaj creează un rând în `pv_notifications` cu `status = pending`. Un worker (`npm run send:notifications`, Edge Function `notify`, workflow `notifications-dispatch.yml`)
  trimite **un e-mail către toți contactele active** din `pv_contacts` ale tenantului, prin Resend. Fără `RESEND_API_KEY` / `PV_FROM_EMAIL`, nu se încearcă și nu se modifică nimic.
  Fără contacte active, notificarea rămâne `pending` (`last_error = no_contacts`, un singur eveniment `no_contacts`). Eroare tranzitorie (429, 5xx, rețea): rămâne `pending`; după 5
  încercări sau la o eroare definitivă (4xx): `failed` (vizibil, reluabil manual). Cheia `Idempotency-Key` = `pv-notification-<id>`.
- **Jurnalul:** `pv_flag_events` (append-only): `marked`, `notification_sent`, `notification_failed`, `no_contacts` (sistem), `note`, `transmitted`, `closed` (agency_admin).
  Statusul marcajului: `open → notified` (sistem, după trimitere) · `open | notified → transmitted` · `transmitted → closed`. Vizibil `agency_admin`; autorul își vede marcajul.
- **Contacte:** `pv_contacts` (e-mail, nume, activ), gestionate doar de `agency_admin`; lista e internă.
- E-mailul conține: brand, data (Europe/Bucharest), ID-ul utilizatorului, tipul și referința, linkul, un fragment de maximum 500 de caractere din snapshot și disclaimerul.

## Audit

`audit_events` primește `insights`, `recommendations`, `actions` și `pv_contacts` (actorul din JWT). Marcajele PV **nu** intră în `audit_events` (textul sensibil nu se duplică); jurnalul lor este `pv_flag_events`.
