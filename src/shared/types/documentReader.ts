import type { LLMConfig } from './llm'

export interface DocumentReaderEmbeddedImage {
  displayName: string
  mimeType: string
  data: string
}

export interface ImageAnalysisRequest {
  config: LLMConfig
  prompt?: string
  path?: string
  image?: DocumentReaderEmbeddedImage
}

export interface ImageAnalysisResult {
  success: boolean
  content?: string
  error?: string
  image?: DocumentReaderEmbeddedImage
}

export interface ReadRichContentOptions {
  imageAnalysis?: {
    config: LLMConfig
    prompt?: string
  }
}

export interface RichContentReadResult {
  success: boolean
  content?: string
  error?: string
  contentKind: 'document' | 'text' | 'image' | 'unknown'
  sourceFormat: string
  usedFallback?: boolean
  embeddedImageCount?: number
  embeddedImagesAnalyzed?: number
  imageAnalysisSkippedReason?: string
}
