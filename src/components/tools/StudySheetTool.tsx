import { useState, useRef, useCallback } from 'react'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  VerticalAlign,
  PageBreak,
  Footer,
  PageNumber,
  TabStopType,
  LeaderType,
  BorderStyle,
  convertInchesToTwip,
  LevelFormat,
} from 'docx'
import { FileText, Upload, Loader2, Download, X, Settings2, Microscope } from 'lucide-react'
import { toast } from 'sonner'
import { NativeToolLayout } from './shared/NativeToolLayout'
import PrivacyBadge from './shared/PrivacyBadge'

const SUPPORTED_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'gif', 'webp']

type ImageEntry = { name: string; file: File }
type ImagesPerPage = 1 | 2 | 4 | 6
type NoteStyle = 'bullets' | 'lines'

const LAYOUT = {
  1: { cols: 1, rows: 1, imgW: 5.8, imgH: 4.6 },
  2: { cols: 1, rows: 2, imgW: 6.4, imgH: 3.8 },
  4: { cols: 2, rows: 2, imgW: 3.0, imgH: 3.2 },
  6: { cols: 2, rows: 3, imgW: 3.0, imgH: 2.2 },
}

function prettify(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())
}

async function resizeImage(file: File, maxWIn: number, maxHIn: number, dpi = 200, quality = 0.88): Promise<{ data: Uint8Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const aspect = img.width / img.height
      let dispW = maxWIn
      let dispH = dispW / aspect
      if (dispH > maxHIn) { dispH = maxHIn; dispW = dispH * aspect }

      const targetW = Math.round(dispW * dpi)
      const targetH = Math.round(dispH * dpi)
      const scale = Math.min(1, targetW / img.width, targetH / img.height)
      const canvasW = Math.round(img.width * scale)
      const canvasH = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = canvasW
      canvas.height = canvasH
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvasW, canvasH)
      ctx.drawImage(img, 0, 0, canvasW, canvasH)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('canvas.toBlob failed')); return }
        blob.arrayBuffer().then(buf => resolve({
          data: new Uint8Array(buf),
          width: Math.round(dispW * 96),
          height: Math.round(dispH * 96),
        }))
      }, 'image/jpeg', quality)
    }
    img.onerror = reject
    img.src = url
  })
}

function parseOrderFile(text: string, images: ImageEntry[]): ImageEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const byName = new Map(images.map(i => [i.name.toLowerCase(), i]))
  const ordered: ImageEntry[] = []
  const used = new Set<string>()

  for (const line of lines) {
    const key = line.toLowerCase()
    const entry = byName.get(key)
    if (entry && !used.has(key)) { ordered.push(entry); used.add(key) }
  }

  const leftover = images.filter(i => !used.has(i.name.toLowerCase()))
  return [...ordered, ...leftover]
}

