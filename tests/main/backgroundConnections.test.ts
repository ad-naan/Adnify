import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkModelEndpoint } from '@main/services/backgroundTasks/checkConnections'
import { normalizeBackgroundTaskSettings } from '@shared/types/backgroundTasks'

afterEach(() => vi.unstubAllGlobals())

describe('wake connection probes', () => {
  it('sends no credentials, strips query tokens, and never follows redirects', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    expect(await checkModelEndpoint({ provider: 'custom', baseUrl: 'https://example.test/v1?key=secret#token' })).toBe('reachable')
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe('https://example.test/v1')
    expect(init.method).toBe('HEAD')
    expect(init.redirect).toBe('manual')
    expect(init.credentials).toBe('omit')
    expect(init.cache).toBe('no-store')
    expect(init.headers).toBeUndefined()
    expect(init.body).toBeUndefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each(['file:///secret', 'https://user:secret@example.test', 'invalid'])('rejects unsafe endpoint %s without a network request', async baseUrl => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await checkModelEndpoint({ provider: 'custom', baseUrl })).toBe('unreachable')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('distinguishes missing configuration from an unavailable network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await checkModelEndpoint(undefined)).toBe('unconfigured')
    expect(await checkModelEndpoint({ provider: 'custom', baseUrl: 'http://localhost:1234' })).toBe('unreachable')
  })

  it('requires an explicit boolean to opt in to sleep prevention', () => {
    expect(normalizeBackgroundTaskSettings({ preventIdleSleep: 'true' }).preventIdleSleep).toBe(false)
    expect(normalizeBackgroundTaskSettings({ preventIdleSleep: true }).preventIdleSleep).toBe(true)
  })
})
