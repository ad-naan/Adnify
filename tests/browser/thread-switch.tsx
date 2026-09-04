import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useAssistantTurnView } from '../../src/renderer/components/agent/useAssistantTurnView'
import { publish, useAgentStore } from './motion-store'
import type { AssistantPart } from '../../src/renderer/agent/types'
import '../../src/renderer/styles/globals.css'

const parts: AssistantPart[] = [
  { type: 'reasoning', id: 'thought', content: 'Received reasoning. '.repeat(30), isStreaming: false },
  { type: 'tool_call', toolCall: { id: 'tool', name: 'browser_inspect', arguments: {}, status: 'success' } },
  { type: 'text', content: 'Already received answer.' },
]
const empty: AssistantPart[] = []
function Reply() {
  const thread = useAgentStore(state => state.threads.fixture)
  const source = thread.liveAssistantMessage?.parts ?? thread.messages[0]?.parts ?? empty
  const view = useAssistantTurnView({ parts: source, isTransportActive: !!thread.liveAssistantMessage, isAwaitingApproval: false, hasContextMeta: false })
  return <section>
    <output>Visible parts: {view.visibleParts.length}</output>
    {view.visibleParts.map((part, index) => <p key={index}>{part.type === 'text' || part.type === 'reasoning' ? part.content : part.type === 'tool_call' ? `${part.toolCall.name}: ${part.toolCall.status}` : part.type}</p>)}
  </section>
}
function Fixture() {
  const selected = useAgentStore(state => state.currentThreadId)
  const active = useAgentStore(state => selected === 'fixture' && !!state.threads.fixture.liveAssistantMessage)
  return <main style={{ maxWidth: 760, margin: '24px auto', lineHeight: 1.7 }}>
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
      <button onClick={() => publish(parts, true)}>Start live reply</button>
      <button onClick={() => useAgentStore.setState({ currentThreadId: 'other' })}>Switch away</button>
      <button onClick={() => useAgentStore.setState({ currentThreadId: 'fixture' })}>Return to reply</button>
      <button onClick={() => publish([...parts.slice(0, -1), { type: 'text', content: 'Already received answer. Final answer.' }], false)}>Finish reply</button>
    </nav>
    <p>Selected thread: {selected}</p>
    <p role="status">{active ? 'Reply in progress' : 'Idle'}</p>
    {selected === 'fixture' ? <Reply /> : <p>Other thread</p>}
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
