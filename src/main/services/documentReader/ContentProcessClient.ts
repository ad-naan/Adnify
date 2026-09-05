import { join } from 'node:path'
import { UtilityProcessClient } from '../process/UtilityProcessClient'
import type { DocumentReaderEmbeddedImage, RichContentReadResult } from '@shared/types'
import type { ReadRichContentInternalOptions } from './richContentReader'
import type { ASTParser } from '../../indexing/astParser'

export interface ImageMetadata { format?: string; width?: number; height?: number }
export type ContentOperation =
  | { type: 'document'; path: string; analyzeImages: boolean; skipImageAnalysisReason?: string }
  | { type: 'imageMetadata'; bytes: Uint8Array }
  | { type: 'imagePreview'; path: string }
  | { type: 'callGraph'; path: string; content: string }

export class ContentProcessClient {
  private client = new UtilityProcessClient({
    entry: join(__dirname, 'content.utility.js'), name: 'Adnify Content Tools', timeoutMs: 120_000, idleMs: 60_000,
  })
  readRichContent(targetPath: string, options: ReadRichContentInternalOptions = {}): Promise<RichContentReadResult> {
    return this.client.request({
      type: 'document', path: targetPath, analyzeImages: !!options.embeddedImageAnalyzer,
      skipImageAnalysisReason: options.skipImageAnalysisReason,
    } satisfies ContentOperation, {
      timeoutMs: options.embeddedImageAnalyzer ? 15 * 60_000 : 120_000,
      onEvent: event => options.embeddedImageAnalyzer!(event as DocumentReaderEmbeddedImage),
    })
  }
  imageMetadata(bytes: Uint8Array): Promise<ImageMetadata> {
    return this.client.request({ type: 'imageMetadata', bytes } satisfies ContentOperation)
  }
  imagePreview(targetPath: string): Promise<string> {
    return this.client.request({ type: 'imagePreview', path: targetPath } satisfies ContentOperation)
  }
  parseCallGraph(targetPath: string, content: string): ReturnType<ASTParser['parseCallGraph']> {
    return this.client.request({ type: 'callGraph', path: targetPath, content } satisfies ContentOperation)
  }
}
export const contentProcess = new ContentProcessClient()
