/**
 * Client-side Office → PDF conversion. 100% in-browser, zero uploads.
 *
 * Two pipelines sharing one rendering layer:
 *  - "snapshot": rasterize the rendered DOM (html2canvas) into an image PDF
 *    via pdf-lib. Fully automatic, but text is not selectable.
 *  - "print": serialize the same rendered DOM into a hidden iframe and open
 *    the browser's print dialog — the user picks "Save as PDF" and gets a
 *    real text-based PDF from the browser's own print engine.
 *
 * Heavy renderers (docx-preview, xlsx, html2canvas) are dynamically imported
 * so they only load on first use.
 *
 * Fidelity notes:
 *  - docx  : high (docx-preview paginates faithfully)
 *  - xlsx  : good (sheet → styled HTML table; landscape in print mode)
 *  - pptx  : best-effort (text boxes + images positioned by their EMU
 *            coordinates; charts/shapes/animations are not rendered)
 */

import { PDFDocument } from 'pdf-lib'

export type OfficeKind = 'docx' | 'xlsx' | 'pptx'

// A4 in PostScript points
const A4_W = 595.28
const A4_H = 841.89
const PAGE_MARGIN = 24
const EMU_PER_PX = 9525 // 914400 EMU/in ÷ 96 px/in

export function detectOfficeKind(file: File): OfficeKind | null {
  const ext = file.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'docx': return 'docx'
    case 'xlsx':
    case 'xls': return 'xlsx'
    case 'pptx': return 'pptx'
    default: return null
  }
}

// ---------- shared DOM / raster helpers ----------

