import { beforeEach, describe, expect, it, vi } from 'vitest'

const { card, dismiss, openCandidate, discoverySubscribers, storeState } = vi.hoisted(() => ({
  card: vi.fn((_options: unknown) => 'toast-1'),
  dismiss: vi.fn(),
  openCandidate: vi.fn(),
  discoverySubscribers: new Set<(state: { candidates: unknown[] }) => void>(),
  storeState: { openFiles: [] as unknown[], language: 'en' },
}))

vi.mock('@store', () => ({ useStore: { getState: () => storeState } }))

vi.mock('@/renderer/components/common/ToastProvider', () => ({
  toast: { card, dismiss },
}))

vi.mock('@/renderer/preview/previewSessionService', () => ({
  previewSessionService: { openCandidate },
}))

vi.mock('@/renderer/preview/devServerDiscoveryService', () => ({
  devServerDiscoveryService: {
    initialize: vi.fn(),
    refresh: vi.fn(async () => {}),
    subscribe: (listener: (state: { candidates: unknown[] }) => void) => {
      discoverySubscribers.add(listener)
      listener({ candidates: [] })
      return () => discoverySubscribers.delete(listener)
    },
  },
}))

import { PreviewPromptService } from '@/renderer/preview/previewPromptService'
import { DEFAULT_PREVIEW_SETTINGS, savePreviewSettings } from '@/renderer/preview/previewSettings'

function readyCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'http:5173',
    url: 'http://127.0.0.1:5173',
    source: 'terminal',
    status: 'ready',
    label: '127.0.0.1:5173',
    workspaceRoot: '/repo',
    detectedAt: 1,
    lastSeenAt: 1,
    ...overrides,
  }
}

function emitDiscovery(candidates: unknown[]): void {
  for (const listener of discoverySubscribers) listener({ candidates })
}

describe('PreviewPromptService', () => {
  beforeEach(() => {
    card.mockClear()
    dismiss.mockClear()
    openCandidate.mockClear()
    discoverySubscribers.clear()
    storeState.openFiles = []
    localStorage.clear()
    savePreviewSettings(DEFAULT_PREVIEW_SETTINGS)
  })

  it('stays silent by default — this is the repeated-popup regression', () => {
    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])

    // 同一端口的 20 次发现事件（dev server 刷日志的真实节奏）
    for (let i = 0; i < 20; i++) {
      emitDiscovery([readyCandidate({ lastSeenAt: i })])
    }

    expect(card).not.toHaveBeenCalled()
  })

  it('prompts at most once per origin when auto-prompt is enabled', () => {
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, autoPrompt: true })
    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])

    for (let i = 0; i < 20; i++) {
      emitDiscovery([readyCandidate({ lastSeenAt: i })])
    }

    expect(card).toHaveBeenCalledTimes(1)
  })

  it('gives the card a finite duration so it cannot sit in the corner', () => {
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, autoPrompt: true })
    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])
    emitDiscovery([readyCandidate()])

    const options = card.mock.calls[0][0] as { duration?: number }
    expect(options.duration).toBeGreaterThan(0)
  })

  it('honours a persisted "don\'t ask again" for that origin', () => {
    savePreviewSettings({
      ...DEFAULT_PREVIEW_SETTINGS,
      autoPrompt: true,
      dismissedOrigins: ['http://127.0.0.1:5173'],
    })
    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])
    emitDiscovery([readyCandidate()])

    expect(card).not.toHaveBeenCalled()
  })

  it('does not prompt for a candidate that already has a preview tab open', () => {
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, autoPrompt: true })
    storeState.openFiles = [{ kind: 'preview', preview: { candidateId: 'http:5173', url: 'http://127.0.0.1:5173' } }]

    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])
    emitDiscovery([readyCandidate()])

    expect(card).not.toHaveBeenCalled()
  })

  it('ignores candidates that are not ready or live outside the workspace', () => {
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, autoPrompt: true })
    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])

    emitDiscovery([readyCandidate({ status: 'probing' })])
    emitDiscovery([readyCandidate({ id: 'http:9999', url: 'http://127.0.0.1:9999', workspaceRoot: '/elsewhere' })])

    expect(card).not.toHaveBeenCalled()
  })

  it('opens the preview and clears the card when the user accepts', () => {
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, autoPrompt: true })
    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])
    emitDiscovery([readyCandidate()])

    const options = card.mock.calls[0][0] as { actions: Array<{ id: string; onClick: () => void }> }
    options.actions.find((action) => action.id === 'open')!.onClick()

    expect(openCandidate).toHaveBeenCalledTimes(1)
    expect(dismiss).toHaveBeenCalledWith('toast-1')
  })

  it('persists the mute when the user picks "don\'t ask again"', async () => {
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, autoPrompt: true })
    const service = new PreviewPromptService()
    service.setWorkspaceRoots(['/repo'])
    emitDiscovery([readyCandidate()])

    const options = card.mock.calls[0][0] as { actions: Array<{ id: string; onClick: () => void }> }
    options.actions.find((action) => action.id === 'never')!.onClick()

    const { loadPreviewSettings } = await import('@/renderer/preview/previewSettings')
    expect(loadPreviewSettings().dismissedOrigins).toContain('http://127.0.0.1:5173')
  })
})
