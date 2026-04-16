import { BrowserWindow, app, screen } from 'electron'
import * as path from 'path'

export type ShutdownPhase = 'saving' | 'done' | 'error'
export type ShutdownReason = 'window-close' | 'app-quit'
export type ShutdownLanguage = 'zh' | 'en'
export type ShutdownThemeType = 'dark' | 'light'

export interface ShutdownWindowPresentation {
  language: ShutdownLanguage
  themeType: ShutdownThemeType
  background: string
  surface: string
  border: string
  text: string
  muted: string
  accent: string
  success: string
  warning: string
}

interface ShutdownWindowState {
  phase: ShutdownPhase
  title: string
  message: string
  description: string
}

const WINDOW_WIDTH = 500
const WINDOW_HEIGHT = 214

const DEFAULT_PRESENTATION: ShutdownWindowPresentation = {
  language: 'zh',
  themeType: 'dark',
  background: '18 18 21',
  surface: '25 25 29',
  border: '40 40 48',
  text: '242 242 247',
  muted: '161 161 180',
  accent: '139 92 246',
  success: '52 211 153',
  warning: '251 191 36',
}

const COPY = {
  zh: {
    savingTitle: '正在保存工作区',
    savingAppQuit: '正在退出应用前保存所有运行时数据。',
    savingWindowClose: '正在关闭窗口前保存当前工作区与会话状态。',
    savingDescription: '请稍候，Adnify 会在保存完成后继续退出流程。',
    doneTitle: '保存完成',
    doneMessage: '当前工作区与对话数据已安全保存。',
    doneDescription: 'Adnify 正在完成最后的退出收尾。',
    errorTitle: '保存未完全成功',
    errorMessage: '部分运行时数据可能未完整持久化。',
    errorDescription: 'Adnify 正在继续退出，请下次启动后确认恢复结果。',
  },
  en: {
    savingTitle: 'Saving workspace',
    savingAppQuit: 'Saving all runtime data before quitting the application.',
    savingWindowClose: 'Saving the current workspace and conversation state before closing this window.',
    savingDescription: 'Please wait while Adnify completes the shutdown flow.',
    doneTitle: 'Save complete',
    doneMessage: 'The current workspace and conversation data have been saved safely.',
    doneDescription: 'Adnify is finishing the last shutdown steps.',
    errorTitle: 'Save completed with warnings',
    errorMessage: 'Some runtime data may not have been fully persisted.',
    errorDescription: 'Adnify will keep exiting. Please verify recovery after the next launch.',
  },
} as const

function rgb(value: string, alpha = 1): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return `rgba(${normalized.replace(/ /g, ', ')}, ${alpha})`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildState(
  reason: ShutdownReason,
  phase: ShutdownPhase,
  language: ShutdownLanguage
): ShutdownWindowState {
  const copy = COPY[language]

  if (phase === 'done') {
    return {
      phase,
      title: copy.doneTitle,
      message: copy.doneMessage,
      description: copy.doneDescription,
    }
  }

  if (phase === 'error') {
    return {
      phase,
      title: copy.errorTitle,
      message: copy.errorMessage,
      description: copy.errorDescription,
    }
  }

  return {
    phase,
    title: copy.savingTitle,
    message: reason === 'app-quit' ? copy.savingAppQuit : copy.savingWindowClose,
    description: copy.savingDescription,
  }
}

