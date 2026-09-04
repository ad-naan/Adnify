import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Virtuoso } from 'react-virtuoso'
import { useAssistantTurnView } from '../../src/renderer/components/agent/useAssistantTurnView'
import SmoothCollapse from '../../src/renderer/components/agent/SmoothCollapse'
import ToolActivityIndicator from '../../src/renderer/components/agent/ToolActivityIndicator'
import { useChatScrollController } from '../../src/renderer/hooks/useChatScrollController'
import { useDisclosureState } from '../../src/renderer/hooks/useDisclosureState'
import { publish, useAgentStore } from './motion-store'
import type { AssistantPart } from '../../src/renderer/agent/types'
import '../../src/renderer/styles/globals.css'

const INITIAL_LOCATION = { index: 'LAST', align: 'end' } as const
const EMPTY: AssistantPart[] = []
const TEST_PROCESS_FOLD = new URLSearchParams(location.search).has('processFold')
function Tool({ part, open }: { part: Extract<AssistantPart, { type: 'tool_call' }>; open: boolean }) {
  const disclosure = useDisclosureState({ automaticOpen: open })
  return <div data-tool={part.toolCall.id}>
    <button onClick={disclosure.toggle} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 42 }}>
      <ToolActivityIndicator state={part.toolCall.status === 'success' ? 'success' : 'running'} />
      {TEST_PROCESS_FOLD ? part.toolCall.name : 'Read README.md'} <span style={{ color: '#16a34a' }}>45ms</span>
    </button>
    <SmoothCollapse open={disclosure.isOpen}>
      <div style={{ height: 540, background: '#edf0f4', padding: 20 }}>Tool result<br />A long result to exercise viewport anchoring.
        {part.toolCall.richContent?.map((item, index) => <div key={index} data-rich={item.type}>{item.text || item.type}</div>)}
      </div>
    </SmoothCollapse>
  </div>
}
function Reply() {
  const source = useAgentStore(state => state.threads.fixture)
  const parts = source.liveAssistantMessage?.parts ?? source.messages[0]?.parts ?? EMPTY
  const view = useAssistantTurnView({ parts, isTransportActive: !!source.liveAssistantMessage, isAwaitingApproval: false, hasContextMeta: false })
  if (!TEST_PROCESS_FOLD) return <div style={{ padding: '0 24px', minHeight: 60 }}><div style={{ height: 40 }}>Adnify</div>{view.visibleParts.map((part, index) => part.type === 'tool_call'
    ? <div key={index} className={part.type === 'tool_call' && view.presentingToolIds.includes(part.toolCall.id) ? 'tool-row-enter' : ''}><div className="tool-row-enter-clip"><Tool part={part} open={part.type === 'tool_call' && view.presentingToolIds.includes(part.toolCall.id)} /></div></div>
    : part.type === 'text' || part.type === 'reasoning' ? <div key={index} data-text={part.type} style={{ fontSize: 19, lineHeight: '32px', whiteSpace: 'pre-wrap' }}>{part.content}</div> : null)}</div>
  return <div style={{ padding: '0 24px', minHeight: 60 }}><div style={{ height: 40 }}>Adnify</div>
    {view.hasProcessContent && <button data-process aria-expanded={view.processExpanded} onClick={view.toggleProcess}>Process</button>}
    {view.visibleParts.map((part, index) => {
      const body = part.type === 'tool_call'
        ? <div className={part.type === 'tool_call' && view.presentingToolIds.includes(part.toolCall.id) ? 'tool-row-enter' : ''}><div className="tool-row-enter-clip"><Tool part={part} open={part.type === 'tool_call' && view.presentingToolIds.includes(part.toolCall.id)} /></div></div>
        : part.type === 'text' || part.type === 'reasoning' ? <div data-text={part.type} style={{ fontSize: 19, lineHeight: '32px', whiteSpace: 'pre-wrap' }}>{part.content}</div> : null
      return <SmoothCollapse key={index} open={view.processExpanded || !view.processParts.has(part)} animateInitial={false}>{body}</SmoothCollapse>
    })}
  </div>
}
function Fixture() {
  const { attachScrollerNode, handleTotalListHeightChanged, virtuosoRef } = useChatScrollController({ threadId: 'fixture', isHydratingActiveThread: false, isSwitchingThread: false, messageCount: 2 })
  const source = useAgentStore(state => state.threads.fixture)
  const active = !!source.liveAssistantMessage
  const frame = { phase: active ? 'active' : 'complete', openIndex: -1 }
  const awaiting = source.liveAssistantMessage?.parts.some(part => part.type === 'tool_call' && part.toolCall.status === 'awaiting')
  const frameRef = useRef(frame)
  frameRef.current = frame
  useEffect(() => {
    let raf = 0
    const samples: object[] = []
    const sample = () => {
      const scroller = document.querySelector('[data-virtuoso-scroller]') as HTMLElement | null
      const header = document.querySelector('[data-tool="first"] button')
      samples.push({ time: performance.now(), phase: frameRef.current?.phase, openIndex: frameRef.current?.openIndex,
        top: scroller?.scrollTop, scrollHeight: scroller?.scrollHeight, viewport: scroller?.clientHeight, headerY: header?.getBoundingClientRect().top,
        toolCount: document.querySelectorAll('[data-tool]').length,
        approval: !!document.querySelector('[data-approval]'),
        body: document.querySelector('[data-text="text"]')?.textContent,
      })
      if (samples.length > 5000) samples.shift()
      raf = requestAnimationFrame(sample)
    }
    ;(window as any).motionTest = { samples, publish }
    raf = requestAnimationFrame(sample)
    return () => { cancelAnimationFrame(raf); delete (window as any).motionTest }
  }, [])
  return <main style={{ width: 720, height: 800, margin: '20px auto', display: 'flex', flexDirection: 'column', background: '#f7f8fa', color: '#323840', border: '1px solid #ddd' }}>
    <Virtuoso ref={virtuosoRef} totalCount={2} initialTopMostItemIndex={INITIAL_LOCATION} followOutput={false} overscan={12}
      scrollerRef={attachScrollerNode as (node: HTMLElement | Window | null) => void}
      style={{ flex: 1, overflowAnchor: 'none' }} totalListHeightChanged={handleTotalListHeightChanged}
      itemContent={index => index === 0 ? <div style={{ height: 900, padding: 24 }}>Earlier conversation</div> : <Reply />} />
    <SmoothCollapse open={active}>
      <div style={{ padding: 14, borderTop: '1px solid #ddd' }}>
        {awaiting ? <button data-approval>Approve command</button> : 'Displaying reply…'}
      </div>
    </SmoothCollapse>
    <div style={{ padding: 26, height: 92, borderTop: '1px solid #ddd' }}>Message composer</div>
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
