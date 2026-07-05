import { useState, useRef, useEffect } from 'react'
import { FileText, FileSpreadsheet, Presentation, Loader2, X, Sparkles, Printer, Camera } from 'lucide-react'
import { toast } from 'sonner'

import { addActivity } from '../../utils/recentActivity'
import { usePipeline } from '../../utils/pipelineContext'
import { convertOfficeToPdfSnapshot, printOfficeAsPdf, detectOfficeKind, type OfficeKind } from '../../utils/officeToPdf'
import { NativeToolLayout } from './shared/NativeToolLayout'
import SuccessState from './shared/SuccessState'
import PrivacyBadge from './shared/PrivacyBadge'

const ACCEPT = '.docx,.xlsx,.xls,.pptx'

type Mode = 'text' | 'snapshot'

const KIND_META: Record<OfficeKind, { label: string; icon: typeof FileText; color: string; bg: string }> = {
  docx: { label: 'Word Document', icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  xlsx: { label: 'Excel Spreadsheet', icon: FileSpreadsheet, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  pptx: { label: 'PowerPoint Slides', icon: Presentation, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20' },
}

export default function OfficeToPdfTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { consumePipelineFile } = usePipeline()

  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<OfficeKind | null>(null)
  const [mode, setMode] = useState<Mode>('text')
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState('')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [outName, setOutName] = useState('')

  useEffect(() => {
    const pipelined = consumePipelineFile()
    if (pipelined) {
      const f = new File([pipelined.buffer as any], pipelined.name, { type: pipelined.type })
      acceptFile(f)
    }
    return () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl) }
  }, [])

  const acceptFile = (f: File) => {
    const detected = detectOfficeKind(f)
    if (!detected) { toast.error('Unsupported file. Use .docx, .xlsx, or .pptx.'); return }
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); setDownloadUrl(null) }
    setFile(f)
    setKind(detected)
    setOutName(f.name.replace(/\.[^.]+$/, ''))
    setProgress('')
  }

  const handleConvert = async () => {
    if (!file || isProcessing) return
    setIsProcessing(true)
    try {
      if (mode === 'text') {
        await printOfficeAsPdf(file, (m) => setProgress(m))
        toast.success('Done — if you chose "Save as PDF" in the dialog, your file is saved.')
      } else {
        setProgress('Starting…')
        const bytes = await convertOfficeToPdfSnapshot(file, (m) => setProgress(m))
        const blob = new Blob([bytes as any], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        setDownloadUrl(url)
        addActivity({ name: `${outName || 'document'}.pdf`, tool: 'Office to PDF', size: blob.size, resultUrl: url })
        toast.success('Converted to PDF!')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Conversion failed.')
    } finally {
      setIsProcessing(false)
      setProgress('')
    }
  }

  const reset = () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    setFile(null)
    setKind(null)
    setDownloadUrl(null)
    setProgress('')
    setIsProcessing(false)
  }

  const meta = kind ? KIND_META[kind] : null

  return (
    <NativeToolLayout
      title="Office to PDF"
      description="Convert Word, Excel & PowerPoint files to PDF — entirely in your browser."
    >
      <input
        type="file"
        accept={ACCEPT}
        className="hidden"
        ref={fileInputRef}
        onChange={(e) => e.target.files?.[0] && acceptFile(e.target.files[0])}
      />

      {downloadUrl ? (
        <div className="bg-white dark:bg-zinc-900 p-8 rounded-[2rem] border border-gray-100 dark:border-white/5">
          <SuccessState
            message="Your PDF is ready!"
            downloadUrl={downloadUrl}
            fileName={`${outName || 'document'}.pdf`}
            onStartOver={reset}
          />
        </div>
      ) : !file ? (
        <>
          <div
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className="border-4 border-dashed border-gray-100 dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-sky-50 dark:hover:bg-sky-900/10 hover:border-sky-200 transition-all cursor-pointer group"
          >
            <div className="w-20 h-20 bg-sky-50 dark:bg-sky-900/20 text-sky-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
              <FileText size={32} />
            </div>
            <h3 className="text-xl font-bold dark:text-white mb-2">Select an Office file</h3>
            <p className="text-sm text-gray-400">Word, Excel or PowerPoint — drop or tap to browse</p>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {(Object.keys(KIND_META) as OfficeKind[]).map((k) => {
              const m = KIND_META[k]
              const Icon = m.icon
              return (
                <div key={k} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-white/5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${m.bg} ${m.color}`}>
                    <Icon size={20} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 text-center leading-tight">.{k}</span>
                </div>
              )
            })}
          </div>

          <p className="mt-5 text-center text-[11px] text-gray-400 leading-relaxed max-w-md mx-auto">
            Word &amp; Excel convert with high fidelity. PowerPoint is best-effort — text and images
            are placed by position; charts, shapes and animations aren&apos;t rendered.
          </p>
        </>
      ) : (
        <div className="space-y-6">
          {/* File card */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center gap-5">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${meta?.bg} ${meta?.color}`}>
              {meta && <meta.icon size={26} />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm truncate dark:text-white">{file.name}</h3>
              <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest">{meta?.label} · {(file.size / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
            {!isProcessing && (
              <button onClick={reset} className="p-2 text-gray-400 hover:text-sky-500 transition-colors"><X size={20} /></button>
            )}
          </div>

          {/* Mode selector */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5">
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Output quality</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setMode('text')}
                disabled={isProcessing}
                className={`p-4 rounded-2xl border text-left transition-all ${mode === 'text' ? 'border-sky-500 bg-sky-50/60 dark:bg-sky-900/20 ring-1 ring-sky-500' : 'border-gray-100 dark:border-white/5 hover:border-sky-200 dark:hover:border-sky-900/40'}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Printer size={16} className={mode === 'text' ? 'text-sky-500' : 'text-gray-400'} />
                  <span className={`text-xs font-black ${mode === 'text' ? 'text-sky-600 dark:text-sky-400' : 'text-gray-700 dark:text-zinc-300'}`}>Editable Text</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                  Selectable, searchable text via your browser&apos;s print engine. A print dialog opens — choose <b>&quot;Save as PDF&quot;</b>.
                </p>
              </button>
              <button
                onClick={() => setMode('snapshot')}
                disabled={isProcessing}
                className={`p-4 rounded-2xl border text-left transition-all ${mode === 'snapshot' ? 'border-sky-500 bg-sky-50/60 dark:bg-sky-900/20 ring-1 ring-sky-500' : 'border-gray-100 dark:border-white/5 hover:border-sky-200 dark:hover:border-sky-900/40'}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Camera size={16} className={mode === 'snapshot' ? 'text-sky-500' : 'text-gray-400'} />
                  <span className={`text-xs font-black ${mode === 'snapshot' ? 'text-sky-600 dark:text-sky-400' : 'text-gray-700 dark:text-zinc-300'}`}>Exact Snapshot</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                  One click, downloads automatically. Pages are stored as images — no selectable text, larger file.
                </p>
              </button>
            </div>
          </div>

          {/* Output filename (snapshot only — print mode names the file in the dialog) */}
          {mode === 'snapshot' && (
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Output filename</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={outName}
                  disabled={isProcessing}
                  onChange={(e) => setOutName(e.target.value)}
                  className="flex-1 bg-gray-50 dark:bg-black rounded-xl px-4 py-3 border border-transparent focus:border-sky-500 outline-none font-bold text-sm dark:text-white disabled:opacity-50"
                  placeholder="document"
                />
                <span className="text-sm font-bold text-gray-400">.pdf</span>
              </div>
            </div>
          )}

          {progress && (
            <div className="flex items-center gap-2.5 rounded-2xl bg-sky-50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-900/20 px-4 py-3 text-sky-700 dark:text-sky-400 text-xs font-medium">
              <Loader2 size={14} className="animate-spin shrink-0" />
              {progress}
            </div>
          )}

          {kind === 'pptx' && !isProcessing && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 rounded-2xl px-4 py-3 leading-relaxed">
              PowerPoint conversion is best-effort: text &amp; images are placed by position, but charts,
              shapes and animations may not appear.
            </p>
          )}

          <button
            onClick={handleConvert}
            disabled={isProcessing}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all active:scale-95 disabled:opacity-50 shadow-xl shadow-sky-500/20 flex items-center justify-center gap-2"
          >
            {isProcessing
              ? <><Loader2 size={16} className="animate-spin" /> Converting…</>
              : mode === 'text'
                ? <><Printer size={16} /> Convert &amp; Open Print Dialog</>
                : <><Sparkles size={16} /> Convert to PDF</>
            }
          </button>
        </div>
      )}

      <PrivacyBadge />
    </NativeToolLayout>
  )
}
