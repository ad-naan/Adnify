import type { IpcMainInvokeEvent } from 'electron'
import type Store from 'electron-store'

export interface WorkspaceSession {
  roots: string[]
}

export interface WorkspaceContextOptions {
  getWindowWorkspace?: (windowId: number) => string[] | null
  workspaceMetaStore: Store<Record<string, unknown>>
}

/**
 * Resolve workspace roots for an IPC request.
 * Prefers the sender window's workspace; falls back to last saved session.
 */
export function resolveWorkspaceFromEvent(
  event: IpcMainInvokeEvent | undefined,
  options: WorkspaceContextOptions,
): WorkspaceSession | null {
  const { getWindowWorkspace, workspaceMetaStore } = options

  if (event && getWindowWorkspace) {
    const windowRoots = getWindowWorkspace(event.sender.id)
    // An explicitly empty window must not inherit another window's saved roots.
    if (windowRoots) {
      return { roots: windowRoots }
    }
  }

  return workspaceMetaStore.get('lastWorkspaceSession') as WorkspaceSession | null
}
