import type { EmbeddingConfig, IndexConfig, IndexMode } from './types'
import type { IndexRuntimePaths } from './indexService'

export type IndexProcessOperation =
  | { type: 'initialize'; workspacePath: string; config: Partial<IndexConfig>; paths: IndexRuntimePaths }
  | { type: 'indexWorkspace' | 'hasIndex' | 'getProjectSummary' | 'getProjectSummaryText' | 'clearIndex' | 'testEmbeddingConnection' | 'destroy' }
  | { type: 'search' | 'hybridSearch' | 'searchSymbols'; query: string; topK: number }
  | { type: 'getFileSymbols'; relativePath: string }
  | { type: 'setMode'; mode: IndexMode }
  | { type: 'updateEmbeddingConfig'; config: Partial<EmbeddingConfig> }
  | { type: 'updateFiles'; paths: string[] }
  | { type: 'deleteFileIndex'; path: string }
