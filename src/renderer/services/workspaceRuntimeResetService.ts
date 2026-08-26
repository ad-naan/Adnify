import { useStore } from '@store'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { resetLspState } from './lspService'
import { lintService } from '@renderer/agent/services/lintService'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import { clearHealthCache } from './healthCheckService'
import { workspaceStorageRuntime } from './workspaceStorageRuntime'
import {
  suspendAgentStorageWrites,
  resumeAgentStorageWrites,
  markAgentStorageSnapshotAsCurrent,
} from '@renderer/agent/store/agentStorage'
import { workspaceAnalyticsService } from './workspaceAnalyticsService'
import { aiAttributionService } from './aiAttributionService'

export function resetWorkspaceRuntimeState(): void {
  useStore.setState({
    openFiles: [],
    activeFilePath: null,
    expandedFolders: new Set(),
    selectedFolderPath: null,
  })

  suspendAgentStorageWrites()
  try {
  useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      threadMessageVersions: {},
      pendingChanges: [],
      branches: {},
      activeBranchId: {},
      inputPrompt: '',
      currentSessionId: null,
      plans: [],
      activePlanId: null,
      currentTaskId: null,
    })
    markAgentStorageSnapshotAsCurrent(null)
  } finally {
    resumeAgentStorageWrites()
  }

  useStore.getState().clearToolCallLogs()

  resetLspState()
  lintService.clearCache()
  streamingEditService.clearAll()
  clearHealthCache()
  workspaceAnalyticsService.reset()
  aiAttributionService.reset()
  workspaceStorageRuntime.reset()
}
