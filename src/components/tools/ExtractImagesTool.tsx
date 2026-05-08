import { useState, useRef, useCallback, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Image as ImageIcon, ChevronLeft, ChevronRight, Download, Loader2, X, Sparkles } from 'lucide-react'
import JSZip from 'jszip'
import { toast } from 'sonner'

import { getPdfMetaData, downloadFile } from '../../utils/pdfHelpers'
import { addActivity } from '../../utils/recentActivity'
import { usePipeline } from '../../utils/pipelineContext'
import { NativeToolLayout } from './shared/NativeToolLayout'
import PrivacyBadge from './shared/PrivacyBadge'
import SuccessState from './shared/SuccessState'
import {
  loadPdfForExtraction,
  extractImagesFromPage,
  renderPagePreview,
  clearPreviewCache,
  disposeImages,
  type ExtractedImage,
} from '../../utils/pdfExtractor'

type PdfData = { file: File; thumbnail?: string; pageCount: number; isLocked: boolean; pdfDoc?: PDFDocumentProxy }

export default function ExtractImagesTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { consumePipelineFile } = usePipeline()
  const abortRef = useRef<AbortController | null>(null)
  const imagesRef = useRef<ExtractedImage[]>([])
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)

  const [pdfData, setPdfData] = useState<PdfData | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pagePreview, setPagePreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [images, setImages] = useState<ExtractedImage[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState('')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [extractedCount, setExtractedCount] = useState(0)
  const [pageInput, setPageInput] = useState('1')

  imagesRef.current = images

  useEffect(() => {
    const pipelined = consumePipelineFile()
    if (pipelined) {
      const file = new File([pipelined.buffer as any], pipelined.name, { type: 'application/pdf' })
      handleFile(file)
    }
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      clearPreviewCache()
      disposeImages(imagesRef.current)
      pdfDocRef.current?.destroy().catch(() => {})
    }
  }, [])

  // Debounced page preview
  useEffect(() => {
    if (!pdfDocRef.current) return
    let cancelled = false
    setPreviewLoading(true)

    const timer = setTimeout(async () => {
      try {
        const preview = await renderPagePreview(pdfDocRef.current!, pageNumber)
        if (!cancelled) setPagePreview(preview)
      } catch (err) {
        const name = (err as { name?: string } | null)?.name
        if (!cancelled && name !== 'RenderingCancelledException') console.warn('Preview render failed:', err)
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 250)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [pdfData, pageNumber])

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      toast.error('Please select a PDF file.')
      return
    }

    abortRef.current?.abort()
    disposeImages(imagesRef.current)
    const oldDoc = pdfDocRef.current

    setImages([])
    setPagePreview(null)
    setDownloadUrl(null)
    setProgress('')
    clearPreviewCache()
    setIsProcessing(true)

    try {
      const meta = await getPdfMetaData(file)
      if (meta.isLocked) {
        setPdfData({ file, pageCount: 0, isLocked: true })
        return
      }
      const pdfDoc = await loadPdfForExtraction(file)
      oldDoc?.destroy().catch(() => {})
      pdfDocRef.current = pdfDoc
      setPdfData({ file, pageCount: pdfDoc.numPages, isLocked: false, pdfDoc, thumbnail: meta.thumbnail })
      setPageNumber(1)
      setPageInput('1')
    } catch (err) {
      toast.error('Failed to load PDF.')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleExtract = async () => {
    if (!pdfData || !pdfDocRef.current || isProcessing) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    disposeImages(imagesRef.current)
    setImages([])
    setDownloadUrl(null)
    setIsProcessing(true)
    setProgress('Starting extraction…')

    try {
      const extracted = await extractImagesFromPage(
        pdfDocRef.current,
        pageNumber,
        controller.signal,
        (msg) => { if (!controller.signal.aborted) setProgress(msg) }
      )

      if (controller.signal.aborted) { disposeImages(extracted); return }

      setImages(extracted)
      setExtractedCount(extracted.length)

      if (extracted.length === 0) {
        setProgress('No extractable images found on this page.')
        return
      }

      // Auto-zip if multiple images
      if (extracted.length > 1) {
        const zip = new JSZip()
        const baseName = pdfData.file.name.replace(/\.pdf$/i, '')
        for (let i = 0; i < extracted.length; i++) {
          zip.file(`${baseName}_page${pageNumber}_img${i + 1}.png`, extracted[i].blob)
        }
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
        const url = URL.createObjectURL(zipBlob)
        setDownloadUrl(url)
        addActivity({ name: `${baseName}-images.zip`, tool: 'Extract Images', size: zipBlob.size, resultUrl: url })
        toast.success(`Extracted ${extracted.length} images!`)
      } else {
        toast.success('Image extracted!')
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`)
        setProgress('')
      }
    } finally {
      if (!controller.signal.aborted) setIsProcessing(false)
    }
  }

  const downloadSingle = (img: ExtractedImage, idx: number) => {
    const baseName = pdfData?.file.name.replace(/\.pdf$/i, '') ?? 'image'
    downloadFile(new Uint8Array(img.blob instanceof Blob ? [] : []), `${baseName}_page${pageNumber}_img${idx + 1}.png`, 'image/png')
    const a = document.createElement('a')
    a.href = img.url
    a.download = `${baseName}_page${pageNumber}_img${idx + 1}.png`
    a.click()
  }

  const reset = () => {
    abortRef.current?.abort()
    clearPreviewCache()
    disposeImages(imagesRef.current)
    pdfDocRef.current?.destroy().catch(() => {})
    pdfDocRef.current = null
    setPdfData(null)
    setImages([])
    setPagePreview(null)
    setDownloadUrl(null)
    setProgress('')
    setPageNumber(1)
    setPageInput('1')
    setIsProcessing(false)
  }

  return (
    <NativeToolLayout
      title="Extract Images"
      description="Pull out all original images embedded in a PDF, page by page."
    >
      <input
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        ref={fileInputRef}
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />

      {!pdfData ? (
        <div
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          className="border-4 border-dashed border-gray-100 dark:border-zinc-900 rounded-[2.5rem] p-12 text-center hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all cursor-pointer group"
        >
          <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
            <ImageIcon size={32} />
          </div>
          <h3 className="text-xl font-bold dark:text-white mb-2">Select PDF</h3>
          <p className="text-sm text-gray-400">Drop a file or tap to browse</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* File info */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center gap-6">
            <div className="w-16 h-20 bg-gray-50 dark:bg-black rounded-xl overflow-hidden shrink-0 border border-gray-100 dark:border-zinc-800 flex items-center justify-center text-rose-500">
              {pdfData.thumbnail ? <img src={pdfData.thumbnail} className="w-full h-full object-cover" alt="" /> : <ImageIcon size={20} />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm truncate dark:text-white">{pdfData.file.name}</h3>
              <p className="text-[10px] text-gray-400 uppercase font-black">{pdfData.pageCount} Pages · {(pdfData.file.size / (1024 * 1024)).toFixed(1)} MB</p>
            </div>
            <button onClick={reset} className="p-2 text-gray-400 hover:text-rose-500 transition-colors"><X size={20} /></button>
          </div>

          {/* Page selector + preview */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Page to Extract</span>
              {previewLoading && <span className="text-[10px] text-gray-400 animate-pulse">Rendering…</span>}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => { const p = Math.max(1, pageNumber - 1); setPageNumber(p); setPageInput(String(p)) }}
                disabled={pageNumber <= 1 || isProcessing}
                className="w-9 h-9 rounded-xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-black hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40 transition-colors flex items-center justify-center text-gray-600 dark:text-zinc-400 shrink-0"
              >
                <ChevronLeft size={16} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                disabled={isProcessing}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => {
                  const n = parseInt(pageInput, 10)
                  const clamped = Number.isFinite(n) ? Math.max(1, Math.min(pdfData.pageCount, n)) : pageNumber
                  setPageNumber(clamped)
                  setPageInput(String(clamped))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                className="w-14 text-center rounded-xl border border-gray-100 dark:border-white/5 bg-white dark:bg-black px-2 py-2 font-mono font-bold text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 disabled:opacity-50"
              />
              <button
                onClick={() => { const p = Math.min(pdfData.pageCount, pageNumber + 1); setPageNumber(p); setPageInput(String(p)) }}
                disabled={pageNumber >= pdfData.pageCount || isProcessing}
                className="w-9 h-9 rounded-xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-black hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40 transition-colors flex items-center justify-center text-gray-600 dark:text-zinc-400 shrink-0"
              >
                <ChevronRight size={16} />
              </button>
              <span className="text-sm text-gray-400 mr-2">of {pdfData.pageCount}</span>

              {!downloadUrl && images.length === 0 && (
                <button
                  onClick={handleExtract}
                  disabled={isProcessing}
                  className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 shadow-md shadow-rose-500/20"
                >
                  {isProcessing
                    ? <><Loader2 size={13} className="animate-spin" /> Extracting…</>
                    : <><Sparkles size={13} /> Extract</>
                  }
                </button>
              )}
            </div>

            {pagePreview && (
              <div className="rounded-2xl overflow-hidden border border-gray-100 dark:border-white/5 bg-[repeating-conic-gradient(#f0f0f0_0%_25%,#fafafa_0%_50%)] dark:bg-zinc-950 bg-[length:16px_16px] flex items-center justify-center p-3">
                <img src={pagePreview} alt={`Page ${pageNumber}`} className="max-w-full max-h-64 rounded-lg shadow-md object-contain" />
              </div>
            )}
          </div>

          {/* Progress */}
          {progress && (
            <div className="flex items-center gap-2.5 rounded-2xl bg-sky-50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-900/20 px-4 py-3 text-sky-700 dark:text-sky-400 text-xs font-medium">
              {isProcessing && <Loader2 size={14} className="animate-spin shrink-0" />}
              {progress}
            </div>
          )}

          {/* Results */}
          {images.length > 0 && !downloadUrl && (
            <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-gray-100 dark:border-white/5 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
                <h3 className="text-sm font-black dark:text-white">
                  Extracted Images
                  <span className="ml-2 text-xs font-bold text-gray-400 bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">{images.length}</span>
                </h3>
              </div>
              <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                {images.map((img, idx) => (
                  <div key={img.id} className="rounded-2xl border border-gray-100 dark:border-white/5 overflow-hidden hover:border-rose-200 dark:hover:border-rose-900/30 transition-all">
                    <div className="flex items-center justify-center bg-[repeating-conic-gradient(#f0f0f0_0%_25%,#fafafa_0%_50%)] dark:bg-zinc-950 bg-[length:12px_12px] p-3 min-h-24">
                      <img src={img.url} alt={`Image ${idx + 1}`} loading="lazy" className="max-w-full max-h-48 rounded shadow-sm object-contain" />
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-zinc-950/60">
                      <div className="text-xs text-gray-500 dark:text-zinc-400">
                        <p className="font-bold text-gray-700 dark:text-white">Image {idx + 1}</p>
                        <p>{img.width} × {img.height} px · {img.sizeKB >= 1024 ? `${(img.sizeKB / 1024).toFixed(1)} MB` : `${img.sizeKB} KB`}</p>
                      </div>
                      <button
                        onClick={() => downloadSingle(img, idx)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black transition-colors"
                      >
                        <Download size={12} /> Save
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 pb-4">
                <button onClick={reset} className="w-full py-2 text-[10px] font-black uppercase text-gray-300 hover:text-rose-500 transition-colors">Start Over</button>
              </div>
            </div>
          )}

          {downloadUrl && (
            <div className="bg-white dark:bg-zinc-900 p-8 rounded-[2rem] border border-gray-100 dark:border-white/5">
              <SuccessState
                message={`Extracted ${extractedCount} images!`}
                downloadUrl={downloadUrl}
                fileName={`${pdfData.file.name.replace(/\.pdf$/i, '')}-page${pageNumber}-images.zip`}
                onStartOver={reset}
                showPreview={false}
              />
            </div>
          )}
        </div>
      )}

      <PrivacyBadge />
    </NativeToolLayout>
  )
}
