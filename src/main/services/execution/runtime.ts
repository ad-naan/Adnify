// A small bridge keeps application/window lifetime independent of terminal IPC initialization.
export const executionRuntime = {
  hasHosted: (): boolean => false,
  hosted: (): { jobId: string; command: string; cwd: string }[] => [],
  stopHosted: (_id: string): void => {},
  flush: async (): Promise<void> => {},
  hostedChanged: (): void => {},
  prepareHosting: (): void => {},
  managerRequests: new Set<number>(),
}
