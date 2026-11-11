import { csvFileName } from '../../lib/csv'
import { useLayout } from '../../routing/AppLayout'

/** Numele fișierului CSV al unui tabel de brand: ce conține, brandul și perioada aleasă. */
export function useExportName(label: string): string {
  const { brand, ctx } = useLayout()
  return csvFileName(label, brand?.name, ctx?.period.from, ctx?.period.to)
}
