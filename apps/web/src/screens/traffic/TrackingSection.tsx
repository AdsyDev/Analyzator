import { CheckCircleIcon, QuestionIcon, WarningCircleIcon, WarningIcon } from '@phosphor-icons/react'
import type { ProviderResult, TrackingQuality, TrackingStatus } from '../../contracts'
import { StatusChip, type ChipTone } from '../../components/ui/Chip'
import type { AsyncState } from '../../data/useAsync'
import { formatDateTime } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const STATUS: Record<TrackingStatus, { label: string; tone: ChipTone; icon: typeof CheckCircleIcon }> = {
  ok: { label: 'În regulă', tone: 'pos', icon: CheckCircleIcon },
  warning: { label: 'Avertisment', tone: 'warn', icon: WarningIcon },
  problem: { label: 'Problemă', tone: 'neg', icon: WarningCircleIcon },
  unknown: { label: 'Necunoscut', tone: 'neutral', icon: QuestionIcon },
}

/** Tracking quality: listă de verificări. Sensul stă în text și icon, nu doar în culoare. */
export function TrackingSection({ state, onRetry }: { state: AsyncState<ProviderResult<TrackingQuality>>; onRetry: () => void }) {
  return (
    <Section id="tracking" title="Tracking quality" description="Verificări rulate zilnic. Cifrele de mai sus sunt la fel de bune ca măsurarea din spatele lor.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă verificările" skeletonClass="h-40">
        {(q) => (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {q.checks.map((c) => {
                const s = STATUS[c.status]
                const Icon = s.icon
                return (
                  <li key={c.id} data-status={c.status} className="flex items-start gap-3 px-4 py-3">
                    <Icon size={18} aria-hidden="true" className="mt-0.5 flex-none text-text-2" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">{c.title}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-text-2">{c.note}</p>
                    </div>
                    <StatusChip tone={s.tone}>{s.label}</StatusChip>
                  </li>
                )
              })}
            </ul>
            <p className="text-[12px] text-text-2">Verificat la <span className="font-mono text-[11.5px] text-text">{formatDateTime(q.checked_at)}</span>.</p>
          </div>
        )}
      </Resolved>
    </Section>
  )
}
