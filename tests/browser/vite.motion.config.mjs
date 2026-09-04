import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['tests/browser/conversation-motion.html'] },
  resolve: { alias: [
    { find: '@renderer/agent/store/AgentStore', replacement: path.resolve('tests/browser/motion-store.ts') },
    { find: '@renderer', replacement: path.resolve('src/renderer') },
    { find: '@shared', replacement: path.resolve('src/shared') },
    { find: '@', replacement: path.resolve('src') },
  ] },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
})
