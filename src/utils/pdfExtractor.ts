import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";

export interface ExtractedImage {
  id: string;
  url: string;
  blob: Blob;
  width: number;
  height: number;
  format: string;
  sizeKB: number;
}

export async function loadPdfForExtraction(file: File): Promise<PDFDocumentProxy> {
  const buf = await file.arrayBuffer();
  return pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    isEvalSupported: false,
    disableRange: true,
    disableStream: true,
  }).promise;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null")),
      type,
      quality
    );
  });
}

function getImageObject(page: PDFPageProxy, name: string, timeoutMs = 8000): Promise<unknown> {
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
      () => finish(null, new Error(`Timeout resolving "${name}" after ${timeoutMs}ms`)),
      timeoutMs
    );

    try {
      const objs = (page as unknown as { objs: { get: ObjsGet } }).objs;
      const commonObjs = (page as unknown as { commonObjs: { get: ObjsGet } }).commonObjs;

      objs.get(name, (data: unknown) => {
        if (data != null) { finish(data); return; }
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

function renderImgDataToCanvas(imgData: unknown): HTMLCanvasElement | null {
  if (imgData instanceof ImageBitmap) return drawBitmap(imgData);
  if (imgData && typeof imgData === "object" && "bitmap" in imgData && (imgData as { bitmap: unknown }).bitmap instanceof ImageBitmap) {
    return drawBitmap((imgData as { bitmap: ImageBitmap }).bitmap);
  }

  const obj = imgData as { data?: Uint8Array | Uint8ClampedArray; width?: number; height?: number; kind?: number } | null;
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
      const rowBytes = (width + 7) >> 3;
      let d = 0;
      for (let y = 0; y < height; y++) {
        const rowStart = y * rowBytes;
        for (let x = 0; x < width; x++) {
          const byte = src[rowStart + (x >> 3)];
          const bit = (byte >> (7 - (x & 7))) & 1;
          const v = bit ? 0 : 255;
          dst[d++] = v; dst[d++] = v; dst[d++] = v; dst[d++] = 255;
        }
      }
      break;
    }
    case 2: {
      const px = width * height;
      let s = 0, d = 0;
      for (let p = 0; p < px; p++) {
        dst[d++] = src[s++]; dst[d++] = src[s++]; dst[d++] = src[s++]; dst[d++] = 255;
      }
      break;
    }
    case 3:
      dst.set(src.subarray(0, dst.length));
      break;
    default: {
      const px = width * height;
      let s = 0, d = 0;
      for (let p = 0; p < px && s + 2 < src.length; p++) {
        dst[d++] = src[s++]; dst[d++] = src[s++]; dst[d++] = src[s++]; dst[d++] = 255;
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
  const ctx = canvas.getContext("2d", { alpha: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

async function canvasToResult(canvas: HTMLCanvasElement, id: string, format = "PNG"): Promise<ExtractedImage> {
  const blob = await canvasToBlob(canvas, "image/png");
  const url = URL.createObjectURL(blob);
  return { id, url, blob, width: canvas.width, height: canvas.height, format, sizeKB: Math.max(1, Math.round(blob.size / 1024)) };
}

export function disposeImages(images: ExtractedImage[]): void {
  for (const img of images) {
    try { URL.revokeObjectURL(img.url); } catch { /* already revoked */ }
  }
}

export async function extractImagesFromPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<ExtractedImage[]> {
  onProgress?.(`Loading page ${pageNumber}…`);
  const page = await pdf.getPage(pageNumber);

  const cleanup = () => { try { page.cleanup(); } catch { /* ignore */ } };

  if (signal?.aborted) { cleanup(); return []; }

  const ops = await page.getOperatorList();
  if (signal?.aborted) { cleanup(); return []; }

  const OPS = pdfjsLib.OPS;
  const seen = new Set<string>();
  const names: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.paintImageXObject || fn === OPS.paintXObject || fn === OPS.paintImageMaskXObject) {
      const n = ops.argsArray[i]?.[0];
      if (typeof n === "string" && !seen.has(n)) { seen.add(n); names.push(n); }
    }
  }

  if (names.length === 0) onProgress?.("No image references — falling back to full-page render…");
  else onProgress?.(`Found ${names.length} image reference${names.length === 1 ? "" : "s"} — extracting…`);

  const canvases = await Promise.allSettled(
    names.map(async (name): Promise<HTMLCanvasElement | null> => {
      if (signal?.aborted) return null;
      const data = await getImageObject(page, name);
      if (signal?.aborted) return null;
      const canvas = renderImgDataToCanvas(data);
      if (!canvas) return null;
      if (canvas.width < 4 || canvas.height < 4) return null;
      return canvas;
    })
  );

  if (signal?.aborted) { cleanup(); return []; }

  const encodeTasks: Promise<ExtractedImage>[] = [];
  let imgIdx = 0;
  for (let i = 0; i < canvases.length; i++) {
    const r = canvases[i];
    if (r.status === "fulfilled" && r.value) {
      const idx = imgIdx++;
      encodeTasks.push(canvasToResult(r.value, `page${pageNumber}_img${idx}`, "PNG"));
    }
  }

  const images = await Promise.all(encodeTasks);

  if (signal?.aborted) { disposeImages(images); cleanup(); return []; }

  if (images.length === 0) {
    onProgress?.("No embedded images — rendering full page at 3× DPI…");
    const scale = 3;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) { cleanup(); throw new Error("Could not create 2D context for full-page render"); }

    const renderTask: RenderTask = page.render({ canvasContext: ctx, viewport, canvas } as any);
    const onAbort = () => { try { renderTask.cancel(); } catch { /* ignore */ } };
    signal?.addEventListener("abort", onAbort);

    try {
      await renderTask.promise;
      if (!signal?.aborted) images.push(await canvasToResult(canvas, `page${pageNumber}_fullrender`, "PNG (Full Page @ 3×)"));
    } catch (err) {
      const errName = (err as { name?: string } | null)?.name;
      if (errName !== "RenderingCancelledException" && !signal?.aborted) { cleanup(); throw err; }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  if (!signal?.aborted) onProgress?.(`Done — extracted ${images.length} image${images.length === 1 ? "" : "s"}.`);

  cleanup();
  return images;
}

const PREVIEW_CACHE_MAX = 12;
const previewCache = new Map<string, string>();
let activePreviewTask: RenderTask | null = null;

function pdfFingerprint(pdf: PDFDocumentProxy): string {
  const fps = (pdf as unknown as { fingerprints?: string[] }).fingerprints;
  return fps?.[0] ?? "pdf";
}

export async function renderPagePreview(pdf: PDFDocumentProxy, pageNumber: number, maxWidth = 640): Promise<string> {
  const key = `${pdfFingerprint(pdf)}_p${pageNumber}_w${maxWidth}`;

  const cached = previewCache.get(key);
  if (cached !== undefined) {
    previewCache.delete(key);
    previewCache.set(key, cached);
    return cached;
  }

  if (activePreviewTask) {
    try { activePreviewTask.cancel(); } catch { /* ignore */ }
    activePreviewTask = null;
  }

  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / baseViewport.width, 2);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) { page.cleanup(); throw new Error("Could not create 2D context for preview"); }

  const task = page.render({ canvasContext: ctx, viewport, canvas } as any);
  activePreviewTask = task;

  try {
    await task.promise;
  } catch (err) {
    page.cleanup();
    throw err;
  } finally {
    if (activePreviewTask === task) activePreviewTask = null;
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  page.cleanup();

  if (previewCache.size >= PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(key, dataUrl);
  return dataUrl;
}

export function clearPreviewCache(): void {
  if (activePreviewTask) {
    try { activePreviewTask.cancel(); } catch { /* ignore */ }
    activePreviewTask = null;
  }
  previewCache.clear();
}
