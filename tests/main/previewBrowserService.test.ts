import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { PreviewBrowserService } from '@main/services/previewBrowserService'
import { browserActionSchema } from '@shared/preview/browserAutomation'
import { getToolsForContext } from '@shared/config/toolGroups'
import { isBrowserPreviewUrl, isLocalPreviewUrl } from '@shared/preview/discovery'

function contents(id: number, url = 'http://localhost:5173/') {
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: vi.fn(() => true), attach: vi.fn(), detach: vi.fn(),
    sendCommand: vi.fn(async () => ({ result: { value: { visible: true } } })),
  })
  return Object.assign(new EventEmitter(), {
    id, debugger: debuggerApi, getURL: vi.fn(() => url), getTitle: () => 'Preview',
    isDestroyed: vi.fn(() => false), isLoading: () => false, loadURL: vi.fn(async () => {}),
  })
}

function setup() {
  const service = new PreviewBrowserService()
  const owner = contents(1), guest = contents(10)
  service.register(owner as unknown as WebContents, guest as unknown as WebContents)
  return { service, owner, guest }
}

describe('preview browser boundary', () => {
  it('isolates targets by owning window and rejects guessing another guest ID', async () => {
    const { service, guest } = setup()
    expect(service.list(2)).toEqual([])
    await expect(service.act(2, { action: 'click', target_id: 10, selector: '#pay' })).rejects.toThrow('another window')
    expect(guest.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('rejects unsafe protocols before dispatch and stale targets after destruction', async () => {
    const { service, guest } = setup()
    await expect(service.act(1, { action: 'navigate', url: 'file:///etc/passwd' })).rejects.toThrow('HTTP(S)')
    expect(guest.loadURL).not.toHaveBeenCalled()
    guest.emit('destroyed')
    expect(service.list(1)).toEqual([])
    await expect(service.inspect(1, { action: 'dom', target_id: 10 })).rejects.toThrow('closed')
  })

  it('allows external websites without expanding the local discovery boundary', async () => {
    const { service, guest } = setup()
    await service.act(1, { action: 'navigate', url: 'https://example.com/page' })
    expect(guest.loadURL).toHaveBeenCalledWith('https://example.com/page')
    guest.getURL.mockReturnValue('https://example.com/page')
    await expect(service.inspect(1, { action: 'dom' })).resolves.toMatchObject({ targetId: 10 })
    expect(isBrowserPreviewUrl('https://example.com/page')).toBe(true)
    expect(isLocalPreviewUrl('https://example.com/page')).toBe(false)
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a', 'https://user:password@example.com', 'mailto:a@b.com']) {
      expect(isBrowserPreviewUrl(url)).toBe(false)
    }
  })

  it('does not silently choose between multiple mounted previews', async () => {
    const { service, owner } = setup()
    service.register(owner as unknown as WebContents, contents(11) as unknown as WebContents)
    await expect(service.inspect(1, { action: 'dom' })).rejects.toThrow('Multiple')
  })

  it('retains bounded diagnostics including network URLs and runtime stacks', async () => {
    const { service, guest } = setup()
    for (let i = 0; i < 210; i++) guest.debugger.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log', args: [{ value: i }] })
    guest.debugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'r', request: { url: 'http://localhost:5173/api' } })
    guest.debugger.emit('message', {}, 'Network.loadingFailed', { requestId: 'r', errorText: 'net::ERR_CONNECTION_RESET' })
    guest.debugger.emit('message', {}, 'Runtime.exceptionThrown', { exceptionDetails: { exception: { description: 'Error: crash\n at app.js:10' } } })
    const result = await service.inspect(1, { action: 'diagnostics', limit: 200 }) as { records: Array<{ kind: string; url?: string; message: string }> }
    expect(result.records).toHaveLength(200)
    expect(result.records.at(-2)).toMatchObject({ kind: 'network-error', url: 'http://localhost:5173/api' })
    expect(result.records.at(-1)?.message).toContain('app.js:10')
  })

  it('surfaces page evaluation errors and releases the action lock', async () => {
    const { service, guest } = setup()
    guest.debugger.sendCommand.mockResolvedValueOnce({ exceptionDetails: { text: 'Selector is ambiguous' } } as never)
    await expect(service.act(1, { action: 'click', selector: 'button' })).rejects.toThrow('ambiguous')
    await expect(service.act(1, { action: 'navigate', url: 'http://localhost:5173/next' })).resolves.toMatchObject({ action: 'navigate' })
  })

  it('rejects overlapping actions instead of double submitting', async () => {
    const { service, guest } = setup()
    let finish!: () => void
    guest.loadURL.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const first = service.act(1, { action: 'navigate', url: 'http://localhost:5173/next' })
    await expect(service.act(1, { action: 'click', selector: '#submit' })).rejects.toThrow('busy')
    finish()
    await first
  })

  it('rejects malformed operations while allowing an empty fill value', () => {
    expect(browserActionSchema.safeParse({ action: 'fill', selector: 'input' }).success).toBe(false)
    expect(browserActionSchema.safeParse({ action: 'fill', selector: 'input', text: '' }).success).toBe(true)
    expect(browserActionSchema.safeParse({ action: 'navigate', url: 'http://localhost', target_id: -1 }).success).toBe(false)
    expect(browserActionSchema.safeParse({ action: 'evaluate', text: 'process.exit()' }).success).toBe(false)
  })

  it('makes inspection discoverable but withholds mutations during planning and delegation', () => {
    expect(getToolsForContext({ mode: 'agent' })).toEqual(expect.arrayContaining(['browser_open', 'browser_inspect', 'browser_action']))
    for (const context of [{ mode: 'plan' as const, planPhase: 'planning' as const }, { mode: 'agent' as const, isSubAgent: true }]) {
      const tools = getToolsForContext(context)
      expect(tools).toContain('browser_inspect')
      expect(tools).not.toContain('browser_action')
      expect(tools).not.toContain('browser_open')
    }
  })
})
