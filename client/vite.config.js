import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Proxies /api to the Python server (server/app.py) in dev, so fetches stay
// same-origin from the browser's POV and the Authorization header the
// browser attaches after the Basic Auth prompt is forwarded straight through.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