function createHost(widthPx: number): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${widthPx}px`,
    background: '#ffffff',
    color: '#000000',
    zIndex: '-1',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  document.body.appendChild(host)
  return host
}

async function elementToCanvas(el: HTMLElement, scale = 2): Promise<HTMLCanvasElement> {
  const html2canvas = (await import('html2canvas')).default
  return html2canvas(el, {
    scale,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  })
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('canvas.toBlob returned null')); return }
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png')
  })
}

// Split a tall canvas into page-height segments (for long tables, etc).
function sliceCanvas(full: HTMLCanvasElement, sliceHeight: number): HTMLCanvasElement[] {
  if (full.height <= sliceHeight) return [full]
  const pages: HTMLCanvasElement[] = []
  for (let y = 0; y < full.height; y += sliceHeight) {
    const h = Math.min(sliceHeight, full.height - y)
    const c = document.createElement('canvas')
    c.width = full.width
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, h)
    ctx.drawImage(full, 0, y, full.width, h, 0, 0, full.width, h)
    pages.push(c)
  }
  return pages
}

async function canvasesToPdf(canvases: HTMLCanvasElement[]): Promise<Uint8Array> {
  if (!canvases.length) throw new Error('Nothing to convert — no pages were produced.')
  const pdf = await PDFDocument.create()

  for (const canvas of canvases) {
    const png = await pdf.embedPng(await canvasToPngBytes(canvas))
    const landscape = canvas.width > canvas.height
    const pageW = landscape ? A4_H : A4_W
    const pageH = landscape ? A4_W : A4_H
    const page = pdf.addPage([pageW, pageH])

    const maxW = pageW - PAGE_MARGIN * 2
    const maxH = pageH - PAGE_MARGIN * 2
    const scale = Math.min(maxW / png.width, maxH / png.height)
    const w = png.width * scale
    const h = png.height * scale
    page.drawImage(png, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h })
  }

  return pdf.save()
}

function waitForImages(root: HTMLElement | Document): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  return Promise.all(
    imgs.map(img => img.complete && img.naturalWidth > 0
      ? Promise.resolve()
      : new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res() })
    )
  ).then(() => undefined)
}

// ---------- DOCX rendering ----------

async function buildDocxDom(file: File, host: HTMLElement): Promise<HTMLElement[]> {
  const { renderAsync } = await import('docx-preview')
  await renderAsync(await file.arrayBuffer(), host, undefined, {
    className: 'docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    useBase64URL: true,
    experimental: true,
  })

  let pages = Array.from(host.querySelectorAll<HTMLElement>('.docx-wrapper > section'))
  if (!pages.length) pages = Array.from(host.querySelectorAll<HTMLElement>('section.docx'))
  if (!pages.length) pages = [host]

  await waitForImages(host)
  return pages
}

// ---------- XLSX rendering ----------

function buildSheetWrap(name: string, tableHtml: string): HTMLElement {
  const wrap = document.createElement('div')
  Object.assign(wrap.style, {
    padding: '16px',
    fontFamily: 'Arial, sans-serif',
    fontSize: '12px',
    color: '#000',
    background: '#fff',
  } as CSSStyleDeclaration)
  wrap.innerHTML = `<h2 style="font-family:Arial;margin:0 0 12px;font-size:16px;color:#111;">${name}</h2>${tableHtml}`

  wrap.querySelectorAll('table').forEach(t => {
    const e = t as HTMLElement
    e.style.borderCollapse = 'collapse'
    e.style.width = '100%'
  })
  wrap.querySelectorAll('td, th').forEach(cell => {
    const e = cell as HTMLElement
    e.style.border = '1px solid #cbd5e1'
    e.style.padding = '4px 6px'
    e.style.fontSize = '12px'
    e.style.whiteSpace = 'nowrap'
  })
  return wrap
}

async function buildXlsxWraps(file: File): Promise<{ name: string; wrap: HTMLElement }[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return wb.SheetNames.map(name => ({
    name,
    wrap: buildSheetWrap(name, XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false })),
  }))
}

// ---------- PPTX rendering ----------

function emuToPx(v: string | null | undefined): number {
  return v ? Math.round(parseInt(v, 10) / EMU_PER_PX) : 0
}

function resolveRels(parser: DOMParser, relsXml: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!relsXml) return map
  const doc = parser.parseFromString(relsXml, 'application/xml')
  Array.from(doc.getElementsByTagName('Relationship')).forEach(r => {
    map.set(r.getAttribute('Id') || '', r.getAttribute('Target') || '')
  })
  return map
}

async function buildPptxSlides(
  file: File,
  onProgress?: (m: string) => void
): Promise<{ slides: HTMLElement[]; pxW: number; pxH: number }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()

  // slide size + order
  let slideW = 12192000
  let slideH = 6858000
  let slidePaths: string[] = []

  const presXml = await zip.file('ppt/presentation.xml')?.async('string')
  if (presXml) {
    const doc = parser.parseFromString(presXml, 'application/xml')
    const sz = doc.getElementsByTagName('p:sldSz')[0]
    if (sz) {
      slideW = parseInt(sz.getAttribute('cx') || '') || slideW
      slideH = parseInt(sz.getAttribute('cy') || '') || slideH
    }
    const relMap = resolveRels(parser, await zip.file('ppt/_rels/presentation.xml.rels')?.async('string'))
    Array.from(doc.getElementsByTagName('p:sldId')).forEach(s => {
      const rid = s.getAttribute('r:id') || ''
      const tgt = relMap.get(rid)
      if (tgt) slidePaths.push(tgt.startsWith('ppt/') ? tgt : `ppt/${tgt.replace(/^\.\.\//, '')}`)
    })
  }

  if (!slidePaths.length) {
    slidePaths = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10))
  }

  if (!slidePaths.length) throw new Error('No slides found in this presentation.')

  const pxW = Math.round(slideW / EMU_PER_PX)
  const pxH = Math.round(slideH / EMU_PER_PX)
  const slides: HTMLElement[] = []

  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i]
    onProgress?.(`Rendering slide ${i + 1} of ${slidePaths.length}…`)
    const xml = await zip.file(path)?.async('string')
    if (!xml) continue

    const sdoc = parser.parseFromString(xml, 'application/xml')
    const relsPath = path.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels')
    const relMap = resolveRels(parser, await zip.file(relsPath)?.async('string'))

    const slide = document.createElement('div')
    Object.assign(slide.style, {
      position: 'relative', width: `${pxW}px`, height: `${pxH}px`,
      background: '#ffffff', overflow: 'hidden', fontFamily: 'Arial, sans-serif', color: '#000',
    } as CSSStyleDeclaration)

    // text shapes
    for (const sp of Array.from(sdoc.getElementsByTagName('p:sp'))) {
      const xfrm = sp.getElementsByTagName('a:xfrm')[0]
      const off = xfrm?.getElementsByTagName('a:off')[0]
      const ext = xfrm?.getElementsByTagName('a:ext')[0]
      const paras = Array.from(sp.getElementsByTagName('a:p'))
      if (!paras.length) continue

      const box = document.createElement('div')
      Object.assign(box.style, {
        position: 'absolute', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', overflow: 'hidden', boxSizing: 'border-box', padding: '4px',
      } as CSSStyleDeclaration)
      if (off) { box.style.left = `${emuToPx(off.getAttribute('x'))}px`; box.style.top = `${emuToPx(off.getAttribute('y'))}px` }
      if (ext) { box.style.width = `${emuToPx(ext.getAttribute('cx'))}px`; box.style.height = `${emuToPx(ext.getAttribute('cy'))}px` }

      let hasText = false
      for (const p of paras) {
        const line = document.createElement('div')
        const algn = p.getElementsByTagName('a:pPr')[0]?.getAttribute('algn')
        line.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left'
        line.style.lineHeight = '1.2'

        for (const r of Array.from(p.getElementsByTagName('a:r'))) {
          const text = r.getElementsByTagName('a:t')[0]?.textContent || ''
          if (!text) continue
          hasText = true
          const span = document.createElement('span')
          span.textContent = text
          const rpr = r.getElementsByTagName('a:rPr')[0]
          const sz = rpr?.getAttribute('sz')
          span.style.fontSize = sz ? `${parseInt(sz, 10) / 100}pt` : '18pt'
          if (rpr?.getAttribute('b') === '1') span.style.fontWeight = 'bold'
          if (rpr?.getAttribute('i') === '1') span.style.fontStyle = 'italic'
          const clr = rpr?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val')
          if (clr) span.style.color = `#${clr}`
          line.appendChild(span)
        }
        if (!line.textContent) line.innerHTML = '&nbsp;'
        box.appendChild(line)
      }
      if (hasText) slide.appendChild(box)
    }

    // pictures
    for (const pic of Array.from(sdoc.getElementsByTagName('p:pic'))) {
      const embed = pic.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed')
      const tgt = embed ? relMap.get(embed) : undefined
      if (!tgt) continue
      const mediaPath = `ppt/${tgt.replace(/^\.\.\//, '')}`.replace('ppt/ppt/', 'ppt/')
      const mediaFile = zip.file(mediaPath)
      if (!mediaFile) continue

      const b64 = await mediaFile.async('base64')
      const ext2 = mediaPath.split('.').pop()?.toLowerCase()
      const mime = ext2 === 'png' ? 'image/png' : ext2 === 'gif' ? 'image/gif'
        : ext2 === 'bmp' ? 'image/bmp' : ext2 === 'svg' ? 'image/svg+xml' : 'image/jpeg'

      const xfrm = pic.getElementsByTagName('a:xfrm')[0]
      const off = xfrm?.getElementsByTagName('a:off')[0]
      const ext = xfrm?.getElementsByTagName('a:ext')[0]
      const img = document.createElement('img')
      img.src = `data:${mime};base64,${b64}`
      img.style.position = 'absolute'
      img.style.objectFit = 'contain'
      if (off) { img.style.left = `${emuToPx(off.getAttribute('x'))}px`; img.style.top = `${emuToPx(off.getAttribute('y'))}px` }
      if (ext) { img.style.width = `${emuToPx(ext.getAttribute('cx'))}px`; img.style.height = `${emuToPx(ext.getAttribute('cy'))}px` }
      slide.appendChild(img)
    }

    slides.push(slide)
  }

  return { slides, pxW, pxH }
}

