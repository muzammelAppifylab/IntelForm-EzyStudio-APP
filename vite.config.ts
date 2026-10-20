import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const apiPort = process.env.API_PORT ?? '8787'
// `npm run build` runs Vite twice: the dashboard app, then (BUILD_TARGET=form) the respondent
// page on its own, so it shares no chunks with the dashboard and stays inside its size budget.
const formBuild = process.env.BUILD_TARGET === 'form'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // Dashboard: index.html. Respondent (/f/*): form.html, with no router, query client,
    // builder or charts, to meet the 1.5 s public-form budget.
    rollupOptions: { input: formBuild ? { form: 'form.html' } : { main: 'index.html' } },
    // The second (form) build adds to dist/ instead of wiping the dashboard build.
    emptyOutDir: !formBuild,
  },
  server: {
    // The API runs as its own process in dev (npm run dev:api); the browser only talks to Vite.
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
})
