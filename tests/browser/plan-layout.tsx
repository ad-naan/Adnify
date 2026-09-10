import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlanHistoryDrawer } from '../../src/renderer/components/plan/workbench/PlanHistoryDrawer'
import { PlanWorkbenchQuestion } from '../../src/renderer/components/plan/workbench/PlanWorkbenchQuestion'
import type { PlanHistoryEntry } from '../../src/renderer/agent/plan/planHistoryProjection'
import '../../src/renderer/styles/globals.css'
import '../../src/renderer/components/plan/plan-workspace.css'

// Real components inside the short, overflowing empty-state container that
// exposed the bug. The drawer must use the full panel's separate portal host.
function Fixture() {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [split, setSplit] = useState(false)
  const [entries, setEntries] = useState<PlanHistoryEntry[]>([])
  const [draft, setDraft] = useState('保留这段需求和上下文')
  const [result, setResult] = useState('')
  const [question, setQuestion] = useState(false)
  return <>
    <style>{`:root { --background:255 255 255; --surface:241 243 245; --surface-hover:233 236 239; --text-primary:33 37 41; --text-secondary:73 80 87; --text-muted:134 142 150; --accent:37 99 235; color-scheme:light; }
      body { background:#f8f9fa; } #fixture { position:fixed; top:48px; bottom:32px; right:0; left:min(404px, 20vw); }
      #fixture.split { left:73%; } .fixture-toolbar { height:42px; display:flex; gap:16px; align-items:center; padding:0 20px; }
      .fixture-body { flex:1; min-height:0; display:flex; flex-direction:column; }
      .fixture-messages { position:relative; height:270px; } .fixture-composer textarea { width:100%; height:110px; padding:16px; }
      #result { position:fixed; left:8px; bottom:8px; }`}</style>
    <main id="fixture" className={`plan-chat-surface plan-chat-canvas plan-chat-empty ${split ? 'split' : ''}`} style={{ display:'flex', flexDirection:'column' }}>
      <div className="fixture-toolbar">
        <button onClick={() => setOpen(true)}>打开历史</button>
        <button onClick={() => setEntries(Array.from({ length:80 }, (_,i) => ({ id:String(i), title:`计划 ${i}`, updatedAt:Date.now()-i*1000, status:'draft' })))}>填充记录</button>
        <button onClick={() => setSplit(!split)}>切换布局</button>
        <button onClick={() => setQuestion(!question)}>需求澄清</button>
      </div>
      <div className="fixture-body plan-chat-body">
        <div className="fixture-messages plan-chat-messages">
          <div className="plan-surface" style={{ height:'100%', position:'relative' }}>
            {question ? <PlanWorkbenchQuestion language="zh" content={{ type:'interactive', question:'本次修改范围？', options:[{ id:'ui',label:'仅修改界面' },{ id:'custom',label:'其他' }], multiSelect:true }} onSubmit={(ids,text) => setResult(JSON.stringify({ids,text}))} /> : <div className="plan-empty-content"><h2>从一个目标开始</h2><p>描述需求，再一起完善计划。</p></div>}
            <PlanHistoryDrawer open={open} portalTarget={host} language="zh" entries={entries} onClose={() => setOpen(false)} onSelect={entry => setResult(`selected:${entry.id}`)} onDelete={entry => { setEntries(previous => previous.filter(item => item.id!==entry.id)); setResult(`deleted:${entry.id}`) }} onCreateNew={() => { setDraft(''); setResult('created') }} />
          </div>
        </div>
        <div className="fixture-composer plan-chat-composer"><textarea aria-label="需求草稿" value={draft} onChange={event => setDraft(event.target.value)} /></div>
      </div>
      <div ref={setHost} data-plan-overlay-host className="pointer-events-none absolute inset-0 z-40" />
    </main>
    <output id="result">{result}</output>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
