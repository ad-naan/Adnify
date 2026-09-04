import { describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import ts from 'typescript'

describe('asset SQLite worker', () => {
  it('persists records across worker restarts and separates collections', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'adnify-asset-worker-'))
    if (path.dirname(directory) !== path.resolve(tmpdir())) throw new Error('Unexpected test directory')
    const source = await fs.readFile(path.resolve('src/main/services/assets/assetStorage.worker.ts'), 'utf8')
    const entry = path.join(directory, 'worker.cjs')
    await fs.writeFile(entry, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
    let worker: Worker | undefined
    let sequence = 0
    const start = () => { worker = new Worker(entry, { workerData: { databasePath: path.join(directory, 'assets.sqlite') } }) }
    const send = (operation: string, table: string, key?: string, value?: unknown) => new Promise<unknown>((resolve, reject) => {
      const id = ++sequence
      const timeout = setTimeout(() => reject(new Error('Worker response timed out')), 5000)
      const onError = (error: Error) => { clearTimeout(timeout); reject(error) }
      worker!.once('error', onError)
      worker!.once('message', response => {
        clearTimeout(timeout); worker!.removeListener('error', onError)
        if (response.error) reject(new Error(response.error)); else resolve(response.result)
      })
      worker!.postMessage({ id, operation, table, key, value })
    })
    try {
      start()
      await send('put', 'job', 'same-id', { state: 'running', remoteId: 'remote-1' })
      await send('put', 'asset', 'same-id', { path: 'image.png' })
      await worker!.terminate()
      start()
      expect(await send('get', 'job', 'same-id')).toEqual({ state: 'running', remoteId: 'remote-1' })
      expect(await send('list', 'asset')).toEqual([{ path: 'image.png' }])
      await send('delete', 'asset', 'same-id')
      expect(await send('list', 'asset')).toEqual([])
      await expect(send('putMany', 'settings', undefined, [
        { table: 'capability', id: 'atomic', value: { name: 'should roll back' } },
        { table: 'secret', id: null, value: 'invalid primary key' },
      ])).rejects.toThrow()
      expect(await send('get', 'capability', 'atomic')).toBeUndefined()
    } finally {
      await worker?.terminate()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