function buildHtml(state: ShutdownWindowState, presentation: ShutdownWindowPresentation): string {
  const payload = JSON.stringify(state)
  const lang = presentation.language === 'zh' ? 'zh-CN' : 'en'

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(state.title)}</title>
    <style>
      :root {
        color-scheme: ${presentation.themeType};
        --bg: ${rgb(presentation.background, 0.96)};
        --card: ${rgb(presentation.surface, 0.94)};
        --border: ${rgb(presentation.border, 0.38)};
        --text: ${rgb(presentation.text)};
        --muted: ${rgb(presentation.muted)};
        --accent: ${rgb(presentation.accent)};
        --accent-soft: ${rgb(presentation.accent, 0.14)};
        --success: ${rgb(presentation.success)};
        --success-soft: ${rgb(presentation.success, 0.14)};
        --warning: ${rgb(presentation.warning)};
        --warning-soft: ${rgb(presentation.warning, 0.14)};
      }
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
      }
      .card {
        width: min(468px, calc(100vw - 28px));
        border-radius: 24px;
        border: 1px solid var(--border);
        background: var(--card);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(18px);
        padding: 28px;
      }
      .row { display: flex; gap: 16px; align-items: flex-start; }
      .icon {
        width: 48px;
        height: 48px;
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        font-size: 22px;
        font-weight: 700;
      }
      .icon.saving { border: 1px solid ${rgb(presentation.accent, 0.28)}; background: var(--accent-soft); color: var(--accent); }
      .icon.done { border: 1px solid ${rgb(presentation.success, 0.28)}; background: var(--success-soft); color: var(--success); }
      .icon.error { border: 1px solid ${rgb(presentation.warning, 0.28)}; background: var(--warning-soft); color: var(--warning); }
      .spinner {
        width: 22px;
        height: 22px;
        border-radius: 999px;
        border: 2px solid ${rgb(presentation.accent, 0.22)};
        border-top-color: var(--accent);
        animation: spin 0.85s linear infinite;
      }
      .title {
        color: var(--text);
        font-size: 15px;
        font-weight: 700;
        line-height: 1.3;
      }
      .message {
        margin-top: 10px;
        color: ${rgb(presentation.text, 0.9)};
        font-size: 14px;
        line-height: 1.7;
      }
      .progress {
        margin-top: 16px;
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: ${rgb(presentation.text, 0.08)};
      }
      .progress-bar {
        height: 100%;
        border-radius: inherit;
        transition: width 220ms ease, background-color 220ms ease;
      }
      .progress-bar.saving {
        width: 34%;
        background: linear-gradient(90deg, ${rgb(presentation.accent, 0.38)}, var(--accent));
        animation: shimmer 1.2s ease-in-out infinite;
      }
      .progress-bar.done { width: 100%; background: var(--success); }
      .progress-bar.error { width: 100%; background: var(--warning); }
      .description {
        margin-top: 12px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes shimmer {
        0% { transform: translateX(-35%); opacity: 0.82; }
        50% { transform: translateX(40%); opacity: 1; }
        100% { transform: translateX(115%); opacity: 0.82; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="row">
        <div id="icon" class="icon saving"><div class="spinner"></div></div>
        <div style="min-width: 0; flex: 1;">
          <div id="title" class="title"></div>
          <div id="message" class="message"></div>
          <div class="progress"><div id="bar" class="progress-bar saving"></div></div>
          <div id="description" class="description"></div>
        </div>
      </div>
    </div>
    <script>
      const icon = document.getElementById('icon');
      const title = document.getElementById('title');
      const message = document.getElementById('message');
      const description = document.getElementById('description');
      const bar = document.getElementById('bar');

      function render(state) {
        title.textContent = state.title;
        message.textContent = state.message;
        description.textContent = state.description;
        icon.className = 'icon ' + state.phase;
        bar.className = 'progress-bar ' + state.phase;

        if (state.phase === 'done') {
          icon.textContent = '✓';
        } else if (state.phase === 'error') {
          icon.textContent = '!';
        } else {
          icon.innerHTML = '<div class="spinner"></div>';
        }
      }

      window.__setShutdownState = render;
      render(${payload});
    </script>
  </body>
</html>`
}

export class ShutdownWindowController {
  private window: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private presentation: ShutdownWindowPresentation = DEFAULT_PRESENTATION
  private reason: ShutdownReason = 'app-quit'

  private getIconPath(): string {
    const platform = process.platform
    if (app.isPackaged) {
      if (platform === 'win32') return path.join(process.resourcesPath, 'icon.ico')
      if (platform === 'darwin') return path.join(process.resourcesPath, 'icon.icns')
      return path.join(process.resourcesPath, 'icon.png')
    }

    if (platform === 'win32') return path.join(app.getAppPath(), 'public/icon.ico')
    if (platform === 'darwin') return path.join(app.getAppPath(), 'resources/icon.icns')
    return path.join(app.getAppPath(), 'public/icon.png')
  }

  private positionWindow(anchor?: BrowserWindow | null): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    const displayBounds = anchor && !anchor.isDestroyed()
      ? anchor.getBounds()
      : screen.getPrimaryDisplay().workArea

    const x = Math.round(displayBounds.x + (displayBounds.width - WINDOW_WIDTH) / 2)
    const y = Math.round(displayBounds.y + (displayBounds.height - WINDOW_HEIGHT) / 2)
    this.window.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
  }

  async show(
    reason: ShutdownReason,
    presentation?: Partial<ShutdownWindowPresentation>,
    anchor?: BrowserWindow | null
  ): Promise<void> {
    this.reason = reason
    this.presentation = { ...DEFAULT_PRESENTATION, ...presentation }
    const state = buildState(reason, 'saving', this.presentation.language)

    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        minWidth: WINDOW_WIDTH,
        minHeight: WINDOW_HEIGHT,
        maxWidth: WINDOW_WIDTH,
        maxHeight: WINDOW_HEIGHT,
        resizable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        movable: false,
        fullscreenable: false,
        frame: false,
        transparent: true,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        roundedCorners: true,
        icon: this.getIconPath(),
        backgroundColor: '#00000000',
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      })

      this.window.on('closed', () => {
        this.window = null
        this.ready = null
      })

      this.positionWindow(anchor)
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(state, this.presentation))}`
      this.ready = this.window.loadURL(dataUrl).then(() => undefined)
      await this.ready
    } else {
      this.positionWindow(anchor)
      await this.update(reason, 'saving', presentation)
    }

    if (this.window && !this.window.isVisible()) {
      this.window.showInactive()
    }
  }

  async update(
    reason: ShutdownReason,
    phase: ShutdownPhase,
    presentation?: Partial<ShutdownWindowPresentation>
  ): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    if (presentation) {
      this.presentation = { ...this.presentation, ...presentation }
    }
    this.reason = reason

    if (this.ready) {
      await this.ready
    }

    const state = buildState(reason, phase, this.presentation.language)
    const payload = JSON.stringify(state)
    await this.window.webContents.executeJavaScript(`window.__setShutdownState(${payload});`, true)
  }

  async close(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    this.window.destroy()
    this.window = null
    this.ready = null
  }
}

export const shutdownWindowController = new ShutdownWindowController()
