import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import UnifiedStatusTray from '../../src/renderer/components/agent/UnifiedStatusTray'
import { useAgentStore } from './approval-store'
import '../../src/renderer/styles/globals.css'

function Fixture() {
  const state = useAgentStore()
  return <main className="bg-background text-text-primary" style={{ width: 480, margin: '30px auto', padding: 16 }}>
    <p>当前线程：{state.currentThreadId}</p>
    <div style={{ height: 160 }}>子任务工具条已收起</div>
    <UnifiedStatusTray pendingChanges={[]} todos={[]} isStreaming={true} isAwaitingApproval={false} />
    <textarea aria-label="消息输入框" placeholder="输入消息" className="bg-surface rounded-xl p-3" style={{ width: '100%', minHeight: 80 }} />
    <output>{state.decisions.join('\n')}</output>
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
