import { workspaceFiles } from './workspaceFileRepository'

class WorkspaceStorageRuntime {
  initializeRoot(rootPath: string): Promise<boolean> {
    return workspaceFiles.initialize(rootPath)
  }

  async initializeRoots(rootPaths: string[]): Promise<void> {
    await Promise.all(rootPaths.map(rootPath => this.initializeRoot(rootPath)))
  }

  bindPrimaryRoot(rootPath: string): Promise<void> {
    return workspaceFiles.setPrimaryRoot(rootPath)
  }

  isReady(): boolean {
    return workspaceFiles.isInitialized()
  }

  reset(): void {
    workspaceFiles.reset()
  }
}

export const workspaceStorageRuntime = new WorkspaceStorageRuntime()
