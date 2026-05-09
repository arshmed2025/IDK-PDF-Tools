import { useState, useRef, useCallback, useEffect } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  loadPdf,
  extractImagesFromPage,
  renderPagePreview,
  clearPreviewCache,
  disposeImages,
  type ExtractedImage,
} from "./pdfExtractor";
import JSZip from "jszip";
import { saveAs } from "file-saver";

function isProbablyPdf(file: File): boolean {
  // Some browsers/OSs don't set file.type — fall back to extension.
  if (file.type === "application/pdf" || file.type === "application/x-pdf")
    return true;
  return /\.pdf$/i.test(file.name);
}

export default function App() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pagePreview, setPagePreview] = useState<string | null>(null);
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Drag-enter counter: dragleave fires when hovering over child elements,
  // which makes a single counter the only reliable way to know we've truly
  // left the dropzone.
  const dragCounterRef = useRef(0);

  // Keep refs to the current pdf and images so cleanup hooks see fresh values
  // without making cleanup depend on them.
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const imagesRef = useRef<ExtractedImage[]>([]);
  pdfRef.current = pdf;
  imagesRef.current = images;

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearPreviewCache();
      disposeImages(imagesRef.current);
      pdfRef.current?.destroy().catch(() => {});
    };
  }, []);

  // Debounced page preview: fires 250 ms after pageNumber stops changing.
  // Race-safe: a flag prevents stale renders from overwriting fresh state if
  // the effect is cleaned up mid-flight.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setPreviewLoading(true);

    const timer = setTimeout(async () => {
      try {
        const preview = await renderPagePreview(pdf, pageNumber);
        if (!cancelled) setPagePreview(preview);
      } catch (err) {
        // RenderingCancelledException is expected on rapid navigation.
        const name = (err as { name?: string } | null)?.name;
        if (!cancelled && name !== "RenderingCancelledException") {
          // Only surface non-cancellation errors.
          // eslint-disable-next-line no-console
          console.warn("Preview render failed:", err);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, pageNumber]);

  const handleFile = useCallback(async (file: File) => {
    if (!isProbablyPdf(file)) {
      setError("Please upload a PDF file.");
      return;
    }
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }

    // Cancel any running extraction.
    abortRef.current?.abort();

    // Tear down the previous document and its results.
    disposeImages(imagesRef.current);
    const oldPdf = pdfRef.current;

    setError("");
    setLoading(true);
    setProgress("Loading PDF…");
    setImages([]);
    setPagePreview(null);
    clearPreviewCache();

    try {
      const pdfDoc = await loadPdf(file);
      // Destroy the previous PDF only after the new one parses cleanly, so a
      // bad file doesn't leave the user with no document loaded.
      oldPdf?.destroy().catch(() => {});

      setPdf(pdfDoc);
      setFileName(file.name);
      setTotalPages(pdfDoc.numPages);
      setPageNumber(1);
      setProgress(
        `Loaded — ${pdfDoc.numPages} page${pdfDoc.numPages === 1 ? "" : "s"}.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load PDF: ${msg}`);
      setProgress("");
    } finally {
      setLoading(false);
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be re-selected.
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragOver(false);
  };

  const handleExtract = async () => {
    if (!pdf || loading) return;
    if (pageNumber < 1 || pageNumber > totalPages) {
      setError(`Page must be between 1 and ${totalPages}.`);
      return;
    }

    // Cancel any previous extraction.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Dispose URLs from the previous run so we don't leak blob memory.
    disposeImages(imagesRef.current);

    setError("");
    setLoading(true);
    setImages([]);
    setProgress("Starting extraction…");

    try {
      const extracted = await extractImagesFromPage(
        pdf,
        pageNumber,
        controller.signal,
        (msg) => {
          // Drop progress updates from a stale extraction.
          if (!controller.signal.aborted) setProgress(msg);
        }
      );
      if (!controller.signal.aborted) {
        setImages(extracted);
        if (extracted.length === 0) {
          setProgress("No extractable images found on this page.");
        }
      } else {
        // We were aborted — discard whatever we got.
        disposeImages(extracted);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Extraction failed: ${msg}`);
        setProgress("");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const baseFileName = fileName.replace(/\.pdf$/i, "");

  const downloadImage = (img: ExtractedImage, index: number) => {
    saveAs(
      img.blob,
      `${baseFileName}_page${pageNumber}_img${index + 1}.png`
    );
  };

  const downloadAll = async () => {
    if (images.length === 0) return;
    if (images.length === 1) {
      downloadImage(images[0], 0);
      return;
    }
    const zip = new JSZip();
    for (let i = 0; i < images.length; i++) {
      // Pass the Blob directly — JSZip handles it without a base64 round-trip.
      zip.file(
        `${baseFileName}_page${pageNumber}_img${i + 1}.png`,
        images[i].blob
      );
    }
    const blob = await zip.generateAsync({
      type: "blob",
      // No re-compression — PNGs are already compressed; STORE is far faster
      // and produces near-identical zip sizes for incompressible payloads.
      compression: "STORE",
    });
    saveAs(blob, `${baseFileName}_page${pageNumber}_images.zip`);
  };

  const formatSize = (kb: number) =>
    kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

  const handlePageInput = (raw: string) => {
    if (raw === "") {
      // Allow clearing while typing — clamp on blur or extract.
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setPageNumber(Math.max(1, Math.min(totalPages, Math.floor(n))));
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 shadow-sm">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500 shadow-md shadow-rose-200">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-stone-900 leading-tight">PDF Image Extractor</h1>
            <p className="text-xs text-stone-500 leading-tight">Extract high-quality images from any PDF page</p>
          </div>
          <div className="ml-auto">
            <span className="text-xs bg-emerald-100 text-emerald-700 font-medium px-2.5 py-1 rounded-full">
              100% local — no uploads
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* Upload Area */}
        <section
          onDragEnter={onDragEnter}
          onDragOver={(e) => { e.preventDefault(); }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 p-10 text-center select-none
            ${dragOver
              ? "border-rose-400 bg-rose-50 scale-[1.01]"
              : pdf
                ? "border-emerald-400 bg-emerald-50 hover:bg-emerald-100/60"
                : "border-stone-300 bg-white hover:border-rose-300 hover:bg-rose-50/40"
            }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onFileChange}
            className="hidden"
          />

          {pdf ? (
            <div className="space-y-2 pointer-events-none">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-xs font-semibold">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                PDF Loaded
              </div>
              <p className="text-base font-semibold text-stone-800">{fileName}</p>
              <p className="text-sm text-stone-500">{totalPages} page{totalPages !== 1 ? "s" : ""} · Click or drop to replace</p>
            </div>
          ) : (
            <div className="space-y-3 pointer-events-none">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-stone-100">
                <svg className="w-7 h-7 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 3 3 0 013.898 3.345A3.745 3.745 0 0118 19.5H6.75z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-stone-700">Drop your PDF here, or click to browse</p>
              <p className="text-sm text-stone-400">Works entirely in your browser — nothing is sent to any server</p>
            </div>
          )}
        </section>

        {/* Controls */}
        {pdf && (
          <section className="flex flex-wrap items-end gap-4 rounded-2xl bg-white border border-stone-200 shadow-sm p-5">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                Page
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1 || loading}
                  className="w-9 h-9 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-stone-600"
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageNumber}
                  disabled={loading}
                  onChange={(e) => handlePageInput(e.target.value)}
                  onBlur={(e) => {
                    if (e.target.value === "") setPageNumber(1);
                  }}
                  className="w-20 text-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 font-mono text-base focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 disabled:opacity-50"
                />
                <button
                  onClick={() => setPageNumber((p) => Math.min(totalPages, p + 1))}
                  disabled={pageNumber >= totalPages || loading}
                  className="w-9 h-9 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-stone-600"
                  aria-label="Next page"
                >
                  ›
                </button>
                <span className="text-sm text-stone-400 ml-1">of {totalPages}</span>
              </div>
            </div>

            <button
              onClick={handleExtract}
              disabled={loading}
              className="px-6 py-2.5 rounded-xl font-semibold text-white bg-rose-500 hover:bg-rose-600 active:scale-95 shadow-md shadow-rose-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Extracting…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                  </svg>
                  Extract Images
                </>
              )}
            </button>
          </section>
        )}

        {/* Progress */}
        {progress && (
          <div className="flex items-center gap-2.5 rounded-xl bg-sky-50 border border-sky-200 px-4 py-2.5 text-sky-700 text-sm">
            {loading ? (
              <svg className="animate-spin w-4 h-4 shrink-0 text-sky-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 shrink-0 text-sky-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            )}
            {progress}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-red-700 text-sm">
            <svg className="w-4 h-4 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {/* Two-column layout: Preview + Results */}
        {pdf && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Page Preview */}
            <section className="rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-stone-700">Page {pageNumber} Preview</h2>
                {previewLoading && (
                  <span className="text-xs text-stone-400 flex items-center gap-1.5">
                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Rendering…
                  </span>
                )}
              </div>
              <div className="p-4 flex items-center justify-center min-h-[200px] bg-[repeating-conic-gradient(#f0f0f0_0%_25%,#fafafa_0%_50%)] bg-[length:16px_16px]">
                {pagePreview ? (
                  <img
                    src={pagePreview}
                    alt={`Page ${pageNumber} preview`}
                    className="max-w-full max-h-[480px] rounded-lg shadow-md"
                  />
                ) : (
                  <div className="text-stone-400 text-sm">Preview will appear here</div>
                )}
              </div>
            </section>

            {/* Extracted Images */}
            <section className="rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
                  Extracted Images
                  {images.length > 0 && (
                    <span className="text-xs font-medium text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
                      {images.length}
                    </span>
                  )}
                </h2>
                {images.length > 0 && (
                  <button
                    onClick={downloadAll}
                    className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {images.length > 1 ? "Download All (ZIP)" : "Download"}
                  </button>
                )}
              </div>

              <div className="p-4 space-y-3 max-h-[540px] overflow-y-auto">
                {images.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center py-12 text-stone-400 text-sm gap-2">
                    <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                    </svg>
                    <p>Click "Extract Images" to begin</p>
                  </div>
                )}

                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className="rounded-xl border border-stone-200 overflow-hidden hover:border-rose-300 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-center justify-center bg-[repeating-conic-gradient(#f0f0f0_0%_25%,#fafafa_0%_50%)] bg-[length:12px_12px] min-h-[100px] p-3">
                      <img
                        src={img.url}
                        alt={`Image ${idx + 1}`}
                        loading="lazy"
                        className="max-w-full max-h-[220px] rounded shadow-sm"
                      />
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between border-t border-stone-100 bg-stone-50/60">
                      <div className="text-xs text-stone-500 space-y-0.5">
                        <p className="font-semibold text-stone-700">Image {idx + 1}</p>
                        <p>{img.width} × {img.height} px · {img.format} · {formatSize(img.sizeKB)}</p>
                      </div>
                      <button
                        onClick={() => downloadImage(img, idx)}
                        className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold transition-colors shadow-sm"
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* How it works — only when no PDF loaded */}
        {!pdf && (
          <section className="rounded-2xl bg-white border border-stone-200 shadow-sm p-8">
            <h3 className="text-sm font-bold uppercase tracking-wide text-stone-400 mb-6">How it works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { n: 1, title: "Upload PDF", desc: "Drop or browse for your PDF file" },
                { n: 2, title: "Select Page", desc: "Choose which page to extract from" },
                { n: 3, title: "Download", desc: "Get images as lossless PNG files" },
              ].map(({ n, title, desc }) => (
                <div key={n} className="flex gap-4 items-start">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-rose-100 text-rose-600 font-bold text-sm shrink-0">
                    {n}
                  </div>
                  <div>
                    <p className="font-semibold text-stone-800 text-sm">{title}</p>
                    <p className="text-xs text-stone-500 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-stone-200 mt-12">
        <div className="mx-auto max-w-5xl px-6 py-4 text-center text-xs text-stone-400">
          All processing happens locally in your browser — no files leave your device.
        </div>
      </footer>
    </div>
  );
}
