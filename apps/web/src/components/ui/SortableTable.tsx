import { useId, useMemo, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { DataCard, DataCardList } from './DataCard'
import { paginate, Pager } from './Pager'
import { Tabs } from './Tabs'
import { useIsPhone } from './useIsPhone'

export interface Column<Row> {
  key: string
  header: string
  align?: 'left' | 'right'
  /** Valoarea de sortare. Lipsa (null) merge mereu la sfârșit, în ambele direcții. */
  sortValue?: (row: Row) => string | number | null
  render: (row: Row) => ReactNode
  /** Pe telefon, coloana care dă titlul cardului (implicit prima). */
  cardTitle?: boolean
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
  /** Pe telefon, rândurile devin carduri (cu „Tabel" ca a doua vedere). `false` când ecranul are deja propriile carduri. */
  phoneCards?: boolean
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null

function compare(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ro')
}

export function SortableTable<Row>({ caption, columns, rows, rowKey, pageSize = 10, emptyText, onRowClick, phoneCards = true }: SortableTableProps<Row>) {
  const [sort, setSort] = useState<Sort>(null)
  const [page, setPage] = useState(1)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const phone = useIsPhone()
  const sortId = useId()

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

  const { visible, current, pages } = paginate(sorted, page, pageSize)

  function toggle(key: string) {
    setPage(1)
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  }

  const empty = <p className="px-4 py-8 text-center text-[13px] text-text-2">{emptyText}</p>
  const pager = <Pager current={current} pages={pages} pageSize={pageSize} total={sorted.length} onPage={setPage} className="border-t border-border px-4 py-2" />

  const tableView = (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
      <div className="scroll-x relative">
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
      {rows.length === 0 ? empty : pager}
    </div>
  )

  if (phoneCards && phone) {
    // Telefon: un card pe rând. Sortarea se alege dintr-o listă (antetele de coloană nu mai sunt pe ecran).
    const titleColumn = columns.find((c) => c.cardTitle) ?? columns[0]
    const sortable = columns.filter((c) => c.sortValue)
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {view === 'cards' && sortable.length > 0 && (
            <>
              <label htmlFor={sortId} className="sr-only">
                Sortează după
              </label>
              {/* Coloana și direcția într-o singură listă: pe telefon, un singur control încape lângă „Carduri / Tabel". */}
              <select
                id={sortId}
                value={sort ? `${sort.key}:${sort.dir}` : ''}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(':')
                  setPage(1)
                  setSort(key && (dir === 'asc' || dir === 'desc') ? { key, dir } : null)
                }}
                className="h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-surface px-2.5 text-[13px] text-text"
              >
                <option value="">Ordinea implicită</option>
                {sortable.flatMap((c) => [
                  <option key={`${c.key}:asc`} value={`${c.key}:asc`}>
                    {c.header}, crescător
                  </option>,
                  <option key={`${c.key}:desc`} value={`${c.key}:desc`}>
                    {c.header}, descrescător
                  </option>,
                ])}
              </select>
            </>
          )}
          {(view === 'table' || sortable.length === 0) && <span className="flex-1" />}
          <Tabs
            label={`Afișarea: ${caption}`}
            items={[
              { id: 'cards', label: 'Carduri' },
              { id: 'table', label: 'Tabel' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
        {view === 'cards' ? (
          rows.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface">{empty}</div>
          ) : (
            <>
              <DataCardList label={caption}>
                {visible.map((row) => (
                  <DataCard
                    key={rowKey(row)}
                    title={titleColumn?.render(row)}
                    fields={columns.filter((c) => c !== titleColumn).map((c) => ({ key: c.key, label: c.header, value: c.render(row) }))}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  />
                ))}
              </DataCardList>
              <Pager current={current} pages={pages} pageSize={pageSize} total={sorted.length} onPage={setPage} className="px-1" />
            </>
          )
        ) : (
          tableView
        )}
      </div>
    )
  }

  return tableView
}
