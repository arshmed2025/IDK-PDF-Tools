import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";

// ── Worker setup ────────────────────────────────────────────────────────────
// Vite's `new URL(...)` resolves the bundled worker file at build time, so
// this works in dev, prod, and viteSingleFile builds.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export interface ExtractedImage {
  id: string;
  /** Object URL — cheap to render, must be revoked when replaced. */
  url: string;
  /** Raw blob for download (avoids the base64 round-trip). */
  blob: Blob;
  width: number;
  height: number;
  format: string;
  sizeKB: number;
}

// ── Loading ─────────────────────────────────────────────────────────────────

export async function loadPdf(file: File): Promise<PDFDocumentProxy> {
  const buf = await file.arrayBuffer();
  // pdf.js takes ownership of the buffer (transferable). Don't reuse it.
  return pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    // useSystemFonts can trigger a permissions prompt in some browsers and
    // isn't needed for image extraction.
    useSystemFonts: false,
    isEvalSupported: false,
    // Data is fully in memory — streaming/range only adds overhead.
    disableRange: true,
    disableStream: true,
  }).promise;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wrap canvas.toBlob in a Promise. Async encoding lets the browser do PNG
 * compression off the main rendering path — the single biggest win against
 * perceived lag on large extracted images.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null")),
      type,
      quality
    );
  });
}

/**
 * Resolve a PDF.js image XObject by name. PDF.js stores most images on
 * page.objs but a handful (e.g., shared resources) live on commonObjs. We
 * try both, with a hard timeout so a missing resource never wedges the
 * extractor.
 */
