import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { PreviewPartitionService } from '@main/services/previewPartitionService'

const owner = (id: number) => Object.assign(new EventEmitter(), { id }) as unknown as WebContents

describe('project preview partitions', () => {
  it('persists a project across windows and isolates other projects and window-only sessions', () => {
    const service = new PreviewPartitionService()
    const one = owner(1), two = owner(2)
    const a = service.prepare(one, ['/project-a'], '/project-a')
    const same = service.prepare(two, ['/project-a'])
    const b = service.prepare(two, ['/project-b'])
    expect(a.partition).toBe(same.partition)
    expect(a.partition).toMatch(/^persist:adnify-preview-project-[a-f0-9]{64}$/)
    expect(a.partition).not.toBe(b.partition)
    expect(service.prepare(one, []).partition).not.toBe(service.prepare(two, []).partition)
    expect(service.prepare(one, []).partition).not.toMatch(/^persist:/)
    expect(service.isAllowed(1, b.partition)).toBe(false)
    expect(service.isAllowed(1, 'persist:adnify-preview')).toBe(false)
    one.emit('destroyed')
    expect(service.isAllowed(1, a.partition)).toBe(false)
    expect(service.isAllowed(2, a.partition)).toBe(true)
  })

  it('rejects roots outside the owning window, including a sibling with a shared prefix', () => {
    const service = new PreviewPartitionService()
    expect(() => service.prepare(owner(1), ['/project'], '/project-other')).toThrow('does not belong')
    expect(() => service.prepare(owner(2), [], '/project')).toThrow('does not belong')
  })
})
