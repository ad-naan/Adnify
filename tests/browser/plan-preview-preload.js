// Browser-only read stubs for components that subscribe to Electron services.
// No execution or filesystem mutation APIs are provided by this preview.
window.electronAPI = {
  getSetting: async () => null,
  onSettingsChanged: () => () => {},
  executionList: async () => ({ jobs: [] }),
  onExecutionChanged: () => () => {},
  listTerminals: async () => ({ sessions: [] }),
  onTerminalData: () => () => {},
  onTerminalExit: () => () => {},
  onTerminalError: () => () => {},
}
