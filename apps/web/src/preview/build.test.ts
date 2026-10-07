import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Teste pe build-ul real (rulează `vite build`). Regula 1 din CLAUDE.md: fără date demo în staging și
 * production. Verifică și că flag-ul oprește build-ul, și că fixtures nu ajung în bundle fără flag.
 */
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const VITE = join(WEB, 'node_modules/vite/bin/vite.js')
const MARKER = 'analyzator-design-preview-fixture'
const BANNER = 'Previzualizare design'
const SENTINELS = [MARKER, BANNER, 'urinal.example', 'Uronova', 'Mihai Dumitrescu (QPPV)', 'adsymphony.example', 'Elena Dobre', 'az-preview-session']

const outDirs: string[] = []
afterAll(() => outDirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

function build(mode: string, flag: string | undefined) {
  const outDir = mkdtempSync(join(tmpdir(), 'az-build-'))
  outDirs.push(outDir)
  const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: undefined, VITE_DESIGN_PREVIEW: flag }
  if (flag === undefined) delete env.VITE_DESIGN_PREVIEW
  const r = spawnSync(process.execPath, [VITE, 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB,
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
  return { outDir, status: r.status, output: `${r.stdout}${r.stderr}` }
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}
const bundleText = (dir: string) => files(dir).filter((f) => /\.(js|css|html|json)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n')

describe('build: flag-ul de previzualizare', () => {
  it.each(['production', 'staging'])('eșuează în modul %s cu VITE_DESIGN_PREVIEW=true', (mode) => {
    const r = build(mode, 'true')
    expect(r.status).not.toBe(0)
    expect(r.output).toMatch(/nu e permis/)
    expect(r.output).toContain(`„${mode}"`)
  }, 60_000)

  it('eșuează și într-un mod necunoscut', () => {
    const r = build('qa', 'true')
    expect(r.status).not.toBe(0)
    expect(r.output).toMatch(/nu e permis/)
  }, 60_000)

  it('eșuează la o valoare ambiguă, chiar în modul permis', () => {
    const r = build('design-preview', '1')
    expect(r.status).not.toBe(0)
    expect(r.output).toMatch(/Valorile acceptate/)
  }, 60_000)
})

describe('build: fixtures nu ajung în bundle fără flag', () => {
  for (const mode of ['production', 'staging']) {
    it(`modul ${mode}, fără flag: build reușit și niciun semn de fixtures sau banner`, () => {
      const r = build(mode, undefined)
      expect(r.status, r.output).toBe(0)
      const text = bundleText(r.outDir)
      expect(text.length).toBeGreaterThan(1000)
      for (const s of SENTINELS) expect(text, `„${s}" apare în bundle-ul ${mode}`).not.toContain(s)
    }, 60_000)
  }

  it('cu VITE_DESIGN_PREVIEW=false, la fel: nicio urmă de fixtures', () => {
    const r = build('production', 'false')
    expect(r.status, r.output).toBe(0)
    const text = bundleText(r.outDir)
    for (const s of SENTINELS) expect(text).not.toContain(s)
  }, 60_000)

  it('control pozitiv: în modul design-preview cu flag, bundle-ul conține fixtures și bannerul', () => {
    const r = build('design-preview', 'true')
    expect(r.status, r.output).toBe(0)
    const text = bundleText(r.outDir)
    expect(text).toContain(MARKER)
    expect(text).toContain(BANNER)
    expect(text).toContain('urinal.example')
  }, 60_000)
})
