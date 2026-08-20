/**
 * `<webview>` guest 的安全加固。
 *
 * 预览标签用 Electron 的 webview 承载本地 dev server。webview 让 guest 跑在
 * 独立进程里、并暴露真实的导航与错误事件，代价是 host 页面能通过属性配置 guest
 * 的 webPreferences —— 所以这里在主进程把配置钉死，不信任 host 传上来的值。
 *
 * 三道闸：
 *  1. will-attach-webview —— 重写 webPreferences，删掉 preload，拒绝非本地 src。
 *  2. guest 的 will-navigate / setWindowOpenHandler —— 只允许在本地地址间跳转，
 *     外部链接交给系统浏览器。
 *  3. guest 的权限请求全部拒绝（和主窗口一致）。
 */

import type { BrowserWindow, WebContents, WebPreferences } from 'electron'
import { logger } from '@shared/utils/Logger'
import { isLocalPreviewUrl } from '@shared/preview/discovery'
import { openExternalSafely } from './externalUrl'

/** about:blank 是 webview 未设置 src 时的初始地址，必须放行否则挂载即被拒。 */
function isAllowedGuestUrl(url: string): boolean {
  return !url || url === 'about:blank' || isLocalPreviewUrl(url)
}

function hardenGuestPreferences(preferences: WebPreferences): void {
  preferences.nodeIntegration = false
  preferences.nodeIntegrationInWorker = false
  preferences.nodeIntegrationInSubFrames = false
  preferences.contextIsolation = true
  preferences.sandbox = true
  preferences.webSecurity = true
  preferences.allowRunningInsecureContent = false
  preferences.experimentalFeatures = false
  preferences.enableBlinkFeatures = undefined
  // guest 不需要任何 preload —— 它加载的是用户自己的页面，不该拿到 IPC 桥。
  delete (preferences as { preload?: string }).preload
}

/** 把 guest 的导航面锁在本地地址内。 */
function guardGuestNavigation(guest: WebContents): void {
  // 预览面板里没有标签概念，guest 的 window.open 只会变成一个裸窗口。
  // 无论目标是不是本地地址，一律不在应用内开新窗口，交给系统浏览器。
  guest.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })

  guest.on('will-navigate', (event, url) => {
    if (isAllowedGuestUrl(url)) {
      return
    }

    event.preventDefault()
    logger.security.info('[Preview] Redirected non-local guest navigation to the system browser', { url })
    void openExternalSafely(url)
  })

  // 服务端 3xx 跳到外部域名同样要拦 —— will-navigate 不覆盖重定向。
  guest.on('will-redirect', (event, url) => {
    if (isAllowedGuestUrl(url)) {
      return
    }

    event.preventDefault()
    logger.security.warn('[Preview] Blocked non-local guest redirect', { url })
  })

  guest.session.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.security.warn('[Preview] Guest permission request denied', { permission })
    callback(false)
  })

  guest.on('render-process-gone', (_event, details) => {
    logger.ui.warn('[Preview] Guest render process gone', { reason: details.reason })
  })
}

/**
 * 在窗口上注册 webview 加固。必须在窗口加载内容之前调用。
 */
export function registerWebviewGuards(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = typeof params.src === 'string' ? params.src : ''

    if (!isAllowedGuestUrl(src)) {
      logger.security.warn('[Preview] Blocked webview attach with non-local src', { src })
      event.preventDefault()
      return
    }

    hardenGuestPreferences(webPreferences)

    // 属性形式的开关也要清掉 —— host 页面被 XSS 时这是最直接的提权面。
    delete params.nodeintegration
    delete params.nodeintegrationinsubframes
    delete params.disablewebsecurity
    delete params.allowpopups
    delete params.preload
  })

  win.webContents.on('did-attach-webview', (_event, guest) => {
    guardGuestNavigation(guest)
  })
}
