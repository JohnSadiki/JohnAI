import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Phone hits JohnAI on the PC LAN IP; Hermes stays on localhost.
      '/hermes': {
        target: 'http://127.0.0.1:8642',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hermes/, ''),
      },
    },
  },
})