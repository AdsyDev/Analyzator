/**
 * Modul de previzualizare design (VITE_DESIGN_PREVIEW) înlocuiește datele cu fixtures fictive.
 * Regula 1 din CLAUDE.md: fără date demo în staging și production. Garda e o allowlist, nu o
 * blocare a lui `production`: flag-ul e acceptat doar în modurile de mai jos; orice alt mod
 * (production, staging, un mod nou, necunoscut) eșuează la build.
 */
export const PREVIEW_ALLOWED_MODES: readonly string[] = ['development', 'design-preview']

export const PREVIEW_FLAG = 'VITE_DESIGN_PREVIEW'

type Env = Record<string, string | undefined>

/** `true` doar pentru valoarea exactă `true`; `false`, gol sau lipsă înseamnă dezactivat. */
export function isPreviewEnabled(env: Env): boolean {
  return env[PREVIEW_FLAG] === 'true'
}

export function assertPreviewAllowed(mode: string, env: Env): void {
  const raw = env[PREVIEW_FLAG]
  if (raw === undefined || raw === '' || raw === 'false') return
  if (raw !== 'true') {
    throw new Error(`${PREVIEW_FLAG} are valoarea ${JSON.stringify(raw)}. Valorile acceptate sunt „true" și „false".`)
  }
  if (!PREVIEW_ALLOWED_MODES.includes(mode)) {
    throw new Error(
      `${PREVIEW_FLAG}=true nu e permis în modul „${mode}". Previzualizarea cu date fictive rulează doar în ` +
        `${PREVIEW_ALLOWED_MODES.join(' sau ')} (regula 1: fără date demo în staging și production). Elimină variabila din mediul build-ului.`,
    )
  }
}
