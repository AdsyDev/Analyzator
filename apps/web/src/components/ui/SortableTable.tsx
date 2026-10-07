import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface Column<Row> {
  key: string
  header: string
  align?: 'left' | 'right'
  /** Valoarea de sortare. Lipsa (null) merge mereu la sfârșit, în ambele direcții. */
  sortValue?: (row: Row) => string | number | null
  render: (row: Row) => ReactNode
}

interface SortableTableProps<Row> {
  caption: string
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  pageSize?: number
  /** Textul stării goale; tabelul gol explică de ce, nu rămâne gol. */
  emptyText: string
  onRowClick?: (row: Row) => void
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null

function compare(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ro')
}

export function SortableTable<Row>({ caption, columns, rows, rowKey, pageSize = 10, emptyText, onRowClick }: SortableTableProps<Row>) {
  const [sort, setSort] = useState<Sort>(null)
  const [page, setPage] = useState(1)

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!sort || !col?.sortValue) return rows
    const get = col.sortValue
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((x, y) => {
      const a = get(x)
      const b = get(y)
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return compare(a, b) * dir
    })
  }, [rows, columns, sort])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages)
  const start = (current - 1) * pageSize
  const visible = sorted.slice(start, start + pageSize)

  function toggle(key: string) {
    setPage(1)
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-2 text-text-2">
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}
                    className={cn('px-4 py-2.5 text-[12px] font-semibold', c.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    {c.sortValue ? (
                      <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-text">
                        {c.header}
                        <span aria-hidden="true" className="text-[10px]">
                          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('border-b border-border last:border-b-0', onRowClick && 'cursor-pointer hover:bg-surface-2')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-2.5 align-middle tabular-nums', c.align === 'right' && 'text-right')}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-text-2">{emptyText}</p>
      ) : (
        pages > 1 && (
          <nav aria-label="Paginare" className="flex items-center gap-3 border-t border-border px-4 py-2 text-[12px] text-text-2">
            <span>
              {start + 1}-{Math.min(start + pageSize, sorted.length)} din {sorted.length}
            </span>
            <span className="flex-1" />
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="rounded-md px-2 py-1 hover:bg-neutral-soft disabled:opacity-40">
              Înapoi
            </button>
            <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} className="rounded-md px-2 py-1 hover:bg-neutral-soft disabled:opacity-40">
              Înainte
            </button>
          </nav>
        )
      )}
    </div>
  )
}
