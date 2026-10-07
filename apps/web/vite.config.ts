import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { assertPreviewAllowed, isPreviewEnabled } from './vite.preview-guard.ts'

export default defineConfig(({ mode }) => {
  // process.env are prioritate față de fișierele .env, ca în Vite; garda vede ambele surse.
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  assertPreviewAllowed(mode, env)

  return {
    plugins: [react(), tailwindcss()],
    // Contractele partajate cu SQL și testele de concordanță trăiesc în `analytics/`; UI-ul le importă, nu le copiază.
    resolve: { alias: { '@analytics': fileURLToPath(new URL('../../analytics', import.meta.url)) } },
    // Constantă la build: fără flag, ramurile de previzualizare dispar din bundle, inclusiv importul fixtures.
    define: { __DESIGN_PREVIEW__: JSON.stringify(isPreviewEnabled(env)) },
    server: { fs: { allow: ['../..'] } },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
