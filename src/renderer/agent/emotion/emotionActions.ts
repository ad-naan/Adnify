import { useStore } from '@/renderer/store'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useDiagnosticsStore } from '@/renderer/services/diagnosticsStore'
import { toast } from '@/renderer/components/common/InlineToast'
import { t, type TranslationKey } from '@shared/i18n'
import type { EmotionDetection } from '../types/emotion'
import type { OtterAssetKey } from '@/renderer/components/brand/otterAssets'

export type EmotionActionType =
  | 'ai_fix'
  | 'ask_ai'
  | 'take_break'
  | 'focus_mode'
  | 'switch_theme'

export interface EmotionActionDef {
  type: EmotionActionType
  /** 按钮文案的 locale 键，渲染的组件自己翻。 */
  labelKey: TranslationKey
  asset: OtterAssetKey
  execute: () => void
}

const actions: Record<EmotionActionType, () => EmotionActionDef> = {
  ai_fix: () => ({
    type: 'ai_fix',
    labelKey: 'emotion.action.aiFix',
    asset: 'modalDanger',
    execute: () => {
      const activeFile = useStore.getState().activeFilePath
      const diagState = useDiagnosticsStore.getState()

      if (!activeFile) return

      const fileDiags = diagState.diagnostics.get(activeFile) || []
      const errors = fileDiags
        .filter((d: { severity?: number }) => d.severity === 1)
        .slice(0, 5)
        .map((d: { message?: string; range?: { start?: { line?: number } } }) =>
          `Line ${(d.range?.start?.line ?? 0) + 1}: ${d.message || 'Error'}`
        )

      const fileName = activeFile.split(/[\\/]/).pop()
      // prompt 是替用户写进输入框的话，跟着界面语言走：中文界面里塞一句英文
      // （或反过来）会让模型的回答语言也跟着跑偏。
      const language = useStore.getState().language
      const prompt = errors.length > 0
        ? t('emotion.action.aiFix.prompt', language, { file: fileName, errors: errors.join('\n') })
        : t('emotion.action.aiFix.promptCheck', language, { file: fileName })

      useAgentStore.getState().setInputPrompt(prompt)
      useStore.getState().setChatVisible(true)
    },
  }),

  ask_ai: () => ({
    type: 'ask_ai',
    labelKey: 'emotion.action.askAi',
    asset: 'chat',
    execute: () => {
      useAgentStore.getState().setInputPrompt('')
      useStore.getState().setChatVisible(true)
    },
  }),

  take_break: () => ({
    type: 'take_break',
    labelKey: 'emotion.action.takeBreak',
    asset: 'break',
    execute: () => {
      toast.info(t('emotion.break.stretchNow', useStore.getState().language))
    },
  }),

  focus_mode: () => ({
    type: 'focus_mode',
    labelKey: 'emotion.action.focusMode',
    asset: 'emotionFocusRing',
    execute: () => {
      const store = useStore.getState()
      store.setActiveSidePanel(null)
      if (store.setTerminalVisible) store.setTerminalVisible(false)
      if (store.setDebugVisible) store.setDebugVisible(false)
    },
  }),

  switch_theme: () => ({
    type: 'switch_theme',
    labelKey: 'emotion.action.switchTheme',
    asset: 'creative',
    execute: () => {
      const store = useStore.getState()
      if (store.setTheme) {
        const themes = ['adnify-dark', 'midnight', 'dawn', 'cyberpunk'] as const
        const current = store.currentTheme || 'adnify-dark'
        const idx = themes.indexOf(current as typeof themes[number])
        const next = themes[(idx + 1) % themes.length]
        store.setTheme(next)
      }
    },
  }),
}

export function getRecommendedActions(detection: EmotionDetection): EmotionActionDef[] {
  const result: EmotionActionDef[] = []
  const state = detection.state

  if (detection.context?.hasErrors) {
    result.push(actions.ai_fix())
  }

  if (state === 'frustrated' || state === 'stressed') {
    if (!detection.context?.hasErrors) result.push(actions.ask_ai())
    result.push(actions.take_break())
  }

  if (state === 'tired') {
    result.push(actions.take_break())
    result.push(actions.switch_theme())
  }

  if (state === 'bored') {
    result.push(actions.switch_theme())
    result.push(actions.ask_ai())
  }

  if (state === 'focused' || state === 'flow') {
    result.push(actions.focus_mode())
  }

  return result.slice(0, 2)
}
