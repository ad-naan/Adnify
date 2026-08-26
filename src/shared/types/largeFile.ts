/** Metadata calculated once when a text buffer is loaded from disk. */
export interface LargeFileInfo {
  path: string
  size: number
  lineCount: number
  isLarge: boolean
  isVeryLarge: boolean
  reason?: 'size' | 'lines' | 'both'
  warning?: string
}
