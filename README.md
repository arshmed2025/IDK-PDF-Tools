<p align="center">
  <img src="public/icons/logo-github.svg" width="120" alt="IDK PDF Tools Logo">
</p>

# IDK PDF Tools

**A simple, honest PDF utility that respects your privacy.**

[![License](https://img.shields.io/badge/license-AGPL--3.0-0EA5E9.svg)](LICENSE)

---

### Why it exists

Most PDF websites ask you to upload your sensitive documents—bank statements, IDs, contracts—to their servers. Even if they promise to delete them, your data still leaves your device and travels across the internet.

**IDK PDF Tools** runs entirely in your browser. Your files are processed in memory, never stored in a database, and no server ever sees them.

### What it can do

*   **Modify:** Merge multiple files, split pages, rotate, and rearrange.
*   **Optimize:** Reduce file size with quality presets, convert to grayscale, repair damaged files.
*   **Secure:** Encrypt files with passwords or remove them locally; deep-clean metadata (Author, Producer) to keep files anonymous.
*   **Annotate:** Add watermarks, page numbers, and electronic signatures.
*   **Convert:** Office (Word/Excel/PowerPoint) → PDF, PDF ↔ images, and PDF → plain text (with OCR for scanned pages).

### My Tools

Three tools that aren't part of the upstream toolkit:

| Tool | | What it is |
|---|---|---|
| **Extract Images** | ⭐ | Pulls every original embedded image out of a PDF, page by page. Upstream shipped a tool of the same name; **this is a ground-up rewrite** using our own extractor (handles all PDF image kinds, page previews, cancellation, and a full-page fallback). |
| **Study Sheet Builder** | ⭐ | Arrange a folder of images, add section dividers, and generate a printable Word study sheet for any subject. Written from scratch. |
| **Office to PDF** | | Converts `.docx` / `.xlsx` / `.pptx` to PDF fully client-side. Written from scratch. |

⭐ = marked **Developer's Choice** in the app.

**Office to PDF has two modes:**
*   **Editable Text** — renders the document and hands it to the browser's print engine; you choose *"Save as PDF"* and get a real, selectable-text PDF.
*   **Exact Snapshot** — one click, downloads automatically, but pages are images (no text layer).

Fidelity is high for Word and good for Excel. **PowerPoint is best-effort**: text and images are placed by their real coordinates, but charts, shapes and animations are not rendered.

### Credits & Attribution

The **core PDF toolkit** — Merge, Split, Compress, Protect, Unlock, Rotate, Rearrange, Watermark, Page Numbers, Metadata, Signature, Grayscale, Repair, PDF ↔ Image, and PDF to Text — is **adapted from the open-source project [PaperKnife](https://github.com/potatameister/PaperKnife) by potatameister**, used under the **GNU AGPL v3** license.

The three tools listed under **My Tools** above were added here. Everything else, including the app shell and PDF engine wiring, comes from upstream.

### Development

```bash
npm install      # install dependencies
npm run dev      # start the dev server
npm run build    # production build to dist/
npm run preview  # preview the production build
npm run lint     # eslint
```

`npm run build` automatically runs a **`prebuild`** step (`scripts/prepare-ocr.mjs`) that assembles the OCR assets used by *PDF to Text*:

*   Copies the version-matched Tesseract worker + WASM cores out of `node_modules`.
*   Downloads `eng.traineddata.gz` **once** (~11 MB) and caches it.

Those files land in `public/tesseract/` and are **gitignored** — they're regenerated on every build, so a fresh clone needs network access for the first build. After that, OCR runs entirely offline in the browser.

### Deployment

The build output in `dist/` is a fully static site — host it anywhere.

For **Cloudflare Pages**:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |

Vite's `base` defaults to `./` (relative), so the site also works from a subdirectory. To deploy under a sub-path (e.g. GitHub Pages project sites), set `VITE_BASE=/your-repo-name/` at build time.

### Under the hood

Built with **React**, **TypeScript** and **Vite**.

| Concern | Library |
|---|---|
| PDF creation & editing | `pdf-lib` |
| PDF rendering & parsing | `pdfjs-dist` |
| OCR (scanned PDFs) | `tesseract.js` (WebAssembly) |
| Word generation | `docx` |
| Word rendering (Office→PDF) | `docx-preview` |
| Spreadsheets | `xlsx` |
| DOM rasterization | `html2canvas` |
| Zip / OOXML unpacking | `jszip` |
| Drag & drop | `@dnd-kit` |

Every conversion runs in the browser — there is no backend.

Licensed under the **GNU AGPL v3**.
