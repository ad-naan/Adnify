import type { CSSProperties } from 'react'
import type { Theme } from '@renderer/config/themeConfig'
import { t, type Language } from '@shared/i18n'
import { createWorkbenchLayout, measureWorkbench, WORKBENCH_PANELS, type WorkbenchLayout, type WorkbenchPanel } from './workbenchLayout'

interface WorkbenchMiniatureProps {
  theme?: Theme
  layout?: WorkbenchLayout
  visible?: WorkbenchPanel[]
  focused?: WorkbenchPanel | null
  terminalVisible?: boolean
  compact?: boolean
  language?: Language
}

/** A proportional preview of the actual arrangement; never mounts an editor or animation. */
export default function WorkbenchMiniature({ theme, layout = createWorkbenchLayout(), visible = [...WORKBENCH_PANELS], focused, terminalVisible = false, compact = false, language = 'zh' }: WorkbenchMiniatureProps) {
  const shown = focused && visible.includes(focused) ? [focused] : visible
  // Keep the reference canvas above minimum panel widths so the preview preserves user ratios.
  const geometry = measureWorkbench({ ...layout, terminalHeight: 200 }, shown, 1200, 640, terminalVisible)
  const palette = theme?.colors
  const style = palette ? {
    '--mini-bg': `rgb(${palette.background})`, '--mini-surface': `rgb(${palette.backgroundSecondary})`,
    '--mini-border': `rgb(${palette.border})`, '--mini-ink': `rgb(${palette.textMuted})`,
    '--mini-accent': `rgb(${palette.accent})`,
  } as CSSProperties : undefined
  return <div className={`appearance-miniature${compact ? ' is-compact' : ''}`} style={style} aria-hidden="true">
    <div className="appearance-mini-chrome"><span /><i /><span /></div>
    <div className="appearance-mini-body">
      {shown.map(panel => {
        const rect = geometry.panels[panel]
        if (!rect) return null
        return <div key={panel} className="appearance-mini-pane" data-kind={panel} data-condensed={rect.height < 500} style={{ left: `${rect.x / 12}%`, top: `${rect.y / 6.4}%`, width: `${rect.width / 12}%`, height: `${rect.height / 6.4}%` }}>
          {!compact && <span className="appearance-mini-label">{t(`workbench.${panel}`, language)}</span>}
          <div className="appearance-mini-lines"><i /><i /><i /><i /></div>
          {panel === 'agent' && <div className="appearance-mini-composer" />}
        </div>
      })}
      {geometry.terminal && <div className="appearance-mini-terminal" style={{ left: `${geometry.terminal.x / 12}%`, top: `${geometry.terminal.y / 6.4}%`, width: `${geometry.terminal.width / 12}%`, height: `${geometry.terminal.height / 6.4}%` }}><span>›_</span><i /></div>}
    </div>
    <div className="appearance-mini-status"><i /><i /></div>
  </div>
}
