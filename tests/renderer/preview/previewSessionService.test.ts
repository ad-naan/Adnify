import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storeState, openPreview, updatePreviewMetadata } = vi.hoisted(() => {
  const openPreview = vi.fn()
  const updatePreviewMetadata = vi.fn()
  return {
    openPreview,
    updatePreviewMetadata,
    storeState: { openPreview, updatePreviewMetadata },
  }
})

vi.mock('@store', () => ({
  useStore: { getState: () => storeState },
}))

vi.mock('@/renderer/preview/devServerDiscoveryService', () => ({
  devServerDiscoveryService: {
    refresh: vi.fn(async () => {}),
    getPreferredCandidate: vi.fn(() => null),
  },
}))

import { PreviewSessionService } from '@/renderer/preview/previewSessionService'

describe('PreviewSessionService', () => {
  let service: PreviewSessionService

  beforeEach(() => {
    openPreview.mockClear()
    updatePreviewMetadata.mockClear()
    service = new PreviewSessionService()
  })

  it('reuses the existing session when the same url is opened twice', () => {
    const first = service.openUrl('http://127.0.0.1:5173')
    const second = service.openUrl('http://127.0.0.1:5173')

    expect(second.id).toBe(first.id)
    expect(service.getState().sessions).toHaveLength(1)
  })

  it('releases the session on dispose so the same url gets a fresh one', () => {
    const first = service.openUrl('http://127.0.0.1:5173')
    service.disposeSession(first.id)

    expect(service.getState().sessions).toHaveLength(0)

    const second = service.openUrl('http://127.0.0.1:5173')
    expect(second.id).not.toBe(first.id)
    expect(second.reloadToken).toBe(0)
  })

  it('prunes sessions whose tabs are gone', () => {
    const kept = service.openUrl('http://127.0.0.1:5173')
    service.openUrl('http://127.0.0.1:3000')
    expect(service.getState().sessions).toHaveLength(2)

    service.pruneSessions([kept.id])

    expect(service.getState().sessions.map((session) => session.id)).toEqual([kept.id])
  })

  it('remaps the url index on navigate so the old address no longer matches', () => {
    const session = service.openUrl('http://127.0.0.1:5173')
    service.navigate(session.id, 'http://127.0.0.1:4173')

    // 旧地址不该再复用这个会话
    const reopened = service.openUrl('http://127.0.0.1:5173')
    expect(reopened.id).not.toBe(session.id)
    // 新地址应该命中它
    expect(service.openUrl('http://127.0.0.1:4173').id).toBe(session.id)
  })

  it('navigate resets error state and marks loading', () => {
    const session = service.openUrl('http://127.0.0.1:5173')
    service.markStatus(session.id, 'error', 'boom', -102)
    expect(service.getSession(session.id)?.lastErrorCode).toBe(-102)

    service.navigate(session.id, 'http://127.0.0.1:5173/about')

    const next = service.getSession(session.id)!
    expect(next.status).toBe('loading')
    expect(next.lastError).toBeUndefined()
    expect(next.lastErrorCode).toBeUndefined()
  })

  it('syncNavigated records the guest url without touching status or reloadToken', () => {
    const session = service.openUrl('http://127.0.0.1:5173')
    service.markStatus(session.id, 'ready')

    service.syncNavigated(session.id, 'http://127.0.0.1:5173/deep/link')

    const next = service.getSession(session.id)!
    expect(next.url).toBe('http://127.0.0.1:5173/deep/link')
    expect(next.status).toBe('ready')
    expect(next.reloadToken).toBe(session.reloadToken)
    expect(updatePreviewMetadata).toHaveBeenCalledWith(
      `preview://session/${session.id}`,
      { url: 'http://127.0.0.1:5173/deep/link' },
    )
  })

  it('reload bumps reloadToken and clears the previous error', () => {
    const session = service.openUrl('http://127.0.0.1:5173')
    service.markStatus(session.id, 'error', 'boom', -102)

    service.reload(session.id)

    const next = service.getSession(session.id)!
    expect(next.reloadToken).toBe(1)
    expect(next.status).toBe('loading')
    expect(next.lastError).toBeUndefined()
  })

  it('ignores implicit titles and empty updates', () => {
    const session = service.openUrl('http://127.0.0.1:5173', { title: 'Preview 127.0.0.1:5173' })

    service.updateTitle(session.id, '   ')
    expect(service.getSession(session.id)?.title).toBe('Preview 127.0.0.1:5173')

    service.updateTitle(session.id, 'My App')
    expect(service.getSession(session.id)?.title).toBe('My App')
    expect(updatePreviewMetadata).toHaveBeenCalledWith(
      `preview://session/${session.id}`,
      { title: 'My App' },
    )
  })

  it('tracks navigation availability for the toolbar buttons', () => {
    const session = service.openUrl('http://127.0.0.1:5173')
    expect(service.getSession(session.id)?.canGoBack).toBe(false)

    service.updateNavigationState(session.id, { canGoBack: true, canGoForward: false })
    expect(service.getSession(session.id)?.canGoBack).toBe(true)
  })

  it('restores a persisted preview tab without opening a new store entry', () => {
    service.restoreSession({
      sessionId: 'persisted-1',
      url: 'http://127.0.0.1:5173',
      title: 'Restored',
      source: 'terminal',
    })

    expect(openPreview).not.toHaveBeenCalled()
    expect(service.getSessionByPath('preview://session/persisted-1')?.title).toBe('Restored')
  })

  it('is a no-op for unknown session ids', () => {
    expect(() => {
      service.markStatus('nope', 'ready')
      service.navigate('nope', 'http://127.0.0.1:5173')
      service.reload('nope')
      service.disposeSession('nope')
      service.updateFavicon('nope', 'http://127.0.0.1:5173/favicon.ico')
    }).not.toThrow()
  })
})