export default function StudySheetTool() {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const orderInputRef = useRef<HTMLInputElement>(null)

  const [images, setImages] = useState<ImageEntry[]>([])
  const [orderFile, setOrderFile] = useState<File | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')

  // Config
  const [branding, setBranding] = useState('PaperKnife | Histology Notes')
  const [imagesPerPage, setImagesPerPage] = useState<ImagesPerPage>(1)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [noteStyle, setNoteStyle] = useState<NoteStyle>('bullets')
  const [numItems, setNumItems] = useState(5)
  const [outputName, setOutputName] = useState('Histology_Study_Sheets')

  const loadImages = useCallback((fileList: File[]) => {
    const filtered = fileList.filter(f => SUPPORTED_EXT.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
    if (!filtered.length) { toast.error('No supported images found.'); return }
    const seen = new Set<string>()
    const unique = filtered.filter(f => { if (seen.has(f.name)) return false; seen.add(f.name); return true })
    const sorted = unique.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    setImages(sorted.map(f => ({ name: f.name, file: f })))
    toast.success(`Loaded ${sorted.length} image${sorted.length > 1 ? 's' : ''}`)
  }, [])

  const generate = async () => {
    if (!images.length) { toast.error('Load images first.'); return }
    setIsGenerating(true)
    setProgressMsg('Preparing images…')

    try {
      let ordered = [...images]
      if (orderFile) {
        const text = await orderFile.text()
        ordered = parseOrderFile(text, images)
        setProgressMsg(`Applied order.txt — ${ordered.length} images`)
      }

      const layout = LAYOUT[imagesPerPage]
      const notesActive = includeNotes && imagesPerPage === 1
      const nPages = Math.ceil(ordered.length / imagesPerPage)

      // Build document children
      const children: (Paragraph | Table)[] = []
      const numberingConfig = notesActive && noteStyle === 'bullets' ? {
        config: [{
          reference: 'histology-bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) } } },
          }],
        }],
      } : undefined

      for (let pageIdx = 0; pageIdx < nPages; pageIdx++) {
        const chunk = ordered.slice(pageIdx * imagesPerPage, (pageIdx + 1) * imagesPerPage)
        const isLast = pageIdx === nPages - 1
        setProgressMsg(`Building page ${pageIdx + 1} of ${nPages}…`)

        if (imagesPerPage === 1) {
          const img = chunk[0]
          setProgressMsg(`Processing ${img.name}…`)

          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 160 },
            children: [new TextRun({ text: prettify(img.name), bold: true, size: 36, font: 'Montserrat' })],
          }))

          try {
            const { data, width, height } = await resizeImage(img.file, layout.imgW, layout.imgH)
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 200 },
              children: [new ImageRun({ data, transformation: { width, height }, type: 'jpg' })],
            }))
          } catch {
            children.push(new Paragraph({ children: [new TextRun({ text: `[Could not embed: ${img.name}]`, italics: true, color: '999999' })] }))
          }

          if (notesActive) {
            children.push(new Paragraph({
              spacing: { before: 0, after: 80 },
              children: [new TextRun({ text: 'Key identification points', bold: true, size: 32, font: 'Montserrat' })],
            }))

            if (noteStyle === 'bullets') {
              for (let b = 0; b < numItems; b++) {
                children.push(new Paragraph({
                  numbering: { reference: 'histology-bullets', level: 0 },
                  spacing: { before: 0, after: 120 },
                  children: [new TextRun({ text: '', size: 32 })],
                }))
              }
            } else {
              const lineTable = new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: Array.from({ length: numItems }, () =>
                  new TableRow({
                    height: { value: convertInchesToTwip(0.35), rule: 'exact' as any },
                    children: [new TableCell({
                      width: { size: 100, type: WidthType.PERCENTAGE },
                      borders: { top: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF' } },
                      children: [new Paragraph({ children: [new TextRun('')] })],
                    })],
                  })
                ),
              })
              children.push(lineTable)
            }
          }

          if (!isLast) children.push(new Paragraph({ children: [new PageBreak()] }))
        } else {
          // Multi-image grid using a table
          const { cols, rows } = layout
          const tableRows: TableRow[] = []

          for (let r = 0; r < rows; r++) {
            const cells: TableCell[] = []
            for (let c = 0; c < cols; c++) {
              const imgIdx = r * cols + c
              const img = chunk[imgIdx]
              const cellChildren: (Paragraph | Table)[] = []

              if (img) {
                cellChildren.push(new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 40 },
                  children: [new TextRun({ text: prettify(img.name), bold: true, size: Math.round(36 * (imagesPerPage === 2 ? 0.85 : imagesPerPage === 4 ? 0.65 : 0.55)), font: 'Montserrat' })],
                }))
                try {
                  const { data, width, height } = await resizeImage(img.file, layout.imgW, layout.imgH)
                  cellChildren.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 0, after: 80 },
                    children: [new ImageRun({ data, transformation: { width, height }, type: 'jpg' })],
                  }))
                } catch {
                  cellChildren.push(new Paragraph({ children: [new TextRun({ text: `[Could not embed: ${img.name}]`, italics: true, color: '999999' })] }))
                }
              } else {
                cellChildren.push(new Paragraph({ children: [] }))
              }

              cells.push(new TableCell({
                width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.TOP,
                borders: { top: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE } },
                children: cellChildren,
              }))
            }
            tableRows.push(new TableRow({ children: cells }))
          }

          children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }))
          if (!isLast) children.push(new Paragraph({ children: [new PageBreak()] }))
        }
      }

      setProgressMsg('Assembling document…')

      const doc = new Document({
        ...(numberingConfig ? { numbering: numberingConfig } : {}),
        sections: [{
          properties: {
            page: {
              margin: { top: convertInchesToTwip(0.7), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(0.8), right: convertInchesToTwip(0.8) },
            },
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(6.5), leader: LeaderType.NONE }],
                  border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'C8C8C8', space: 6 } },
                  spacing: { before: 120 },
                  children: [
                    new TextRun({ text: `${branding}\t`, italics: true, size: 24, color: '555555', font: 'Montserrat' }),
                    new TextRun({ text: 'Page ', size: 24, color: '555555', font: 'Montserrat' }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 24, color: '555555', font: 'Montserrat' }),
                  ],
                }),
              ],
            }),
          },
          children,
        }],
      })

      setProgressMsg('Generating DOCX file…')
      const blob = await Packer.toBlob(doc)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${outputName}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)

      toast.success(`Generated ${nPages} page document!`)
      setProgressMsg('')
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      setProgressMsg('')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <NativeToolLayout
      title="Study Sheet Generator"
      description="Convert a folder of histology images into a printable Word document."
      actions={
        images.length > 0 ? (
          <button
            onClick={generate}
            disabled={isGenerating}
            className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all active:scale-95 disabled:opacity-50 shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2"
          >
            {isGenerating
              ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
              : <><Download size={16} /> Generate .docx</>
            }
          </button>
        ) : undefined
      }
    >
      <input ref={imageInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => e.target.files && loadImages(Array.from(e.target.files))} />
      <input ref={orderInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setOrderFile(f); toast.success(`Loaded ${f.name}`) }; e.target.value = '' }} />

      <div className="space-y-6">
        {/* Image Loader */}
        {images.length === 0 ? (
          <div
            onClick={() => imageInputRef.current?.click()}
            className="border-4 border-dashed border-gray-100 dark:border-zinc-900 rounded-[2.5rem] p-12 text-center cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-900/10 hover:border-rose-200 transition-all group"
          >
            <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
              <Microscope size={32} />
            </div>
            <h3 className="text-xl font-bold dark:text-white mb-2">Load Histology Images</h3>
            <p className="text-sm text-gray-400">JPG, PNG, TIFF, WebP supported</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center gap-4">
            <div className="w-12 h-12 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-2xl flex items-center justify-center shrink-0">
              <Microscope size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm dark:text-white">{images.length} images loaded</p>
              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Ready to generate</p>
            </div>
            <button onClick={() => imageInputRef.current?.click()} className="text-xs font-black text-rose-500 hover:underline underline-offset-4">Change</button>
            <button onClick={() => setImages([])} className="text-gray-400 hover:text-rose-500 transition-colors"><X size={16} /></button>
          </div>
        )}

        {/* order.txt */}
        <div className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 dark:bg-amber-900/10 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm dark:text-white">{orderFile ? orderFile.name : 'order.txt (optional)'}</p>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{orderFile ? 'Custom order applied' : 'Defaults to alphabetical order'}</p>
          </div>
          {orderFile
            ? <button onClick={() => setOrderFile(null)} className="text-gray-400 hover:text-rose-500 transition-colors"><X size={16} /></button>
            : <button onClick={() => orderInputRef.current?.click()} className="text-xs font-black text-amber-500 hover:underline underline-offset-4 flex items-center gap-1"><Upload size={11} /> Load</button>
          }
        </div>

        {/* Configuration */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <Settings2 size={14} className="text-gray-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Configuration</span>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Output filename</label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-rose-500 outline-none font-bold text-sm dark:text-white"
              placeholder="Histology_Study_Sheets"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Footer branding</label>
            <input
              type="text"
              value={branding}
              onChange={(e) => setBranding(e.target.value)}
              className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-rose-500 outline-none font-bold text-sm dark:text-white"
              placeholder="Your Name | Histology Notes"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Images per page</label>
            <div className="grid grid-cols-4 gap-2">
              {([1, 2, 4, 6] as ImagesPerPage[]).map(n => (
                <button
                  key={n}
                  onClick={() => setImagesPerPage(n)}
                  className={`py-2.5 rounded-xl text-sm font-black transition-all border ${imagesPerPage === n ? 'bg-rose-500 text-white border-rose-500 shadow-lg shadow-rose-500/20' : 'bg-gray-50 dark:bg-black text-gray-500 dark:text-zinc-400 border-gray-100 dark:border-white/5 hover:border-rose-300'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {imagesPerPage === 1 && (
            <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-white/5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Include notes area</span>
                <button
                  onClick={() => setIncludeNotes(p => !p)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${includeNotes ? 'bg-rose-500' : 'bg-gray-200 dark:bg-zinc-700'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${includeNotes ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {includeNotes && (
                <>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Note style</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['bullets', 'lines'] as NoteStyle[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setNoteStyle(s)}
                          className={`py-2 rounded-xl text-xs font-black capitalize transition-all border ${noteStyle === s ? 'bg-rose-500 text-white border-rose-500' : 'bg-gray-50 dark:bg-black text-gray-500 dark:text-zinc-400 border-gray-100 dark:border-white/5 hover:border-rose-300'}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                      Number of {noteStyle} — {numItems}
                    </label>
                    <input
                      type="range"
                      min={2}
                      max={10}
                      value={numItems}
                      onChange={(e) => setNumItems(Number(e.target.value))}
                      className="w-full accent-rose-500"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Progress */}
        {progressMsg && (
          <div className="flex items-center gap-2.5 rounded-2xl bg-sky-50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-900/20 px-4 py-3 text-sky-700 dark:text-sky-400 text-xs font-medium">
            <Loader2 size={14} className="animate-spin shrink-0" />
            {progressMsg}
          </div>
        )}

        {/* Image preview strip */}
        {images.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-gray-100 dark:border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{orderFile ? 'Custom order preview' : 'Alphabetical order preview'}</p>
            </div>
            <div className="flex gap-3 p-4 overflow-x-auto">
              {images.slice(0, 12).map((img) => (
                <div key={img.name} className="flex-shrink-0 w-16 text-center">
                  <img
                    src={URL.createObjectURL(img.file)}
                    alt={img.name}
                    className="w-16 h-16 object-cover rounded-xl border border-gray-100 dark:border-white/5"
                  />
                  <p className="font-mono text-[8px] text-gray-400 mt-1 truncate w-full">{img.name}</p>
                </div>
              ))}
              {images.length > 12 && (
                <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-gray-50 dark:bg-zinc-800 flex items-center justify-center text-xs font-black text-gray-400">
                  +{images.length - 12}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <PrivacyBadge />
    </NativeToolLayout>
  )
}
