import { cn } from '../../lib/cn'

const SIZES = { sm: 'size-6 text-[10px]', md: 'size-8 text-[12px]', lg: 'size-10 text-[14px]' } as const
const TONES = { accent: 'bg-accent-soft text-accent-text', lav: 'bg-lav-soft text-lav-text', neutral: 'bg-neutral-soft text-text-2' } as const

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toLocaleUpperCase('ro-RO')
}

/** Avatar cu inițiale pentru persoane; monogramă pentru surse și branduri. Textul alternativ e numele. */
export function Avatar({ name, size = 'md', tone = 'neutral' }: { name: string; size?: keyof typeof SIZES; tone?: keyof typeof TONES }) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn('inline-grid flex-none place-items-center rounded-full font-semibold', SIZES[size], TONES[tone])}
    >
      {initials(name)}
    </span>
  )
}
