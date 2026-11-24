import { InfoIcon } from '@phosphor-icons/react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Datele lipsă (decizia AG, cererea proprietarului produsului din 24 nov. 2026: „nu vreau să mai văd nicăieri «Sursă
 * neconectată»; nu-mi arăta boxul și pune un mesaj că pentru perioada selectată…”).
 *
 * O secțiune sau un card fără sursă nu se mai desenează. Pagina adună titlurile lor într-un singur mesaj, sub titlul ei:
 * „Pentru perioada selectată nu avem date pentru: …”. Motivul tehnic rămâne în atributul `title` al numelui, pentru echipă.
 * Erorile (nu am putut citi datele) nu trec pe aici: rămân vizibile, cu „Reîncearcă” (regula 8: lipsă ≠ eroare).
 *
 * Mecanism: o „cutie” (Section, card de pe Overview, card KPI) e un `MissingScope`. Un descendent fără sursă (`MissingData`)
 * îi raportează lipsa; unul cu date (`ReadyMark`) îi raportează prezența. Cutia se ascunde când are doar lipsuri și se
 * înregistrează în mesajul paginii. Ascunderea e cu atributul `hidden` (copiii rămân montați), ca raportarea să nu oscileze.
 */

type Entry = { label: string; reason: string | null }

const PageCtx = createContext<{ set: (id: string, entry: Entry | null) => void } | null>(null)
const ScopeCtx = createContext<{ report: (id: string, kind: 'missing' | 'ready' | null, reason?: string | null) => void } | null>(null)

/** Mesajul paginii, sub titlu și filtre. Fără intrări nu desenează nimic. */
export function MissingDataProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Array<[string, Entry]>>([])
  const set = useCallback((id: string, entry: Entry | null) => {
    setEntries((list) => {
      const rest = list.filter(([k]) => k !== id)
      if (!entry) return rest.length === list.length ? list : rest
      const prev = list.find(([k]) => k === id)?.[1]
      if (prev && prev.label === entry.label && prev.reason === entry.reason) return list
      // Ordinea de pe pagină: o intrare nouă se adaugă la final, una actualizată își păstrează locul.
      return prev ? list.map(([k, e]) => [k, k === id ? entry : e] as [string, Entry]) : [...rest, [id, entry]]
    })
  }, [])
  const value = useMemo(() => ({ set }), [set])
  // Același nume o singură dată (de ex. două secțiuni care citesc aceeași sursă).
  const labels = [...new Map(entries.map(([, e]) => [e.label, e])).values()]
  return (
    <PageCtx.Provider value={value}>
      {labels.length > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] leading-snug text-text-2">
          <InfoIcon size={16} aria-hidden="true" className="mt-px flex-none text-text-3" />
          <span>
            Pentru perioada selectată nu avem date pentru{' '}
            {labels.map((e, i) => (
              <span key={e.label}>
                {i > 0 && (i === labels.length - 1 ? ' și ' : ', ')}
                <span className="font-medium text-text" title={e.reason ?? undefined}>{e.label}</span>
              </span>
            ))}
            .
          </span>
        </p>
      )}
      {children}
    </PageCtx.Provider>
  )
}

/** Înregistrează (sau scoate) un nume în mesajul paginii. */
export function useMissingOnPage(label: string, active: boolean, reason: string | null = null) {
  const page = useContext(PageCtx)
  const id = useId()
  useEffect(() => {
    if (!page) return
    page.set(id, active ? { label, reason } : null)
    return () => page.set(id, null)
  }, [page, id, label, active, reason])
}

/**
 * O cutie care dispare când are doar conținut fără sursă. `render(hidden)` întoarce elementul cutiei, cu `hidden` pus
 * de apelant pe elementul rădăcină.
 */
export function MissingScope({ label, children }: { label: string; children: (hidden: boolean) => ReactNode }) {
  const [state, setState] = useState<{ missing: Map<string, string | null>; ready: Set<string> }>(() => ({ missing: new Map(), ready: new Set() }))
  const report = useCallback((id: string, kind: 'missing' | 'ready' | null, reason: string | null = null) => {
    setState((s) => {
      const hadMissing = s.missing.has(id)
      const hadReady = s.ready.has(id)
      if (kind === 'missing' && hadMissing && s.missing.get(id) === reason && !hadReady) return s
      if (kind === 'ready' && hadReady && !hadMissing) return s
      if (kind === null && !hadMissing && !hadReady) return s
      const missing = new Map(s.missing)
      const ready = new Set(s.ready)
      missing.delete(id)
      ready.delete(id)
      if (kind === 'missing') missing.set(id, reason)
      if (kind === 'ready') ready.add(id)
      return { missing, ready }
    })
  }, [])
  const value = useMemo(() => ({ report }), [report])
  const hidden = state.missing.size > 0 && state.ready.size === 0
  const firstReason = hidden ? ([...state.missing.values()].find((r) => r) ?? null) : null
  useMissingOnPage(label, hidden, firstReason)
  return <ScopeCtx.Provider value={value}>{children(hidden)}</ScopeCtx.Provider>
}

function useReport(kind: 'missing' | 'ready', reason: string | null) {
  const scope = useContext(ScopeCtx)
  const id = useId()
  const reasonRef = useRef(reason)
  reasonRef.current = reason
  useEffect(() => {
    if (!scope) return
    scope.report(id, kind, reasonRef.current)
    return () => scope.report(id, null)
  }, [scope, id, kind, reason])
  return scope !== null
}

/**
 * Conținut fără sursă. În interiorul unei cutii, o ascunde (dacă nu are și conținut cu date) și lasă un rând discret în
 * locul lui. Fără cutie (de ex. un modul întreg fără sursă), pune `label` în mesajul paginii.
 */
export function MissingData({ reason = null, label = 'această pagină' }: { reason?: string | null; label?: string }) {
  const inScope = useReport('missing', reason)
  useMissingOnPage(label, !inScope, reason)
  if (!inScope) return null
  return <p className="text-[13px] leading-snug text-text-3">Pentru perioada selectată nu avem date aici.</p>
}

/** Conținut cu date într-o cutie: cutia rămâne vizibilă chiar dacă o altă parte a ei nu are sursă. */
export function ReadyMark() {
  useReport('ready', null)
  return null
}
