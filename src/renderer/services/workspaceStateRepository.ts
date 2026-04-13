import { adnifyDir, type WorkspaceStateData } from './adnifyDirService'

class WorkspaceStateRepository {
  get(): Promise<WorkspaceStateData> {
    return adnifyDir.getWorkspaceState()
  }

  save(state: WorkspaceStateData): Promise<void> {
    return adnifyDir.saveWorkspaceState(state)
  }

  flush(): Promise<void> {
    return adnifyDir.flush()
  }
}

export const workspaceStateRepository = new WorkspaceStateRepository()
export type { WorkspaceStateData }
