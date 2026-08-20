/**
 * Vitest 测试环境设置
 * 为所有测试提供全局 mock 和配置
 */

import { vi } from 'vitest'

declare global {
  var mainWindow: any
}

const localStorageStore = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore.set(key, String(value))
  }),
  removeItem: vi.fn((key: string) => {
    localStorageStore.delete(key)
  }),
  clear: vi.fn(() => {
    localStorageStore.clear()
  }),
}

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
})

Object.defineProperty(globalThis, 'self', {
  value: globalThis,
  writable: true,
  configurable: true,
})

// Mock window.electronAPI
const mockElectronAPI: Record<string, unknown> = {
  file: {
    read: vi.fn(),
    readBinary: vi.fn(),
    readRichContent: vi.fn(),
    readImageAnalysis: vi.fn(),
    write: vi.fn(),
    exists: vi.fn(),
    readDir: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn(),
    createDir: vi.fn(),
  },
  llm: {
    send: vi.fn(),
    compactContext: vi.fn(),
  },
  workspace: {
    setActive: vi.fn(),
    getRecent: vi.fn(),
    removeFromRecent: vi.fn(),
  },
  window: {
    close: vi.fn(),
    resize: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
  },
  mcp: {
    initialize: vi.fn(),
    getServersState: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    reconnectServer: vi.fn(),
    callTool: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
    refreshCapabilities: vi.fn(),
    getConfigPaths: vi.fn(),
    reloadConfig: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    toggleServer: vi.fn(),
    startOAuth: vi.fn(),
    finishOAuth: vi.fn(),
    refreshOAuthToken: vi.fn(),
    onServerStatus: vi.fn(() => vi.fn()),
    onToolsUpdated: vi.fn(() => vi.fn()),
    onResourcesUpdated: vi.fn(() => vi.fn()),
    onStateChanged: vi.fn(() => vi.fn()),
    onMcpServerStatus: vi.fn(() => vi.fn()),
    onMcpToolsUpdated: vi.fn(() => vi.fn()),
    onMcpResourcesUpdated: vi.fn(() => vi.fn()),
  },
  index: {
    hybridSearch: vi.fn(),
    getIndexStatus: vi.fn(),
    rebuildIndex: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    set: vi.fn(),
    onChanged: vi.fn(() => vi.fn()),
  },
  terminal: {
    create: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
  },
  lsp: {
    request: vi.fn(),
    onDiagnostics: vi.fn(() => vi.fn()),
    getDiagnostics: vi.fn(),
    hover: vi.fn(),
    completion: vi.fn(),
    signatureHelp: vi.fn(),
    definition: vi.fn(),
    references: vi.fn(),
    codeAction: vi.fn(),
    format: vi.fn(),
    formatRange: vi.fn(),
    documentSymbol: vi.fn(),
    prepareRename: vi.fn(),
    rename: vi.fn(),
    typeDefinition: vi.fn(),
    implementation: vi.fn(),
    inlayHint: vi.fn(),
    prepareCallHierarchy: vi.fn(),
    callHierarchyIncoming: vi.fn(),
    callHierarchyOutgoing: vi.fn(),
    onLspDiagnostics: vi.fn(() => vi.fn()),
    getLspDiagnostics: vi.fn(),
  },
  git: {
    status: vi.fn(),
    diff: vi.fn(),
    log: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
    execSecure: vi.fn(),
  },
}

// 设置全局 window 对象
global.window = {
  electronAPI: mockElectronAPI,
} as any

vi.stubGlobal('self', globalThis)

  // Mock the raw electronAPI that's accessed by the wrapper
  ; (global.window as any).electronAPI = {
    ...mockElectronAPI,
    // Add raw function names that are wrapped
    mcpInitialize: vi.fn(),
    mcpGetServersState: vi.fn(),
    mcpGetAllTools: vi.fn(),
    mcpConnectServer: vi.fn(),
    mcpDisconnectServer: vi.fn(),
    mcpReconnectServer: vi.fn(),
    mcpCallTool: vi.fn(),
    mcpReadResource: vi.fn(),
    mcpGetPrompt: vi.fn(),
    mcpRefreshCapabilities: vi.fn(),
    mcpGetConfigPaths: vi.fn(),
    mcpReloadConfig: vi.fn(),
    mcpAddServer: vi.fn(),
    mcpRemoveServer: vi.fn(),
    mcpToggleServer: vi.fn(),
    mcpStartOAuth: vi.fn(),
    mcpFinishOAuth: vi.fn(),
    mcpRefreshOAuthToken: vi.fn(),
    onMcpServerStatus: vi.fn(() => vi.fn()),
    onMcpToolsUpdated: vi.fn(() => vi.fn()),
    onMcpResourcesUpdated: vi.fn(() => vi.fn()),
    onMcpStateChanged: vi.fn(() => vi.fn()),
    onLspDiagnostics: vi.fn(() => vi.fn()),
    getLspDiagnostics: vi.fn(),
    // File operations
    fileExists: vi.fn(),
    readFile: vi.fn(),
    readBinaryFile: vi.fn(),
    readRichContent: vi.fn(),
    readImageAnalysis: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(async () => true),
    saveFile: vi.fn(),
    mkdir: vi.fn(),
    ensureDir: vi.fn(),
    gitExecSecure: vi.fn(),
    readDir: vi.fn(),
    onFileChanged: vi.fn(() => vi.fn()),
    getUserDataPath: vi.fn(),
    deleteFile: vi.fn(),
    copyFile: vi.fn(),
    renameFile: vi.fn(),
    createTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    killTerminal: vi.fn(),
    getAvailableShells: vi.fn(() => []),
    onTerminalData: vi.fn(() => vi.fn()),
    onTerminalExit: vi.fn(() => vi.fn()),
    onTerminalError: vi.fn(() => vi.fn()),
    onShellOutput: vi.fn(() => vi.fn()),
    indexParseCallGraph: vi.fn(async () => []),
  }

// Mock performance API
global.performance = {
  now: () => Date.now(),
} as any

// Mock crypto.randomUUID if not available
if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
    },
    writable: true,
    configurable: true,
  })
}

// Mock mainWindow for monaco-editor
global.mainWindow = {
  location: {
    href: 'http://localhost:3000',
  },
} as any

// Mock monaco-editor module
vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn(),
    createModel: vi.fn(),
    setTheme: vi.fn(),
  },
  languages: {
    typescript: {
      typescriptDefaults: {
        setCompilerOptions: vi.fn(),
        addExtraLib: vi.fn(),
      },
      javascriptDefaults: {
        setCompilerOptions: vi.fn(),
        addExtraLib: vi.fn(),
      },
    },
  },
}))

// Mock monacoTypeService
vi.mock('@renderer/services/monacoTypeService', () => ({
  clearExtraLibs: vi.fn(),
  addExtraLib: vi.fn(),
}))

// 导出 mock 以便测试中使用
export { mockElectronAPI }
