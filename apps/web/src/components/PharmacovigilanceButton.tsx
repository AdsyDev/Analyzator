import { useEffect, useState } from 'react'
import type { PvFlag, PvItemRef, PvSnapshot, ProviderResult } from '../contracts'
import { formatDateTime } from '../lib/format'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import { useToast } from './ui/Toast'

interface PharmacovigilanceButtonProps {
  item: PvItemRef
  /** Marcajul existent, persistent. Marcarea nu se poate șterge, doar adnota. */
  flag: PvFlag | null
  /** Ce se va înregistra; se cere când se deschide dialogul. */
  loadSnapshot: (item: PvItemRef) => Promise<ProviderResult<PvSnapshot>>
  /** Execută marcarea (înregistrare în jurnal și notificare). */
  onConfirm: (item: PvItemRef) => Promise<ProviderResult<PvFlag>>
  onFlagged?: (flag: PvFlag) => void
}

type Phase =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PvSnapshot }
  | { kind: 'unavailable'; message: string }
  | { kind: 'saving'; snapshot: PvSnapshot }
  | { kind: 'failed'; snapshot: PvSnapshot; message: string }

function SnapshotRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2 text-[13px]">
      <dt className="w-28 flex-none text-text-2">{term}</dt>
      <dd className="min-w-0 flex-1 break-words text-text">{children}</dd>
    </div>
  )
}

export function PharmacovigilanceButton({ item, flag, loadSnapshot, onConfirm, onFlagged }: PharmacovigilanceButtonProps) {
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' })
  const [local, setLocal] = useState<PvFlag | null>(null)
  const marked = flag ?? local

  useEffect(() => {
    if (flag) setLocal(null)
  }, [flag])

  async function open() {
    setPhase({ kind: 'loading' })
    const r = await loadSnapshot(item)
    if (r.kind === 'ready') setPhase({ kind: 'ready', snapshot: r.data })
    else setPhase({ kind: 'unavailable', message: r.kind === 'not_connected' ? r.reason : r.message })
  }

  async function confirm(snapshot: PvSnapshot) {
    setPhase({ kind: 'saving', snapshot })
    const r = await onConfirm(item)
    if (r.kind === 'ready') {
      setLocal(r.data)
      setPhase({ kind: 'closed' })
      onFlagged?.(r.data)
      toast(r.data.notified ? 'Marcat pentru farmacovigilență. Contactele PV au fost notificate.' : 'Marcajul e înregistrat. Notificarea contactelor PV e în curs.')
    } else {
      setPhase({ kind: 'failed', snapshot, message: r.kind === 'not_connected' ? r.reason : r.message })
    }
  }

  const close = () => setPhase({ kind: 'closed' })

  if (marked) {
    return (
      <Button variant="ghost" disabled className="!opacity-100 text-pv" title="Marcajul rămâne în jurnal și nu poate fi șters.">
        Marcat pentru farmacovigilență, <span className="font-mono text-[12px]">{formatDateTime(marked.flagged_at)}</span>
      </Button>
    )
  }

  const snapshot = phase.kind === 'ready' || phase.kind === 'saving' || phase.kind === 'failed' ? phase.snapshot : null

  return (
    <>
      <Button variant="secondary" onClick={() => void open()} className="border-pv/40 text-pv">
        Marchează pentru farmacovigilență
      </Button>
      <Dialog
        open={phase.kind !== 'closed'}
        onClose={close}
        title="Marchează pentru farmacovigilență"
        footer={
          <>
            <Button onClick={close}>Anulează</Button>
            <Button variant="pv" disabled={!snapshot} loading={phase.kind === 'saving'} onClick={() => snapshot && void confirm(snapshot)}>
              Marchează și notifică
            </Button>
          </>
        }
      >
        {phase.kind === 'loading' && <div role="status" aria-label="Se încarcă" className="h-32 rounded-lg bg-skeleton" />}
        {phase.kind === 'unavailable' && <p className="text-[13.5px] text-text-2">{phase.message}</p>}
        {snapshot && (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-normal text-text">Verifică ce se înregistrează. Marcajul rămâne în jurnal și nu poate fi șters, doar adnotat.</p>
            <dl className="divide-y divide-border rounded-lg border border-border px-3">
              <SnapshotRow term="Data și ora"><span className="font-mono text-[12px]">{formatDateTime(snapshot.at)}</span></SnapshotRow>
              <SnapshotRow term="Utilizator">{snapshot.user}</SnapshotRow>
              <SnapshotRow term="Link">{snapshot.link ? <span className="font-mono text-[12px]">{snapshot.link}</span> : <span className="text-text-3">Fără link</span>}</SnapshotRow>
              <SnapshotRow term="Snapshot text">„{snapshot.text}"</SnapshotRow>
            </dl>
            <p className="text-[13px] leading-normal text-text-2">
              <strong className="font-semibold text-text">Ce urmează:</strong>{' '}
              {snapshot.notify.length > 0
                ? `notificăm imediat contactele de farmacovigilență configurate: ${snapshot.notify.join(', ')}.`
                : 'nu există contacte de farmacovigilență configurate; marcajul se înregistrează în jurnal, fără notificare.'}
            </p>
            {phase.kind === 'failed' && (
              <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[13px] text-neg-text">
                Nu am putut înregistra marcajul: {phase.message}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  )
}
