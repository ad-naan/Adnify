import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DecorativeAnimationScope } from '../../src/renderer/components/common/DecorativeAnimationScope'
import { Modal } from '../../src/renderer/components/ui/Modal'
import ToolActivityIndicator from '../../src/renderer/components/agent/ToolActivityIndicator'
import { useDecorativeAnimations } from '../../src/renderer/hooks/useDecorativeAnimations'
import { setDecorativeMotion } from './decorative-motion-settings'
import { builtinThemes, themeManager } from '../../src/renderer/config/themeConfig'

const legacy = new URLSearchParams(location.search).has('legacy')
const surface = legacy ? 'bg-surface/40 backdrop-blur-md' : 'chat-layered-surface'
themeManager.applyTheme(builtinThemes[0])

function Conversation() {
  const motion = useDecorativeAnimations()
  const [steps, setSteps] = useState(3)
  return <section className="flex flex-col gap-5 p-7">
    <header className="flex items-center justify-between border-b border-border/60 pb-5">
      <div><div className="text-sm font-semibold">Adnify</div><div className="mt-1 text-xs text-text-muted">Agent workspace</div></div>
      <span className="rounded-full bg-accent/10 px-3 py-1 text-[11px] text-accent">Frontend</span>
    </header>
    <div className={`${surface} ml-12 rounded-2xl rounded-tr-sm border border-border/60 px-4 py-3 text-sm`}>
      优化界面性能，同时保留柔和、精致的视觉效果。
    </div>
    <div className="text-sm leading-7 text-text-secondary">
      我会先检查运行状态和输入框的动效，再验证绘制频率。
      <div className="process-fluid-pill mt-3 w-fit"><span>已读取 4 个文件 · 正在处理</span></div>
    </div>
    <div className="flex items-center gap-3 rounded-lg border border-border/50 p-3 text-xs">
      <ToolActivityIndicator state="running" /><span className="tool-text-shimmer">正在优化运行状态提示…</span>
      <span className="ml-auto font-mono text-text-muted">globals.css</span>
    </div>
    <div className={`${surface} rounded-xl border border-border/50 px-4 py-3`}>
      <div className="flex items-center gap-2 text-[11px]"><span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /><span className="font-medium tool-text-shimmer">Processing...</span><span className="ml-auto text-text-muted">{steps} files changed</span></div>
      <div className="mt-3 h-px bg-border/60" />
      <div className="mt-3 text-xs text-text-secondary">保持视觉层次，让界面更从容。</div>
    </div>
    <div className={`process-fluid-input process-fluid-input--streaming rounded-xl ${motion ? 'process-fluid-input--animated' : ''} ${legacy ? 'backdrop-blur-md' : ''}`}>
      <textarea aria-label="Message draft" defaultValue="保留渐变和轻柔呼吸" className="h-20 w-full resize-none bg-transparent px-4 pt-4 text-sm outline-none" />
      <div className="flex items-center justify-between px-4 pb-3 text-xs text-text-muted"><span>Agent · Auto</span><button data-task-step onClick={() => setSteps(value => value + 1)} className="rounded-lg bg-accent/15 px-3 py-1.5 text-accent">继续任务</button></div>
    </div>
    <output className="sr-only" data-hook-motion={motion}>{steps}</output>
  </section>
}

function Fixture() {
  const [modal, setModal] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [light, setLight] = useState(false)
  return <DecorativeAnimationScope className="flex h-screen items-center justify-center bg-background text-text-primary">
    <div className="absolute left-6 top-5 flex gap-3 text-xs">
      <button onClick={() => setModal(true)}>打开设置</button>
      <button onClick={() => { setDecorativeMotion(!enabled); setEnabled(!enabled) }}>切换装饰动画</button>
      <button onClick={() => { themeManager.applyTheme(builtinThemes.find(theme => theme.id === (light ? 'adnify-dark' : 'dawn'))!); setLight(!light) }}>切换主题</button>
    </div>
    <DecorativeAnimationScope paused={modal} data-workspace className="w-[510px] rounded-2xl border border-border/70 bg-background-secondary shadow-xl">
      <Conversation />
    </DecorativeAnimationScope>
    <Modal isOpen={modal} onClose={() => setModal(false)} title="外观与编辑器" size="sm">
      <p className="text-sm text-text-secondary">后台任务继续执行，工作区动效已暂停。</p>
      <span data-modal-motion className="tool-text-shimmer mt-4 inline-block text-sm">动效预览</span>
      <button className="ml-4 text-sm" onClick={() => setModal(false)}>返回工作区</button>
    </Modal>
  </DecorativeAnimationScope>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