// ---------- Pipeline 1: snapshot (rasterize → image PDF) ----------

async function snapshotDocx(file: File, onProgress?: (m: string) => void): Promise<Uint8Array> {
  onProgress?.('Rendering document…')
  const host = createHost(794) // ≈ A4 width @ 96dpi
  try {
    const pages = await buildDocxDom(file, host)
    const canvases: HTMLCanvasElement[] = []
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`Rasterizing page ${i + 1} of ${pages.length}…`)
      canvases.push(await elementToCanvas(pages[i], 2))
    }
    onProgress?.('Assembling PDF…')
    return await canvasesToPdf(canvases)
  } finally {
    host.remove()
  }
}

async function snapshotXlsx(file: File, onProgress?: (m: string) => void): Promise<Uint8Array> {
  onProgress?.('Reading spreadsheet…')
  const wraps = await buildXlsxWraps(file)
  const host = createHost(1000)
  try {
    const contentW = A4_W - PAGE_MARGIN * 2
    const contentH = A4_H - PAGE_MARGIN * 2
    const canvases: HTMLCanvasElement[] = []

    for (const { name, wrap } of wraps) {
      onProgress?.(`Rendering sheet “${name}”…`)
      host.innerHTML = ''
      host.appendChild(wrap)
      const full = await elementToCanvas(wrap, 2)
      const sliceHeight = Math.floor(full.width * (contentH / contentW))
      sliceCanvas(full, sliceHeight).forEach(c => canvases.push(c))
    }

    onProgress?.('Assembling PDF…')
    return await canvasesToPdf(canvases)
  } finally {
    host.remove()
  }
}

