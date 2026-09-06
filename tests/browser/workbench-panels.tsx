import { useEffect, useState } from 'react'
import type { SidePanel } from '@renderer/store/slices/layoutSlice'

function useMountCount(id: string) {
  useEffect(() => {
    const counters = (window as unknown as { dockMounts: Record<string, number> }).dockMounts
    counters[id] = (counters[id] || 0) + 1
    return () => { counters[`${id}-unmount`] = (counters[`${id}-unmount`] || 0) + 1 }
  }, [id])
}
export function Editor() {
  useMountCount('editor')
  return <div className="h-full flex flex-col"><div className="p-3 text-xs border-b border-border text-accent">footer.tsx · ●</div><textarea aria-label="Editor buffer" className="flex-1 min-h-0 p-5 font-mono text-sm bg-background text-text-primary resize-none" defaultValue={'// A quiet finish to every page.\nexport function Footer() {\n  return (\n    <footer className="site-footer">\n      <span>Built with care.</span>\n    </footer>\n  )\n}'} /></div>
}
export function Sidebar({ panel }: { panel?: SidePanel }) {
  useMountCount('sidebar')
  return <div className="h-full overflow-auto p-4 text-xs text-text-muted" data-fixture-scroll><p className="mb-4">{panel === 'explorer' ? 'blog / frontend / src' : panel}</p>{Array.from({ length: 45 }, (_, i) => <div key={i} className="py-2 pl-3">{i === 0 ? '▾ layouts' : i === 1 ? '　footer.tsx' : `　component-${i}.tsx`}</div>)}</div>
}
export function ChatPanel() {
  useMountCount('agent')
  const [steps, setSteps] = useState(3)
  return <div className="h-full flex flex-col gap-4 p-4 text-sm"><p className="text-text-muted text-xs">主线 · 界面优化</p><p className="bg-surface border border-border rounded-xl p-3">保留精致的视觉效果，让界面更轻。</p><p className="font-medium text-accent">Adnify</p><p>面板可以左右换位、上下分屏，也可以切换为专注布局。</p><button data-agent-step onClick={() => setSteps(n => n + 1)} className="text-left text-xs text-text-muted">已完成 {steps} 步</button><textarea aria-label="Agent draft" placeholder="继续描述你的想法…" className="mt-auto rounded-xl border border-border p-3 bg-surface resize-none" rows={4} /></div>
}
export function TerminalPanel({ onCollapsedChange }: { docked?: boolean; layoutVisible?: boolean; onCollapsedChange?: (value: boolean) => void }) {
  useMountCount('terminal')
  const [collapsed, setCollapsed] = useState(false)
  return <div className="h-full flex flex-col"><button className="text-left h-[42px] shrink-0 px-3 bg-surface text-xs" onClick={() => { setCollapsed(!collapsed); onCollapsedChange?.(!collapsed) }}>Terminal · PowerShell</button><textarea aria-label="Terminal buffer" className="flex-1 min-h-0 p-3 bg-background text-text-primary font-mono text-xs resize-none" defaultValue={'PS E:\\Project\\blog> pnpm dev\nVITE ready in 218 ms\nLocal: http://localhost:3000/'} /></div>
}
export function ShellStudio() { useMountCount('shell'); return <textarea aria-label="Shell session" className="flex-1 bg-background p-4" defaultValue="Shell Studio" /> }
export function DebugPanel() { return <div>Debug</div> }
export function EmotionAmbientGlow() { return null }
