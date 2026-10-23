import {
  ArrowSquareOutIcon,
  ChatsCircleIcon,
  FacebookLogoIcon,
  GlobeIcon,
  GoogleLogoIcon,
  InstagramLogoIcon,
  LinkedinLogoIcon,
  NewspaperIcon,
  RedditLogoIcon,
  StarIcon,
  ThreadsLogoIcon,
  TiktokLogoIcon,
  UserCircleIcon,
  XLogoIcon,
  YoutubeLogoIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { formatDateTime } from '../lib/format'
import { POST_PLATFORM_LABELS, type PostPlatform } from '../lib/platform'
import type { IsoDateTime } from '../contracts'
import { initials } from './ui/Avatar'

/**
 * Iconița și culoarea mărcii fiecărei platforme. Culorile sunt ale rețelelor (recunoaștere), nu ale datelor; X, TikTok
 * și Threads folosesc culoarea textului, ca să se vadă în ambele teme.
 */
const PLATFORM_ICON: Record<PostPlatform, { Glyph: Icon; color: string }> = {
  facebook: { Glyph: FacebookLogoIcon, color: '#1877F2' },
  instagram: { Glyph: InstagramLogoIcon, color: '#E1306C' },
  linkedin: { Glyph: LinkedinLogoIcon, color: '#0A66C2' },
  tiktok: { Glyph: TiktokLogoIcon, color: 'currentColor' },
  youtube: { Glyph: YoutubeLogoIcon, color: '#FF0000' },
  x: { Glyph: XLogoIcon, color: 'currentColor' },
  threads: { Glyph: ThreadsLogoIcon, color: 'currentColor' },
  google_business: { Glyph: GoogleLogoIcon, color: '#4285F4' },
  reddit: { Glyph: RedditLogoIcon, color: '#FF4500' },
  forum: { Glyph: ChatsCircleIcon, color: 'currentColor' },
  news: { Glyph: NewspaperIcon, color: 'currentColor' },
  review: { Glyph: StarIcon, color: 'currentColor' },
  web: { Glyph: GlobeIcon, color: 'currentColor' },
}

export function PlatformGlyph({ platform, size = 14 }: { platform: PostPlatform; size?: number }) {
  const { Glyph, color } = PLATFORM_ICON[platform]
  return <Glyph size={size} weight="fill" color={color} aria-hidden="true" className="flex-none" />
}

const LONG = 320
const TOKEN = /([#@][\p{L}\p{N}_.]+)/u

/** Textul postării ca pe rețea: rânduri păstrate, hashtag-uri și @mențiuni evidențiate (doar stil, fără linkuri). */
function PostText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > LONG
  return (
    <div className="flex flex-col items-start gap-1">
      <p className={cn('whitespace-pre-line break-words text-[14px] leading-relaxed text-text', long && !open && 'line-clamp-5')}>
        {text.split(TOKEN).map((part, i) => (TOKEN.test(part) ? <span key={i} className="font-medium text-accent-text">{part}</span> : part))}
      </p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[12.5px] font-medium text-text-2 hover:text-text">
          {open ? 'Mai puțin' : 'Vezi tot'}
        </button>
      )}
    </div>
  )
}

export interface SocialPostCardProps {
  platform: PostPlatform
  /** Numele afișat în antet: brandul (cont propriu) sau „Autor extern”. Nu se inventează autori (D-22). */
  author: string
  own: boolean
  /** Sursa așa cum vine (de ex. „Facebook (public)”, „Forum Sănătatea Ta”); fără ea, eticheta platformei. */
  source?: string
  publishedAt: IsoDateTime
  text: string
  /** URL deja validat (`safeUrl`); `null` = fără link. */
  href: string | null
  /** Colțul din dreapta sus (de ex. sentimentul). */
  aside?: ReactNode
  /** Etichete sub text (format, subiect, campanie, „date incomplete”). */
  tags?: ReactNode
  /** Rândul de jos: interacțiuni sau starea revizuirii. */
  footer?: ReactNode
  /** Acțiuni sub rândul de jos (de ex. marcarea pentru farmacovigilență). */
  actions?: ReactNode
}

/** Sursele care nu sunt rețele sociale primesc „Deschide sursa”, nu „Vezi pe Forum”. */
const NOT_A_NETWORK: readonly PostPlatform[] = ['forum', 'news', 'review', 'web']

/**
 * Cardul unei postări, „cum s-ar vedea pe rețea”: antet cu avatar, nume și platformă, textul complet și rândul de
 * interacțiuni. Imaginile și video-urile nu se importă (E-3), deci cardul nu le simulează; linkul duce la original.
 */
export function SocialPostCard({ platform, author, own, source, publishedAt, text, href, aside, tags, footer, actions }: SocialPostCardProps) {
  const label = POST_PLATFORM_LABELS[platform]
  const where = source && source.trim() !== '' ? source : label
  return (
    <article aria-label={`Postare ${label}, ${author}`} className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-1">
      <header className="flex items-start gap-3">
        <span className="relative flex-none">
          {own ? (
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent-text">{initials(author)}</span>
          ) : (
            <UserCircleIcon size={40} weight="fill" aria-hidden="true" className="text-text-3" />
          )}
          <span className="absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full border-2 border-surface bg-surface">
            <PlatformGlyph platform={platform} size={12} />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13.5px] font-semibold text-text">{author}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-text-2">
            <span>{where}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[11.5px]">{formatDateTime(publishedAt)}</span>
          </span>
        </span>
        {aside && <span className="flex-none">{aside}</span>}
      </header>
      <PostText text={text} />
      {tags && <div className="flex flex-wrap items-center gap-1.5">{tags}</div>}
      <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[12.5px]">
        {footer}
        <span className="flex-1" />
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline">
            {NOT_A_NETWORK.includes(platform) ? 'Deschide sursa' : `Vezi pe ${label}`}
            <ArrowSquareOutIcon size={13} aria-hidden="true" />
          </a>
        ) : (
          <span className="text-text-3">Link indisponibil</span>
        )}
      </footer>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </article>
  )
}
