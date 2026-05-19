import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SyncService } from '@main/services/llm/services/SyncService'
import type {
  DocumentReaderEmbeddedImage,
  ImageAnalysisRequest,
  ImageAnalysisResult,
} from '@shared/types'

const DEFAULT_IMAGE_ANALYSIS_PROMPT = `Analyze this image and return a compact Markdown report with exactly these headings:

### Image Overview
### OCR / Visible Text
### Key Details
### Relevant Observations

Rules:
- Focus on visible information only.
- Include OCR text when present.
- For UI screenshots, mention layout and notable controls.
- For charts/tables/doc scans, summarize the data-bearing parts clearly.
- If a section has no useful information, write "None".`

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export async function analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResult> {
  try {
    const image = request.image ?? await loadImageFromPath(request.path)
    const syncService = new SyncService()
    const response = await syncService.generate({
      config: request.config,
      systemPrompt: DEFAULT_IMAGE_ANALYSIS_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: request.prompt?.trim()
                || `Analyze the image "${image.displayName}" and extract the most useful visual details.`,
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mimeType,
                data: image.data,
              },
            },
          ],
        },
      ],
    })

    return {
      success: true,
      content: response.data.trim(),
      image,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function loadImageFromPath(targetPath: string | undefined): Promise<DocumentReaderEmbeddedImage> {
  const absolutePath = path.resolve(String(targetPath ?? ''))
  const stats = await fs.stat(absolutePath)
  if (!stats.isFile()) {
    throw new Error(`Image file not found: ${absolutePath}`)
  }
  const data = await fs.readFile(absolutePath)
  const extension = path.extname(absolutePath).replace('.', '').toLowerCase()
  return {
    displayName: path.basename(absolutePath),
    mimeType: MIME_TYPES[extension] || 'image/png',
    data: data.toString('base64'),
  }
}
