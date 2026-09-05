import base from './vite.motion.config.mjs'
import path from 'node:path'

const mock = path.resolve('tests/browser/window-focus-mocks.tsx')
const mockedImports = [
  '@/renderer/services/electronAPI', '@utils/Logger', '@/renderer/store',
  '@/renderer/hooks/useAgent', '@/renderer/hooks', '@/renderer/agent/store/AgentStore',
  '@/renderer/components/chat', '@/renderer/components/agent/MentionPopup',
  '@/renderer/agent/utils/MentionParser', './ChatMessage', './UnifiedStatusTray',
  '@/renderer/services/keybindingService', '@/renderer/services/slashCommandService',
  './SlashCommandPopup', '../chat/EmptyChatSuggestions', '../ui/Loading', '../ui',
  '../common/ConfirmDialog', '@/renderer/components/common/ToastProvider',
  './TaskCommandCenter', './ActiveTaskQuickSwitch', './BranchControls',
  '@/renderer/agent/services/composerService', '@/renderer/agent/store/slices/queueSlice',
  '@/renderer/hooks/useMessageQueue', '@/renderer/agent/services/shellServerRoutingService',
  '@/renderer/components/plan/workbench/PlanWorkbench', './ToolCallGroup',
  '@/renderer/agent/emotion/panelSettings',
]
export default {
  ...base,
  cacheDir: 'tmp/window-focus/.vite',
  optimizeDeps: { entries: ['tests/browser/window-focus.html'] },
  resolve: { alias: [
    ...mockedImports.map(find => ({ find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: mock })),
    ...base.resolve.alias,
  ] },
  server: { host: '127.0.0.1', port: 5214, strictPort: true },
}
