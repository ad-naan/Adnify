import pLimit from 'p-limit'
import { serveUtility } from '../process/utilityServer'
import { readRichContent } from './richContentReader'
import { ASTParser } from '../../indexing/astParser'
import type { ContentOperation } from './ContentProcessClient'

const limit = pLimit(2)
const astLimit = pLimit(1)
let parser: ASTParser | undefined
serveUtility((raw, askParent) => limit(async () => {
  const operation = raw as ContentOperation
  switch (operation.type) {
    case 'document': return readRichContent(operation.path, {
      skipImageAnalysisReason: operation.skipImageAnalysisReason,
      embeddedImageAnalyzer: operation.analyzeImages ? async image => String(await askParent(image)) : undefined,
    })
    case 'callGraph': return astLimit(async () => {
      parser ??= new ASTParser()
      await parser.init()
      return parser.parseCallGraph(operation.path, operation.content)
    })
    case 'imageMetadata': {
      // Keep sharp's CommonJS entry; its native binaries stay external to the bundle.
      const sharp = require('sharp') as typeof import('sharp').default
      const metadata = await sharp(Buffer.from(operation.bytes)).metadata()
      return { format: metadata.format, width: metadata.width, height: metadata.height }
    }
    case 'imagePreview': {
      const sharp = require('sharp') as typeof import('sharp').default
      const bytes = await sharp(operation.path).resize(960, 960, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
      return `data:image/webp;base64,${bytes.toString('base64')}`
    }
  }
}))
