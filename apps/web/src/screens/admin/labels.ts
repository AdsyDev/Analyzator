import type { CredentialStatus, SyncRunStatus, ValidationOutcomeKind } from '../../contracts'
import type { ChipTone } from '../../components/ui/Chip'

export const CREDENTIAL_LABELS: Record<CredentialStatus, { label: string; tone: ChipTone }> = {
  missing: { label: 'Token neconfigurat', tone: 'neutral' },
  unverified: { label: 'Token salvat, netestat', tone: 'warn' },
  valid: { label: 'Conexiune funcțională', tone: 'pos' },
  invalid: { label: 'Token refuzat de furnizor', tone: 'neg' },
}

export const SYNC_LABELS: Record<SyncRunStatus, { label: string; tone: ChipTone }> = {
  queued: { label: 'În coadă', tone: 'neutral' },
  running: { label: 'Rulează', tone: 'accent' },
  partial: { label: 'Parțial', tone: 'warn' },
  succeeded: { label: 'Reușit', tone: 'pos' },
  failed: { label: 'Eșuat', tone: 'neg' },
}

/** Rezultatul testului: verde / roșu / galben (starea tokenului nu s-a schimbat) / testul nu a rulat. */
export const OUTCOME_TONE: Record<ValidationOutcomeKind, ChipTone> = {
  valid: 'pos',
  invalid: 'neg',
  rate_limited: 'warn',
  provider_error: 'warn',
  budget_exhausted: 'neutral',
}

export const BUDGET_RESET_NOTE = 'Bugetul zilnic e consumat. Se resetează la 00:00 UTC (03:00 ora României vara, 02:00 iarna).'

/** Singura sursă cu validare în funcția server la pilot. */
export const VALIDATABLE: readonly string[] = ['clarity']
