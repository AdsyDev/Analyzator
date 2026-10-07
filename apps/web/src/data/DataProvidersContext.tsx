import { createContext, useContext, type ReactNode } from 'react'
import type { DataProviders } from '../contracts'

const DataProvidersContext = createContext<DataProviders | null>(null)

export function DataProvidersProvider({ providers, children }: { providers: DataProviders; children: ReactNode }) {
  return <DataProvidersContext.Provider value={providers}>{children}</DataProvidersContext.Provider>
}

export function useProviders(): DataProviders {
  const ctx = useContext(DataProvidersContext)
  if (!ctx) throw new Error('useProviders se folosește în interiorul DataProvidersProvider')
  return ctx
}
