import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  credential: null as null | {
    accessToken: string
    refreshToken: string
    expiresAt: number
    accountID?: string
    email?: string
    planType?: string
  },
}))

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}))

vi.mock('@shared/utils/Logger', () => ({
  logger: {
    security: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}))

vi.mock('@main/services/credentials/ProviderCredentialStore', () => ({
  ProviderCredentialStore: {
    getOAuth: vi.fn(() => state.credential ? { ...state.credential } : null),
    setOAuth: vi.fn((_providerId: string, credential: typeof state.credential) => {
      state.credential = credential ? { ...credential } : null
    }),
    clear: vi.fn(() => { state.credential = null }),
  },
}))

import { OpenAIAuthService } from '@main/services/openai/OpenAIAuthService'

describe('OpenAIAuthService refresh lifecycle', () => {
  beforeEach(() => {
    state.credential = {
      accessToken: 'expired-access',
      refreshToken: 'refresh-token',
      expiresAt: 0,
      accountID: 'account-1',
      planType: 'plus',
    }
    vi.restoreAllMocks()
  })

  it('coalesces concurrent refreshes and preserves a refresh token omitted by the server', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'fresh-access',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([
      OpenAIAuthService.getValidToken(),
      OpenAIAuthService.getValidToken(),
    ])

    expect(first).toBe('fresh-access')
    expect(second).toBe('fresh-access')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.credential).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'refresh-token',
      accountID: 'account-1',
      planType: 'plus',
    })
  })

  it('keeps the session after a transient refresh failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))

    await expect(OpenAIAuthService.getValidToken()).rejects.toThrow('Token refresh failed: 503')
    expect(state.credential).toMatchObject({ refreshToken: 'refresh-token' })
  })

  it('clears the session only when the refresh credential is permanently rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'invalid_grant',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })))

    await expect(OpenAIAuthService.getValidToken()).resolves.toBeNull()
    expect(state.credential).toBeNull()
  })
})
