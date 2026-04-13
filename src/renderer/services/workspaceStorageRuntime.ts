import { adnifyDir } from './adnifyDirService'

class WorkspaceStorageRuntime {
  initializeRoot(rootPath: string): Promise<boolean> {
    return adnifyDir.initialize(rootPath)
  }

  async initializeRoots(rootPaths: string[]): Promise<void> {
    await Promise.all(rootPaths.map(rootPath => this.initializeRoot(rootPath)))
  }

  bindPrimaryRoot(rootPath: string): Promise<void> {
    return adnifyDir.setPrimaryRoot(rootPath)
  }

  isReady(): boolean {
    return adnifyDir.isInitialized()
  }

  flush(): Promise<void> {
    return adnifyDir.flush()
  }

  reset(): void {
    adnifyDir.reset()
  }
}

export const workspaceStorageRuntime = new WorkspaceStorageRuntime()
