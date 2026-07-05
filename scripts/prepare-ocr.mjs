/**
 * Copies Tesseract OCR assets into public/tesseract/ so the PDF-to-Text tool
 * runs fully offline at runtime (no CDN fetches).
 *
 * - worker + core WASM come from node_modules (always version-matched)
 * - eng.traineddata.gz is downloaded once at build time and then cached
 *
 * Wired as the "prebuild" npm script; safe to re-run (idempotent).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'tesseract')
mkdirSync(outDir, { recursive: true })

// 1. worker from tesseract.js
copyFileSync(
  join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  join(outDir, 'worker.min.js')
)

// 2. all core builds from tesseract.js-core (js loaders + wasm binaries)
const coreDir = join(root, 'node_modules', 'tesseract.js-core')
for (const f of readdirSync(coreDir)) {
  if (f.startsWith('tesseract-core') && (f.endsWith('.js') || f.endsWith('.wasm'))) {
    copyFileSync(join(coreDir, f), join(outDir, f))
  }
}

// 3. English language data (downloaded once, then cached in public/)
const lang = join(outDir, 'eng.traineddata.gz')
if (!existsSync(lang) || statSync(lang).size === 0) {
  console.log('[prepare-ocr] downloading eng.traineddata.gz (one-time)…')
  const res = await fetch('https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz')
  if (!res.ok) throw new Error(`traineddata download failed: HTTP ${res.status}`)
  writeFileSync(lang, Buffer.from(await res.arrayBuffer()))
}

console.log(`[prepare-ocr] OCR assets ready in public/tesseract (${readdirSync(outDir).length} files)`)
