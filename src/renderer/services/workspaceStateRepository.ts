import { workspaceFiles, type WorkspaceStateData } from './workspaceFileRepository'

class WorkspaceStateRepository {
  get(): Promise<WorkspaceStateData> {
    return workspaceFiles.getWorkspaceState()
  }

  save(state: WorkspaceStateData): Promise<void> {
    return workspaceFiles.saveWorkspaceState(state)
  }
}

export const workspaceStateRepository = new WorkspaceStateRepository()
export type { WorkspaceStateData }
