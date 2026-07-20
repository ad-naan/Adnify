import { describe, expect, it } from 'vitest'
import { resolveWorkspaceFromEvent } from '@main/ipc/workspaceContext'

describe('resolveWorkspaceFromEvent', () => {
  it('prefers window workspace over global session', () => {
    const result = resolveWorkspaceFromEvent(
      { sender: { id: 42 } } as any,
      {
        getWindowWorkspace: (id) => (id === 42 ? ['/window/root'] : null),
        workspaceMetaStore: {
          get: () => ({ roots: ['/global/root'] }),
        } as any,
      },
    )

    expect(result).toEqual({ roots: ['/window/root'] })
  })

  it('falls back to last workspace session when window has no roots', () => {
    const result = resolveWorkspaceFromEvent(
      { sender: { id: 7 } } as any,
      {
        getWindowWorkspace: () => [],
        workspaceMetaStore: {
          get: () => ({ roots: ['/global/root'] }),
        } as any,
      },
    )

    expect(result).toEqual({ roots: ['/global/root'] })
  })

  it('returns null when no workspace is available', () => {
    const result = resolveWorkspaceFromEvent(undefined, {
      workspaceMetaStore: {
        get: () => null,
      } as any,
    })

    expect(result).toBeNull()
  })
})
