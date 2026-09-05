import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ChatPanel from '../../src/renderer/components/agent/ChatPanel'
import { useDecorativeAnimations } from '../../src/renderer/hooks/useDecorativeAnimations'
import { useAgentViewState } from './window-focus-mocks'
import '../../src/renderer/styles/globals.css'

function Fixture() {
  const animations = useDecorativeAnimations()
  return <>
    <output data-animations={String(animations)}>Animations: {String(animations)}</output>
    <button onClick={() => useAgentViewState.setState(state => ({
      messageListVersion: state.messageListVersion + 1,
      messages: state.messages.map((message, index) => index === state.messages.length - 1
        ? { ...message, content: 'New reply'.repeat(80 * (state.messageListVersion + 1)) }
        : message),
    }))}>Grow reply</button>
    <div style={{ position: 'relative', width: 640, height: 650, margin: '20px auto' }}><ChatPanel /></div>
  </>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