async function snapshotPptx(file: File, onProgress?: (m: string) => void): Promise<Uint8Array> {
  onProgress?.('Reading presentation…')
  const { slides, pxW } = await buildPptxSlides(file, onProgress)
  const host = createHost(pxW)
  try {
    const canvases: HTMLCanvasElement[] = []
    for (let i = 0; i < slides.length; i++) {
      onProgress?.(`Rasterizing slide ${i + 1} of ${slides.length}…`)
      host.innerHTML = ''
      host.appendChild(slides[i])
      await waitForImages(slides[i])
      canvases.push(await elementToCanvas(slides[i], 2))
    }
    onProgress?.('Assembling PDF…')
    return await canvasesToPdf(canvases)
  } finally {
    host.remove()
  }
}

export async function convertOfficeToPdfSnapshot(file: File, onProgress?: (m: string) => void): Promise<Uint8Array> {
  const kind = detectOfficeKind(file)
  if (!kind) throw new Error('Unsupported file type. Use .docx, .xlsx, or .pptx.')
  switch (kind) {
    case 'docx': return snapshotDocx(file, onProgress)
    case 'xlsx': return snapshotXlsx(file, onProgress)
    case 'pptx': return snapshotPptx(file, onProgress)
  }
}

// ---------- Pipeline 2: print (browser print engine → text PDF) ----------

function printHtml(bodyHtml: string, css: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    Object.assign(iframe.style, {
      position: 'fixed', right: '0', bottom: '0',
      width: '0', height: '0', border: '0',
    } as CSSStyleDeclaration)

    let settled = false
    const cleanup = () => {
      if (settled) return
      settled = true
      setTimeout(() => iframe.remove(), 100)
      resolve()
    }

    iframe.onload = async () => {
      const win = iframe.contentWindow
      const idoc = iframe.contentDocument
      if (!win || !idoc) { cleanup(); return }
      try {
        await waitForImages(idoc)
        win.addEventListener('afterprint', cleanup, { once: true })
        win.focus()
        win.print()
        // Safari doesn't always fire afterprint on hidden iframes — fallback.
        setTimeout(cleanup, 120000)
      } catch {
        cleanup()
      }
    }

    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; background: #fff; }
      ${css}
    </style></head><body>${bodyHtml}</body></html>`
    document.body.appendChild(iframe)
  })
}

export async function printOfficeAsPdf(file: File, onProgress?: (m: string) => void): Promise<void> {
  const kind = detectOfficeKind(file)
  if (!kind) throw new Error('Unsupported file type. Use .docx, .xlsx, or .pptx.')

  if (kind === 'docx') {
    onProgress?.('Rendering document…')
    const host = createHost(794)
    try {
      await buildDocxDom(file, host)
      onProgress?.('Opening print dialog…')
      await printHtml(host.innerHTML, `
        @page { size: A4; margin: 0; }
        .docx-wrapper { background: none !important; padding: 0 !important; display: block !important; }
        .docx-wrapper > section.docx { box-shadow: none !important; margin: 0 auto !important; page-break-after: always; }
      `)
    } finally {
      host.remove()
    }
    return
  }

  if (kind === 'xlsx') {
    onProgress?.('Reading spreadsheet…')
    const wraps = await buildXlsxWraps(file)
    const bodyHtml = wraps.map(({ wrap }, i) =>
      `<div style="${i > 0 ? 'page-break-before: always;' : ''}">${wrap.outerHTML}</div>`
    ).join('')
    onProgress?.('Opening print dialog…')
    await printHtml(bodyHtml, `
      @page { size: A4 landscape; margin: 12mm; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
    `)
    return
  }

  // pptx — each slide becomes exactly one page (1in = 96px in CSS)
  onProgress?.('Reading presentation…')
  const { slides, pxW, pxH } = await buildPptxSlides(file, onProgress)
  const wIn = (pxW / 96).toFixed(3)
  const hIn = (pxH / 96).toFixed(3)
  const bodyHtml = slides.map(s => `<div class="pk-slide">${s.outerHTML}</div>`).join('')
  onProgress?.('Opening print dialog…')
  await printHtml(bodyHtml, `
    @page { size: ${wIn}in ${hIn}in; margin: 0; }
    .pk-slide { page-break-after: always; overflow: hidden; width: ${pxW}px; height: ${pxH}px; }
  `)
}
