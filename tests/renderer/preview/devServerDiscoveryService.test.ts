import { beforeEach, describe, expect, it, vi } from 'vitest'

const { probe, readFile, terminalState, outputBuffer, dataListeners } = vi.hoisted(() => ({
  probe: vi.fn(async (_url: string, _timeout?: number) => ({
    ok: true as boolean,
    title: undefined as string | undefined,
    resolvedUrl: undefined as string | undefined,
  })),
  readFile: vi.fn(async (_path: string) => null as string | null),
  terminalState: { terminals: [] as Array<{ id: string; cwd?: string }> },
  outputBuffer: new Map<string, string[]>(),
  dataListeners: new Set<(id: string, data: string) => void>(),
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    preview: { probe: (url: string, timeout?: number) => probe(url, timeout) },
    file: { readFull: (path: string) => readFile(path) },
  },
}))

vi.mock('@/renderer/services/TerminalManager', () => ({
  terminalManager: {
    getState: () => terminalState,
    getOutputBuffer: (id: string) => outputBuffer.get(id) || [],
    onData: (listener: (id: string, data: string) => void) => {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
  },
}))

import { DevServerDiscoveryService } from '@/renderer/preview/devServerDiscoveryService'

function emitTerminalData(id: string, data: string): void {
  for (const listener of dataListeners) listener(id, data)
}

describe('DevServerDiscoveryService', () => {
  let service: DevServerDiscoveryService

  beforeEach(() => {
    probe.mockClear()
    readFile.mockClear()
    readFile.mockResolvedValue(null)
    probe.mockImplementation(async () => ({ ok: true, title: undefined, resolvedUrl: undefined }))
    terminalState.terminals = []
    outputBuffer.clear()
    dataListeners.clear()
    service = new DevServerDiscoveryService()
  })

  it('creates one candidate per port from a noisy dev server log', async () => {
    service.initialize()

    emitTerminalData('t1', [
      '  ➜  Local:   http://localhost:5173/',
      '  ➜  Network: http://127.0.0.1:5173/',
      'GET http://localhost:5173/@vite/client 200',
      'GET http://localhost:5173/src/main.tsx 200',
    ].join('\n'))

    await vi.waitFor(() => expect(probe).toHaveBeenCalled())

    expect(service.getState().candidates).toHaveLength(1)
    expect(service.getState().candidates[0].url).toBe('http://127.0.0.1:5173')
  })

  it('does not re-probe a candidate while the log keeps repeating the address', async () => {
    service.initialize()

    emitTerminalData('t1', 'ready at http://localhost:5173/')
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1))

    for (let i = 0; i < 20; i++) {
      emitTerminalData('t1', `GET http://localhost:5173/asset-${i}.js 200`)
    }

    // 探活有 5s 冷却，这一串日志不应该再触发任何请求。
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('marks a candidate unreachable when the probe fails', async () => {
    probe.mockResolvedValue({ ok: false, title: undefined, resolvedUrl: undefined, error: 'ECONNREFUSED' } as never)
    service.initialize()

    emitTerminalData('t1', 'listening on http://localhost:4000')
    await vi.waitFor(() => expect(service.getState().candidates[0]?.status).toBe('unreachable'))

    expect(service.getState().candidates[0].error).toBe('ECONNREFUSED')
  })

  it('adopts the address the probe actually reached', async () => {
    probe.mockResolvedValue({ ok: true, title: 'My App', resolvedUrl: 'http://localhost:3000' } as never)
    service.initialize()

    emitTerminalData('t1', 'server on http://127.0.0.1:3000')
    await vi.waitFor(() => expect(service.getState().candidates[0]?.status).toBe('ready'))

    expect(service.getState().candidates[0].url).toBe('http://localhost:3000')
    expect(service.getState().candidates[0].title).toBe('My App')
  })

  it('prefers a ready candidate over an unreachable one', async () => {
    probe.mockImplementation(async (url: string) => ({
      ok: url.includes('5173'),
      title: undefined,
      resolvedUrl: undefined,
    }))
    service.initialize()

    emitTerminalData('t1', 'api http://localhost:9999 web http://localhost:5173')
    await vi.waitFor(() => expect(service.getReadyCandidates()).toHaveLength(1))

    expect(service.getPreferredCandidate()?.url).toBe('http://127.0.0.1:5173')
  })

  it('rejects non-local manual urls', () => {
    expect(service.registerManualUrl('https://example.com')).toBeNull()
    expect(service.registerManualUrl('http://localhost:8080')?.url).toBe('http://127.0.0.1:8080')
  })

  it('throttles repeated refresh calls', async () => {
    readFile.mockResolvedValue(JSON.stringify({ devDependencies: { vite: '^5' } }))

    await service.refresh(['/repo'], { force: true })
    const afterFirst = probe.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    await service.refresh(['/repo'])
    expect(probe.mock.calls.length).toBe(afterFirst)
  })

  it('infers framework ports from package.json instead of scanning everything', async () => {
    readFile.mockResolvedValue(JSON.stringify({
      scripts: { dev: 'next dev --port 3100' },
      dependencies: { next: '^15' },
    }))

    await service.refresh(['/repo'], { force: true })

    const probedPorts = probe.mock.calls.map(([url]) => new URL(url).port).sort()
    expect(probedPorts).toEqual(['3000', '3100'])
  })

  it('falls back to common ports for a project with no package.json', async () => {
    await service.refresh(['/repo'], { force: true })
    expect(probe.mock.calls.length).toBeGreaterThan(1)
    expect(probe.mock.calls.some(([url]) => url.endsWith(':5173'))).toBe(true)
  })

  it('scans the existing buffer of terminals opened before discovery started', async () => {
    terminalState.terminals = [{ id: 'restored', cwd: '/repo' }]
    outputBuffer.set('restored', ['ready at http://localhost:7777/\n'])

    await service.refresh([], { force: true })
    await vi.waitFor(() => expect(service.getState().candidates.some((c) => c.url.endsWith(':7777'))).toBe(true))
  })

  it('drops the terminal subscription on dispose', () => {
    service.initialize()
    expect(dataListeners.size).toBe(1)
    service.dispose()
    expect(dataListeners.size).toBe(0)
    expect(service.getState().candidates).toEqual([])
  })
})
