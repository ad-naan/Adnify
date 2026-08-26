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

export const LARGE_FILE_CONFIRM_BYTES = 5 * 1024 * 1024
export const MAX_EDITABLE_TEXT_FILE_BYTES = 50 * 1024 * 1024
export const LARGE_FILE_PAGE_BYTES = 2 * 1024 * 1024
