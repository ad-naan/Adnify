import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(), act: vi.fn(), openUrl: vi.fn(), restoreSession: vi.fn(), getSession: vi.fn(),
  refresh: vi.fn(), getCandidatesForWorkspace: vi.fn(), analyzeImageSource: vi.fn(),
  state: { activeFilePath: 'preview://session/a', openFiles: [] as Array<{ kind: string; path: string; preview?: { url: string; title: string; sessionId: string } }> },
}))
vi.mock('@/renderer/services/electronAPI', () => ({ api: { preview: { inspect: mocks.inspect, act: mocks.act } } }))
vi.mock('@/renderer/preview/previewSessionService', () => ({ previewSessionService: mocks }))
vi.mock('@/renderer/preview/devServerDiscoveryService', () => ({ devServerDiscoveryService: mocks }))
vi.mock('@/renderer/store', () => ({ useStore: { getState: () => mocks.state } }))
vi.mock('@/renderer/agent/services/imageReadService', () => ({ analyzeImageSource: mocks.analyzeImageSource }))

import { browserToolExecutors } from '@/renderer/agent/tools/executors/browser'
import { TOOL_DEFINITIONS, TOOL_SCHEMAS, TOOL_CONFIGS } from '@shared/config/tools'
import { buildToolRoutingContract } from '@/renderer/agent/prompts/promptContract'

describe('browser agent integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.state.openFiles = []
    mocks.refresh.mockResolvedValue(undefined)
    mocks.getCandidatesForWorkspace.mockReturnValue([{ url: 'http://localhost:5173', status: 'ready', source: 'terminal' }])
    mocks.inspect.mockResolvedValue({ success: true, data: { targets: [] } })
  })

  it('returns live targets, existing tabs and discovered server URLs to the model', async () => {
    mocks.state.openFiles = [{ kind: 'preview', path: 'preview://session/a', preview: { sessionId: 'a', url: 'http://localhost:5173', title: 'App' } }]
    const result = await browserToolExecutors.browser_inspect({ action: 'list' }, { workspacePath: '/repo' })
    const data = JSON.parse(result.result)
    expect(data.openTabs[0]).toMatchObject({ active: true, url: 'http://localhost:5173' })
    expect(data.serverCandidates[0]).toMatchObject({ status: 'ready', source: 'terminal' })
    expect(mocks.refresh).toHaveBeenCalledWith(['/repo'])
  })

  it('reuses an existing tab even when its URL lacks the canonical trailing slash', async () => {
    mocks.state.openFiles = [{ kind: 'preview', path: 'preview://session/a', preview: { sessionId: 'a', url: 'http://localhost:5173', title: 'App' } }]
    mocks.openUrl.mockReturnValue({ id: 'a' })
    mocks.getSession.mockReturnValue({ url: 'http://localhost:5173/', status: 'ready' })
    mocks.inspect.mockResolvedValue({ success: true, data: { targets: [{ id: 10, url: 'http://localhost:5173/', loading: false }] } })
    const result = await browserToolExecutors.browser_open({ url: 'http://localhost:5173/' }, { workspacePath: '/repo' })
    expect(result.success).toBe(true)
    expect(JSON.parse(result.result).target_id).toBe(10)
    expect(mocks.openUrl).toHaveBeenCalledWith('http://localhost:5173', { workspaceRoot: '/repo' })
  })

  it('passes screenshots through image analysis because rich content alone is UI-only', async () => {
    mocks.inspect.mockResolvedValue({ success: true, data: { image: 'base64', mimeType: 'image/jpeg', targetId: 10 } })
    mocks.analyzeImageSource.mockResolvedValue({ success: true, content: 'The button overlaps the heading.' })
    const result = await browserToolExecutors.browser_inspect({ action: 'screenshot', question: 'Does the button overlap?' }, { workspacePath: null })
    expect(result.result).toContain('overlaps')
    expect(result.richContent?.[0].data).toBe('base64')
    expect(mocks.analyzeImageSource).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('Does the button overlap?') }))
  })

  it('preserves the captured image and reports unavailable visual analysis honestly', async () => {
    mocks.inspect.mockResolvedValue({ success: true, data: { image: 'base64', mimeType: 'image/jpeg' } })
    mocks.analyzeImageSource.mockResolvedValue({ success: false, error: 'No model configured' })
    const result = await browserToolExecutors.browser_inspect({ action: 'screenshot' }, { workspacePath: null })
    expect(result.result).toContain('visual analysis is unavailable')
    expect(result.richContent?.[0].data).toBe('base64')
  })

  it('enforces read-only mode at execution even if a hidden caller invokes mutations', async () => {
    for (const context of [{ isSubAgent: true }, { planPhase: 'planning' as const }]) {
      expect((await browserToolExecutors.browser_action({ action: 'click', selector: '#buy' }, { workspacePath: null, ...context })).success).toBe(false)
    }
    expect(mocks.act).not.toHaveBeenCalled()
    const controller = new AbortController()
    controller.abort()
    await expect(browserToolExecutors.browser_action({ action: 'click', selector: '#buy' }, { workspacePath: null, abortSignal: controller.signal })).rejects.toThrow()
    expect(mocks.act).not.toHaveBeenCalled()
  })

  it('registers executable schemas and prevents automatic retries of UI mutations', () => {
    for (const name of Object.keys(browserToolExecutors)) {
      expect(TOOL_DEFINITIONS[name]).toBeDefined()
      expect(TOOL_SCHEMAS[name]).toBeDefined()
    }
    expect(TOOL_CONFIGS.browser_action.retryPolicy?.maxAttempts).toBe(1)
    expect(TOOL_SCHEMAS.browser_inspect.safeParse({ action: 'styles' }).success).toBe(false)
  })

  it('guides proactive browser validation and respects mode-specific capabilities', () => {
    const allowedTools = ['browser_open', 'browser_inspect', 'browser_action']
    const prompt = buildToolRoutingContract({ mode: 'agent', allowedTools })!
    expect(prompt).toContain('After implementing a visible UI or interaction change')
    expect(prompt).toContain('First call browser_inspect(action=list)')
    expect(prompt).toContain('Do not open browser tabs for unrelated backend/CLI changes')
    expect(prompt).toContain('do not submit twice')
    const readOnly = buildToolRoutingContract({ mode: 'plan', planPhase: 'planning', allowedTools: ['browser_inspect'] })!
    expect(readOnly).toContain('browser inspection is read-only')
    expect(readOnly).not.toContain('start the appropriate dev server with run_command')
  })
})
