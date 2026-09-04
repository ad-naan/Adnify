import { StrictMode, forwardRef, useCallback, useMemo, useState, type ComponentPropsWithoutRef } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatVirtualList } from '../../src/renderer/components/agent/ChatVirtualList'
import { useChatScrollController } from '../../src/renderer/hooks/useChatScrollController'
import '../../src/renderer/styles/globals.css'

function Fixture() {
  const [messages, setMessages] = useState<string[]>([])
  const [threadId, setThreadId] = useState('first')
  const controller = useChatScrollController({ threadId, messageCount: messages.length, isHydratingActiveThread: false, isSwitchingThread: false })
  const { attachScrollerNode } = controller
  const components = useMemo(() => ({
    Scroller: forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>((props, ref) => {
      const setNode = useCallback((node: HTMLDivElement | null) => {
        attachScrollerNode(node)
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }, [ref])
      return <div {...props} ref={setNode} />
    }),
    EmptyPlaceholder: () => <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>Start a conversation</div>,
  }), [attachScrollerNode])
  return <main style={{ width: 480, margin: '20px auto' }}>
    <button onClick={() => {
      setMessages(['Look at this project', 'Context: searching for related files'])
      requestAnimationFrame(() => controller.scrollToBottom('auto'))
    }}>Send first message</button>
    <button onClick={() => { setThreadId('history'); setMessages(Array.from({ length: 30 }, (_, index) => `History ${index}`)) }}>Open history</button>
    <button onClick={() => { setThreadId('next'); setMessages([]) }}>New conversation</button>
    <div style={{ height: 600, marginTop: 16, display: 'flex', flexDirection: 'column', border: '1px solid #555' }}>
      {messages.length === 0 ? <div className="flex-1 min-h-0 overflow-hidden"><components.EmptyPlaceholder /></div> :
      <ChatVirtualList key={threadId} data={messages} followOutput={false}
        totalListHeightChanged={controller.handleTotalListHeightChanged} components={components}
        style={{ flex: 1, minHeight: 100, overflowAnchor: 'none' }}
        itemContent={(index, message) => <div data-message={index} style={{ padding: 16, height: index ? 100 : 72 }}>{message}</div>}
      />}
    </div>
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
