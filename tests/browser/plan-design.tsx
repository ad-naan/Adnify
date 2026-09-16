import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, CodeXml, GitBranch, History, Plus, Search } from 'lucide-react'
import { PlanWorkbenchEmpty } from '../../src/renderer/components/plan/workbench/PlanWorkbenchEmpty'
import { PlanWorkbenchRuntime } from '../../src/renderer/components/plan/workbench/PlanWorkbenchRuntime'
import { PlanWorkbenchProcessing } from '../../src/renderer/components/plan/workbench/PlanWorkbenchProcessing'
import { PlanWorkbenchQuestion } from '../../src/renderer/components/plan/workbench/PlanWorkbenchQuestion'
import { PlanTaskList } from '../../src/renderer/components/plan/PlanTaskList'
import { PlanStageTrace } from '../../src/renderer/components/plan/PlanStageTrace'
import { PlanDependencyGraph } from '../../src/renderer/components/plan/PlanDependencyGraph'
import { OtterAsset } from '../../src/renderer/components/brand/OtterAsset'
import ChatMessage from '../../src/renderer/components/agent/ChatMessage'
import { useStore } from '../../src/renderer/store'
import type { PlanTask } from '../../src/renderer/agent/plan/types'
import type { PlanTaskRuntimeItem, PlanWorkbenchStage } from '../../src/renderer/agent/plan/planWorkbenchProjection'
import { t, type Language } from '../../src/shared/i18n'
import '../../src/renderer/styles/globals.css'
import '../../src/renderer/components/plan/plan-workspace.css'

const tasks: PlanTask[] = [
  { id: 'research', title: '梳理登录流程与现有权限', description: '检查认证入口、会话管理和路由守卫，确认改动范围与兼容边界。', status: 'completed', dependencies: [], role: '架构分析', provider: 'anthropic', model: 'claude-sonnet', startedAt: Date.now() - 90000, completedAt: Date.now() - 30000 },
  { id: 'implement', title: '实现统一的登录与会话管理', description: '整合登录入口，为会话续期和退出登录添加一致的处理逻辑。', status: 'running', dependencies: ['research'], role: '功能开发', provider: 'anthropic', model: 'claude-sonnet', startedAt: Date.now() - 30000 },
  { id: 'verify', title: '补齐权限边界与回归测试', description: '覆盖会话过期、权限不足和跨页面跳转，验证现有功能不受影响。', status: 'pending', dependencies: ['implement'], role: '测试验证', provider: 'openai', model: 'gpt-5' },
]
const initialItems: PlanTaskRuntimeItem[] = tasks.map(task => ({ task, waitingApproval: task.id === 'implement', currentToolName: task.id === 'implement' ? 'run_command' : undefined, currentToolArguments: task.id === 'implement' ? { command: 'pnpm test:auth' } : undefined, requestId: task.id, subAgents: [] }))

