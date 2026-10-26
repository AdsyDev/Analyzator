import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Avatar, initials } from './Avatar'
import { Button } from './Button'
import { FilterChip, StatusChip } from './Chip'
import { Dialog } from './Dialog'
import { InfoTip } from './InfoTip'
import { Menu } from './Menu'
import { SortableTable, type Column } from './SortableTable'
import { Tabs } from './Tabs'
import { ToastProvider, useToast } from './Toast'

describe('Button', () => {
  it('loading dezactivează și marchează aria-busy', () => {
    render(<Button loading>Salvează</Button>)
    const b = screen.getByRole('button', { name: 'Salvează' })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
  })
  it('disabled nu apelează onClick', async () => {
    const f = vi.fn()
    render(<Button disabled onClick={f}>x</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(f).not.toHaveBeenCalled()
  })
})

describe('Chip', () => {
  it('StatusChip are textul statusului', () => {
    render(<StatusChip tone="warn">În review</StatusChip>)
    expect(screen.getByText('În review')).toBeInTheDocument()
  })
  it('FilterChip: aria-pressed și eliminare', async () => {
    const onRemove = vi.fn()
    render(<FilterChip active onRemove={onRemove}>Device: Mobil</FilterChip>)
    expect(screen.getByRole('button', { name: 'Device: Mobil' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Elimină filtrul Device: Mobil' }))
    expect(onRemove).toHaveBeenCalled()
  })
})

describe('Avatar', () => {
  it('inițiale din nume', () => {
    expect(initials('Andreea Vlad')).toBe('AV')
    expect(initials('Mihai')).toBe('M')
    expect(initials('  ')).toBe('?')
    render(<Avatar name="Ștefan Ionescu" />)
    expect(screen.getByRole('img', { name: 'Ștefan Ionescu' })).toHaveTextContent('ȘI')
  })
})

describe('Tabs', () => {
  function Harness() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a')
    return <Tabs label="Vedere" value={v} onChange={setV} items={[{ id: 'a', label: 'Flux' }, { id: 'b', label: 'Publicate' }, { id: 'c', label: 'Arhivă' }]} />
  }
  it('selectează cu click și cu săgeți, cu roving tabindex', async () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Flux' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Flux' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Publicate' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Publicate' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Arhivă' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Flux' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Publicate' })).toHaveAttribute('tabindex', '-1')
  })
})

describe('InfoTip', () => {
  it('se deschide la hover, la focus și la click; Esc îl închide', async () => {
    render(<InfoTip>Definiție</InfoTip>)
    const btn = screen.getByRole('button', { name: 'Ce înseamnă indicatorul' })
    await userEvent.hover(btn)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Definiție')
    await userEvent.unhover(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Toast', () => {
  function Trigger() {
    const toast = useToast()
    return <button onClick={() => toast('Sincronizarea GA4 a pornit.')}>go</button>
  }
  it('afișează mesajul în role=status și îl scoate după durată', async () => {
    vi.useFakeTimers()
    render(<ToastProvider duration={1000}><Trigger /></ToastProvider>)
    act(() => screen.getByText('go').click())
    expect(within(screen.getByRole('status')).getByText('Sincronizarea GA4 a pornit.')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(1100))
    expect(screen.queryByText('Sincronizarea GA4 a pornit.')).toBeNull()
    vi.useRealTimers()
  })
})

describe('Dialog', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Deschide</button>
        <Dialog open={open} onClose={() => { setOpen(false); onClose() }} title="Confirmare" footer={<><Button>Anulează</Button><Button variant="primary">Confirmă</Button></>}>
          <p>Conținut</p>
        </Dialog>
      </>
    )
  }
  it('nu randează când e închis', () => {
    render(<Dialog open={false} onClose={() => {}} title="x">c</Dialog>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('modal etichetat, focus pe primul element, Esc închide și restituie focusul', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByText('Deschide')
    await userEvent.click(opener)
    const dlg = screen.getByRole('dialog', { name: 'Confirmare' })
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Închide' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
  it('capturează focusul cu Tab și Shift+Tab', async () => {
    render(<Harness onClose={() => {}} />)
    await userEvent.click(screen.getByText('Deschide'))
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Confirmă' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Închide' })).toHaveFocus()
  })
  it('respectă înălțimea bannerului de previzualizare (--banner-h), ca antetul să nu fie acoperit', async () => {
    render(<Dialog open onClose={() => {}} title="x" placement="right">c</Dialog>)
    expect(screen.getByTestId('scrim').parentElement?.className).toContain('top-[var(--banner-h,0px)]')
  })

  it('click pe scrim închide', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByText('Deschide'))
    await userEvent.click(screen.getByTestId('scrim'))
    expect(onClose).toHaveBeenCalled()
  })
})

interface Row { id: string; name: string; clicks: number | null }
const columns: Column<Row>[] = [
  { key: 'name', header: 'Keyword', sortValue: (r) => r.name, render: (r) => r.name },
  { key: 'clicks', header: 'Clicks', align: 'right', sortValue: (r) => r.clicks, render: (r) => (r.clicks === null ? 'Fără date' : String(r.clicks)) },
]
const rows: Row[] = [
  { id: '1', name: 'urinal', clicks: 30 },
  { id: '2', name: 'cistită', clicks: null },
  { id: '3', name: 'merișor', clicks: 0 },
  { id: '4', name: 'd-manoză', clicks: 12 },
]
const order = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]?.textContent)

