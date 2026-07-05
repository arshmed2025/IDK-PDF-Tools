import { useState, useRef, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import {
  GraduationCap, GripVertical, Download, RotateCcw, SortAsc, ArrowUpDown,
  Plus, X, FolderOpen, Loader2, Settings2, FileText, Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { NativeToolLayout } from './shared/NativeToolLayout'
import PrivacyBadge from './shared/PrivacyBadge'

const SUPPORTED_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'gif', 'webp']
const ACCENT = '0EA5E9' // sky-500, matches brand

type ImageItem = { kind: 'image'; id: string; name: string; url: string; file: File }
type SectionItem = { kind: 'section'; id: string; label: string }
type Item = ImageItem | SectionItem

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
        // docx expects pixel dimensions and converts to EMU internally (×9525). 96px = 1in.
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

// Rebuild the item list (images + section dividers) from a saved order.txt
function applyOrderFile(text: string, images: ImageItem[]): Item[] {
  const byName = new Map(images.map(i => [i.name.toLowerCase(), i]))
  const used = new Set<string>()
  const result: Item[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const sec = line.match(/^#\s*-+\s*(.+?)\s*-+\s*$/)
    if (sec) {
      result.push({ kind: 'section', id: `sec_${Date.now()}_${result.length}`, label: sec[1].toUpperCase() })
      continue
    }
    if (line.startsWith('#')) continue
    const key = line.toLowerCase()
    const entry = byName.get(key)
    if (entry && !used.has(key)) { result.push(entry); used.add(key) }
  }

  for (const img of images) if (!used.has(img.name.toLowerCase())) result.push(img)
  return result
}

function SortableImageCard({ item, onRemove }: { item: ImageItem; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative bg-white dark:bg-zinc-900 rounded-2xl border transition-all overflow-hidden group
        ${isDragging ? 'opacity-40 scale-95 border-sky-300 dark:border-sky-700 shadow-xl' : 'border-gray-100 dark:border-white/5 hover:border-sky-200 dark:hover:border-sky-900/30 hover:shadow-md'}`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <div className="relative">
          <img src={item.url} alt={item.name} loading="lazy" className="w-full h-32 object-cover block" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="px-3 py-2">
          <p className="font-mono text-[10px] text-gray-500 dark:text-zinc-400 truncate leading-tight">{item.name}</p>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-sky-500"
      >
        <X size={10} />
      </button>
    </div>
  )
}

function SortableSectionDivider({ item, onChange, onRemove }: { item: SectionItem; onChange: (v: string) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`col-span-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all
        ${isDragging ? 'opacity-40 scale-98 shadow-lg' : ''}
        bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-amber-400 flex-shrink-0">
        <GripVertical size={16} />
      </div>
      <input
        type="text"
        value={item.label}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder="SECTION NAME"
        className="flex-1 bg-transparent border-none outline-none text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 placeholder:text-amber-300 dark:placeholder:text-amber-700"
      />
      <button onClick={onRemove} className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 transition-colors flex-shrink-0">
        <X size={14} />
      </button>
    </div>
  )
}

export default function StudySheetBuilderTool() {
  const folderInputRef = useRef<HTMLInputElement>(null)
  const orderInputRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<Item[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const [isGenerating, setIsGenerating] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')

  // Config
  const [docTitle, setDocTitle] = useState('')
  const [branding, setBranding] = useState('IDK PDF Tools | Study Notes')
  const [imagesPerPage, setImagesPerPage] = useState<ImagesPerPage>(1)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [noteStyle, setNoteStyle] = useState<NoteStyle>('bullets')
  const [notesHeading, setNotesHeading] = useState('Key Points')
  const [numItems, setNumItems] = useState(5)
  const [outputName, setOutputName] = useState('Study_Sheets')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadFiles = useCallback((fileList: File[]) => {
    const filtered = fileList.filter(f => SUPPORTED_EXT.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
    if (!filtered.length) { toast.error('No supported images found.'); return }

    const seen = new Set<string>()
    const unique = filtered.filter(f => { if (seen.has(f.name)) return false; seen.add(f.name); return true })
    const sorted = unique.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const newItems: ImageItem[] = sorted.map(f => ({
      kind: 'image',
      id: `img_${f.name}_${f.lastModified}`,
      name: f.name,
      url: URL.createObjectURL(f),
      file: f,
    }))

    setItems(prev => {
      prev.filter((i): i is ImageItem => i.kind === 'image').forEach(i => URL.revokeObjectURL(i.url))
      return newItems
    })
    toast.success(`Loaded ${newItems.length} image${newItems.length > 1 ? 's' : ''}`)
  }, [])

  const onFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) loadFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)
    const files: File[] = []
    if (e.dataTransfer.items) {
      for (const it of Array.from(e.dataTransfer.items)) {
        const f = it.getAsFile()
        if (f) files.push(f)
      }
    } else {
      files.push(...Array.from(e.dataTransfer.files))
    }
    loadFiles(files)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setItems(prev => {
        const oldIdx = prev.findIndex(i => i.id === active.id)
        const newIdx = prev.findIndex(i => i.id === over.id)
        return arrayMove(prev, oldIdx, newIdx)
      })
    }
  }

  const addSection = () => {
    const label = window.prompt('Section name (e.g. CHAPTER 1, TOPIC, UNIT):', 'NEW SECTION')?.trim()
    if (!label) return
    setItems(prev => [{ kind: 'section', id: `sec_${Date.now()}`, label }, ...prev])
    toast.success('Section added — drag it to position.')
  }

  const sortAlpha = () => {
    setItems(prev => {
      const sections = prev.filter(i => i.kind === 'section')
      const imgs = prev.filter((i): i is ImageItem => i.kind === 'image')
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      return [...sections, ...imgs]
    })
  }

  const reverseAll = () => setItems(prev => [...prev].reverse())

  const removeItem = (id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id)
      if (item?.kind === 'image') URL.revokeObjectURL(item.url)
      return prev.filter(i => i.id !== id)
    })
  }

  const updateSectionLabel = (id: string, label: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, label } : i))
  }

  const reset = () => {
    items.filter((i): i is ImageItem => i.kind === 'image').forEach(i => URL.revokeObjectURL(i.url))
    setItems([])
  }

  const onOrderFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const imgs = items.filter((i): i is ImageItem => i.kind === 'image')
    if (!imgs.length) { toast.error('Load images first, then apply an order.'); return }
    const text = await f.text()
    setItems(applyOrderFile(text, imgs))
    toast.success('Applied order from file.')
  }

  const exportOrder = () => {
    if (!items.length) { toast.error('Nothing to export.'); return }
    const lines = [
      '# Generated by IDK PDF Tools — Study Sheet Builder',
      '# One filename per line; lines starting with # are ignored',
      '# Section markers use the form: # ----- NAME -----',
      '',
    ]
    items.forEach((item, idx) => {
      if (item.kind === 'section') {
        if (idx > 0) lines.push('')
        lines.push(`# ----- ${(item.label || 'SECTION').toUpperCase()} -----`)
      } else {
        lines.push(item.name)
      }
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'order.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast.success('order.txt downloaded!')
  }

  const sectionHeadingParagraph = (label: string) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
      children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 44, color: ACCENT, font: 'Montserrat' })],
    })

  const generate = async () => {
    const imageItems = items.filter((i): i is ImageItem => i.kind === 'image')
    if (!imageItems.length) { toast.error('Load images first.'); return }

    setIsGenerating(true)
    setProgressMsg('Preparing images…')

    try {
      const layout = LAYOUT[imagesPerPage]
      const notesActive = includeNotes && imagesPerPage === 1

      // Group items by section dividers; each group is a labelled run of images.
      const groups: { label?: string; imgs: ImageItem[] }[] = []
      let cur: { label?: string; imgs: ImageItem[] } = { imgs: [] }
      let started = false
      for (const item of items) {
        if (item.kind === 'section') {
          if (started) groups.push(cur)
          cur = { label: item.label || 'Section', imgs: [] }
          started = true
        } else {
          cur.imgs.push(item)
          started = true
        }
      }
      if (started) groups.push(cur)

      const children: (Paragraph | Table)[] = []
      const numberingConfig = notesActive && noteStyle === 'bullets' ? {
        config: [{
          reference: 'study-bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) } } },
          }],
        }],
      } : undefined

      let firstPage = true
      let processed = 0
      const totalImages = imageItems.length

      for (const group of groups) {
        const chunks: ImageItem[][] = []
        for (let i = 0; i < group.imgs.length; i += imagesPerPage) chunks.push(group.imgs.slice(i, i + imagesPerPage))
        if (chunks.length === 0) chunks.push([]) // section heading with no images → heading-only page

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci]
          if (!firstPage) children.push(new Paragraph({ children: [new PageBreak()] }))
          firstPage = false

          if (ci === 0 && group.label) children.push(sectionHeadingParagraph(group.label))

          if (imagesPerPage === 1) {
            const img = chunk[0]
            if (img) {
              processed++
              setProgressMsg(`Processing ${img.name} (${processed}/${totalImages})…`)

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
                  children: [new TextRun({ text: notesHeading || 'Key Points', bold: true, size: 32, font: 'Montserrat' })],
                }))

                if (noteStyle === 'bullets') {
                  for (let b = 0; b < numItems; b++) {
                    children.push(new Paragraph({
                      numbering: { reference: 'study-bullets', level: 0 },
                      spacing: { before: 0, after: 120 },
                      children: [new TextRun({ text: '', size: 32 })],
                    }))
                  }
                } else {
                  children.push(new Table({
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
                  }))
                }
              }
            }
          } else {
            // Multi-image grid
            const { cols, rows } = layout
            const tableRows: TableRow[] = []
            for (let r = 0; r < rows; r++) {
              const cells: TableCell[] = []
              for (let c = 0; c < cols; c++) {
                const img = chunk[r * cols + c]
                const cellChildren: (Paragraph | Table)[] = []
                if (img) {
                  processed++
                  setProgressMsg(`Processing ${img.name} (${processed}/${totalImages})…`)
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
          }
        }
      }

      setProgressMsg('Assembling document…')

      const titleChildren: Paragraph[] = docTitle.trim()
        ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 80 },
              children: [new TextRun({ text: docTitle.trim(), bold: true, size: 52, font: 'Montserrat' })],
            }),
            new Paragraph({ children: [new PageBreak()] }),
          ]
        : []

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
          children: [...titleChildren, ...children],
        }],
      })

      setProgressMsg('Generating DOCX file…')
      const blob = await Packer.toBlob(doc)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${outputName || 'Study_Sheets'}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)

      toast.success('Study sheet generated!')
      setProgressMsg('')
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      setProgressMsg('')
    } finally {
      setIsGenerating(false)
    }
  }

  const imageCount = items.filter(i => i.kind === 'image').length
  const sectionCount = items.filter(i => i.kind === 'section').length

  return (
    <NativeToolLayout
      title="Study Sheet Builder"
      description="Arrange a folder of images, add section dividers, and generate a printable Word study sheet — for any subject."
      actions={
        imageCount > 0 ? (
          <button
            onClick={generate}
            disabled={isGenerating}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all active:scale-95 disabled:opacity-50 shadow-xl shadow-sky-500/20 flex items-center justify-center gap-2"
          >
            {isGenerating
              ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
              : <><Download size={16} /> Generate .docx</>
            }
          </button>
        ) : undefined
      }
    >
      <input ref={folderInputRef} type="file" multiple accept="image/*" className="hidden" onChange={onFolderChange} />
      <input ref={orderInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={onOrderFileChange} />

      {items.length === 0 ? (
        <div
          onClick={() => folderInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setIsDragOver(true) }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current = Math.max(0, dragCounterRef.current - 1); if (dragCounterRef.current === 0) setIsDragOver(false) }}
          onDrop={onDrop}
          className={`border-4 border-dashed rounded-[2.5rem] p-12 text-center cursor-pointer transition-all group
            ${isDragOver ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/10 scale-[1.01]' : 'border-gray-100 dark:border-zinc-900 hover:bg-sky-50 dark:hover:bg-sky-900/10 hover:border-sky-200'}`}
        >
          <div className="w-20 h-20 bg-sky-50 dark:bg-sky-900/20 text-sky-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
            <GraduationCap size={32} />
          </div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Drop your images here</h3>
          <p className="text-sm text-gray-400 mb-4">Or click to browse — supports JPG, PNG, TIFF, WebP</p>
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-sky-500 bg-sky-50 dark:bg-sky-900/20 px-4 py-2 rounded-full border border-sky-100 dark:border-sky-900/30">
            <FolderOpen size={12} /> Select Image Folder
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-white/5 p-4 flex flex-wrap items-center gap-3">
            <div className="text-xs font-black text-gray-400 dark:text-zinc-500 uppercase tracking-widest mr-2">
              <span className="text-gray-700 dark:text-white">{imageCount}</span> images
              {sectionCount > 0 && <> · <span className="text-gray-700 dark:text-white">{sectionCount}</span> section{sectionCount > 1 ? 's' : ''}</>}
            </div>
            <div className="flex-1" />
            <button onClick={addSection} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-600 dark:text-zinc-300 hover:border-amber-300 hover:text-amber-600 transition-colors">
              <Plus size={12} /> Section
            </button>
            <button onClick={sortAlpha} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-600 dark:text-zinc-300 hover:border-sky-200 hover:text-sky-500 transition-colors">
              <SortAsc size={12} /> A→Z
            </button>
            <button onClick={reverseAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-600 dark:text-zinc-300 hover:border-sky-200 hover:text-sky-500 transition-colors">
              <ArrowUpDown size={12} /> Reverse
            </button>
            <button onClick={() => orderInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-600 dark:text-zinc-300 hover:border-sky-200 hover:text-sky-500 transition-colors">
              <Upload size={12} /> Apply order.txt
            </button>
            <button onClick={exportOrder} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-600 dark:text-zinc-300 hover:border-sky-200 hover:text-sky-500 transition-colors">
              <FileText size={12} /> Save order.txt
            </button>
            <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-300 hover:text-sky-500 transition-colors">
              <RotateCcw size={12} /> Reset
            </button>
            <button onClick={() => folderInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-900/30 text-xs font-black text-sky-500 hover:bg-sky-100 transition-colors">
              <FolderOpen size={12} /> Load
            </button>
          </div>

          {/* Sortable Grid */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {items.map(item =>
                  item.kind === 'image' ? (
                    <SortableImageCard key={item.id} item={item} onRemove={() => removeItem(item.id)} />
                  ) : (
                    <SortableSectionDivider
                      key={item.id}
                      item={item}
                      onChange={(v) => updateSectionLabel(item.id, v)}
                      onRemove={() => removeItem(item.id)}
                    />
                  )
                )}
              </div>
            </SortableContext>
          </DndContext>

          {/* Configuration */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Settings2 size={14} className="text-gray-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Document Settings</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Cover title (optional)</label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-sky-500 outline-none font-bold text-sm dark:text-white"
                  placeholder="e.g. Biology — Cell Structures"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Output filename</label>
                <input
                  type="text"
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-sky-500 outline-none font-bold text-sm dark:text-white"
                  placeholder="Study_Sheets"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Footer branding</label>
              <input
                type="text"
                value={branding}
                onChange={(e) => setBranding(e.target.value)}
                className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-sky-500 outline-none font-bold text-sm dark:text-white"
                placeholder="Your Name | Study Notes"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Images per page</label>
              <div className="grid grid-cols-4 gap-2">
                {([1, 2, 4, 6] as ImagesPerPage[]).map(n => (
                  <button
                    key={n}
                    onClick={() => setImagesPerPage(n)}
                    className={`py-2.5 rounded-xl text-sm font-black transition-all border ${imagesPerPage === n ? 'bg-sky-500 text-white border-sky-500 shadow-lg shadow-sky-500/20' : 'bg-gray-50 dark:bg-black text-gray-500 dark:text-zinc-400 border-gray-100 dark:border-white/5 hover:border-sky-300'}`}
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
                    className={`relative w-11 h-6 rounded-full transition-colors ${includeNotes ? 'bg-sky-500' : 'bg-gray-200 dark:bg-zinc-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${includeNotes ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {includeNotes && (
                  <>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Notes heading</label>
                      <input
                        type="text"
                        value={notesHeading}
                        onChange={(e) => setNotesHeading(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-sky-500 outline-none font-bold text-sm dark:text-white"
                        placeholder="Key Points"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Note style</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['bullets', 'lines'] as NoteStyle[]).map(s => (
                          <button
                            key={s}
                            onClick={() => setNoteStyle(s)}
                            className={`py-2 rounded-xl text-xs font-black capitalize transition-all border ${noteStyle === s ? 'bg-sky-500 text-white border-sky-500' : 'bg-gray-50 dark:bg-black text-gray-500 dark:text-zinc-400 border-gray-100 dark:border-white/5 hover:border-sky-300'}`}
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
                        className="w-full accent-sky-500"
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
        </div>
      )}

      <PrivacyBadge />
    </NativeToolLayout>
  )
}
