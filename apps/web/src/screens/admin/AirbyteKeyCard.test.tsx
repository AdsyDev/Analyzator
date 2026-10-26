import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AirbyteInspection, AirbyteTable } from '../../contracts'
import { formatRange } from '../../lib/format'
import { AirbyteSummary } from './AirbyteKeyCard'

const table = (o: Partial<AirbyteTable> = {}): AirbyteTable => ({
  schema: 'meta', table: 'ads_insights', role: 'report', level: 'ad', rows: 110, accounts: 2, first_date: '2026-09-01', last_date: '2026-10-25',
  last_synced_at: '2026-10-26T03:00:00Z', metrics: ['clicks', 'spend'], dimensions: ['age'], error: null, ...o,
})

const inspection = (o: Partial<AirbyteInspection> = {}): AirbyteInspection => ({
  outcome: 'ok', credential_status: 'valid', message: 'Conexiunea funcționează: 2 conturi în 1 tabel (Meta Ads).', calls_today: 3, daily_limit: 30,
  inspected_at: '2026-10-26T10:00:00Z', platforms: [{ platform: 'meta_ads', label: 'Meta Ads', tables: [table()] }], accounts: [], truncated: false, ...o,
})

describe('rezumatul inspecției Airbyte', () => {
  it('tabelul: nivelul, conturile, perioada în format românesc, metricile și defalcările', () => {
    render(<AirbyteSummary inspection={inspection()} />)
    const item = screen.getByText('meta.ads_insights').closest('li')!
    expect(item).toHaveTextContent('raport pe anunț')
    expect(item).toHaveTextContent('2 conturi')
    expect(item).toHaveTextContent(formatRange('2026-09-01', '2026-10-25'))
    expect(within(item).getByText('clicks, spend')).toBeInTheDocument()
    expect(within(item).getByText('age')).toBeInTheDocument()
    expect(screen.getByText('Inspecții azi: 3 din 30.', { exact: false })).toBeInTheDocument()
  })

  it('un tabel necitit: motivul, fără „0 conturi” sau perioadă inventată', () => {
    render(<AirbyteSummary inspection={inspection({ platforms: [{ platform: 'meta_ads', label: 'Meta Ads', tables: [table({ error: 'timeout', rows: null, accounts: null, first_date: null, last_date: null, metrics: [], dimensions: [] })] }] })} />)
    const item = screen.getByText('meta.ads_insights').closest('li')!
    expect(item).toHaveTextContent('nu a răspuns la timp')
    expect(item).not.toHaveTextContent('0 conturi')
    expect(item).not.toHaveTextContent('—')
  })

  it('o configurare greșită: motivul din funcția server, fără tabele', () => {
    render(<AirbyteSummary inspection={inspection({ outcome: 'tls_failed', credential_status: 'invalid', message: 'Conexiunea TLS a eșuat.', platforms: [], inspected_at: null })} />)
    expect(screen.getByText('Problemă')).toBeInTheDocument()
    expect(screen.getByText('Conexiunea TLS a eșuat.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
