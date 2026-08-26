/**
 * Sidebar 主组件
 * 重塑：沉浸式设计，去除多余色块
 */

import { lazy, Suspense } from 'react'
import { useStore } from '@store'

const ExplorerView = lazy(() =>
    import('./panels/ExplorerView').then(module => ({ default: module.ExplorerView }))
)
const SearchView = lazy(() =>
    import('./panels/SearchView').then(module => ({ default: module.SearchView }))
)
const GitView = lazy(() =>
    import('./panels/GitView').then(module => ({ default: module.GitView }))
)
const ProblemsView = lazy(() =>
    import('./panels/ProblemsView').then(module => ({ default: module.ProblemsView }))
)
const OutlineView = lazy(() =>
    import('./panels/OutlineView').then(module => ({ default: module.OutlineView }))
)
const HistoryView = lazy(() =>
    import('./panels/HistoryView').then(module => ({ default: module.HistoryView }))
)
const ShellView = lazy(() =>
    import('./panels/ShellView').then(module => ({ default: module.ShellView }))
)
const EmotionAwarenessPanel = lazy(() => import('../agent/EmotionAwarenessPanel'))

function PanelFallback() {
    return (
        <div className="p-3 space-y-2" aria-busy="true" aria-label="Loading panel">
            <div className="h-5 w-2/3 rounded bg-foreground/5 animate-pulse" />
            <div className="h-4 w-full rounded bg-foreground/5 animate-pulse" />
            <div className="h-4 w-4/5 rounded bg-foreground/5 animate-pulse" />
        </div>
    )
}

export default function Sidebar() {
    const activeSidePanel = useStore(s => s.activeSidePanel)

    if (!activeSidePanel) return null

    return (
        <div className="w-full bg-background border-r border-border/30 shadow-[1px_0_15px_rgba(0,0,0,0.03)] flex flex-col h-full animate-fade-in relative z-10">
            <Suspense fallback={<PanelFallback />}>
                {activeSidePanel === 'explorer' && <ExplorerView />}
                {activeSidePanel === 'search' && <SearchView />}
                {activeSidePanel === 'git' && <GitView />}
                {activeSidePanel === 'emotion' && <EmotionAwarenessPanel />}
                {activeSidePanel === 'problems' && <ProblemsView />}
                {activeSidePanel === 'outline' && <OutlineView />}
                {activeSidePanel === 'history' && <HistoryView />}
                {activeSidePanel === 'shell' && <ShellView />}
            </Suspense>
        </div>
    )
}
