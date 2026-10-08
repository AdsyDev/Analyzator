import type { PvStatus, Sentiment } from '../../contracts'
import type { ChipTone } from '../../components/ui/Chip'

export const SENTIMENT_LABELS: Record<Sentiment, { label: string; tone: ChipTone; bar: string }> = {
  positive: { label: 'Pozitiv', tone: 'pos', bar: 'bg-pos' },
  neutral: { label: 'Neutru', tone: 'neutral', bar: 'bg-c2' },
  negative: { label: 'Negativ', tone: 'neg', bar: 'bg-neg' },
}

export const PV_STATUS_LABELS: Record<PvStatus, { label: string; tone: ChipTone }> = {
  pending: { label: 'În așteptare', tone: 'warn' },
  notified: { label: 'Notificat', tone: 'accent' },
  acknowledged: { label: 'Confirmat', tone: 'pos' },
}
