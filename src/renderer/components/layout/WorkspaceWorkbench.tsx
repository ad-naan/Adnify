import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { DecorativeAnimationScope } from '../common/DecorativeAnimationScope'
import { EditorSkeleton, PanelSkeleton, ChatSkeleton } from '../ui/Loading'
import { EmotionAmbientGlow } from '../agent/EmotionAmbientGlow'
import DockWorkbench from './DockWorkbench'
import { syncWorkbenchEditorVisibility } from './workbenchVisibility'

const Editor = lazy(() => import('../editor/Editor'))
const Sidebar = lazy(() => import('../sidebar/Sidebar'))
const ChatPanel = lazy(() => import('../agent/ChatPanel'))
const ShellStudio = lazy(() => import('../../shell/components/ShellStudio'))
const TerminalPanel = lazy(() => import('../panels/TerminalPanel'))
const DebugPanel = lazy(() => import('../panels/DebugPanel'))

function LoadOnce({ active, children }: { active: boolean; children: ReactNode }) {
  const loaded = useRef(active)
  if (active) loaded.current = true
  return loaded.current ? children : null
}

export default function WorkspaceWorkbench() {
  const state = useStore(useShallow(s => ({
    layout: s.workbenchLayout, language: s.language, sidebar: s.activeSidePanel,
    editor: s.editorVisible, agent: s.chatVisible, terminal: s.terminalVisible, debug: s.debugVisible, focus: s.focusedPanel,
    setLayout: s.setWorkbenchLayout,
  })))
  const shell = state.sidebar === 'shell'
  useEffect(syncWorkbenchEditorVisibility, [])
  const lastSidebar = useRef(state.sidebar && !shell ? state.sidebar : 'explorer' as const)
  if (state.sidebar && !shell) lastSidebar.current = state.sidebar
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)
  const visible = useMemo(() => ([
    ...(state.sidebar && !shell ? ['sidebar' as const] : []),
    ...(state.editor || shell ? ['editor' as const] : []),
    ...(state.agent ? ['agent' as const] : []),
  ]), [state.sidebar, state.editor, state.agent, shell])
  const terminalVisible = state.terminal && !shell && (state.layout.terminalPosition === 'bottom' || (visible.includes(state.layout.terminalPosition) && (!state.focus || state.focus === state.layout.terminalPosition)))
  const panelContent = useMemo(() => ({
    sidebar: <ErrorBoundary><Suspense fallback={<PanelSkeleton />}><LoadOnce active={Boolean(state.sidebar && !shell)}><Sidebar panel={lastSidebar.current} /></LoadOnce></Suspense></ErrorBoundary>,
    editor: <>
      <EmotionAmbientGlow />
      <DecorativeAnimationScope paused={shell} className="flex-1 min-h-0 flex-col relative overflow-hidden" style={{ display: shell ? 'none' : 'flex' }}>
        <ErrorBoundary><Suspense fallback={<EditorSkeleton />}><Editor /></Suspense></ErrorBoundary>
      </DecorativeAnimationScope>
      <DecorativeAnimationScope paused={!shell} className="flex-1 min-h-0 flex-col relative overflow-hidden" style={{ display: shell ? 'flex' : 'none' }}>
        <ErrorBoundary><Suspense fallback={<EditorSkeleton />}><LoadOnce active={shell}><ShellStudio /></LoadOnce></Suspense></ErrorBoundary>
      </DecorativeAnimationScope>
      {state.debug && !shell && <ErrorBoundary><Suspense fallback={null}><DebugPanel /></Suspense></ErrorBoundary>}
    </>,
    agent: <ErrorBoundary><Suspense fallback={<ChatSkeleton />}><LoadOnce active={state.agent}><ChatPanel /></LoadOnce></Suspense></ErrorBoundary>,
  }), [state.sidebar, state.agent, state.debug, shell])
  return <DockWorkbench layout={state.layout} visible={visible} focused={state.focus} language={state.language}
    panels={panelContent} terminalVisible={terminalVisible} terminalCollapsed={terminalCollapsed}
    terminal={<ErrorBoundary><Suspense fallback={null}><LoadOnce active={state.terminal && !shell}><TerminalPanel docked layoutVisible={terminalVisible} onCollapsedChange={setTerminalCollapsed} /></LoadOnce></Suspense></ErrorBoundary>}
    onLayoutChange={state.setLayout} />
}
