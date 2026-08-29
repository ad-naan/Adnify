import { describe, expect, it, vi } from 'vitest'
import { FileChangeBuffer, createFileChangeHandler, type FileChangeEvent } from '@main/indexing/fileChangeBuffer'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function event(path: string, type: FileChangeEvent['type'] = 'update'): FileChangeEvent {
  return { path, type, timestamp: Date.now() }
}

describe('FileChangeBuffer', () => {
  it('serializes flushes and coalesces changes received during active work', async () => {
    const first = deferred()
    const batches: FileChangeEvent[][] = []
    const onFlush = vi.fn(async (events: FileChangeEvent[]) => {
      batches.push(events)
      if (batches.length === 1) await first.promise
    })
    const buffer = new FileChangeBuffer(onFlush)

    buffer.add(event('a.ts'))
    buffer.flush()
    await Promise.resolve()

    buffer.add(event('b.ts'))
    buffer.add(event('b.ts'))
    buffer.add(event('c.ts', 'create'))
    buffer.flush()

    expect(onFlush).toHaveBeenCalledTimes(1)
    first.resolve()
    await buffer.waitForIdle()

    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(batches[1].map(item => [item.path, item.type])).toEqual([
      ['b.ts', 'update'],
      ['c.ts', 'create'],
    ])
  })

  it('continues draining after a failed batch without an unhandled rejection', async () => {
    const first = deferred()
    let callCount = 0
    const buffer = new FileChangeBuffer(async () => {
      callCount += 1
      if (callCount === 1) {
        await first.promise
        throw new Error('expected failure')
      }
    })

    buffer.add(event('a.ts'))
    buffer.flush()
    await Promise.resolve()
    buffer.add(event('b.ts'))
    buffer.flush()

    first.resolve()
    await buffer.waitForIdle()
    expect(callCount).toBe(2)
  })

  it('drops queued work on destroy and ignores later events', async () => {
    const active = deferred()
    const onFlush = vi.fn(async () => active.promise)
    const buffer = new FileChangeBuffer(onFlush)

    buffer.add(event('active.ts'))
    buffer.flush()
    await Promise.resolve()
    buffer.add(event('queued.ts'))

    const destroying = buffer.destroy()
    active.resolve()
    await destroying

    buffer.add(event('ignored.ts'))
    buffer.flush()
    await buffer.waitForIdle()
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(buffer.size()).toBe(0)
  })
})

// drain() 在调用 onFlush 之前就把这批事件从缓冲区清掉了，而且没有重投递。
// 所以处理器内部一旦让一个失败的删除冒出去，同一批里剩下的删除和整批更新
// 都会被跳过，那些文件的检索结果永久停留在旧内容上。
describe('createFileChangeHandler', () => {
  it('isolates a failed deletion from the rest of the batch', async () => {
    const deleted: string[] = []
    const indexService = {
      updateFiles: vi.fn(async () => {}),
      deleteFileIndex: vi.fn(async (path: string) => {
        if (path === 'boom.ts') throw new Error('structural store timeout')
        deleted.push(path)
      }),
    }

    const buffer = createFileChangeHandler(indexService)
    buffer.addBatch([
      event('boom.ts', 'delete'),
      event('gone.ts', 'delete'),
      event('changed.ts'),
    ])
    buffer.flush()
    await buffer.waitForIdle()

    expect(indexService.deleteFileIndex).toHaveBeenCalledTimes(2)
    expect(deleted).toEqual(['gone.ts'])
    expect(indexService.updateFiles).toHaveBeenCalledWith(['changed.ts'])
  })

  it('still propagates update failures so the flush is logged as failed', async () => {
    const indexService = {
      updateFiles: vi.fn(async () => {
        throw new Error('embedder unavailable')
      }),
      deleteFileIndex: vi.fn(async () => {}),
    }

    const buffer = createFileChangeHandler(indexService)
    buffer.add(event('changed.ts'))
    buffer.flush()
    await expect(buffer.waitForIdle()).resolves.toBeUndefined()
    expect(indexService.updateFiles).toHaveBeenCalledTimes(1)
  })
})
