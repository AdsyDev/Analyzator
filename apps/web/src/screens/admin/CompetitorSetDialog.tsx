import { CheckIcon, PlusIcon, SparkleIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { Brand, CompetitorSetVersion, CompetitorSuggestions, PlanableCompetitorSuggestion, ProviderResult, SocialProfile } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { formatDate } from '../../lib/format'
import { addDays, todayBucharest } from '../../lib/period'
import { normalizeDomain } from '../../lib/slug'

const field = 'h-9 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'
const MAX_MEMBERS = 10
/** Cea mai veche dată acceptată de funcția SQL. */
const MIN_DATE = '2020-01-01'

const PLATFORM_LABELS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', linkedin: 'LinkedIn' }

type Row = { key: number; name: string; domain: string; social: SocialProfile[] }

/** Cheia unui profil, cum o salvează funcția SQL: rețea + handle cu litere mici, fără „@”. */
const profileKey = (p: SocialProfile) => `${p.platform.toLowerCase()}:${p.handle.trim().replace(/^@+/, '').toLowerCase()}`
const platformLabel = (p: string) => PLATFORM_LABELS[p] ?? p

/**
 * Versiune nouă a setului de competitori. Pornește de la versiunea în vigoare (dacă există); „Propune din surse”
 * aduce profilurile urmărite în Planable și domeniile văzute de SEOmonitor, iar adminul alege. Nimic nu se salvează
 * fără „Creează versiunea”. Prima versiune poate începe în trecut, ca perioadele trecute să primească comparația.
 */
export function CompetitorSetDialog({ brand, versions, onClose, onCreated }: { brand: Brand; versions: CompetitorSetVersion[]; onClose: () => void; onCreated: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const ids = { date: useId(), note: useId(), hint: useId(), names: useId(), domains: useId() }
  const today = todayBucharest()
  const first = versions.length === 0
  const base = versions.find((v) => v.current) ?? null
  // Prima versiune: implicit cu un an în urmă, ca și comparațiile față de anul trecut să aibă setul.
  const [date, setDate] = useState(first ? addDays(today, -365) : today)
  const [note, setNote] = useState('')
  const [nextKey, setNextKey] = useState(base ? base.members.length + 1 : 2)
  const [rows, setRows] = useState<Row[]>(base ? base.members.map((m, i) => ({ key: i + 1, name: m.name, domain: m.domain ?? '', social: m.social_profiles })) : [{ key: 1, name: '', domain: '', social: [] }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ProviderResult<CompetitorSuggestions> | 'loading' | null>(null)

  const filled = rows.filter((r) => r.name.trim() || r.domain.trim())
  const names = filled.map((r) => r.name.trim().toLowerCase())
  const problems: string[] = []
  if (filled.length === 0) problems.push('Adaugă cel puțin un competitor.')
  if (filled.length > MAX_MEMBERS) problems.push(`Setul poate avea cel mult ${MAX_MEMBERS} competitori.`)
  filled.forEach((r, i) => {
    if (!r.name.trim()) problems.push(`Competitorul ${i + 1} nu are nume.`)
    else if (names.indexOf(r.name.trim().toLowerCase()) !== i) problems.push(`„${r.name.trim()}” apare de mai multe ori.`)
    if (normalizeDomain(r.domain) === undefined) problems.push(`Domeniul „${r.domain.trim()}” nu arată a domeniu (de ex. exemplu.ro).`)
  })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push('Alege data de la care se aplică versiunea.')
  else if (date < MIN_DATE) problems.push('Data nu poate fi înainte de 1 ianuarie 2020.')
  else if (!first && date < today) problems.push('O versiune nouă începe azi sau mai târziu; doar prima versiune poate începe în trecut.')
  else if (versions.some((v) => v.effective_from === date)) problems.push(`Există deja o versiune care începe pe ${formatDate(date)}.`)

  const usedDomains = new Set(rows.map((r) => normalizeDomain(r.domain)).filter((d): d is string => !!d))
  /** Profilurile deja legate: cheie → eticheta competitorului (C1…). */
  const usedProfiles = new Map(rows.flatMap((r, i) => r.social.map((p) => [profileKey(p), `C${i + 1}`] as const)))

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  function add(row: Omit<Row, 'key'>) {
    setRows((rs) => {
      // Un rând gol se completează înainte de a adăuga unul nou.
      const empty = rs.find((r) => !r.name.trim() && !r.domain.trim())
      if (empty) return rs.map((r) => (r === empty ? { ...r, ...row } : r))
      return rs.length >= MAX_MEMBERS ? rs : [...rs, { key: nextKey, ...row }]
    })
    setNextKey((k) => k + 1)
  }
  /**
   * Un profil Planable se leagă de competitorul cu același nume; altfel devine un competitor nou. Prin profil se leagă
   * metricile sociale colectate: fără el, rândurile sociale ale competitorului rămân N/A.
   */
  function addProfile(c: PlanableCompetitorSuggestion) {
    const profile = { platform: c.platform, handle: c.handle }
    if (usedProfiles.has(profileKey(profile))) return
    const same = rows.find((r) => r.name.trim().toLowerCase() === c.name.toLowerCase())
    if (same) update(same.key, { social: [...same.social, profile] })
    else add({ name: c.name, domain: '', social: [profile] })
  }
  function linkProfile(c: PlanableCompetitorSuggestion, key: number) {
    const profile = { platform: c.platform, handle: c.handle }
    if (usedProfiles.has(profileKey(profile))) return
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, social: [...r.social, profile] } : r)))
  }

  /** Leagă un domeniu de un competitor deja ales fără domeniu; altfel îl adaugă ca rând nou. */
  function addDomain(domain: string) {
    const target = rows.find((r) => r.name.trim() && !r.domain.trim())
    if (target) update(target.key, { domain })
    else add({ name: domain, domain, social: [] })
  }

  async function propose() {
    setSuggestions('loading')
    setSuggestions(await providers.config.competitorSuggestions(brand.id))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || problems.length > 0) return
    setBusy(true)
    setError(null)
    const r = await providers.config.createCompetitorSetVersion(brand.id, {
      effective_from: date,
      note: note.trim() || null,
      members: filled.map((m) => ({ name: m.name.trim(), domain: normalizeDomain(m.domain) ?? null, social: m.social })),
    })
    setBusy(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    toast(`Versiunea v${r.data.version} a fost creată, cu ${r.data.member_count} ${r.data.member_count === 1 ? 'competitor' : 'competitori'}, în vigoare din ${formatDate(r.data.effective_from)}.`)
    onCreated()
    onClose()
  }

  const ready = suggestions && suggestions !== 'loading' && suggestions.kind === 'ready' ? suggestions.data : null
  const planableNames = ready?.planable.competitors.map((c) => c.name) ?? []
  const seoDomains = ready?.seomonitor.domains.map((d) => d.domain) ?? []

  return (
    <Dialog
      open
      onClose={onClose}
      placement="right"
      title={first ? 'Configurează competitorii' : `Versiune nouă · ${brand.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Anulează</Button>
          <Button variant="primary" type="submit" form="competitor-set-form" loading={busy} disabled={problems.length > 0}>Creează versiunea</Button>
        </>
      }
    >
      <form id="competitor-set-form" onSubmit={submit} className="flex flex-col gap-5">
        <p className="text-[13px] leading-snug text-text-2">
          {first
            ? `Primul set de competitori pentru ${brand.name}. Brief-ul cere trei competitori, validați cu Account și Strategie. Domeniul leagă competitorul de răspunsurile AI din SEOmonitor, iar profilurile din Planable de metricile sociale; fără ele, comparațiile respective rămân N/A.`
            : `Pornește de la v${base?.version ?? versions[0]?.version} (în vigoare). Versiunile sunt imutabile: se creează v${Math.max(...versions.map((v) => v.version)) + 1}, iar istoricul rămâne.`}
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.date} className="text-[12.5px] font-semibold">Se aplică de la</label>
          <input id={ids.date} type="date" value={date} min={first ? MIN_DATE : today} onChange={(e) => setDate(e.target.value)} className={`${field} font-mono sm:w-48`} aria-describedby={ids.hint} />
          <p id={ids.hint} className="text-[12px] leading-snug text-text-3">
            {first
              ? 'Prima versiune poate începe în trecut: perioadele de dinainte primesc comparația în loc de „Sursă neconectată”.'
              : 'Azi sau mai târziu. Comparațiile pentru perioadele de dinainte rămân cu versiunea veche.'}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12.5px] font-semibold">Competitori</legend>
          <ol className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.key} className="flex items-start gap-2">
                <span className="mt-2.5 w-6 shrink-0 font-mono text-[11.5px] text-text-3">C{i + 1}</span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder="Nume" aria-label={`Numele competitorului ${i + 1}`} list={ids.names} maxLength={120} autoComplete="off" className={field} />
                  <input
                    value={r.domain}
                    onChange={(e) => update(r.key, { domain: e.target.value })}
                    placeholder="domeniu.ro (opțional)"
                    aria-label={`Domeniul competitorului ${i + 1}`}
                    aria-invalid={normalizeDomain(r.domain) === undefined || undefined}
                    list={ids.domains}
                    autoComplete="off"
                    className={`${field} font-mono`}
                  />
                  {r.social.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 sm:col-span-2" aria-label={`Profilurile sociale ale competitorului ${i + 1}`}>
                      {r.social.map((p) => (
                        <li key={profileKey(p)} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pl-2.5 pr-1 text-[12px]">
                          <span className="text-text-2">{platformLabel(p.platform)}</span>
                          <span className="font-mono text-[11.5px]">@{p.handle.replace(/^@+/, '')}</span>
                          <button
                            type="button"
                            className="grid size-5 place-items-center rounded-full text-text-3 hover:bg-neutral-soft hover:text-text"
                            aria-label={`Scoate profilul ${platformLabel(p.platform)} @${p.handle.replace(/^@+/, '')} de la competitorul ${i + 1}`}
                            onClick={() => update(r.key, { social: r.social.filter((x) => profileKey(x) !== profileKey(p)) })}
                          >
                            <XIcon size={11} weight="bold" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button variant="ghost" className="px-2.5" icon={<TrashIcon size={14} />} aria-label={`Scoate competitorul ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
              </li>
            ))}
          </ol>
          <datalist id={ids.names}>{planableNames.map((n) => <option key={n} value={n} />)}</datalist>
          <datalist id={ids.domains}>{seoDomains.map((d) => <option key={d} value={d} />)}</datalist>
          <div>
            <Button variant="ghost" icon={<PlusIcon size={14} weight="bold" />} disabled={rows.length >= MAX_MEMBERS} onClick={() => { setRows((rs) => [...rs, { key: nextKey, name: '', domain: '', social: [] }]); setNextKey((k) => k + 1) }}>
              Adaugă competitor
            </Button>
          </div>
        </fieldset>

        <Suggestions
          state={suggestions}
          onPropose={propose}
          usedProfiles={usedProfiles}
          usedDomains={usedDomains}
          full={rows.length >= MAX_MEMBERS && rows.every((r) => r.name.trim() || r.domain.trim())}
          targets={rows.flatMap((r, i) => (r.name.trim() ? [{ key: r.key, label: `C${i + 1} · ${r.name.trim()}` }] : []))}
          onAddProfile={addProfile}
          onLinkProfile={linkProfile}
          onAddDomain={addDomain}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.note} className="text-[12.5px] font-semibold">Notă <span className="font-normal text-text-3">(opțional)</span></label>
          <textarea id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder="de ex. Set validat cu Account STADA" className="rounded-[10px] border border-border-strong bg-surface px-3 py-2 text-[13px]" />
        </div>

        {filled.length > 0 && problems.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[12.5px] text-warn-text" aria-live="polite">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </form>
    </Dialog>
  )
}

