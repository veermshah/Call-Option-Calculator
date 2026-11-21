import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser build of the renderer, deployed to Vercel as a static site.
export default defineConfig({
  root: resolve('src/renderer'),
  base: '/',
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: { outDir: resolve('dist-web'), emptyOutDir: true, chunkSizeWarningLimit: 2000 }
})
