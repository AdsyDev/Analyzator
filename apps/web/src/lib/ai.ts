import type { AiEngine, AnswerOutcome } from '../contracts'
import type { ChipTone } from '../components/ui/Chip'

export const AI_ENGINE_LABELS: Record<AiEngine, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  aio: 'AI Overviews',
}

/**
 * Starea unui răspuns, în română. Refuzul, eroarea și necolectatul sunt etichete proprii: nu se confundă cu
 * „brandul nu e menționat" (spec 2.2) și nu intră în numitorul ratelor.
 */
export const OUTCOME_LABELS: Record<AnswerOutcome, { label: string; tone: ChipTone; explanation: string }> = {
  recommended: { label: 'Recomandat', tone: 'pos', explanation: 'Brandul e recomandat explicit în răspuns.' },
  mentioned: { label: 'Menționat', tone: 'accent', explanation: 'Brandul e menționat în răspuns.' },
  not_mentioned: { label: 'Nemenționat', tone: 'neutral', explanation: 'Răspunsul valid nu menționează brandul.' },
  refused: { label: 'Refuzat', tone: 'warn', explanation: 'Motorul a refuzat să răspundă. Un refuz nu e o absență a brandului și nu intră în rata de menționare.' },
  error: { label: 'Eroare de colectare', tone: 'neg', explanation: 'Colectarea a eșuat. Nu avem un răspuns, deci nu putem spune dacă brandul apare; nu intră în rata de menționare.' },
  not_collected: { label: 'Necolectat', tone: 'neutral', explanation: 'Întrebarea nu a fost colectată pentru acest engine în perioada aleasă. Nu intră în rata de menționare.' },
}
