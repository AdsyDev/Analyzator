import { useNavigate } from 'react-router-dom'
import type { Brand, EvidenceQuery, MetricDefinition, MetricItem, QueryContext } from '../../contracts'
import { EvidenceDrawer } from '../../components/EvidenceDrawer'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { adminPath } from '../../lib/navigation'

export interface EvidenceTarget {
  /** Pagina din care s-a deschis (de ex. „Overview"). */
  page: string
  /** Eticheta de rezervă când metrica nu are definiție în registru. */
  label: string
  query: EvidenceQuery
  /** Când vin deja de la card; altfel se încarcă aici (de ex. dovezile unei analize). */
  item?: MetricItem
  definition?: MetricDefinition | null
}

interface Props {
  brand: Brand
  target: EvidenceTarget | null
  onClose: () => void
  /** Doar `agency_admin` are acces la Surse. */
  canManageSources: boolean
}

/**
 * Deschide EvidenceDrawer pentru o metrică: încarcă (dacă lipsesc) metrica și definiția, apoi înregistrările
 * sursă, toate prin provideri. Fiecare parte are starea ei: o dovadă lentă sau căzută nu blochează restul.
 */
export function EvidenceHost({ brand, target, onClose, canManageSources }: Props) {
  const providers = useProviders()
  const navigate = useNavigate()
  const toast = useToast()
  const qKey = target ? JSON.stringify(target.query) : ''

  const evidence = useAsync(() => (target ? providers.metrics.evidence(brand.id, target.query) : Promise.resolve(null)), [providers, brand.id, qKey])

  const resolved = useAsync(async () => {
    if (!target) return null
    if (target.item && target.definition !== undefined) return { item: target.item, definition: target.definition }
    const q = target.query
    const ctx: QueryContext = { brandId: brand.id, period: { preset: 'custom', from: q.period.start, to: q.period.end }, comparison: 'previous', filters: {} }
    const [bundle, defs] = await Promise.all([target.item ? null : providers.metrics.metrics(ctx, [q.metric_key]), target.definition !== undefined ? null : providers.metrics.definitions([q.metric_key])])
    return {
      item: target.item ?? bundle?.items[0] ?? null,
      definition: target.definition !== undefined ? target.definition : defs?.kind === 'ready' ? (defs.data[0] ?? null) : null,
    }
  }, [providers, brand.id, qKey])

  const ev = evidence.state.status === 'done' ? evidence.state.value : evidence.state.status === 'failed' ? ({ kind: 'error', message: evidence.state.message } as const) : null
  const meta = resolved.state.status === 'done' ? resolved.state.value : null

  async function copy(hash: string) {
    try {
      await navigator.clipboard.writeText(hash)
      toast('Hash copiat.')
    } catch {
      toast('Nu am putut copia hash-ul.')
    }
  }

  // Fără țintă, drawerul nu se montează (la demontare, Dialog restituie focusul elementului care l-a deschis).
  if (!target) return null

  return (
    <EvidenceDrawer
      open
      onClose={onClose}
      page={target.page}
      label={meta?.definition?.label ?? target.label}
      metric={meta?.item ?? null}
      definition={meta?.definition ?? null}
      period={{ from: target.query.period.start, to: target.query.period.end }}
      evidence={ev}
      onRetry={evidence.reload}
      onCopyHash={copy}
      connectAction={canManageSources ? { label: 'Vezi sursele', onClick: () => navigate(adminPath('sources')) } : undefined}
    />
  )
}