function getImageObject(
  page: PDFPageProxy,
  name: string,
  timeoutMs = 8000
): Promise<unknown> {
  type ObjsGet = (n: string, cb: (data: unknown) => void) => void;

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (data: unknown, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else if (data == null) reject(new Error(`Image "${name}" was null`));
      else resolve(data);
    };

    const timer = setTimeout(
      () =>
        finish(
          null,
          new Error(`Timeout resolving "${name}" after ${timeoutMs}ms`)
        ),
      timeoutMs
    );

    try {
      // page.objs / commonObjs aren't part of the public TS surface in 4.x.
      const objs = (page as unknown as { objs: { get: ObjsGet } }).objs;
      const commonObjs = (
        page as unknown as { commonObjs: { get: ObjsGet } }
      ).commonObjs;

      objs.get(name, (data: unknown) => {
        if (data != null) {
          finish(data);
          return;
        }
        try {
          commonObjs.get(name, (d: unknown) => finish(d));
        } catch (e) {
          finish(null, e instanceof Error ? e : new Error(String(e)));
        }
      });
    } catch (e) {
      finish(null, e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Render PDF.js image data onto an off-screen canvas.
 *
 * In pdfjs-dist 4.x the typical path is `imgData instanceof ImageBitmap`
 * (or `{ bitmap: ImageBitmap }`), which is a zero-copy GPU draw. The raw
 * pixel paths are kept correct for older builds and edge cases.
 *
 * PDF.js ImageKind:
 *   1 = GRAYSCALE_1BPP — bit-packed, 1 *bit* per pixel, MSB-first,
 *       row stride = ((width + 7) >> 3) bytes. Bit set ⇒ black, per
 *       pdf.js's own canvas renderer.
 *   2 = RGB_24BPP      — 3 bytes per pixel, no alpha.
 *   3 = RGBA_32BPP     — 4 bytes per pixel, direct copy.
 *
 * The previous implementation read kind=1 as 1 *byte* per pixel, which
 * mis-decodes any genuine 1-bit image (line art, scanned monochrome).
 */
function renderImgDataToCanvas(imgData: unknown): HTMLCanvasElement | null {
  // ── ImageBitmap (modern fast path) ──────────────────────────────────────
  if (imgData instanceof ImageBitmap) {
    return drawBitmap(imgData);
  }
  if (
    imgData &&
    typeof imgData === "object" &&
    "bitmap" in imgData &&
    (imgData as { bitmap: unknown }).bitmap instanceof ImageBitmap
  ) {
    return drawBitmap((imgData as { bitmap: ImageBitmap }).bitmap);
  }

  // ── Raw pixel path ──────────────────────────────────────────────────────
  const obj = imgData as {
    data?: Uint8Array | Uint8ClampedArray;
    width?: number;
    height?: number;
    kind?: number;
  } | null;
  if (!obj?.data || !obj.width || !obj.height) return null;

  const { width, height, data: src, kind } = obj;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  const imageData = ctx.createImageData(width, height);
  const dst = imageData.data;

  switch (kind) {
    case 1: {
      // GRAYSCALE_1BPP: bit-packed, MSB-first, row-padded to byte.
      const rowBytes = (width + 7) >> 3;
      let d = 0;
      for (let y = 0; y < height; y++) {
        const rowStart = y * rowBytes;
        for (let x = 0; x < width; x++) {
          const byte = src[rowStart + (x >> 3)];
          const bit = (byte >> (7 - (x & 7))) & 1;
          const v = bit ? 0 : 255; // 1 = black, 0 = white
          dst[d++] = v;
          dst[d++] = v;
          dst[d++] = v;
          dst[d++] = 255;
        }
      }
      break;
    }
    case 2: {
      // RGB_24BPP → expand to RGBA
      const px = width * height;
      let s = 0;
      let d = 0;
      for (let p = 0; p < px; p++) {
        dst[d++] = src[s++];
        dst[d++] = src[s++];
        dst[d++] = src[s++];
        dst[d++] = 255;
      }
      break;
    }
    case 3:
      // RGBA_32BPP → direct copy
      dst.set(src.subarray(0, dst.length));
      break;
    default: {
      // Unknown — best-effort RGB guess. Better than throwing in the middle
      // of a parallel batch.
      console.warn(
        `pdfExtractor: unknown ImageKind ${kind}, attempting RGB fallback`
      );
      const px = width * height;
      let s = 0;
      let d = 0;
      for (let p = 0; p < px && s + 2 < src.length; p++) {
        dst[d++] = src[s++];
        dst[d++] = src[s++];
        dst[d++] = src[s++];
        dst[d++] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function drawBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  // No willReadFrequently — that disables hardware acceleration in Chrome
  // and we never read pixels back; we only encode-on-write.
  const ctx = canvas.getContext("2d", { alpha: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

async function canvasToResult(
  canvas: HTMLCanvasElement,
  id: string,
  format = "PNG"
): Promise<ExtractedImage> {
  const blob = await canvasToBlob(canvas, "image/png");
  const url = URL.createObjectURL(blob);
  return {
    id,
    url,
    blob,
    width: canvas.width,
    height: canvas.height,
    format,
    sizeKB: Math.max(1, Math.round(blob.size / 1024)),
  };
}

/**
 * Revoke object URLs held by a results array. Call before replacing the
 * array — failure to do so leaks blob memory until full page reload.
 */
export function disposeImages(images: ExtractedImage[]): void {
  for (const img of images) {
    try {
      URL.revokeObjectURL(img.url);
    } catch {
      // already revoked — ignore
    }
  }
}

// ── Main extraction ─────────────────────────────────────────────────────────

export async function extractImagesFromPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<ExtractedImage[]> {
  onProgress?.(`Loading page ${pageNumber}…`);
  const page = await pdf.getPage(pageNumber);

  const cleanup = (): void => {
    try {
      page.cleanup();
    } catch {
      // page may already be cleaned up if pdf was destroyed
    }
  };

  if (signal?.aborted) {
    cleanup();
    return [];
  }

  const ops = await page.getOperatorList();
  if (signal?.aborted) {
    cleanup();
    return [];
  }

  const OPS = pdfjsLib.OPS;

  // Collect unique image-XObject names in document order.
  const seen = new Set<string>();
  const names: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintJpegXObject ||
      fn === OPS.paintXObject
    ) {
      const n = ops.argsArray[i]?.[0];
      if (typeof n === "string" && !seen.has(n)) {
        seen.add(n);
        names.push(n);
      }
    }
  }

  if (names.length === 0) {
    onProgress?.("No image references — falling back to full-page render…");
  } else {
    onProgress?.(
      `Found ${names.length} image reference${names.length === 1 ? "" : "s"} — extracting in parallel…`
    );
  }

  // Fetch + render all images in parallel. allSettled prevents one bad
  // resource from killing the whole batch.
  const canvases = await Promise.allSettled(
    names.map(async (name): Promise<HTMLCanvasElement | null> => {
      if (signal?.aborted) return null;
      const data = await getImageObject(page, name);
      if (signal?.aborted) return null;
      const canvas = renderImgDataToCanvas(data);
      if (!canvas) return null;
      // Drop degenerate masks / 1-px spacers that aren't useful images.
      if (canvas.width < 4 || canvas.height < 4) return null;
      return canvas;
    })
  );

  if (signal?.aborted) {
    cleanup();
    return [];
  }

  // Encode all canvases in parallel — toBlob is async so the browser can
  // overlap PNG compression across multiple images.
  const encodeTasks: Promise<ExtractedImage>[] = [];
  let imgIdx = 0;
  for (let i = 0; i < canvases.length; i++) {
    const r = canvases[i];
    if (r.status === "fulfilled" && r.value) {
      const idx = imgIdx++;
      encodeTasks.push(
        canvasToResult(r.value, `page${pageNumber}_img${idx}`, "PNG")
      );
    } else if (r.status === "rejected") {
      console.warn(
        `pdfExtractor: skipping "${names[i]}":`,
        r.reason instanceof Error ? r.reason.message : r.reason
      );
    }
  }

  const images = await Promise.all(encodeTasks);

  // If aborted mid-encode, dispose what we made and bail.
  if (signal?.aborted) {
    disposeImages(images);
    cleanup();
    return [];
  }

  // Fallback: high-DPI full-page render when nothing extractable was found.
  if (images.length === 0) {
    onProgress?.("No embedded images — rendering full page at 3× DPI…");
    const scale = 3;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      cleanup();
      throw new Error("Could not create 2D context for full-page render");
    }

    const renderTask: RenderTask = page.render({
      canvasContext: ctx,
      viewport,
    });

    // Wire abort → renderTask.cancel so a long render doesn't outlive cancel.
    const onAbort = () => {
      try {
        renderTask.cancel();
      } catch {
        // ignore
      }
    };
    signal?.addEventListener("abort", onAbort);

    try {
      await renderTask.promise;
      if (!signal?.aborted) {
        images.push(
          await canvasToResult(
            canvas,
            `page${pageNumber}_fullrender`,
            "PNG (Full Page @ 3×)"
          )
        );
      }
    } catch (err) {
      // Render-cancel surfaces as RenderingCancelledException — swallow it
      // when the cancellation was ours.
      const errName = (err as { name?: string } | null)?.name;
      if (errName !== "RenderingCancelledException" && !signal?.aborted) {
        cleanup();
        throw err;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  if (!signal?.aborted) {
    onProgress?.(
      `Done — extracted ${images.length} image${images.length === 1 ? "" : "s"}.`
    );
  }

  cleanup();
  return images;
}

// ── Page preview ────────────────────────────────────────────────────────────

const PREVIEW_CACHE_MAX = 12;
const previewCache = new Map<string, string>();
let activePreviewTask: RenderTask | null = null;

function pdfFingerprint(pdf: PDFDocumentProxy): string {
  const fps = (pdf as unknown as { fingerprints?: string[] }).fingerprints;
  return fps?.[0] ?? "pdf";
}

/**
 * Render a JPEG thumbnail of a page. Cached LRU-style so common navigation
 * patterns (← → flicking between pages) don't re-render. Cache holds the
 * last PREVIEW_CACHE_MAX pages — bounded so big PDFs don't bloat memory.
 *
 * Concurrent calls cancel the previous in-flight render to keep the UI
 * responsive while the user is rapidly typing a page number.
 */
export async function renderPagePreview(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  maxWidth = 640
): Promise<string> {
  const key = `${pdfFingerprint(pdf)}_p${pageNumber}_w${maxWidth}`;

  // LRU touch on cache hit
  const cached = previewCache.get(key);
  if (cached !== undefined) {
    previewCache.delete(key);
    previewCache.set(key, cached);
    return cached;
  }

  // Cancel any in-flight render — saves a lot of work when scrolling fast.
  if (activePreviewTask) {
    try {
      activePreviewTask.cancel();
    } catch {
      // ignore
    }
    activePreviewTask = null;
  }

  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  // Cap scale at 2× so previews stay snappy even on tiny pages.
  const scale = Math.min(maxWidth / baseViewport.width, 2);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    page.cleanup();
    throw new Error("Could not create 2D context for preview");
  }

  const task = page.render({ canvasContext: ctx, viewport });
  activePreviewTask = task;

  try {
    await task.promise;
  } catch (err) {
    page.cleanup();
    throw err;
  } finally {
    if (activePreviewTask === task) activePreviewTask = null;
  }

  // JPEG @ 0.85 is roughly 6–10× smaller than PNG for a page render and
  // visually identical at this size. Don't use PNG — preview cache would
  // dwarf the rest of the app's memory budget on long PDFs.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  page.cleanup();

  // LRU eviction
  if (previewCache.size >= PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(key, dataUrl);
  return dataUrl;
}

export function clearPreviewCache(): void {
  if (activePreviewTask) {
    try {
      activePreviewTask.cancel();
    } catch {
      // ignore
    }
    activePreviewTask = null;
  }
  previewCache.clear();
}
