import { useStore } from '@/renderer/store'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useDiagnosticsStore } from '@/renderer/services/diagnosticsStore'
import { EventBus } from '../core/EventBus'
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
  label: string
  asset: OtterAssetKey
  execute: () => void
}

const actions: Record<EmotionActionType, () => EmotionActionDef> = {
  ai_fix: () => ({
    type: 'ai_fix',
    label: 'AI 修复',
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
      const prompt = errors.length > 0
        ? `请帮我修复当前文件 \`${fileName}\` 中的错误：\n\n${errors.join('\n')}`
        : `请帮我检查当前文件 \`${fileName}\` 是否有问题。`

      useAgentStore.getState().setInputPrompt(prompt)
      useStore.getState().setChatVisible(true)
    },
  }),

  ask_ai: () => ({
    type: 'ask_ai',
    label: '问 AI',
    asset: 'chat',
    execute: () => {
      useAgentStore.getState().setInputPrompt('')
      useStore.getState().setChatVisible(true)
    },
  }),

  take_break: () => ({
    type: 'take_break',
    label: '休息一下',
    asset: 'break',
    execute: () => {
      EventBus.emit({
        type: 'break:suggested',
        message: '站起来活动一下，看看远处，让大脑放松一下。',
      })
    },
  }),

  focus_mode: () => ({
    type: 'focus_mode',
    label: '专注模式',
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
    label: '切换主题',
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
