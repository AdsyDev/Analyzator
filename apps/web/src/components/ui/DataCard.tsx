import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface DataField {
  key: string
  /** Eticheta (antetul coloanei). Fără etichetă, valoarea ocupă tot rândul. */
  label: ReactNode
  value: ReactNode
}

/** Lista de carduri care înlocuiește un tabel pe telefon. `label` ține locul `caption`-ului tabelului. */
export function DataCardList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {children}
    </ul>
  )
}

/** Un rând de tabel, pe telefon: titlul (prima coloană), opțional un element în dreapta, apoi perechi etichetă: valoare. */
export function DataCard({ title, aside, fields, onClick }: { title: ReactNode; aside?: ReactNode; fields: DataField[]; onClick?: () => void }) {
  return (
    <li onClick={onClick} className={cn('flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5 shadow-1', onClick && 'cursor-pointer active:bg-surface-2')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-text [overflow-wrap:anywhere]">{title}</div>
        {aside && <div className="flex-none">{aside}</div>}
      </div>
      {fields.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 border-t border-border pt-2.5 text-[13px]">
          {fields.map((f) =>
            f.label ? (
              <div key={f.key} className="contents">
                <dt className="text-[12.5px] text-text-2">{f.label}</dt>
                <dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{f.value}</dd>
              </div>
            ) : (
              <dd key={f.key} className="col-span-2 min-w-0">
                {f.value}
              </dd>
            ),
          )}
        </dl>
      )}
    </li>
  )
}
