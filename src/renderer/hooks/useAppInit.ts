/**
 * App initialization hook.
 */
import { useEffect, useRef, useCallback } from 'react'
import { api } from '@renderer/services/electronAPI'
import { initializeApp, registerSettingsSync, registerAppErrorListener } from '@renderer/services/initService'
import { initWorkspaceStateSync } from '@renderer/services/workspaceStateService'

interface InitResult {
  shouldShowOnboarding: boolean
}

interface UseAppInitOptions {
  onInitialized?: (result: InitResult) => void
}

export function useAppInit(options: UseAppInitOptions = {}) {
  const initRef = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const updateLoaderStatus = useCallback((status: string) => {
    const statusEl = document.querySelector('#initial-loader .loader-status span')
    const subStatusEl = document.querySelector('#initial-loader .loader-status-sub span')

    if (statusEl) {
      if (status === 'Initializing...') statusEl.textContent = '正在初始化 AI 引擎...'
      else if (status === 'Loading settings...') statusEl.textContent = '正在加载配置信息...'
      else if (status === 'Restoring workspace...') statusEl.textContent = '正在构建工作区...'
      else if (status === 'Ready!') statusEl.textContent = '加载完成'
      else statusEl.textContent = status
    }

    if (subStatusEl) {
      if (status === 'Initializing...') subStatusEl.textContent = '正在启动核心服务与通信通道'
      else if (status === 'Loading settings...') subStatusEl.textContent = '正在读取偏好设置与插件配置'
      else if (status === 'Restoring workspace...') subStatusEl.textContent = '正在准备项目上下文、模型能力与最近会话'
      else if (status === 'Ready!') subStatusEl.textContent = '即将进入 Adnify'
    }
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
