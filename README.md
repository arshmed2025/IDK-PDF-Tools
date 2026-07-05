<p align="center">
  <img src="public/icons/logo-github.svg" width="120" alt="IDK PDF Tools Logo">
</p>

# IDK PDF Tools

**A simple, honest PDF utility that respects your privacy.**

[![License](https://img.shields.io/badge/license-AGPL--3.0-0EA5E9.svg)](LICENSE)

---

### Why it exists

Most PDF websites ask you to upload your sensitive documents—bank statements, IDs, contracts—to their servers. Even if they promise to delete them, your data still leaves your device and travels across the internet.

**IDK PDF Tools** runs entirely in your browser. Your files never leave your memory, they aren't stored in any database, and no server ever sees them. It works 100% offline.

### What it can do

*   **Modify:** Merge multiple files, split pages, rotate, and rearrange.
*   **Optimize:** Reduce file size with different quality presets.
*   **Secure:** Encrypt files with passwords or remove them locally.
*   **Convert:** Convert between PDF and images (JPG/PNG) or plain text.
*   **Sign:** Add an electronic signature to your documents safely.
*   **Sanitize:** Deep clean metadata (like Author or Producer) to keep your files anonymous.
*   **My Tools:** Study Sheet Builder — turn a folder of images into a printable Word study sheet for any subject.

### Development

```bash
npm install      # install dependencies
npm run dev      # start the dev server
npm run build    # production build to dist/
npm run preview  # preview the production build
```

The production build in `dist/` is a fully static site — deploy it to any static host (e.g. Cloudflare Pages).

### Under the hood

Built with **React** and **TypeScript**. Core processing is handled by **pdf-lib** and **pdfjs-dist**, running in a sandboxed environment using WebAssembly.

Licensed under the **GNU AGPL v3**.
