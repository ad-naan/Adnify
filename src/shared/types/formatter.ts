export interface FormatDocumentRequest {
  filePath: string
  content: string
}

export interface FormatDocumentResult {
  status: 'formatted' | 'unavailable' | 'error'
  content?: string
  formatter?: string
  message?: string
}