function Preview() {
  const [view, setView] = useState('empty')
  const [light, setLight] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [language, setLanguage] = useState<Language>('zh')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [items, setItems] = useState(initialItems)
  const [result, setResult] = useState('')
  const stage: PlanWorkbenchStage = view === 'execution' ? 'execution' : ['review', 'workflow'].includes(view) ? 'plan' : 'requirements'
  return <>
    <style>{`
      body { background:rgb(var(--background-secondary)); }
      .qa-controls { height:48px; display:flex; gap:16px; align-items:center; padding:0 20px; font-size:12px; color:rgb(var(--text-secondary)); }
      .qa-controls button[aria-pressed=true] { color:rgb(var(--accent)); }
      .qa-panel { position:absolute; inset:64px 8% 24px; border:1px solid rgb(var(--border)); border-radius:16px; overflow:hidden; }
      .qa-panel.narrow { left:auto; right:24px; width:360px; }
      .qa-composer { padding:18px; } .qa-composer textarea { width:100%; min-height:76px; resize:none; background:transparent; font-size:14px; outline:none; }
      .qa-composer footer { display:flex; align-items:center; justify-content:space-between; font-size:12px; color:rgb(var(--text-muted)); }
      .qa-light { --background:255 255 255; --background-secondary:246 247 249; --surface:242 243 246; --surface-hover:233 235 240; --border:216 221 230; --text-primary:30 35 45; --text-secondary:78 86 103; --text-muted:111 120 137; --accent:103 76 205; color-scheme:light; }
    `}</style>
    <div className="qa-controls">
      {['empty', 'processing', 'question', 'discussion', 'workflow', 'review', 'execution'].map(value => <button key={value} aria-pressed={view === value} onClick={() => { useStore.setState({ language }); setView(value) }}>{value}</button>)}
      <a href="./plan-navigation.html">文件与看板</a>
      <button onClick={() => setLight(!light)}>主题</button><button onClick={() => setNarrow(!narrow)}>侧栏</button><button onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>EN / 中文</button>
    </div>
    <main className={`qa-panel plan-chat-surface plan-chat-canvas ${view === 'empty' ? 'plan-chat-empty' : ''} ${light ? 'qa-light' : ''} ${narrow ? 'narrow' : ''} flex flex-col`}>
      <header className="plan-chat-toolbar"><OtterAsset asset="plans" className="mr-1 h-6 w-6 object-contain" /><button aria-pressed>计划工作台</button><button disabled={view === 'empty'}>计划讨论</button><button className="ml-auto" aria-label="历史"><History size={15} /></button><button aria-label="新建"><Plus size={15} /></button></header>
      <div className="plan-chat-body flex flex-1 min-h-0 flex-col">
        <div className="plan-chat-messages min-h-0 flex-1 overflow-auto">
          <div className="plan-surface">
            {view === 'empty' ? <PlanWorkbenchEmpty language={language} recent={[]} onOpenHistory={() => setResult('history')} onSelectHistory={() => {}} /> : <>
              <header className="plan-workbench-heading"><h1 className="text-xl font-semibold mb-4">统一登录与权限管理</h1><PlanStageTrace stage={stage} language={language} onStageChange={next => setView(next === 'plan' ? 'review' : next === 'execution' ? 'execution' : 'question')} /></header>
              {view === 'review' ? <PlanTaskList tasks={tasks} language={language} expandedTaskId={expanded} onExpand={setExpanded} onConfigure={task => setResult(task.id)} onDiscuss={task => setResult(task.id)} canDiscuss /> : <div className="plan-workbench-body">
                {view === 'processing' && <PlanWorkbenchProcessing planningState="ready_to_create" stage="requirements" language={language} elapsedSeconds={12} activities={[{ id:'a', title:'已完成项目结构分析', detail:'识别认证模块、路由入口与测试配置。', stage:'requirements', status:'completed', timestamp:Date.now(), source:'ai' }, { id:'b', title:'正在拆分任务与依赖', detail:'为每个任务整理实现范围和验收条件。', stage:'requirements', status:'active', timestamp:Date.now(), source:'ai' }]} />}
                {view === 'question' && <PlanWorkbenchQuestion language={language} content={{ type:'interactive', question:'这次需要覆盖哪些登录方式？', options:[{ id:'email',label:'邮箱与密码',description:'复用现有账号体系，完善会话和权限校验。' },{ id:'oauth',label:'增加第三方登录',description:'支持 GitHub 等第三方身份提供商。' }], multiSelect:true }} onSubmit={ids => setResult(ids.join(','))} />}
                {view === 'execution' && <PlanWorkbenchRuntime items={items} completed={1} language={language} onOpenThread={setResult} onApprove={id => { setItems(previous => previous.map(item => item.requestId === id ? { ...item, waitingApproval:false } : item)); setResult('approved') }} onReject={() => setResult('rejected')} />}
                {view === 'workflow' && <div className="flex h-[540px] overflow-hidden rounded-xl border border-border"><PlanDependencyGraph tasks={tasks} selectedTaskId={expanded} language={language} onSelectTask={id => { setExpanded(id); setResult(id) }} /></div>}
                {view === 'discussion' && <ChatMessage presentation="plan" message={{ id:'qa-discussion', role:'assistant', content:'已确认采用协议无关的核心，接下来整理事件接口和任务依赖。', timestamp:Date.now(), parts:[{ id:'qa-reasoning', type:'reasoning', content:'核对已确认的范围：无头运行时、组件覆盖、工程化分发与文档。\n接下来检查现有接口并整理任务之间的依赖。', isStreaming:false }, { type:'text',content:'已确认采用协议无关的核心，接下来整理事件接口和任务依赖。' }] }} />}
              </div>}
            </>}
          </div>
        </div>
        <div className="plan-chat-composer">
          <div className="process-fluid-input qa-composer"><textarea aria-label="目标" placeholder={t('planDesign.goalPlaceholder', language)} value={draft} onChange={event => setDraft(event.target.value)} /><footer><span>claude-sonnet · Plan</span><button className="bg-accent text-white rounded-lg p-2" onClick={() => setView('processing')} aria-label="发送"><ArrowUp size={15} /></button></footer></div>
          {view === 'empty' && <div className="plan-chat-examples">{([['planDesign.newFeature', CodeXml], ['planDesign.refactor', GitBranch], ['planDesign.fix', Search]] as const).map(([key, Icon]) => <button key={key} onClick={() => setDraft(t(key, language))}><Icon size={14} />{t(key, language)}</button>)}</div>}
        </div>
      </div>
    </main>
    <output style={{ position:'fixed', bottom:0, fontSize:11 }}>{result}</output>
  </>
}
createRoot(document.getElementById('root')!).render(<Preview />)
