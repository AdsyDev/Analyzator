import { UploadSimpleIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { sitePath } from '../../lib/navigation'
import { useLayout } from '../../routing/AppLayout'

interface Props {
  /** Textul din design pentru modulul fără sursă (cu numele brandului). */
  text: string
  /** Doar `agency_admin` are acces la Importuri (în sursele site-ului); ceilalți nu primesc o acțiune care nu funcționează. */
  canImport: boolean
}

/**
 * Starea implicită a unui modul pe bază de import fără import: „Sursă neconectată", explicația și acțiunea
 * „Importă CSV". Acțiunea doar intră în flux (pagina site-ului → Surse → Import CSV); logica importului nu e aici.
 */
export function ImportGate({ text, canImport }: Props) {
  const navigate = useNavigate()
  const { brand } = useLayout()
  return (
    <EmptyState
      icon={<UploadSimpleIcon size={36} weight="thin" />}
      title="Sursă neconectată"
      text={`${text} Datele acestui modul vin din importuri: importă un export CSV ca să le vezi aici.`}
      action={canImport && brand ? { label: 'Importă CSV', onClick: () => navigate(`${sitePath(brand.id)}?source=csv_import`), icon: <UploadSimpleIcon size={16} aria-hidden="true" /> } : undefined}
    />
  )
}
