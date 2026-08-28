import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server on 7421, API proxied to the backend on 7420.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 7421,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:7420', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
