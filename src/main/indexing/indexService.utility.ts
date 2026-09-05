import { net } from 'electron'
import { serveUtility, notifyParent } from '../services/process/utilityServer'
import { CodebaseIndexService } from './indexService'
import type { IndexProcessOperation } from './indexProcessProtocol'

// Preserve the main application's proxy/session behavior for query embeddings.
globalThis.fetch = net.fetch.bind(net) as typeof fetch
let service: CodebaseIndexService | undefined

serveUtility(async raw => {
  const operation = raw as IndexProcessOperation
  if (operation.type === 'initialize') {
    service ??= new CodebaseIndexService(operation.workspacePath, operation.config, operation.paths)
    service.setProgressListener(status => notifyParent(status))
    await service.initialize()
    notifyParent(service.getStatus())
    return service.getStatus()
  }
  if (!service) throw new Error('Index service is not initialized')
  try {
    switch (operation.type) {
      case 'search': return await service.search(operation.query, operation.topK)
      case 'hybridSearch': return await service.hybridSearch(operation.query, operation.topK)
      case 'searchSymbols': return service.searchSymbols(operation.query, operation.topK)
      case 'getFileSymbols': return service.getFileSymbols(operation.relativePath)
      case 'setMode': return await service.setMode(operation.mode)
      case 'updateEmbeddingConfig': return service.updateEmbeddingConfig(operation.config)
      case 'updateFiles': return await service.updateFiles(operation.paths)
      case 'deleteFileIndex': return await service.deleteFileIndex(operation.path)
      case 'indexWorkspace': return await service.indexWorkspace()
      case 'hasIndex': return await service.hasIndex()
      case 'getProjectSummary': return service.getProjectSummary()
      case 'getProjectSummaryText': return service.getProjectSummaryText()
      case 'clearIndex': return await service.clearIndex()
      case 'testEmbeddingConnection': return await service.testEmbeddingConnection()
      case 'destroy': return await service.destroy()
    }
  } finally { notifyParent(service.getStatus()) }
})
