import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { adnifyDir } from './adnifyDirService'
import { toAppError } from '@shared/utils/errorHandler'
import { resetWorkspaceRuntimeState } from './workspaceRuntimeResetService'
import { loadWorkspace } from './workspaceLoadService'
import type { WorkspaceConfig } from '@store'

function normalizeWorkspaceRoots(roots: string[]): string[] {
  return roots.map(root => root.toLowerCase().replace(/\\/g, '/')).sort()
}

function isSameWorkspace(a: WorkspaceConfig | null, b: WorkspaceConfig | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.roots.length !== b.roots.length) return false

  const aRoots = normalizeWorkspaceRoots(a.roots)
  const bRoots = normalizeWorkspaceRoots(b.roots)

  return aRoots.every((root, index) => root === bRoots[index])
}

class WorkspaceManager {
  private switching = false

  getCurrentWorkspacePath(): string | null {
    return useStore.getState().workspacePath
  }

  getCurrentWorkspace(): WorkspaceConfig | null {
    return useStore.getState().workspace
  }

  isSwitching(): boolean {
    return this.switching
  }

  async switchTo(newWorkspace: WorkspaceConfig): Promise<boolean> {
    if (this.switching) {
      logger.system.warn('[WorkspaceManager] Already switching, ignoring request')
      return false
    }

    const oldWorkspace = this.getCurrentWorkspace()
    if (isSameWorkspace(oldWorkspace, newWorkspace)) {
      logger.system.info('[WorkspaceManager] Same workspace, skipping switch')
      return true
    }

    this.switching = true
    logger.system.info('[WorkspaceManager] Switching workspace:', {
      from: oldWorkspace?.roots[0] || 'none',
      to: newWorkspace.roots[0] || 'none',
    })

    try {
      const redirected = await this.handleWorkspaceRedirection(newWorkspace)
      if (redirected) {
        api.window.close()
        return false
      }

      await this.saveCurrentWorkspace()
      this.resetRuntimeState()
      await this.loadWorkspace(newWorkspace)

      if (!oldWorkspace || oldWorkspace.roots.length === 0) {
        await api.window.resize(1600, 1000, 1200, 700)
      }

      logger.system.info('[WorkspaceManager] Switch completed successfully')
      return true
    } catch (err) {
      const error = toAppError(err)
      logger.system.error(`[WorkspaceManager] Switch failed: ${error.code}`, error)

      if (oldWorkspace) {
        try {
          await this.loadWorkspace(oldWorkspace)
        } catch {
          this.resetRuntimeState()
        }
      }

      return false
    } finally {
      this.switching = false
    }
  }

  async openFolder(folderPath: string): Promise<boolean> {
    const exists = await api.file.exists(folderPath)
    if (!exists) {
      await api.workspace.removeFromRecent(folderPath)
      throw new Error(`Folder does not exist: ${folderPath}`)
    }

    return this.switchTo({
      configPath: null,
      roots: [folderPath],
    })
  }

  async closeWorkspace(): Promise<void> {
    await this.saveCurrentWorkspace()
    this.resetRuntimeState()

    const { setWorkspace, setFiles } = useStore.getState()
    setWorkspace(null)
    setFiles([])

    adnifyDir.reset()
  }

  async addFolder(folderPath: string): Promise<void> {
    const { addRoot } = useStore.getState()
    addRoot(folderPath)
    await adnifyDir.initialize(folderPath)
  }

  removeFolder(folderPath: string): void {
    const { removeRoot } = useStore.getState()
    removeRoot(folderPath)
  }

  private async handleWorkspaceRedirection(workspace: WorkspaceConfig): Promise<boolean> {
    if (workspace.roots.length === 0) return false

    const result = await api.workspace.setActive(workspace.roots)
    if (result && typeof result === 'object' && 'redirected' in result) {
      logger.system.info('[WorkspaceManager] Workspace already open in another window, closing this window')
      return true
    }

    return false
  }

  private async saveCurrentWorkspace(): Promise<void> {
    if (!adnifyDir.isInitialized()) return

    logger.system.info('[WorkspaceManager] Saving current workspace data...')
    await adnifyDir.flush()
  }

  private resetRuntimeState(): void {
    logger.system.info('[WorkspaceManager] Resetting runtime state...')
    resetWorkspaceRuntimeState()
  }

  private async loadWorkspace(workspace: WorkspaceConfig): Promise<void> {
    await loadWorkspace(workspace)
  }
}

export const workspaceManager = new WorkspaceManager()
