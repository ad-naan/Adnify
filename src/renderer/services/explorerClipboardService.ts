export interface ExplorerClipboardItem {
  path: string
  name: string
  isDirectory: boolean
  copiedAt: number
}

interface ExplorerClipboardState {
  item: ExplorerClipboardItem | null
}

type Listener = (state: ExplorerClipboardState) => void

class ExplorerClipboardService {
  private state: ExplorerClipboardState = { item: null }
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): ExplorerClipboardState {
    return this.state
  }

  setItem(item: ExplorerClipboardItem | null): void {
    this.state = { item }
    this.emit()
  }

  clear(): void {
    if (!this.state.item) return
    this.state = { item: null }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

export const explorerClipboardService = new ExplorerClipboardService()
