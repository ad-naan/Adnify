/**
 * `<webview>` 的类型声明。
 *
 * 只声明预览面板实际用到的成员，而不是 `import type { WebviewTag } from 'electron'`：
 * 渲染进程其余地方都不依赖 electron 的类型，这里也不想为了一个标签把整个
 * electron 类型面引进来。属性名保持 webview 的小写形式（DOM 属性，不是 React prop）。
 */

export interface PreviewWebviewElement extends HTMLElement {
  src: string
  loadURL: (url: string) => Promise<void>
  getURL: () => string
  getTitle: () => string
  reload: () => void
  reloadIgnoringCache: () => void
  stop: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  isLoading: () => boolean
  clearHistory: () => void
  setZoomLevel: (level: number) => void
  getZoomLevel: () => number
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
}

/** did-fail-load 的事件负载。errorCode 是 Chromium 的 net error 码。 */
export interface PreviewWebviewFailLoadEvent extends Event {
  errorCode: number
  errorDescription: string
  validatedURL: string
  isMainFrame: boolean
}

export interface PreviewWebviewNavigateEvent extends Event {
  url: string
}

export interface PreviewWebviewTitleEvent extends Event {
  title: string
  explicitSet: boolean
}

export interface PreviewWebviewFaviconEvent extends Event {
  favicons: string[]
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: boolean
          useragent?: string
          /** ref 拿到的是带 webview 方法的元素 */
          ref?: React.Ref<PreviewWebviewElement>
        },
        PreviewWebviewElement
      >
    }
  }
}
