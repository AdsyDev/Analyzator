import { UploadSimpleIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { MissingData } from '../../components/MissingData'
import { Button } from '../../components/ui/Button'
import { sitePath } from '../../lib/navigation'
import { useLayout } from '../../routing/AppLayout'

interface Props {
  /** Numele modulului, în mesajul paginii („Pentru perioada selectată nu avem date pentru …”). */
  label: string
  /** Motivul, pentru echipă (tooltip pe numele din mesaj). */
  text: string
  /** Doar `agency_admin` are acces la Importuri (în sursele site-ului); ceilalți nu primesc o acțiune care nu funcționează. */
  canImport: boolean
}

/**
 * Un modul pe bază de import, fără import: nimic din modul nu se desenează, pagina spune „Pentru perioada selectată nu
 * avem date pentru …” (decizia AG). Adminul primește acțiunea „Importă CSV”, care doar intră în flux (pagina site-ului →
 * Surse → Import CSV); logica importului nu e aici.
 */
export function ImportGate({ label, text, canImport }: Props) {
  const navigate = useNavigate()
  const { brand } = useLayout()
  return (
    <>
      <MissingData label={label} reason={`${text} Datele acestui modul vin din importuri.`} />
      {canImport && brand && (
        <div>
          <Button icon={<UploadSimpleIcon size={16} aria-hidden="true" />} onClick={() => navigate(`${sitePath(brand.id)}?source=csv_import`)}>
            Importă CSV
          </Button>
        </div>
      )}
    </>
  )
}
