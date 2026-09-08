import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Two build targets share one Vite project:
//   index.html            -> the authenticated TMS app
//   connector/index.html  -> the standalone tender-drop connector, which is meant to be
//                            openable on its own and posts extracted loads into the TMS.
// Both import from src/lib/tender-engine so the parsing/EDI logic exists once.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        connector: resolve(__dirname, 'connector/index.html'),
      },
    },
  },
})
