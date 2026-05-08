import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react()
  ],
  base: process.env.VITE_BASE || './',
  server: {
    host: true
  },
  build: {
    target: 'esnext',
    minify: 'esbuild', // Faster and more stable in resource-constrained environments
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pdf-lib')) return 'pdf-lib-core';
          if (id.includes('node_modules/pdfjs-dist')) return 'pdfjs-viewer';
          if (id.includes('node_modules/tesseract.js')) return 'tesseract-core';
          if (id.includes('node_modules/@dnd-kit') || id.includes('node_modules/jszip')) return 'vendor-utils';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom') || id.includes('node_modules/lucide-react') || id.includes('node_modules/sonner')) return 'vendor-ui';
        }
      }
    }
  }
})