function Suggestions({
  state,
  onPropose,
  usedProfiles,
  usedDomains,
  full,
  targets,
  onAddProfile,
  onLinkProfile,
  onAddDomain,
}: {
  state: ProviderResult<CompetitorSuggestions> | 'loading' | null
  onPropose: () => void
  usedProfiles: Map<string, string>
  usedDomains: Set<string>
  full: boolean
  targets: Array<{ key: number; label: string }>
  onAddProfile: (c: PlanableCompetitorSuggestion) => void
  onLinkProfile: (c: PlanableCompetitorSuggestion, key: number) => void
  onAddDomain: (domain: string) => void
}) {
  return (
    <section aria-label="Propuneri din surse" className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="text-[13px] font-semibold">Propuneri din surse</h3>
          <p className="text-[12px] leading-snug text-text-2">Profilurile urmărite în Planable și domeniile pe care SEOmonitor le vede lângă brand în răspunsurile AI. Tu alegi; nimic nu se adaugă singur.</p>
        </div>
        <Button icon={<SparkleIcon size={14} />} loading={state === 'loading'} onClick={onPropose}>{state && state !== 'loading' ? 'Reîncarcă' : 'Propune din surse'}</Button>
      </div>
      {state && state !== 'loading' && state.kind !== 'ready' && <p role="alert" className="text-[12.5px] text-neg-text">{state.kind === 'error' ? state.message : state.reason}</p>}
      {state && state !== 'loading' && state.kind === 'ready' && (
        <div className="flex flex-col gap-3">
          <SourceBlock title="Planable · profiluri urmărite drept competitori" outcome={state.data.planable.outcome} message={state.data.planable.message} notes={state.data.planable.notes}>
            {state.data.planable.competitors.map((c) => {
              const usedBy = usedProfiles.get(profileKey(c)) ?? null
              return (
                <SuggestionItem
                  key={`${c.platform}:${c.handle}`}
                  used={usedBy ? `La ${usedBy}` : null}
                  disabled={full && !targets.some((t) => t.label.toLowerCase().endsWith(`· ${c.name.toLowerCase()}`))}
                  onAdd={() => onAddProfile(c)}
                  label={`Adaugă ${c.name}`}
                  link={targets.length > 0 ? { name: c.name, targets, onLink: (key) => onLinkProfile(c, key) } : null}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-text-2"> · {PLATFORM_LABELS[c.platform] ?? c.platform} <span className="font-mono text-[11.5px]">@{c.handle.replace(/^@/, '')}</span></span>
                  <span className="block text-[11.5px] text-text-3">urmărit pe {c.tracked_from.join(', ')}</span>
                </SuggestionItem>
              )
            })}
          </SourceBlock>
          <SourceBlock title={`SEOmonitor · domenii în răspunsurile AI, din ${formatDate(state.data.seomonitor.since)}`} outcome={state.data.seomonitor.outcome} message={state.data.seomonitor.message} notes={[]}>
            {state.data.seomonitor.domains.map((d) => {
              const used = usedDomains.has(d.domain.replace(/^www\./, ''))
              return (
                <SuggestionItem key={d.domain} used={used ? 'În set' : null} disabled={false} onAdd={() => onAddDomain(d.domain)} label={`Adaugă ${d.domain}`} link={null}>
                  <span className="font-mono text-[12.5px]">{d.domain}</span>
                  <span className="text-text-2"> · {d.keywords} {d.keywords === 1 ? 'cuvânt cheie' : 'cuvinte cheie'}</span>
                </SuggestionItem>
              )
            })}
          </SourceBlock>
        </div>
      )}
    </section>
  )
}

