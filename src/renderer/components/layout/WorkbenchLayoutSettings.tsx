import { Code2, Files, MessageSquare, Eye, EyeOff, ChevronLeft, ChevronRight, Maximize2, RotateCcw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import { t } from '@shared/i18n'
import { movePanel, panelOrder, type LayoutPreset } from './workbenchLayout'
import WorkbenchMiniature from './WorkbenchMiniature'

export default function WorkbenchLayoutSettings() {
  const state = useStore(useShallow(s => ({
    language: s.language, layout: s.workbenchLayout, sidebar: s.activeSidePanel, editor: s.editorVisible, agent: s.chatVisible,
    terminalVisible: s.terminalVisible, focused: s.focusedPanel, preset: s.applyLayoutPreset, setLayout: s.setWorkbenchLayout,
    setSidebar: s.setActiveSidePanel, setEditor: s.setEditorVisible, setAgent: s.setChatVisible,
    setTerminal: s.setTerminalVisible, setPosition: s.setTerminalPosition, setFocus: s.setFocusedPanel,
  })))
  const visible = { sidebar: Boolean(state.sidebar && state.sidebar !== 'shell'), editor: state.editor || state.sidebar === 'shell', agent: state.agent }
  const count = Object.values(visible).filter(Boolean).length
  const icons = { sidebar: Files, editor: Code2, agent: MessageSquare }
  const order = panelOrder(state.layout.tree)
  return <div className="appearance-settings appearance-workbench-settings">
    <section className="appearance-section">
      <div className="appearance-section-heading"><h3>{t('workbench.layout', state.language)}</h3><span>{t(state.focused ? 'workbench.preview.focused' : state.layout.preset === 'custom' ? 'workbench.preview.custom' : 'workbench.preview.live', state.language)}</span></div>
      <div className="appearance-layout-preview"><WorkbenchMiniature layout={state.layout} visible={order.filter(panel => visible[panel])} focused={state.focused} terminalVisible={state.terminalVisible} language={state.language} /></div>
      <div className="appearance-segmented" aria-label={t('workbench.layout', state.language)}>
        {(['classic', 'agent'] as LayoutPreset[]).map(preset => <button type="button" key={preset} aria-pressed={state.layout.preset === preset} onClick={() => state.preset(preset)}>{t(`workbench.preset.${preset}`, state.language)}</button>)}
      </div>
    </section>
    <section className="appearance-section">
      <div className="appearance-section-heading"><h3>{t('workbench.visiblePanels', state.language)}</h3><span>{t('workbench.orderHint', state.language)}</span></div>
      <div className="appearance-panel-list">
        {order.map((panel, index) => {
          const Icon = icons[panel]
          const label = t(`workbench.${panel}`, state.language)
          return <div key={panel} className="appearance-panel-row" data-visible={visible[panel]}>
            <span className="appearance-panel-number">{index + 1}</span><Icon size={15} /><span className="appearance-panel-label">{label}</span>
            <div className="appearance-order-actions">
              {([-1, 1] as const).map(direction => <button className="appearance-icon-button" key={direction} type="button" disabled={direction === -1 ? index === 0 : index === order.length - 1} aria-label={t(direction === -1 ? 'workbench.moveLeft' : 'workbench.moveRight', state.language, { panel: label })} title={t(direction === -1 ? 'workbench.moveLeft' : 'workbench.moveRight', state.language, { panel: label })} onClick={() => { state.setLayout({ ...state.layout, preset: 'custom', tree: movePanel(state.layout.tree, panel, direction) }); state.setFocus(null) }}>{direction === -1 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>)}
            </div>
            <button type="button" className="appearance-visibility-button" aria-label={label} aria-pressed={visible[panel]} title={t(visible[panel] ? 'workbench.hide' : 'workbench.show', state.language, { panel: label })} disabled={count === 1 && visible[panel]} onClick={() => {
              const show = !visible[panel]
              if (panel === 'sidebar') state.setSidebar(show ? 'explorer' : null)
              if (panel === 'editor') { if (!show && state.sidebar === 'shell') state.setSidebar(null); state.setEditor(show) }
              if (panel === 'agent') state.setAgent(show)
            }}>{visible[panel] ? <Eye size={14} /> : <EyeOff size={14} />}</button>
          </div>
        })}
      </div>
    </section>
    <section className="appearance-section">
      <div className="appearance-section-heading"><h3>{t('workbench.terminal', state.language)}</h3></div>
      <div className="appearance-segmented appearance-terminal-options" aria-label={t('workbench.terminal', state.language)}>
        {(['editor', 'agent', 'bottom', 'hidden'] as const).map(position => {
          const selected = state.terminalVisible ? state.layout.terminalPosition === position : position === 'hidden'
          return <button type="button" key={position} aria-pressed={selected} onClick={() => position === 'hidden' ? state.setTerminal(false) : state.setPosition(position)}>{t(`workbench.terminal.${position}`, state.language)}</button>
        })}
      </div>
    </section>
    <div className="appearance-focus-options">
      {(['editor', 'agent'] as const).map(panel => <button key={panel} type="button" aria-pressed={state.focused === panel} onClick={() => {
        if (state.focused === panel) { state.setFocus(null); return }
        if (panel === 'editor') state.setEditor(true)
        else state.setAgent(true)
        state.setFocus(panel)
      }}><Maximize2 size={13} />{t('workbench.focus', state.language, { panel: t(`workbench.${panel}`, state.language) })}</button>)}
      <button type="button" className="appearance-icon-button" disabled={!state.focused} aria-label={t('workbench.restore', state.language)} title={t('workbench.restore', state.language)} onClick={() => state.setFocus(null)}><RotateCcw size={14} /></button>
    </div>
  </div>
}
