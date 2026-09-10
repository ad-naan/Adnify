import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  cacheDir: '.tmp/plan-layout-qa/.vite',
  plugins: [react()],
  optimizeDeps: { entries: ['tests/browser/plan-layout.html'] },
  resolve: { alias: {
    '@': path.resolve('src'), '@shared': path.resolve('src/shared'),
    '@utils': path.resolve('src/renderer/utils'),
  } },
  server: { host: '127.0.0.1', port: 5206, strictPort: true },
})
