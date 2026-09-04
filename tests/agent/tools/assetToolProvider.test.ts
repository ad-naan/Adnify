import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetCapability, AssetSnapshot } from '@/shared/types/assets'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/renderer/services/assetService', () => ({ assetService: { request } }))
import { AssetToolProvider } from '@/renderer/agent/tools/providers/AssetToolProvider'

const cap: AssetCapability = {
  id: 'poster', revision: 1, name: 'Poster', description: 'Create a poster', enabled: true, kind: 'image',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
  request: { url: 'https://example.test/generate', body: { prompt: { $input: '/prompt' } } },
  output: { itemsPath: '/images', urlPath: '/url', mimeType: 'image/png', allowedOrigins: [], maxFileMB: 10 },
}
let provider: AssetToolProvider
afterEach(() => { vi.useRealTimers() })
beforeEach(async () => {
  request.mockReset()
  Object.assign(window.electronAPI, { assetRequest: vi.fn() })
  request.mockResolvedValue({ capabilities: [cap] } as AssetSnapshot)
  provider = new AssetToolProvider()
  await provider.refresh()
})
describe('dynamic asset tools', () => {
  it('derives a typed tool and never makes generation read-only or retryable', () => {
    const definition = provider.getToolDefinitions().find(d => d.name === 'asset__poster__r1')!
    expect(definition.parameters.required).toEqual(['prompt'])
    expect(provider.getMetadata(definition.name)?.approvalType).toBe('dangerous')
    expect(provider.getMetadata(definition.name)?.retryPolicy?.maxAttempts).toBe(1)
    expect(provider.validateArgs(definition.name, { wrong: 'x' }).valid).toBe(false)
    expect(provider.validateArgs(definition.name, { prompt: 'x', _meta: { ui: true } }).valid).toBe(true)
    expect(provider.getToolDefinitions().some(d => d.name === 'asset_job_wait')).toBe(false)
    expect(definition.description).not.toContain('use asset_job_wait')
  })
  it('does not expose generation or export in planning or hidden read-only agents', () => {
    provider.setContext({ mode: 'plan', planPhase: 'planning' })
    expect(provider.getToolDefinitions().map(d => d.name)).toEqual(['asset_capabilities', 'asset_job_get'])
    provider.setContext({ mode: 'agent', isSubAgent: true })
    expect(provider.getToolDefinitions().some(d => d.name.startsWith('asset__'))).toBe(false)
  })
  it('rejects generation without approval before calling IPC', async () => {
    request.mockClear()
    await expect(provider.execute('asset__poster__r1', { prompt: 'x' }, { workspacePath: '/project', toolCallId: 'call' })).rejects.toThrow('approval')
    expect(request).not.toHaveBeenCalled()
  })
  it('enforces planning restrictions at execution, independently of the mutable display context', async () => {
    provider.setContext({ mode: 'agent' })
    await expect(provider.execute('asset_import', { path: 'image.png' }, { workspacePath: '/project', chatMode: 'plan', planPhase: 'planning' })).rejects.toThrow('unavailable')
  })
  it('preserves the call identity, strips UI metadata and returns a job card', async () => {
    request.mockResolvedValue({ id: 'job-1', state: 'ready', capabilityName: 'Poster', assetIds: ['image-1'] })
    const result = await provider.execute('asset__poster__r1', { prompt: 'x', _meta: { ui: true } }, {
      workspacePath: '/project', threadId: 'thread', toolCallId: 'call',
      securityApproval: { requestId: 'request', toolCallId: 'call', scope: 'tool', approvedAt: Date.now() },
    })
    expect(request).toHaveBeenLastCalledWith({ type: 'submit', capabilityId: 'poster', revision: 1, inputs: { prompt: 'x' }, toolCallId: 'call', threadId: 'thread' })
    expect(JSON.parse(result.result).state).toBe('ready')
    expect(result.richContent).toEqual([{ type: 'asset-job', jobId: 'job-1' }])
  })
  it('keeps one generation call running through progress revisions until assets are ready', async () => {
    vi.useFakeTimers()
    const initial = { id: 'job-1', state: 'queued', revision: 1, capabilityName: 'Poster', assetIds: [] }
    request.mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, state: 'running', revision: 2 })
      .mockResolvedValueOnce({ ...initial, state: 'ready', revision: 3, assetIds: ['image-1'] })
    const onProgress = vi.fn()
    let settled = false
    const pending = provider.execute('asset__poster__r1', { prompt: 'x' }, {
      workspacePath: '/project', toolCallId: 'call', onProgress,
      securityApproval: { requestId: 'request', toolCallId: 'call', scope: 'tool', approvedAt: Date.now() },
    }).then(result => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(2000)
    expect(settled).toBe(false)
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ meta: { assetJobId: 'job-1', assetKind: 'image', assetName: 'Poster' }, richContent: [{ type: 'asset-job', jobId: 'job-1' }] }))
    await vi.advanceTimersByTimeAsync(2000)
    const result = await pending
    expect(result.success).toBe(true)
    expect(JSON.parse(result.result).assetIds).toEqual(['image-1'])
    expect(request.mock.calls.filter(([action]) => action.type === 'submit')).toHaveLength(1)
    expect(result.meta?.assetJobId).toBe('job-1')
  })
  it('stops waiting promptly on abort without cancelling or resubmitting the persistent job', async () => {
    vi.useFakeTimers()
    request.mockResolvedValue({ id: 'job-1', state: 'submitting', capabilityName: 'Poster', assetIds: [] })
    const controller = new AbortController()
    const pending = provider.execute('asset__poster__r1', { prompt: 'x' }, {
      workspacePath: '/project', toolCallId: 'call', abortSignal: controller.signal,
      securityApproval: { requestId: 'request', toolCallId: 'call', scope: 'tool', approvedAt: Date.now() },
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    const result = await pending
    expect(result.success).toBe(false)
    expect(result.richContent).toEqual([{ type: 'asset-job', jobId: 'job-1' }])
    expect(result.error).toContain('job is retained')
    expect(request.mock.calls.filter(([action]) => ['cancel', 'job'].includes(action.type))).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('returns terminal failures with the same card and forbids automatic regeneration', async () => {
    request.mockResolvedValue({ id: 'job-1', state: 'failed', capabilityName: 'Poster', error: 'Invalid model', assetIds: [] })
    const result = await provider.execute('asset__poster__r1', { prompt: 'x' }, {
      workspacePath: '/project', toolCallId: 'call',
      securityApproval: { requestId: 'request', toolCallId: 'call', scope: 'tool', approvedAt: Date.now() },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid model')
    expect(result.error).toContain('Do not automatically resubmit')
    expect(result.outcome?.retryable).toBe(false)
    expect(result.richContent).toEqual([{ type: 'asset-job', jobId: 'job-1' }])
  })
  it('keeps old schema identities when configuration refreshes', async () => {
    request.mockResolvedValue({ capabilities: [{ ...cap, revision: 2 }] })
    await provider.refresh()
    expect(provider.hasTool('asset__poster__r1')).toBe(true)
    expect(provider.getToolDefinitions().some(d => d.name === 'asset__poster__r2')).toBe(true)
    expect(provider.getToolDefinitions().some(d => d.name === 'asset__poster__r1')).toBe(false)
  })
})
