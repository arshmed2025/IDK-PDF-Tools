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
import { GripVertical, Download, RotateCcw, SortAsc, ArrowUpDown, Plus, X, FolderOpen, Microscope } from 'lucide-react'
import { toast } from 'sonner'
import { NativeToolLayout } from './shared/NativeToolLayout'
import PrivacyBadge from './shared/PrivacyBadge'

const SUPPORTED = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'gif', 'webp']

type ImageItem = { kind: 'image'; id: string; name: string; url: string }
type SectionItem = { kind: 'section'; id: string; label: string }
type Item = ImageItem | SectionItem

function SortableImageCard({ item, onRemove }: { item: ImageItem; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative bg-white dark:bg-zinc-900 rounded-2xl border transition-all overflow-hidden group
        ${isDragging ? 'opacity-40 scale-95 border-rose-300 dark:border-rose-700 shadow-xl' : 'border-gray-100 dark:border-white/5 hover:border-rose-200 dark:hover:border-rose-900/30 hover:shadow-md'}`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <div className="relative">
          <img
            src={item.url}
            alt={item.name}
            loading="lazy"
            className="w-full h-32 object-cover block"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="px-3 py-2">
          <p className="font-mono text-[10px] text-gray-500 dark:text-zinc-400 truncate leading-tight">{item.name}</p>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-rose-500"
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

export default function HistologyReordererTool() {
  const [items, setItems] = useState<Item[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadFiles = useCallback((fileList: File[]) => {
    const filtered = fileList.filter(f => SUPPORTED.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
    if (!filtered.length) { toast.error('No supported images found.'); return }

    const seen = new Set<string>()
    const unique = filtered.filter(f => { if (seen.has(f.name)) return false; seen.add(f.name); return true })
    const sorted = unique.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const newItems: ImageItem[] = sorted.map(f => ({
      kind: 'image',
      id: `img_${f.name}_${f.lastModified}`,
      name: f.name,
      url: URL.createObjectURL(f),
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
      for (const item of Array.from(e.dataTransfer.items)) {
        const f = item.getAsFile()
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
    const label = window.prompt('Section name (e.g. THYROID, PAROTID):', 'NEW SECTION')?.trim()
    if (!label) return
    const newSection: SectionItem = { kind: 'section', id: `sec_${Date.now()}`, label }
    setItems(prev => [newSection, ...prev])
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

  const downloadOrder = () => {
    if (!items.length) { toast.error('Nothing to export.'); return }

    const lines = [
      '# Generated by IDK PDF Tools — Histology Image Reorderer',
      '# One filename per line; lines starting with # are ignored',
      '# Place this file in your image folder and run the script with ORDER_BY = "custom"',
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

  const imageCount = items.filter(i => i.kind === 'image').length
  const sectionCount = items.filter(i => i.kind === 'section').length

  return (
    <NativeToolLayout
      title="Histology Reorderer"
      description="Drag images to reorder them, add section dividers, then export order.txt."
      actions={
        items.length > 0 ? (
          <button
            onClick={downloadOrder}
            className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all active:scale-95 shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2"
          >
            <Download size={16} /> Download order.txt
          </button>
        ) : undefined
      }
    >
      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={onFolderChange}
      />

      {items.length === 0 ? (
        <div
          onClick={() => folderInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setIsDragOver(true) }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current = Math.max(0, dragCounterRef.current - 1); if (dragCounterRef.current === 0) setIsDragOver(false) }}
          onDrop={onDrop}
          className={`border-4 border-dashed rounded-[2.5rem] p-12 text-center cursor-pointer transition-all group
            ${isDragOver ? 'border-rose-400 bg-rose-50 dark:bg-rose-900/10 scale-[1.01]' : 'border-gray-100 dark:border-zinc-900 hover:bg-rose-50 dark:hover:bg-rose-900/10 hover:border-rose-200'}`}
        >
          <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
            <Microscope size={32} />
          </div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Drop your images here</h3>
          <p className="text-sm text-gray-400 mb-4">Or click to browse — supports JPG, PNG, TIFF, WebP</p>
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-4 py-2 rounded-full border border-rose-100 dark:border-rose-900/30">
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
            <button onClick={sortAlpha} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-600 dark:text-zinc-300 hover:border-rose-200 hover:text-rose-500 transition-colors">
              <SortAsc size={12} /> A→Z
            </button>
            <button onClick={reverseAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-600 dark:text-zinc-300 hover:border-rose-200 hover:text-rose-500 transition-colors">
              <ArrowUpDown size={12} /> Reverse
            </button>
            <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-white/5 text-xs font-black text-gray-300 hover:text-rose-500 transition-colors">
              <RotateCcw size={12} /> Reset
            </button>
            <button onClick={() => folderInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/30 text-xs font-black text-rose-500 hover:bg-rose-100 transition-colors">
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
        </div>
      )}

      <PrivacyBadge />
    </NativeToolLayout>
  )
}
