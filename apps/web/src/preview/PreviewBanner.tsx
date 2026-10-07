import { WarningIcon } from '@phosphor-icons/react'

/** Înălțimea bannerului; shell-ul o rezervă prin `--banner-h`. */
export const BANNER_HEIGHT = '30px'

/** Bannerul permanent din modul de previzualizare. Nu se poate închide: datele de pe ecran sunt fictive. */
export function PreviewBanner() {
  return (
    <div role="note" data-testid="preview-banner" className="flex h-[var(--banner-h)] items-center justify-center gap-2 border-b border-warn/40 bg-surface px-4 text-center text-[12.5px] font-semibold text-warn-text">
      <WarningIcon size={14} weight="bold" aria-hidden="true" />
      Previzualizare design — date fictive
    </div>
  )
}