describe('SortableTable', () => {
  it('sortează asc, desc, apoi revine; lipsa (null) rămâne la sfârșit, zero e valoare', async () => {
    render(<SortableTable caption="Keywords" columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Nu există keywords." />)
    const th = screen.getByRole('columnheader', { name: /Clicks/ })
    expect(th).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(within(th).getByRole('button'))
    expect(th).toHaveAttribute('aria-sort', 'ascending')
    expect(order()).toEqual(['merișor', 'd-manoză', 'urinal', 'cistită'])
    await userEvent.click(within(th).getByRole('button'))
    expect(th).toHaveAttribute('aria-sort', 'descending')
    expect(order()).toEqual(['urinal', 'd-manoză', 'merișor', 'cistită'])
    await userEvent.click(within(th).getByRole('button'))
    expect(order()).toEqual(['urinal', 'cistită', 'merișor', 'd-manoză'])
  })

  it('paginează cu „a-b din n"', async () => {
    render(<SortableTable caption="Keywords" columns={columns} rows={rows} rowKey={(r) => r.id} pageSize={3} emptyText="x" />)
    expect(screen.getByText('1-3 din 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Înapoi' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Înainte' }))
    expect(screen.getByText('4-4 din 4')).toBeInTheDocument()
    expect(order()).toEqual(['d-manoză'])
  })

  it('stare goală cu explicație', () => {
    render(<SortableTable caption="Keywords" columns={columns} rows={[]} rowKey={(r) => r.id} emptyText="Nu există keywords pentru filtrele alese." />)
    expect(screen.getByText('Nu există keywords pentru filtrele alese.')).toBeInTheDocument()
  })

  it('click pe rând', async () => {
    const onRowClick = vi.fn()
    render(<SortableTable caption="K" columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="x" onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('urinal'))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })
})

describe('Popovere pe ecrane înguste', () => {
  // jsdom nu are layout: se simulează un ecran de 390 px și un panou care ar ieși prin dreapta.
  function narrowScreen(panelRect: { left: number; width: number }) {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390)
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const popover = this.getAttribute('role') === 'menu' || this.getAttribute('role') === 'tooltip'
      const { left, width } = popover ? panelRect : { left: 0, width: 0 }
      return { left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect
    })
  }

  it('meniul care ar ieși prin dreapta se mută înăuntru, cu 8 px margine', async () => {
    narrowScreen({ left: 300, width: 224 })
    render(<Menu label="Platformă" trigger="Platformă" value="a" options={[{ value: 'a', label: 'Toate' }]} onSelect={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Platformă' }))
    // 390 - 8 - (300 + 224) = -142
    expect(screen.getByRole('menu', { name: 'Platformă' })).toHaveStyle({ transform: 'translateX(-142px)' })
    vi.restoreAllMocks()
  })

  it('tooltipul care încape rămâne pe loc', async () => {
    narrowScreen({ left: 20, width: 256 })
    render(<InfoTip>Definiția</InfoTip>)
    await userEvent.click(screen.getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(screen.getByRole('tooltip').style.transform).toBe('')
    vi.restoreAllMocks()
  })
})

describe('SortableTable pe telefon', () => {
  // jsdom nu are media queries: se simulează un ecran sub 640 px.
  const phone = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('40rem'), addEventListener: () => {}, removeEventListener: () => {} }))
  const titles = () => within(screen.getByRole('list', { name: 'Keywords' })).getAllByRole('listitem').map((li) => li.firstElementChild?.textContent)

  it('un card pe rând: prima coloană e titlul, celelalte sunt „etichetă: valoare"; lipsa rămâne lipsă', () => {
    phone()
    render(<SortableTable caption="Keywords" columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="x" />)
    expect(screen.queryByRole('table')).toBeNull()
    const cards = within(screen.getByRole('list', { name: 'Keywords' })).getAllByRole('listitem')
    expect(cards).toHaveLength(4)
    expect(within(cards[0]!).getByRole('term')).toHaveTextContent('Clicks')
    expect(within(cards[0]!).getByRole('definition')).toHaveTextContent('30')
    expect(within(cards[1]!).getByRole('definition')).toHaveTextContent('Fără date')
    expect(within(cards[2]!).getByRole('definition')).toHaveTextContent('0')
  })

  it('sortarea se alege dintr-o listă, cu direcția; lipsa rămâne la sfârșit', async () => {
    phone()
    render(<SortableTable caption="Keywords" columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="x" />)
    const select = screen.getByRole('combobox', { name: 'Sortează după' })
    await userEvent.selectOptions(select, 'Clicks, crescător')
    expect(titles()).toEqual(['merișor', 'd-manoză', 'urinal', 'cistită'])
    await userEvent.selectOptions(select, 'Clicks, descrescător')
    expect(titles()).toEqual(['urinal', 'd-manoză', 'merișor', 'cistită'])
    await userEvent.selectOptions(select, 'Ordinea implicită')
    expect(titles()).toEqual(['urinal', 'cistită', 'merișor', 'd-manoză'])
  })

  it('„Tabel" arată tabelul; click pe card apelează onRowClick', async () => {
    phone()
    const onRowClick = vi.fn()
    render(<SortableTable caption="Keywords" columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="x" onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('urinal'))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
    await userEvent.click(screen.getByRole('tab', { name: 'Tabel' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Keywords' })).toBeNull()
  })

  it('phoneCards={false} păstrează tabelul (ecranul are propriile carduri)', () => {
    phone()
    render(<SortableTable caption="Keywords" columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="x" phoneCards={false} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

