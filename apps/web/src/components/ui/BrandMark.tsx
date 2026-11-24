import { useState } from 'react'
import { cn } from '../../lib/cn'
import { initials } from './Avatar'

const SIZES = { sm: 'size-6 text-[10px] rounded-md', md: 'size-8 text-[12px] rounded-lg', lg: 'size-10 text-[14px] rounded-[10px]' } as const
const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

/**
 * Iconițele pe care le încercăm, în ordine, direct de pe site-ul brandului (fără serviciu terț):
 * întâi iconița mare pentru ecrane retina, apoi favicon-ul clasic. Domeniu lipsă sau invalid → nicio sursă.
 */
export function brandIconSources(domain: string | null | undefined): string[] {
  const d = domain?.trim().toLowerCase() ?? ''
  if (!DOMAIN.test(d)) return []
  return [`https://${d}/apple-touch-icon.png`, `https://${d}/favicon.ico`]
}

/**
 * Semnul unui brand: favicon-ul site-ului său pe o plăcuță deschisă la culoare, ca să se vadă și pe tema întunecată.
 * Până se încarcă iconița, sau dacă site-ul nu are una, rămâne monograma. Textul alternativ e numele brandului.
 */
export function BrandMark({ name, domain, size = 'md', decorative = false }: { name: string; domain: string | null | undefined; size?: keyof typeof SIZES; decorative?: boolean }) {
  const sources = brandIconSources(domain)
  // Starea ține minte domeniul pentru care a fost calculată: la schimbarea brandului o luăm de la capăt.
  const [state, setState] = useState({ domain, index: 0, loaded: false })
  const current = state.domain === domain ? state : { domain, index: 0, loaded: false }
  const src = sources[current.index]
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      className={cn('relative inline-grid flex-none place-items-center overflow-hidden font-semibold', SIZES[size], current.loaded ? 'bg-white ring-1 ring-black/10' : 'bg-lav-soft text-lav-text')}
    >
      {!current.loaded && initials(name)}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            // Unele site-uri întorc o imagine goală de 1×1 în loc de 404; o tratăm ca lipsă.
            if (e.currentTarget.naturalWidth < 8) setState({ domain, index: current.index + 1, loaded: false })
            else setState({ domain, index: current.index, loaded: true })
          }}
          onError={() => setState({ domain, index: current.index + 1, loaded: false })}
          className={cn('absolute inset-0 size-full object-contain p-[12%]', current.loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </span>
  )
}
