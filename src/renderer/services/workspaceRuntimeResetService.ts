import { useStore } from '@store'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { resetLspState } from './lspService'
import { clearExtraLibs } from './monacoTypeService'
import { lintService } from '@renderer/agent/services/lintService'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import { clearHealthCache } from './healthCheckService'
import { adnifyDir } from './adnifyDirService'

export function resetWorkspaceRuntimeState(): void {
  useStore.setState({
    openFiles: [],
    activeFilePath: null,
    expandedFolders: new Set(),
    selectedFolderPath: null,
  })

  useAgentStore.setState({
    threads: {},
    currentThreadId: null,
    pendingChanges: [],
    branches: {},
    activeBranchId: {},
    contextStats: null,
    inputPrompt: '',
    currentSessionId: null,
    handoffDocument: null,
  })

  useStore.getState().clearToolCallLogs()

  resetLspState()
  clearExtraLibs()
  lintService.clearCache()
  streamingEditService.clearAll()
  clearHealthCache()
  adnifyDir.reset()
}
