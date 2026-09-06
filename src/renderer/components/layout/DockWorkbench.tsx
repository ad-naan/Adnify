import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { t, type Language } from '@shared/i18n'
import { DecorativeAnimationScope } from '../common/DecorativeAnimationScope'
import { measureWorkbench, resizeLayout, WORKBENCH_PANELS, type LayoutDivider, type PanelRect, type WorkbenchLayout, type WorkbenchPanel } from './workbenchLayout'
import './workbench.css'

interface DockWorkbenchProps {
  layout: WorkbenchLayout
  visible: WorkbenchPanel[]
  focused: WorkbenchPanel | null
  language: Language
  panels: Record<WorkbenchPanel, ReactNode>
  terminal?: ReactNode
  terminalVisible: boolean
  terminalCollapsed?: boolean
  onLayoutChange: (layout: WorkbenchLayout) => void
}
const rectStyle = (rect?: PanelRect): CSSProperties => rect
  ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
  : { visibility: 'hidden', pointerEvents: 'none', left: 0, top: 0, width: 0, height: 0 }

/** Flat, keyed panel hosts preserve React, Monaco, webview and xterm identity while docking. */
export default function DockWorkbench({ layout, visible, focused, language, panels, terminal, terminalVisible, terminalCollapsed, onLayoutChange }: DockWorkbenchProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const gestureCleanup = useRef<(() => void) | null>(null)
  const lastRects = useRef<Partial<Record<WorkbenchPanel, PanelRect>>>({})
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [resizePreview, setResizePreview] = useState<PanelRect | null>(null)
  const shown = focused && visible.includes(focused) ? [focused] : visible
  const geometry = useMemo(() => measureWorkbench(layout, shown, size.width, size.height, terminalVisible, terminalCollapsed), [layout, shown.join(','), size, terminalVisible, terminalCollapsed])

  useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(current => current.width === width && current.height === height ? current : { width, height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => gestureCleanup.current?.(), [])
  useEffect(() => {
    // A preset, visibility change or window resize cancels an in-flight gesture.
    gestureCleanup.current?.()
  }, [layout, focused, visible.join(','), size])

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, divider: LayoutDivider | 'terminal') => {
    if (event.button !== 0) return
    event.preventDefault(); gestureCleanup.current?.()
    const handle = event.currentTarget, horizontal = divider !== 'terminal' && divider.direction === 'horizontal'
    const start = horizontal ? event.clientX : event.clientY
    const rect = divider === 'terminal' ? geometry.terminalDivider! : divider
    handle.setPointerCapture(event.pointerId)
    let delta = 0
    const terminalRect = geometry.terminal
    const terminalParent = layout.terminalPosition === 'bottom' ? size.height : (geometry.panels[layout.terminalPosition]?.height || 0) + (terminalRect?.height || 0) + 5
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      const raw = (horizontal ? e.clientX : e.clientY) - start
      delta = divider === 'terminal'
        ? Math.max((terminalRect?.height || 0) - Math.max(100, terminalParent - 135), Math.min((terminalRect?.height || 0) - 100, raw))
        : Math.max((divider.minRatio - divider.ratio) * divider.available, Math.min((divider.maxRatio - divider.ratio) * divider.available, raw))
      setResizePreview({ ...rect, x: rect.x + (horizontal ? delta : 0), y: rect.y + (horizontal ? 0 : delta) })
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', keydown); window.removeEventListener('blur', cancel)
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      setResizePreview(null); gestureCleanup.current = null
    }
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      cleanup()
      if (!delta) return
      onLayoutChange(divider === 'terminal'
        ? { ...layout, terminalHeight: Math.max(100, (terminalRect?.height || 0) - delta) }
        : { ...layout, preset: 'custom', tree: resizeLayout(layout.tree, divider.path, divider.ratio + delta / divider.available) })
    }
    const cancel = () => cleanup()
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup() } }
    gestureCleanup.current = cleanup
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', keydown); window.addEventListener('blur', cancel)
    setResizePreview(rect)
  }

  return (
    <div ref={rootRef} className="dock-workbench" data-dock-workbench data-interacting={resizePreview ? 'true' : undefined}>
      {WORKBENCH_PANELS.map(panel => {
        const rect = geometry.panels[panel], hidden = !rect
        if (rect) lastRects.current[panel] = rect
        const style = hidden ? { ...rectStyle(lastRects.current[panel]), visibility: 'hidden' as const, pointerEvents: 'none' as const } : rectStyle(rect)
        return <DecorativeAnimationScope key={panel} paused={hidden} className="dock-panel" style={style} data-dock-panel={panel} aria-hidden={hidden || undefined}>
          <div className="dock-panel-content">{panels[panel]}</div>
        </DecorativeAnimationScope>
      })}
      <DecorativeAnimationScope paused={!geometry.terminal} className="dock-terminal" style={rectStyle(geometry.terminal)} data-dock-terminal aria-hidden={!geometry.terminal || undefined}>{terminal}</DecorativeAnimationScope>
      {geometry.dividers.map(divider => <button key={divider.path} type="button" className="dock-divider" style={rectStyle(divider)} role="separator" aria-label={t(divider.direction === 'horizontal' ? 'workbench.resizeWidth' : 'workbench.resizeHeight', language)} aria-orientation={divider.direction === 'horizontal' ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(divider.ratio * 100)} aria-valuemin={Math.round(divider.minRatio * 100)} aria-valuemax={Math.round(divider.maxRatio * 100)} onPointerDown={event => startResize(event, divider)} onDoubleClick={() => onLayoutChange({ ...layout, preset: 'custom', tree: resizeLayout(layout.tree, divider.path, .5) })} onKeyDown={event => {
        const keys = divider.direction === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
        if (!keys.includes(event.key)) return
        event.preventDefault()
        const ratio = Math.max(divider.minRatio, Math.min(divider.maxRatio, divider.ratio + (event.key === keys[1] ? .025 : -.025)))
        onLayoutChange({ ...layout, preset: 'custom', tree: resizeLayout(layout.tree, divider.path, ratio) })
      }} />)}
      {geometry.terminalDivider && !terminalCollapsed && <button type="button" className="dock-divider" style={rectStyle(geometry.terminalDivider)} role="separator" aria-orientation="horizontal" aria-label={t('workbench.resizeTerminal', language)} aria-valuenow={Math.round(geometry.terminal!.height)} onPointerDown={event => startResize(event, 'terminal')} onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const current = geometry.terminal!.height
        const total = current + (layout.terminalPosition === 'bottom' ? size.height - current : geometry.panels[layout.terminalPosition]!.height)
        onLayoutChange({ ...layout, terminalHeight: Math.max(100, Math.min(total - 135, current + (event.key === 'ArrowUp' ? 20 : -20))) })
      }} />}
      {resizePreview && <div className="dock-interaction-shield" aria-hidden="true" />}
      {resizePreview && <div className="dock-resize-preview" style={rectStyle(resizePreview)} />}
    </div>
  )
}
