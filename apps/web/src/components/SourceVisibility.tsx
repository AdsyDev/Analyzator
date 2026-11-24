import { createContext, useContext, type ReactNode } from 'react'

/**
 * Numele furnizorului de date (SEOmonitor, Search Console, GA4, Planable...) și fâșia „Starea datelor” sunt
 * vizibile doar administratorului agenției (cererea din 24 nov. 2026). Celelalte roluri văd cifrele, perioada și
 * „Date până la”, fără atribuirea pe sursă. Implicit ascuns: un ecran randat fără furnizor nu arată sursele.
 * E doar prezentare; nu ascunde date pe care serverul le-ar refuza rolului.
 */
const SourceVisibilityContext = createContext(false)

export function SourceVisibilityProvider({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <SourceVisibilityContext.Provider value={visible}>{children}</SourceVisibilityContext.Provider>
}

/** `true` doar când utilizatorul curent poate vedea sursele datelor. */
export function useShowSources(): boolean {
  return useContext(SourceVisibilityContext)
}
