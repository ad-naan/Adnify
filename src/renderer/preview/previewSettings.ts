/**
 * 预览功能的用户偏好：localStorage 持久化。
 *
 * 与 emotion/panelSettings 同一套模式（load / save / subscribe + CustomEvent），
 * 因为这些偏好要在设置面板、状态栏、预览标签三处同步，而它们不共享 React 树。
 */

export interface PreviewSettings {
  /**
   * 发现本地 dev server 时是否主动弹卡片提示。
   *
   * 默认关闭：dev server 的启动日志会反复刷出同一批地址，主动弹窗在实际使用中
   * 表现为右下角反复闪出卡片。改为在状态栏常驻一个入口，需要时点开。
   */
  autoPrompt: boolean
  /** 用户点过"不再提示"的 origin，按 origin 记，不按完整 URL。 */
  dismissedOrigins: string[]
  /** 预览里对 guest 页面的缩放级别（Electron zoom level，0 为原始大小）。 */
  zoomLevel: number
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  autoPrompt: false,
  dismissedOrigins: [],
  zoomLevel: 0,
}

const PREVIEW_SETTINGS_KEY = 'adnify-preview-settings'

/**
 * 订阅者表。
 *
 * 用模块级 Set 而不是 window CustomEvent（emotion/panelSettings 的做法）：
 * 所有订阅者都在同一个渲染进程的同一个模块实例上，走 window 事件只是多绕一圈，
 * 而且让这个模块在测试里必须有一个完整的 window。
 */
const listeners = new Set<(settings: PreviewSettings) => void>()

/** 记住的"不再提示"上限。超出后丢弃最早的，避免无界增长。 */
const MAX_DISMISSED_ORIGINS = 50

function sanitize(parsed: Partial<PreviewSettings>): PreviewSettings {
  const dismissedOrigins = Array.isArray(parsed.dismissedOrigins)
    ? parsed.dismissedOrigins.filter((value): value is string => typeof value === 'string').slice(-MAX_DISMISSED_ORIGINS)
    : []

  return {
    autoPrompt: typeof parsed.autoPrompt === 'boolean' ? parsed.autoPrompt : DEFAULT_PREVIEW_SETTINGS.autoPrompt,
    dismissedOrigins,
    zoomLevel: typeof parsed.zoomLevel === 'number' && Number.isFinite(parsed.zoomLevel)
      ? Math.min(Math.max(parsed.zoomLevel, -5), 5)
      : DEFAULT_PREVIEW_SETTINGS.zoomLevel,
  }
}

export function loadPreviewSettings(): PreviewSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_PREVIEW_SETTINGS
    const raw = localStorage.getItem(PREVIEW_SETTINGS_KEY)
    if (!raw) return DEFAULT_PREVIEW_SETTINGS
    return sanitize(JSON.parse(raw) as Partial<PreviewSettings>)
  } catch {
    return DEFAULT_PREVIEW_SETTINGS
  }
}

export function savePreviewSettings(settings: PreviewSettings): void {
  const next = sanitize(settings)
  try {
    localStorage.setItem(PREVIEW_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // localStorage 写失败（隐私模式 / 配额）不该让调用方炸掉，
    // 但订阅者照样通知 —— 内存里的状态仍应保持一致。
  }
  for (const listener of listeners) {
    listener(next)
  }
}

export function updatePreviewSettings(patch: Partial<PreviewSettings>): PreviewSettings {
  const next = sanitize({ ...loadPreviewSettings(), ...patch })
  savePreviewSettings(next)
  return next
}

export function subscribePreviewSettings(listener: (settings: PreviewSettings) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isOriginDismissed(origin: string): boolean {
  return loadPreviewSettings().dismissedOrigins.includes(origin)
}

export function dismissOrigin(origin: string): void {
  const current = loadPreviewSettings()
  if (current.dismissedOrigins.includes(origin)) return
  updatePreviewSettings({
    dismissedOrigins: [...current.dismissedOrigins, origin].slice(-MAX_DISMISSED_ORIGINS),
  })
}

export function clearDismissedOrigins(): void {
  updatePreviewSettings({ dismissedOrigins: [] })
}
