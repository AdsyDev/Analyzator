import { useId, useState, type FormEvent } from 'react'
import { DOCUMENT_TYPES, type Brand, type BrandDocument, type DocumentStatus, type DocumentType, type NewBrandDocument, type ProviderResult, type Role } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip, type ChipTone } from '../../components/ui/Chip'
import { Dialog } from '../../components/ui/Dialog'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { todayBucharest } from '../../lib/period'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  product_info: 'Informații de produs',
  claims: 'Afirmații aprobate',
  brand_guidelines: 'Ghid de brand',
  faq: 'Întrebări frecvente',
  other: 'Altul',
}
const STATUS: Record<DocumentStatus, { label: string; tone: ChipTone }> = {
  draft: { label: 'Ciornă', tone: 'neutral' },
  approved: { label: 'Aprobat', tone: 'pos' },
  retired: { label: 'Retras', tone: 'lav' },
}

/** De ce un document aprobat nu e acum în context, dacă e cazul. Comparația e pe ziua din Europe/Bucharest. */
export function validityNote(d: BrandDocument, today: string): string | null {
  if (d.status !== 'approved') return null
  if (d.valid_from && d.valid_from > today) return 'Încă nevalabil: intră în context de la data de început.'
  if (d.valid_to && d.valid_to < today) return 'Expirat: nu mai intră în context.'
  return null
}

/**
 * Documentele brandului din care AdSy AI poate cita (deciziile P). Introducerea unui document nu îl aprobă: intră ca
 * ciornă, iar strategistul sau administratorul agenției îl aprobă. Doar documentele aprobate și valabile azi intră în
 * context. Clientul vede lista documentelor aprobate, fără să o poată schimba.
 */
