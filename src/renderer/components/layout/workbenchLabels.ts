import type { TranslationKey } from '@shared/i18n'
import type { LayoutPreset, TerminalPosition, WorkbenchPanel } from './workbenchLayout'

// Explicit keys keep computed UI labels visible to the locale reference check.
export const WORKBENCH_PANEL_LABEL_KEYS = {
  sidebar: 'workbench.sidebar',
  editor: 'workbench.editor',
  agent: 'workbench.agent',
} as const satisfies Record<WorkbenchPanel, TranslationKey>

export const WORKBENCH_PRESET_LABEL_KEYS = {
  classic: 'workbench.preset.classic',
  agent: 'workbench.preset.agent',
} as const satisfies Record<LayoutPreset, TranslationKey>

export const WORKBENCH_TERMINAL_LABEL_KEYS = {
  editor: 'workbench.terminal.editor',
  agent: 'workbench.terminal.agent',
  bottom: 'workbench.terminal.bottom',
  hidden: 'workbench.terminal.hidden',
} as const satisfies Record<TerminalPosition | 'hidden', TranslationKey>

export const WORKBENCH_TAB_LABEL_KEYS = {
  appearance: 'workbench.tab.appearance',
  workbench: 'workbench.tab.workbench',
} as const satisfies Record<'appearance' | 'workbench', TranslationKey>
