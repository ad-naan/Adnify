import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { ExecutionLogStore } from '@main/services/execution/ExecutionLogStore'
import { normalizeExecutionSettings } from '@shared/config/executionSettings'
import type { ExecutionSnapshot } from '@shared/types/execution'

const directories: string[] = []
const stores: ExecutionLogStore[] = []
const row = (jobId: string): ExecutionSnapshot => ({ jobId, command: 'echo test', requestKey: '', threadId: 'task', cwd: '/work', shell: 'bash',
  mode: 'command', status: 'running', submittedAt: Date.now(), exitCode: null, output: '', truncated: false, revision: 1 })
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-execution-test-')); directories.push(directory)
  const store = new ExecutionLogStore(directory); stores.push(store)
  return { directory, store }
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.flush()))
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})
describe('durable bounded execution logs', () => {
  it('recovers logs without reviving jobs or claiming an interrupted process completed', async () => {
    const { directory, store } = await setup()
    store.update(row('old')); store.append('old', '中文输出\n'); await store.flush()
    const recovered = new ExecutionLogStore(directory); stores.push(recovered)
    expect((await recovered.list())[0]).toMatchObject({ status: 'unknown', archived: true, reason: 'application_restarted_unconfirmed', hosted: false })
    expect((await recovered.read('old')).output).toBe('中文输出\n')
  })
  it('retains UTF-8 tails within per-job and global disk budgets under a log flood', async () => {
    const { directory, store } = await setup()
    store.configure({ ...normalizeExecutionSettings(undefined), outputBytes: 16 * 1024, logBytes: 4096, diskBytes: 16 * 1024 })
    for (let i = 0; i < 12; i++) {
      const id = `flood-${i}`
      store.update(row(id)); store.append(id, '测试🙂'.repeat(8000)); await store.flush()
    }
    const files = await fs.readdir(directory)
    const total = (await Promise.all(files.map(file => fs.stat(path.join(directory, file))))).reduce((n, stat) => n + stat.size, 0)
    expect(total).toBeLessThanOrEqual(16 * 1024)
    const output = await store.read('flood-11')
    expect(output.truncated).toBe(true)
    expect(output.output).not.toContain('�')
    expect(Buffer.byteLength(output.output)).toBeLessThanOrEqual(4096)
  })
  it('pins, exports, deletes finished history and rejects deletion of an active log', async () => {
    const { directory, store } = await setup()
    const job = row('../untrusted-job-id')
    store.update(job); store.append(job.jobId, 'retained output')
    await expect(store.delete(job.jobId)).rejects.toThrow('live execution')
    store.update({ ...job, status: 'completed', exitCode: 0 })
    await store.pin(job.jobId, true)
    expect((await store.list())[0].pinned).toBe(true)
    const exported = path.join(directory, 'export.txt')
    await store.export(job.jobId, exported)
    expect(await fs.readFile(exported, 'utf8')).toBe('retained output')
    await store.pin(job.jobId, false); await store.delete(job.jobId)
    expect(await store.list()).toHaveLength(0)
    expect((await fs.readdir(directory)).filter(file => file.endsWith('.log'))).toHaveLength(0)
  })
  it('reports a disk failure without losing lifecycle state or rejecting execution', async () => {
    const { directory } = await setup()
    const blocked = path.join(directory, 'not-a-directory')
    await fs.writeFile(blocked, 'fixture')
    const store = new ExecutionLogStore(blocked); stores.push(store)
    store.update(row('job')); store.append('job', 'output'); await store.flush()
    expect((await store.list())[0]).toMatchObject({ status: 'running', logTruncated: true })
    expect((await store.list())[0].logError).toBeTruthy()
  })
  it('accounts for log files left behind before the index was committed', async () => {
    const { directory, store } = await setup()
    store.update(row('interrupted')); store.append('interrupted', 'uncommitted index fixture'); await store.flush()
    await fs.rm(path.join(directory, 'index.json'))
    const recovered = new ExecutionLogStore(directory); stores.push(recovered)
    const rows = await recovered.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].jobId).toMatch(/^recovered:/)
    expect(rows[0]).toMatchObject({ archived: true, status: 'unknown' })
    expect((await recovered.read(rows[0].jobId)).output).toBe('uncommitted index fixture')
  })
  it('preserves in-flight byte accounting when a lifecycle update occurs during a write', async () => {
    const { directory, store } = await setup()
    store.configure({ ...normalizeExecutionSettings(undefined), logBytes: 1024, diskBytes: 8192 })
    const job = row('race')
    store.update(job); store.append(job.jobId, 'x'.repeat(4096))
    const writing = store.flush()
    await new Promise(resolve => setTimeout(resolve, 0))
    store.update({ ...job, status: 'completed', exitCode: 0 })
    await writing; await store.flush()
    const file = (await fs.readdir(directory)).find(name => name.endsWith('.log'))!
    expect((await fs.stat(path.join(directory, file))).size).toBeLessThanOrEqual(1024)
    expect((await store.list())[0].status).toBe('completed')
  })
  it('includes truncation metadata in the hard disk budget for ordinary output', async () => {
    const { directory, store } = await setup()
    store.configure({ ...normalizeExecutionSettings(undefined), logBytes: 2048, diskBytes: 2048 })
    for (let index = 0; index < 3; index++) {
      const id = `normal-${index}`
      store.update(row(id)); store.append(id, 'a'.repeat(800))
    }
    await store.flush()
    const sizes = await Promise.all((await fs.readdir(directory)).map(file => fs.stat(path.join(directory, file))))
    expect(sizes.reduce((total, stat) => total + stat.size, 0)).toBeLessThanOrEqual(2048)
  })
})
