import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import DockWorkbench from '../../src/renderer/components/layout/DockWorkbench'
import { createWorkbenchLayout } from '../../src/renderer/components/layout/workbenchLayout'
import { EditorTabs } from '../../src/renderer/components/editor/EditorTabs'
import { PlanWorkbenchEmpty } from '../../src/renderer/components/plan/workbench/PlanWorkbenchEmpty'
import { PlanWorkbenchProcessing } from '../../src/renderer/components/plan/workbench/PlanWorkbenchProcessing'
import { TaskBoard } from '../../src/renderer/components/plan/TaskBoard'
import { OtterAsset } from '../../src/renderer/components/brand/OtterAsset'
import { useStore } from '../../src/renderer/store'
import { useAgentStore } from '../../src/renderer/agent/store/AgentStore'
import { PLAN_BOARD_PATH } from '../../src/shared/types/planBoard'
import '../../src/renderer/styles/globals.css'
import '../../src/renderer/components/plan/plan-workspace.css'

// Production docking, tab strip, file store and task board; only the editor and
// conversation input are local fixtures. No LLM calls or Electron file writes.
const appPath = 'E:/example/app.ts'
useStore.setState({ openFiles: [], activeFilePath: null, workspacePath: null, language: 'zh' })
useStore.getState().openFile(appPath, 'const session = await authenticate()')
useStore.getState().openFile('E:/example/README.md', '# Project')
useStore.getState().openFile(PLAN_BOARD_PATH, '')
useAgentStore.setState({ plans: [{ id: 'qa-plan', name: '统一登录与权限管理', status: 'executing', executionMode: 'parallel', createdAt: Date.now(), updatedAt: Date.now(), requirementsDoc: '', tasks: [
  { id: 'a', title: '梳理认证入口', description: '检查认证入口和会话边界，明确改动范围。', status: 'completed', dependencies: [], role: '架构分析', provider: 'anthropic', model: 'claude-sonnet', completedAt: Date.now() },
  { id: 'b', title: '实现会话管理', description: '统一登录、退出与过期处理。', status: 'running', dependencies: ['a'], role: '功能开发', provider: 'anthropic', model: 'claude-sonnet', startedAt: Date.now() },
  { id: 'c', title: '补齐权限回归测试', description: '覆盖过期会话、权限不足与跨页面跳转。', status: 'pending', dependencies: ['b'], role: '测试验证', provider: 'openai', model: 'gpt-5' },
] }], activePlanId: 'qa-plan' })

function Discussion({ canvas, processing, onOpen }: { canvas: boolean; processing: boolean; onOpen: () => void }) {
  const [draft, setDraft] = useState('保留这段需求草稿')
  return <div className={`plan-chat-surface flex min-h-0 flex-1 flex-col ${canvas ? 'plan-chat-canvas plan-chat-empty' : ''}`}>
    <header className="plan-chat-toolbar"><OtterAsset asset="plans" className="h-6 w-6" /><span>计划讨论</span><button className="ml-auto" onClick={onOpen}>查看计划</button></header>
    <div className="plan-chat-body flex min-h-0 flex-1 flex-col">
      <div className="plan-chat-messages min-h-0 flex-1 overflow-auto"><div className="plan-surface p-5">
        {processing ? <PlanWorkbenchProcessing planningState="ready_to_create" stage="requirements" language="zh" elapsedSeconds={72} activities={[]} /> : <PlanWorkbenchEmpty language="zh" recent={[]} onOpenHistory={() => {}} onSelectHistory={() => {}} />}
      </div></div>
      <div className="plan-chat-composer"><textarea className="process-fluid-input w-full resize-none p-4 text-sm" aria-label="讨论草稿" value={draft} onChange={event => setDraft(event.target.value)} /></div>
    </div>
  </div>
}

function Fixture() {
  const active = useStore(state => state.activeFilePath)
  const files = useStore(state => state.openFiles)
  const [layout, setLayout] = useState(createWorkbenchLayout())
  const [screen, setScreen] = useState('initial')
  const [light, setLight] = useState(true)
  const board = active === PLAN_BOARD_PATH
  const canvas = board && screen !== 'execution'
  const file = files.find(item => item.path === active)
  const openBoard = () => useStore.getState().openFile(PLAN_BOARD_PATH, '')
  return <div className={`qa-navigation ${light ? 'qa-light' : ''}`}>
    <style>{`
      .qa-navigation { height:100vh; display:flex; flex-direction:column; color:rgb(var(--text-primary)); }
      .qa-light { --background:255 255 255; --background-secondary:246 247 249; --surface:242 243 246; --surface-hover:233 235 240; --border:216 221 230; --text-primary:30 35 45; --text-secondary:78 86 103; --text-muted:111 120 137; --accent:103 76 205; color-scheme:light; }
      .qa-controls { display:flex; align-items:center; gap:20px; min-height:44px; padding:0 16px; background:rgb(var(--background-secondary)); font-size:12px; }
      .qa-controls button[aria-pressed=true] { color:rgb(var(--accent)); }
    `}</style>
    <nav className="qa-controls">
      <a href="./plan-design.html">界面预览</a>
      {['initial', 'processing', 'execution'].map(item => <button key={item} aria-pressed={screen === item} onClick={() => { setScreen(item); openBoard() }}>{item}</button>)}
      <button onClick={openBoard}>重新打开看板</button><button onClick={() => setLight(!light)}>主题</button>
    </nav>
    <DockWorkbench layout={layout} visible={canvas ? ['editor'] : ['editor', 'agent']} focused={null} language="zh" editorOverlay={canvas ? 'agent' : undefined} terminalVisible={false} onLayoutChange={setLayout} panels={{
      sidebar: null,
      editor: <>
        <EditorTabs activeFilePath={active} onSelectFile={path => useStore.getState().setActiveFile(path)} onCloseFile={path => useStore.getState().closeFile(path)} onContextMenu={() => {}} lintErrorCount={0} lintWarningCount={0} isLinting={false} onRunLint={() => {}} />
        <div className="plan-surface flex min-h-0 flex-1 flex-col" style={canvas ? { visibility: 'hidden' } : undefined} aria-hidden={canvas || undefined}>
          {board ? <TaskBoard planId="qa-plan" /> : file ? <textarea className="flex-1 resize-none bg-background p-8 font-mono text-sm text-text-primary outline-none" aria-label="文件内容" value={file.content} onChange={event => { useStore.getState().updateFileContent(file.path, event.target.value); useStore.getState().updateFileDirtyState(file.path, 2) }} /> : <p className="p-8">选择文件或重新打开计划看板</p>}
        </div>
      </>,
      agent: <Discussion canvas={canvas} processing={screen === 'processing'} onOpen={openBoard} />,
    }} />
    <output className="qa-controls">{files.length} 个标签 · {files.filter(item => item.isDirty).length} 个未保存文件 · 当前 {active}</output>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
