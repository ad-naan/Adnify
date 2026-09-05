/**
 * `<webview>` guest 的安全加固。
 *
 * 预览标签用 Electron 的 webview 承载网站和本地 dev server。webview 让 guest 跑在
 * 独立进程里、并暴露真实的导航与错误事件，代价是 host 页面能通过属性配置 guest
 * 的 webPreferences —— 所以这里在主进程把配置钉死，不信任 host 传上来的值。
 *
 * 三道闸：
 *  1. will-attach-webview —— 重写 webPreferences，删掉 preload，校验 HTTP(S) src。
 *  2. guest 的导航与重定向仅允许 HTTP(S)，新窗口链接在当前预览打开。
 *  3. guest 的权限请求全部拒绝（和主窗口一致）。
 */

import type { BrowserWindow, WebContents, WebPreferences } from 'electron'
import { logger } from '@shared/utils/Logger'
import { isBrowserPreviewUrl } from '@shared/preview/discovery'
import { previewBrowserService } from '../services/previewBrowserService'
import { processDiagnostics } from '../services/diagnostics/ProcessDiagnostics'

/** about:blank 是 webview 未设置 src 时的初始地址，必须放行否则挂载即被拒。 */
function isAllowedGuestUrl(url: string): boolean {
  return !url || url === 'about:blank' || isBrowserPreviewUrl(url)
}

function hardenGuestPreferences(preferences: WebPreferences): void {
  preferences.nodeIntegration = false
  preferences.nodeIntegrationInWorker = false
  preferences.nodeIntegrationInSubFrames = false
  preferences.contextIsolation = true
  preferences.sandbox = true
  preferences.webSecurity = true
  preferences.allowRunningInsecureContent = false
  // 页面导航或 dev server 刷新时保留编辑器/聊天焦点，用户点击预览后仍可正常输入。
  preferences.focusOnNavigation = false
  preferences.experimentalFeatures = false
  preferences.enableBlinkFeatures = undefined
  // guest 不需要任何 preload —— 它加载的是用户自己的页面，不该拿到 IPC 桥。
  delete (preferences as { preload?: string }).preload
}

/** 网站不能跳转到本地文件或启动系统协议处理器。 */
function guardGuestNavigation(guest: WebContents): void {
  // 不创建未受管理的裸窗口。普通 target=_blank 链接留在可操作的预览内。
  guest.setWindowOpenHandler(({ url }) => {
    if (isBrowserPreviewUrl(url)) void guest.loadURL(url).catch(() => {})
    return { action: 'deny' }
  })

  guest.on('will-navigate', (event, url) => {
    if (isAllowedGuestUrl(url)) {
      return
    }

    event.preventDefault()
    logger.security.warn('[Preview] Blocked unsupported guest navigation', { url })
  })

  // 服务端重定向同样校验协议 —— will-navigate 不覆盖重定向。
  guest.on('will-redirect', (event, url) => {
    if (isAllowedGuestUrl(url)) {
      return
    }

    event.preventDefault()
    logger.security.warn('[Preview] Blocked unsupported guest redirect', { url })
  })

  guest.session.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.security.warn('[Preview] Guest permission request denied', { permission })
    callback(false)
  })

  guest.on('did-finish-load', () => processDiagnostics.sample())
  guest.on('render-process-gone', (_event, details) => {
    logger.ui.warn('[Preview] Guest render process gone', {
      webContentsId: guest.id,
      reason: details.reason,
      exitCode: details.exitCode,
      processes: processDiagnostics.describeFailure(guest.id),
    })
  })
}

/**
 * 在窗口上注册 webview 加固。必须在窗口加载内容之前调用。
 */
export function registerWebviewGuards(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = typeof params.src === 'string' ? params.src : ''

    if (!isAllowedGuestUrl(src)) {
      logger.security.warn('[Preview] Blocked webview attach with unsupported src', { src })
      event.preventDefault()
      return
    }

    hardenGuestPreferences(webPreferences)

    // 属性形式的开关也要清掉 —— host 页面被 XSS 时这是最直接的提权面。
    delete params.nodeintegration
    delete params.nodeintegrationinsubframes
    delete params.disablewebsecurity
    // allowpopups lets requests reach setWindowOpenHandler, which always denies
    // native windows and routes valid web links into the existing guest.
    delete params.preload
  })

  win.webContents.on('did-attach-webview', (_event, guest) => {
    guardGuestNavigation(guest)
    previewBrowserService.register(win.webContents, guest)
  })
}
