import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { executeSessionStorageOperation } from '@/main/services/session/sessionStorage.worker'
import type { SessionPatch } from '@/shared/types/sessionPersistence'

const temporaryDirectories: string[] = []

async function temporaryDatabase(): Promise<{ root: string; databasePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'adnify-session-test-'))
  temporaryDirectories.push(root)
  return { root, databasePath: join(root, 'session.sqlite3') }
}

function initialPatch(): SessionPatch {
  return {
    state: { currentThreadId: 't1', activeBranchId: {}, version: 1 },
    deletedThreadIds: [],
    branchThreads: [],
    threads: [{
      metadata: {
        id: 't1', createdAt: 1, lastModified: 2, title: 'Thread', messageCount: 2, data: {},
      },
      replaceFrom: 0,
      messages: [
        { ordinal: 0, id: 'm1', role: 'user', timestamp: 1, payload: { id: 'm1', role: 'user', content: 'one' } },
        { ordinal: 1, id: 'm2', role: 'assistant', timestamp: 2, payload: { id: 'm2', role: 'assistant', content: 'two' } },
      ],
    }],
  }
}

afterEach(async () => {
  await executeSessionStorageOperation({ type: 'closeAll' })
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('SQLite session store', () => {
  it('replaces only a changed message tail', async () => {
    const { databasePath } = await temporaryDatabase()
    await executeSessionStorageOperation({ type: 'open', databasePath })
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch: initialPatch() })
    await executeSessionStorageOperation({
      type: 'applyPatch',
      databasePath,
      patch: {
        deletedThreadIds: [],
        branchThreads: [],
        threads: [{
          metadata: {
            id: 't1', createdAt: 1, lastModified: 3, title: 'Thread', messageCount: 2, data: {},
          },
          replaceFrom: 1,
          messages: [{
            ordinal: 1, id: 'm2', role: 'assistant', timestamp: 3,
            payload: { id: 'm2', role: 'assistant', content: 'updated' },
          }],
        }],
      },
    })

    const result = await executeSessionStorageOperation({ type: 'loadMessages', databasePath, threadId: 't1' })
    expect(result).toEqual({
      type: 'messages',
      messages: [
        { id: 'm1', role: 'user', content: 'one' },
        { id: 'm2', role: 'assistant', content: 'updated' },
      ],
    })
  })

  it('rolls the whole transaction back when serialization fails', async () => {
    const { databasePath } = await temporaryDatabase()
    await executeSessionStorageOperation({ type: 'open', databasePath })
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch: initialPatch() })

    const broken = initialPatch()
    broken.threads[0].messages = [{
      ordinal: 0, id: 'bad', role: 'user', timestamp: 4, payload: { unsupported: BigInt(1) },
    }]
    await expect(executeSessionStorageOperation({
      type: 'applyPatch', databasePath, patch: broken,
    })).rejects.toThrow()

    const result = await executeSessionStorageOperation({ type: 'loadMessages', databasePath, threadId: 't1' })
    expect(result.type === 'messages' ? result.messages : []).toHaveLength(2)
  })

  it('stores branch messages independently and replaces a thread branch set atomically', async () => {
    const { databasePath } = await temporaryDatabase()
    await executeSessionStorageOperation({ type: 'open', databasePath })
    const patch = initialPatch()
    patch.branchThreads = [{
      threadId: 't1',
      branches: [{
        threadId: 't1', id: 'b1', ordinal: 0, name: 'Alternative', forkFromMessageId: 'm1',
        createdAt: 3, isActive: true, messageCount: 1, data: { color: 'blue' },
        messages: [{
          ordinal: 0, id: 'bm1', role: 'assistant', timestamp: 3,
          payload: { id: 'bm1', role: 'assistant', content: 'branch answer' },
        }],
      }],
    }]
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch })

    const catalog = await executeSessionStorageOperation({ type: 'loadCatalog', databasePath })
    expect(catalog.type === 'catalog' ? catalog.catalog.branches : []).toEqual([
      expect.objectContaining({ threadId: 't1', id: 'b1', messageCount: 1, data: { color: 'blue' } }),
    ])
    const messages = await executeSessionStorageOperation({
      type: 'loadBranchMessages', databasePath, threadId: 't1',
    })
    expect(messages.type === 'branchMessages' ? messages.branches : []).toEqual([{
      id: 'b1', messages: [{ id: 'bm1', role: 'assistant', content: 'branch answer' }],
    }])

    await executeSessionStorageOperation({
      type: 'applyPatch', databasePath,
      patch: { threads: [], deletedThreadIds: [], branchThreads: [{ threadId: 't1', branches: [] }] },
    })
    const emptied = await executeSessionStorageOperation({ type: 'loadCatalog', databasePath })
    expect(emptied.type === 'catalog' ? emptied.catalog.branches : ['unexpected']).toEqual([])
  })

  it('deduplicates large payloads into content-addressed blobs and hydrates them transparently', async () => {
    const { databasePath } = await temporaryDatabase()
    await executeSessionStorageOperation({ type: 'open', databasePath })
    const content = 'large-payload-'.repeat(24_000)
    const patch = initialPatch()
    patch.threads[0].messages = [0, 1].map(ordinal => ({
      ordinal, id: `large-${ordinal}`, role: 'assistant', timestamp: ordinal,
      payload: { id: `large-${ordinal}`, role: 'assistant', content },
    }))
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch })

    const loaded = await executeSessionStorageOperation({ type: 'loadMessages', databasePath, threadId: 't1' })
    expect(loaded.type === 'messages' ? loaded.messages : []).toEqual([
      { id: 'large-0', role: 'assistant', content },
      { id: 'large-1', role: 'assistant', content },
    ])
    const stats = await executeSessionStorageOperation({ type: 'getStats', databasePath })
    expect(stats.type === 'stats' ? stats.stats : null).toMatchObject({
      threadCount: 1, messageCount: 2, blobCount: 1,
    })
    expect(stats.type === 'stats' ? stats.stats.blobBytes : 0).toBeGreaterThan(256 * 1024)
  })

  it('keeps blobs referenced by recovery snapshots until those snapshots rotate', async () => {
    const { databasePath } = await temporaryDatabase()
    const content = 'snapshot-payload-'.repeat(20_000)
    const original = initialPatch()
    original.threads[0].messages = [{
      ordinal: 0, id: 'large', role: 'assistant', timestamp: 1,
      payload: { id: 'large', role: 'assistant', content },
    }]
    original.threads[0].metadata.messageCount = 1

    await executeSessionStorageOperation({ type: 'open', databasePath })
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch: original })
    await executeSessionStorageOperation({ type: 'closeAll' })

    await executeSessionStorageOperation({ type: 'open', databasePath })
    const replacement = initialPatch()
    replacement.threads[0].metadata.messageCount = 1
    replacement.threads[0].messages = [{
      ordinal: 0, id: 'small', role: 'user', timestamp: 2,
      payload: { id: 'small', role: 'user', content: 'replacement' },
    }]
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch: replacement })
    await executeSessionStorageOperation({ type: 'closeAll' })
    await writeFile(databasePath, 'corrupt primary')

    await executeSessionStorageOperation({ type: 'open', databasePath })
    const recovered = await executeSessionStorageOperation({ type: 'loadMessages', databasePath, threadId: 't1' })
    expect(recovered.type === 'messages' ? recovered.messages : []).toEqual([
      { id: 'large', role: 'assistant', content },
    ])
  })

  it('migrates legacy inline branches with an atomic user_version migration', async () => {
    const { databasePath } = await temporaryDatabase()
    await executeSessionStorageOperation({ type: 'open', databasePath })
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch: initialPatch() })
    await executeSessionStorageOperation({ type: 'closeAll' })

    const legacy = new DatabaseSync(databasePath)
    legacy.prepare('UPDATE session_state SET payload = ? WHERE singleton = 1').run(JSON.stringify({
      currentThreadId: 't1', activeBranchId: { t1: 'b1' }, version: 1,
      branches: { t1: [{
        id: 'b1', name: 'Legacy', forkFromMessageId: 'm1', createdAt: 4, isActive: true,
        messages: [{ id: 'bm1', role: 'assistant', timestamp: 4, content: 'legacy branch' }],
      }] },
    }))
    legacy.exec('DELETE FROM branch_messages; DELETE FROM branches; PRAGMA user_version = 1;')
    legacy.close()

    const migrated = await executeSessionStorageOperation({ type: 'open', databasePath })
    expect(migrated.type === 'opened' ? migrated.catalog.branches : []).toEqual([
      expect.objectContaining({ id: 'b1', name: 'Legacy', messageCount: 1 }),
    ])
    const check = new DatabaseSync(databasePath, { readOnly: true })
    expect((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3)
    check.close()
  })

  it('does not quarantine a healthy database when its schema is newer than the app', async () => {
    const { root, databasePath } = await temporaryDatabase()
    const database = new DatabaseSync(databasePath)
    database.exec('PRAGMA user_version = 99')
    database.close()

    await expect(executeSessionStorageOperation({ type: 'open', databasePath }))
      .rejects.toThrow('newer than supported')
    expect((await readdir(root)).some(name => name.includes('.corrupt-'))).toBe(false)
  })

  it('imports legacy JSONL once and never resurrects it after clear', async () => {
    const { root, databasePath } = await temporaryDatabase()
    const legacySessionsDir = join(root, 'legacy')
    await mkdir(legacySessionsDir)
    await writeFile(join(legacySessionsDir, '_meta.json'), JSON.stringify({ currentThreadId: 'old', version: 1 }))
    await writeFile(join(legacySessionsDir, 'old.json'), JSON.stringify({
      id: 'old', createdAt: 1, lastModified: 1, title: 'Old', messageCount: 1,
    }))
    await writeFile(join(legacySessionsDir, 'old.jsonl'), `${JSON.stringify({ id: 'm1', role: 'user', timestamp: 1 })}\n`)

    const first = await executeSessionStorageOperation({ type: 'open', databasePath, legacySessionsDir })
    expect(first.type === 'opened' && first.migrated).toBe(true)
    await executeSessionStorageOperation({ type: 'clear', databasePath })
    const second = await executeSessionStorageOperation({ type: 'open', databasePath, legacySessionsDir })
    expect(second.type === 'opened' ? second.catalog.threads : []).toEqual([])
  })

  it('quarantines a corrupt primary and restores a verified snapshot', async () => {
    const { root, databasePath } = await temporaryDatabase()
    await executeSessionStorageOperation({ type: 'open', databasePath })
    await executeSessionStorageOperation({ type: 'applyPatch', databasePath, patch: initialPatch() })
    await executeSessionStorageOperation({ type: 'closeAll' })
    await writeFile(databasePath, 'not a sqlite database')

    const recovered = await executeSessionStorageOperation({ type: 'open', databasePath })
    expect(recovered.type === 'opened' ? recovered.catalog.threads.map(thread => thread.id) : [])
      .toEqual(['t1'])

    await expect(readdir(root)).resolves.toEqual(
      expect.arrayContaining([expect.stringMatching(/^session\.sqlite3\.corrupt-/)]),
    )
  })
})
