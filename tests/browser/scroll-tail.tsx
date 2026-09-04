import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Virtuoso } from 'react-virtuoso'
import SmoothCollapse from '../../src/renderer/components/agent/SmoothCollapse'
import { useChatScrollController } from '../../src/renderer/hooks/useChatScrollController'
import { useDisclosureState } from '../../src/renderer/hooks/useDisclosureState'
import '../../src/renderer/styles/globals.css'

const INITIAL = { index: 'LAST', align: 'end' } as const
const short = new URLSearchParams(location.search).has('short')
const dock = new URLSearchParams(location.search).has('dock')
function Fixture() {
  const [open, setOpen] = useState(true)
  const disclosure = useDisclosureState({ automaticOpen: open })
  const controller = useChatScrollController({ threadId: 'tail', messageCount: 2, isHydratingActiveThread: false, isSwitchingThread: false })
  const [status, setStatus] = useState('Ready')
  const reportTimer = useRef<ReturnType<typeof setTimeout>>()
  const samples = useRef<{ top: number; gap: number; tail: number }[]>([])
  const sampleFrame = useRef(0)
  useEffect(() => () => clearTimeout(reportTimer.current), [])
  useEffect(() => () => cancelAnimationFrame(sampleFrame.current), [])
  const report = () => {
    const scroller = document.querySelector('[data-virtuoso-scroller]') as HTMLElement
    const tail = scroller.querySelector('[data-chat-scroll-tail]') as HTMLElement | null
    const recorded = samples.current
    setStatus(JSON.stringify({ top: scroller.scrollTop, tail: tail?.style.height ?? '0px', tailVisible: tail?.style.display ?? 'none', scrollHeight: scroller.scrollHeight, viewport: scroller.clientHeight,
      maxGap: Math.max(0, ...recorded.map(item => item.gap)), maxTail: Math.max(0, ...recorded.map(item => item.tail)), frames: recorded.length,
    }))
  }
  return <main style={{ width: 680, margin: '20px auto' }}>
    <nav style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
      <button onClick={() => {
        cancelAnimationFrame(sampleFrame.current)
        samples.current = []
        const started = performance.now()
        const sample = () => {
          const scroller = document.querySelector('[data-virtuoso-scroller]') as HTMLElement
          const final = document.querySelector('[data-final]') as HTMLElement | null
          const tail = document.querySelector('[data-chat-scroll-tail]') as HTMLElement | null
          samples.current.push({ top: scroller.scrollTop, gap: final ? scroller.getBoundingClientRect().bottom - final.getBoundingClientRect().bottom : scroller.clientHeight, tail: parseFloat(tail?.style.height || '0') })
          if (performance.now() - started < 1100) sampleFrame.current = requestAnimationFrame(sample)
        }
        sampleFrame.current = requestAnimationFrame(sample)
        setOpen(false)
        clearTimeout(reportTimer.current)
        reportTimer.current = setTimeout(report, 1400)
      }}>Finish with a short reply</button>
      <button onClick={report}>Inspect geometry</button>
    </nav>
    <output>{status}</output>
    <div style={{ height: 520, marginTop: 16, display: 'flex', flexDirection: 'column', border: '1px solid #555' }}>
      <Virtuoso
        totalCount={2} initialTopMostItemIndex={INITIAL} followOutput={false}
        scrollerRef={controller.attachScrollerNode as (node: HTMLElement | Window | null) => void}
        totalListHeightChanged={controller.handleTotalListHeightChanged}
        style={{ flex: 1, overflowAnchor: 'none' }}
        itemContent={index => index === 0 ? <div style={{ height: short ? 40 : 900 }}>Earlier conversation</div> : <div>
          <button data-tool-header onClick={disclosure.toggle}>Toggle tool result</button>
          <SmoothCollapse open={disclosure.isOpen}>
            <div style={{ height: short ? 60 : 1600 }}>Tool result</div>
          </SmoothCollapse>
          <div data-final style={{ padding: 16 }}>Done.</div>
        </div>}
      />
      {dock && <SmoothCollapse open={open} animateInitial={false}><div style={{ height: 100 }}>Active dock</div></SmoothCollapse>}
    </div>
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
