import { useId, useState, type FormEvent } from 'react'
import type { Insight, InsightComment } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { formatDate } from '../../lib/format'

/** Cine a scris, fără nume (E10): utilizatorul curent, clientul sau echipa. */
const authorLabel = (c: InsightComment) => (c.own ? 'Tu' : c.author_role === 'client' ? 'Client' : 'Echipa AdSymphony')

/**
 * Discuția de pe o analiză publicată, între client și echipă. Comentariile nu se editează și nu se șterg; apar în
 * ordinea scrierii. `onAdd` întoarce mesajul de eroare sau `null` la reușită.
 */
export function Discussion({ insight, onAdd }: { insight: Insight; onAdd: (body: string) => Promise<string | null> }) {
  const id = useId()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const comments = insight.comments ?? []

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    const failed = await onAdd(text)
    setBusy(false)
    if (failed) return setError(failed)
    setBody('')
  }

  return (
    <section aria-label={`Discuție: ${insight.title}`} className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-2 px-4 py-3">
      <h4 className="text-[12.5px] font-semibold text-text-2">Discuție{comments.length > 0 ? ` (${comments.length})` : ''}</h4>
      {comments.length === 0 ? (
        <p className="text-[12.5px] leading-snug text-text-2">Niciun comentariu încă. Întrebările și observațiile ajung la echipa AdSymphony și rămân aici.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} data-author={c.author_role} className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-[12px] text-text-2">
                <span className="font-semibold text-text">{authorLabel(c)}</span> · <span className="font-mono">{formatDate(c.created_at.slice(0, 10))}</span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
        <label htmlFor={`${id}-body`} className="sr-only">Comentariu la analiza „{insight.title}”</label>
        <textarea id={`${id}-body`} value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} placeholder="Scrie un comentariu…" className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus-visible:border-accent" />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" type="submit" loading={busy} disabled={body.trim() === ''}>Trimite comentariul</Button>
          <span className="text-[12px] text-text-2">Comentariile nu se pot edita sau șterge după trimitere.</span>
        </div>
        {error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{error}</p>}
      </form>
    </section>
  )
}