export function Documents({ brand, role }: { brand: Brand; role: Role }) {
  const providers = useProviders()
  const list = useAsync(() => providers.assistant.documents(brand.id), [providers, brand.id])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canWrite = role !== 'client_viewer'
  const canApprove = role === 'agency_admin' || role === 'strategist'
  const today = todayBucharest()

  async function run(key: string, call: () => Promise<ProviderResult<unknown>>) {
    setBusy(key)
    setError(null)
    const r = await call().catch((): ProviderResult<never> => ({ kind: 'error', message: 'Modificarea nu a putut fi salvată. Reîncearcă.' }))
    setBusy(null)
    if (r.kind === 'ready') return list.reload()
    setError(r.kind === 'error' ? r.message : r.reason)
  }

  return (
    <Section
      id="ai-documents"
      title="Documente aprobate"
      description={canWrite ? 'Sursa pentru ce afirmă brandul despre produs. AdSy AI citează doar din documentele aprobate și valabile azi; un document nou intră ca ciornă.' : 'Documentele brandului din care AdSy AI poate cita, aprobate de echipă împreună cu brandul.'}
      action={canWrite ? <Button variant="secondary" onClick={() => setAdding(true)}>Adaugă document</Button> : undefined}
    >
      <Resolved state={list.state} onRetry={list.reload} loadingLabel="Se încarcă documentele" skeletonClass="h-24">
        {(docs) =>
          docs.length === 0 ? (
            <EmptyState compact title="Niciun document" text={canWrite ? 'Fără documente aprobate, AdSy AI răspunde doar din indicatori și din analizele publicate.' : 'Nu există încă documente aprobate pentru acest brand.'} />
          ) : (
            <ul aria-label="Documentele brandului" className="flex flex-col divide-y divide-border">
              {docs.map((d) => {
                const note = validityNote(d, today)
                return (
                  <li key={d.id} data-status={d.status} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                        {d.title}
                        <StatusChip tone={STATUS[d.status].tone}>{STATUS[d.status].label}</StatusChip>
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-text-2">
                        {DOCUMENT_TYPE_LABELS[d.doc_type]} · versiunea {d.version} · {d.country}, {d.language}
                        {d.product && <> · {d.product}</>}
                        {d.owner && <> · răspunde: {d.owner}</>}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-text-2">
                        {d.valid_from ? <>Valabil de la <span className="font-mono text-[12px] text-text">{formatDate(d.valid_from)}</span></> : 'Fără dată de început'}
                        {d.valid_to ? <> până la <span className="font-mono text-[12px] text-text">{formatDate(d.valid_to)}</span></> : ', fără dată de sfârșit'}
                        {' · '}
                        {d.fragments} {d.fragments === 1 ? 'fragment' : 'fragmente'}
                      </p>
                      {note && <p role="note" className="mt-1 rounded-md bg-warn-soft px-2 py-1 text-[12px] leading-snug text-warn-text">{note}</p>}
                    </div>
                    {canWrite && (
                      <div className="flex flex-none flex-wrap items-center gap-2">
                        {d.status === 'draft' && canApprove && <Button variant="primary" loading={busy === `approve:${d.id}`} onClick={() => void run(`approve:${d.id}`, () => providers.assistant.setDocumentStatus(brand, d.id, 'approved'))}>Aprobă</Button>}
                        {d.status === 'draft' && <Button variant="ghost" loading={busy === `delete:${d.id}`} onClick={() => void run(`delete:${d.id}`, () => providers.assistant.deleteDocument(brand, d.id))}>Șterge ciorna</Button>}
                        {d.status === 'approved' && canApprove && <Button variant="ghost" loading={busy === `retire:${d.id}`} onClick={() => void run(`retire:${d.id}`, () => providers.assistant.setDocumentStatus(brand, d.id, 'retired'))}>Retrage</Button>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )
        }
      </Resolved>
      {error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{error}</p>}
      {canWrite && <p className="text-[12px] leading-snug text-text-2">Un document aprobat nu se mai editează: se retrage și se adaugă versiunea nouă. Căutarea e pe cuvinte, nu pe înțeles: un fragment e găsit când întrebarea folosește cuvintele lui.</p>}
      {adding && (
        <DocumentDialog
          today={today}
          onClose={() => setAdding(false)}
          onSave={async (doc) => {
            const r = await providers.assistant.addDocument(brand, doc).catch((): ProviderResult<never> => ({ kind: 'error', message: 'Documentul nu a putut fi salvat. Reîncearcă.' }))
            if (r.kind === 'ready') {
              list.reload()
              return null
            }
            return r.kind === 'error' ? r.message : r.reason
          }}
        />
      )}
    </Section>
  )
}

const field = 'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus-visible:border-accent'
const labelCls = 'text-[12.5px] font-semibold'

function DocumentDialog({ today, onClose, onSave }: { today: string; onClose: () => void; onSave: (doc: NewBrandDocument) => Promise<string | null> }) {
  const id = useId()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<DocumentType>('product_info')
  const [product, setProduct] = useState('')
  const [country, setCountry] = useState('RO')
  const [language, setLanguage] = useState('ro')
  const [version, setVersion] = useState('1.0')
  const [owner, setOwner] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Documentul are nevoie de un titlu.')
    if (!/^[A-Za-z]{2}$/.test(country.trim()) || !/^[A-Za-z]{2}$/.test(language.trim())) return setError('Țara și limba au câte două litere, de exemplu RO și ro.')
    if (!version.trim()) return setError('Scrie versiunea documentului, de exemplu 1.0.')
    if (from && to && to < from) return setError('Valabilitatea nu se poate termina înainte să înceapă.')
    if (!text.trim()) return setError('Lipește textul documentului.')
    setBusy(true)
    setError(null)
    const failed = await onSave({ title, doc_type: type, product: product.trim() || null, country, language, version, owner: owner.trim() || null, valid_from: from || null, valid_to: to || null, text })
    setBusy(false)
    if (failed) return setError(failed)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Document nou"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Renunță</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>Salvează ca ciornă</Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-title`} className={labelCls}>Titlu</label>
          <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className={field} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-type`} className={labelCls}>Tip</label>
            <select id={`${id}-type`} value={type} onChange={(e) => setType(e.target.value as DocumentType)} className={field}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-product`} className={labelCls}>Produs (opțional)</label>
            <input id={`${id}-product`} value={product} onChange={(e) => setProduct(e.target.value)} maxLength={200} className={field} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-country`} className={labelCls}>Țară</label>
            <input id={`${id}-country`} value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} className={`${field} uppercase`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-language`} className={labelCls}>Limbă</label>
            <input id={`${id}-language`} value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={2} className={`${field} lowercase`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-version`} className={labelCls}>Versiune</label>
            <input id={`${id}-version`} value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} className={field} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-owner`} className={labelCls}>Cine răspunde de document la brand</label>
          <input id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={200} className={field} />
          <p className="text-[12px] leading-snug text-text-2">Persoana sau departamentul. Se cere la aprobare, nu la salvarea ciornei.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-from`} className={labelCls}>Valabil de la</label>
            <input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-to`} className={labelCls}>Până la (opțional)</label>
            <input id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-text`} className={labelCls}>Textul documentului</label>
          <textarea id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={8} className={`${field} font-mono text-[12.5px]`} />
          <p className="text-[12px] leading-snug text-text-2">Lipește textul aprobat, neschimbat. Un rând care începe cu # e titlu de secțiune. Textul pleacă spre furnizorul modelului doar ca fragmente potrivite unei întrebări: nu include date personale.</p>
        </div>
        {error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{error}</p>}
      </form>
    </Dialog>
  )
}
