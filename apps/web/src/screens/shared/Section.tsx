import type { ReactNode } from 'react'

/** Suprafață solidă pentru conținut cu date (sticla e doar pentru sidebar, topbar, drawere, modale, popovere). */
export function Section({ title, description, action, children, id, plain = false }: { title: string; description?: string; action?: ReactNode; children: ReactNode; id?: string; plain?: boolean }) {
  return (
    <section aria-labelledby={id} className={plain ? 'flex flex-col gap-3' : 'flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-1'}>
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="font-display text-[16px] font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-snug text-text-2">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}
