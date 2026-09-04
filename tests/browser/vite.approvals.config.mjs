import base from './vite.motion.config.mjs'
import path from 'node:path'
const mock = path.resolve('tests/browser/approval-store.ts')
export default {
  ...base,
  cacheDir: 'tmp/subtask-approvals/.vite',
  optimizeDeps: { entries: ['tests/browser/subtask-approvals.html'] },
  resolve: { alias: [
    ...['@store', '@renderer/agent/store/AgentStore', '@renderer/agent/core/Agent', '@renderer/hooks', '@/renderer/agent/store/slices/queueSlice', '@components/common/ToastProvider', './ToolCallGroup'].map(find => ({ find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: mock })),
    ...base.resolve.alias,
  ] },
  server: { host: '127.0.0.1', port: 5213, strictPort: true },
}
