/**
 * App initialization hook.
 */
import { useEffect, useRef, useCallback } from 'react'
import { api } from '@renderer/services/electronAPI'
import { initializeApp, registerSettingsSync, registerAppErrorListener, type AppInitPhase } from '@renderer/services/initService'
import { initWorkspaceStateSync } from '@renderer/services/workspaceStateService'
import { useStore } from '@renderer/store'
import { asLanguage, t, type TranslationKey } from '@shared/i18n'
import { cacheStartupLanguage, readStartupLanguage } from '@renderer/i18n/startupLanguage'

interface InitResult {
  shouldShowOnboarding: boolean
}

interface UseAppInitOptions {
  onInitialized?: (result: InitResult) => void
}

/** 阶段 → 闪屏的两行文案。`beforeSettings` 标出跑在设置加载完成之前的阶段。 */
const PHASES: Record<AppInitPhase, { status: TranslationKey; sub: TranslationKey; beforeSettings?: true }> = {
  initializing: { status: 'splash.initializing', sub: 'splash.initializingSub', beforeSettings: true },
  settings: { status: 'splash.settings', sub: 'splash.settingsSub', beforeSettings: true },
  workspace: { status: 'splash.workspace', sub: 'splash.workspaceSub' },
  ready: { status: 'splash.ready', sub: 'splash.readySub' },
}

export function useAppInit(options: UseAppInitOptions = {}) {
  const initRef = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const language = useStore(state => state.language)

  // 语言变了就更新启动缓存：闪屏首帧只能同步读到 localStorage，权威值仍在设置里。
  useEffect(() => { cacheStartupLanguage(language) }, [language])

  const updateLoaderStatus = useCallback((phase: AppInitPhase) => {
    const statusEl = document.querySelector('#initial-loader .loader-status span')
    const subStatusEl = document.querySelector('#initial-loader .loader-status-sub span')
    if (!statusEl && !subStatusEl) return

    const { status, sub, beforeSettings } = PHASES[phase]
    // 前两个阶段跑在设置加载之前，store 里还是默认值 —— 用上次启动缓存下来的语言，
    // 和 index.html 首帧保持一致；之后的阶段读真实取值。
    const lang = beforeSettings ? readStartupLanguage() : asLanguage(useStore.getState().language)

    if (statusEl) statusEl.textContent = t(status, lang)
    if (subStatusEl) subStatusEl.textContent = t(sub, lang)
  }, [])

  const removeInitialLoader = useCallback(() => {
    const loader = document.getElementById('initial-loader')
    const root = document.getElementById('root')

    if (root) root.classList.add('ready')

    if (loader) {
      requestAnimationFrame(() => {
        loader.classList.add('fade-out')
        setTimeout(() => loader.remove(), 300)
      })
    }
  }, [])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const init = async () => {
      const result = await initializeApp(updateLoaderStatus)

      const unsubscribeSettings = registerSettingsSync()
      window.__settingsUnsubscribe = unsubscribeSettings

      const unsubscribeError = registerAppErrorListener()
      window.__errorUnsubscribe = unsubscribeError

      setTimeout(() => {
        removeInitialLoader()
        api.appReady()
        optionsRef.current.onInitialized?.(result)
      }, 50)
    }

    init()

    return () => {
      const unsubscribeSettings = window.__settingsUnsubscribe
      if (unsubscribeSettings) {
        unsubscribeSettings()
        delete window.__settingsUnsubscribe
      }

      const unsubscribeError = window.__errorUnsubscribe
      if (unsubscribeError) {
        unsubscribeError()
        delete window.__errorUnsubscribe
      }
    }
  }, [updateLoaderStatus, removeInitialLoader])

  useEffect(() => {
    return initWorkspaceStateSync()
  }, [])
}
