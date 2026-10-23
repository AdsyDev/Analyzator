import type { SocialPlatform } from '../contracts'

/** Platforma unei postări, pentru aspectul cardului: rețelele cunoscute plus tipurile de surse din Listening. */
export type PostPlatform = SocialPlatform | 'reddit' | 'forum' | 'news' | 'review' | 'web'

export const POST_PLATFORM_LABELS: Record<PostPlatform, string> = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', threads: 'Threads',
  google_business: 'Google Business', reddit: 'Reddit', forum: 'Forum', news: 'Știri', review: 'Recenzie', web: 'Web',
}

const HOSTS: ReadonlyArray<[RegExp, PostPlatform]> = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'x'],
  [/(^|\.)threads\.(net|com)$/, 'threads'],
  [/(^|\.)(g\.page|business\.google\.com)$/, 'google_business'],
  [/(^|\.)reddit\.com$/, 'reddit'],
]

const NAMES: ReadonlyArray<[RegExp, PostPlatform]> = [
  [/facebook/, 'facebook'],
  [/instagram/, 'instagram'],
  [/linkedin/, 'linkedin'],
  [/tiktok/, 'tiktok'],
  [/youtube/, 'youtube'],
  [/twitter|^x$|^x \(/, 'x'],
  [/threads/, 'threads'],
  [/google business|google my business/, 'google_business'],
  [/reddit/, 'reddit'],
  [/forum|grup/, 'forum'],
  [/review|recenz/, 'review'],
  [/știri|stiri|news|presă|presa/, 'news'],
]

function host(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Platforma pentru aspectul cardului, din adresa postării (domeniul) și, dacă adresa nu spune nimic, din numele sursei.
 * E doar o indicație vizuală: numele sursei rămâne afișat așa cum vine; ce nu se recunoaște e „Web”, nu o presupunere.
 */
export function platformOf(url: string | null, sourceName: string): PostPlatform {
  const h = host(url)
  if (h) for (const [re, p] of HOSTS) if (re.test(h)) return p
  const n = sourceName.trim().toLowerCase()
  for (const [re, p] of NAMES) if (re.test(n)) return p
  return 'web'
}
