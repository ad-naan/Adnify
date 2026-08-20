import { beforeEach, describe, expect, it, vi } from 'vitest'

const { append } = vi.hoisted(() => ({
  append: vi.fn(async () => true),
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    file: {
      append,
    },
  },
}))

import { workspaceFiles } from '@/renderer/services/workspaceFileRepository'

describe('workspace file repository append', () => {
  beforeEach(() => append.mockClear())

  it('appends without reading or replacing the existing JSONL file', async () => {
    await expect(workspaceFiles.appendText('stats/events.jsonl', '{"id":1}\n', '/workspace'))
      .resolves.toBe(true)
    expect(append).toHaveBeenCalledWith('/workspace/.adnify/stats/events.jsonl', '{"id":1}\n')
  })
})