const OUTCOME_TITLE: Record<string, string> = {
  not_connected: 'Sursă neconectată',
  invalid: 'Token refuzat',
  rate_limited: 'Limită de cereri',
  provider_error: 'Eroare la furnizor',
  budget_exhausted: 'Limita zilnică atinsă',
}

function SourceBlock({ title, outcome, message, notes, children }: { title: string; outcome: string; message: string | null; notes: string[]; children: ReactNode[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[12px] font-semibold text-text-2">{title}</h4>
      {outcome !== 'ok' ? (
        <p className={outcome === 'not_connected' ? 'text-[12.5px] text-text-3' : 'text-[12.5px] text-warn-text'}>
          <span className="font-semibold">{OUTCOME_TITLE[outcome] ?? outcome}.</span> {message}
        </p>
      ) : children.length === 0 ? (
        <p className="text-[12.5px] text-text-3">{message ?? 'Nicio propunere.'}</p>
      ) : (
        <ul className="flex flex-col gap-1">{children}</ul>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[11.5px] text-text-3">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}

function SuggestionItem({
  used,
  disabled,
  onAdd,
  label,
  link,
  children,
}: {
  used: string | null
  disabled: boolean
  onAdd: () => void
  label: string
  /** Legarea unui profil de un competitor deja ales (de ex. pagina de Facebook a aceluiași competitor). */
  link: { name: string; targets: Array<{ key: number; label: string }>; onLink: (key: number) => void } | null
  children: ReactNode
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-surface px-2.5 py-1.5 text-[13px]">
      <span className="min-w-0 flex-1 basis-48">{children}</span>
      {used ? (
        <span className="inline-flex items-center gap-1 text-[12px] text-pos-text"><CheckIcon size={13} weight="bold" /> {used}</span>
      ) : (
        <span className="flex items-center gap-1">
          {link && (
            <select
              aria-label={`Leagă ${link.name} de un competitor ales`}
              value=""
              onChange={(e) => e.target.value && link.onLink(Number(e.target.value))}
              className="h-8 max-w-40 rounded-[10px] border border-border-strong bg-surface px-2 text-[12.5px] text-text-2"
            >
              <option value="">Leagă de…</option>
              {link.targets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          )}
          <Button variant="ghost" className="h-8 px-2.5" icon={<PlusIcon size={13} weight="bold" />} aria-label={label} disabled={disabled} onClick={onAdd}>Adaugă</Button>
        </span>
      )}
    </li>
  )
}
