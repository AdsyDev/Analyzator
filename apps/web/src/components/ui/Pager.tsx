import { cn } from '../../lib/cn'

/** Pagina curentă dintr-o listă deja încărcată: elementele vizibile și poziția lor. Pagina cerută se limitează la ultima. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * pageSize
  return { visible: items.slice(start, start + pageSize), current, pages, start }
}

interface PagerProps {
  current: number
  pages: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  className?: string
}

/** „a-b din n”, „Înapoi”, „Înainte”; schimbă pagina pe loc, fără reîncărcare. Nimic dacă totul încape pe o pagină. */
export function Pager({ current, pages, pageSize, total, onPage, className }: PagerProps) {
  if (pages <= 1) return null
  const start = (current - 1) * pageSize
  return (
    <nav aria-label="Paginare" className={cn('flex items-center gap-3 text-[12px] text-text-2', className)}>
      <span>
        {start + 1}-{Math.min(start + pageSize, total)} din {total}
      </span>
      <span className="flex-1" />
      <button type="button" disabled={current <= 1} onClick={() => onPage(current - 1)} className="rounded-md px-2 py-1 hover:bg-neutral-soft disabled:opacity-40">
        Înapoi
      </button>
      <button type="button" disabled={current >= pages} onClick={() => onPage(current + 1)} className="rounded-md px-2 py-1 hover:bg-neutral-soft disabled:opacity-40">
        Înainte
      </button>
    </nav>
  )
}
