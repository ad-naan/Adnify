import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { AssetService, isInside } from '@/main/services/assets/AssetService'
import type { AssetRepository, AssetTable } from '@/main/services/assets/AssetRepository'
import type { AssetCapability, AssetJob } from '@/shared/types/assets'
import { compileInputs, mapRequest, parseCapability } from '@/shared/assets/capability'

class MemoryRepository implements AssetRepository {
  values = new Map<string, unknown>()
  async get<T>(table: AssetTable, id: string) { return structuredClone(this.values.get(`${table}:${id}`)) as T | undefined }
  async list<T>(table: AssetTable) { return [...this.values].filter(([key]) => key.startsWith(`${table}:`)).map(([, value]) => structuredClone(value) as T) }
  async put(table: AssetTable, id: string, value: unknown) { this.values.set(`${table}:${id}`, structuredClone(value)) }
  async putMany(entries: Array<{ table: AssetTable; id: string; value: unknown }>) { for (const entry of entries) await this.put(entry.table, entry.id, entry.value) }
  async delete(table: AssetTable, id: string) { this.values.delete(`${table}:${id}`) }
}
function capability(): AssetCapability {
  return {
    id: 'test_image', revision: 1, name: 'Test image', description: 'A test fixture', kind: 'image', enabled: true,
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 4, default: 1 } }, required: ['prompt'] },
    request: { url: 'https://example.test/generate', body: { text: { $input: '/prompt' }, count: { $input: '/count' } } },
    output: { itemsPath: '/images', base64Path: '/data', mimeType: 'image/png', allowedOrigins: [], maxFileMB: 2 },
  }
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
let directory: string
let repo: MemoryRepository
let service: AssetService
let request: ReturnType<typeof vi.fn>
let png: Buffer
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'adnify-assets-test-'))
  repo = new MemoryRepository()
  png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff8800' } }).png().toBuffer()
  request = vi.fn(async () => json({ images: [{ data: png.toString('base64') }] }))
  service = new AssetService(repo, { configDir: directory, fetch: request as typeof fetch, secret: async () => undefined })
  await service.init()
})
afterEach(async () => {
  service.stop()
  if (path.dirname(directory) !== path.resolve(tmpdir())) throw new Error('Refusing to remove a non-test directory')
  await fs.rm(directory, { recursive: true, force: true })
})
async function submit(key = 'call-1') {
  return service.submit('/workspace', 'test_image', 1, { prompt: 'a product' }, key, 'thread-1')
}

describe('user-defined capability contract', () => {
  it('runs the supplied Cookie/base64 example with its 180 second timeout and no resubmission', async () => {
    const cap = JSON.parse(await fs.readFile(path.resolve('docs/examples/image-service-config.json'), 'utf8'))
    cap.request.url = 'https://example.test/generate'
    cap.request.body.model = 'test-image-model'
    service.stop()
    service = new AssetService(repo, { configDir: directory, fetch: request as typeof fetch, secret: async () => 'session=test-only' })
    await service.init(); await service.saveCapability(cap)
    request.mockResolvedValue(json({ data: [{ b64_json: png.toString('base64') }] }))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const job = await service.submit('/workspace', cap.id, 1, { prompt: 'a cat' }, 'cookie-example')
      await service.tick(); await service.tick()
      expect((await service.job(job.id, '/workspace')).state).toBe('ready')
      expect(timeout).toHaveBeenCalledWith(180_000)
      const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe(cap.request.url)
      expect((init.headers as Record<string, string>).Cookie).toBe('session=test-only')
      expect(JSON.parse(init.body as string)).toEqual({ model: 'test-image-model', prompt: 'a cat', n: 1, quality: 'auto', response_format: 'b64_json' })
      expect(request).toHaveBeenCalledTimes(1)
      expect(() => parseCapability({ ...cap, request: { ...cap.request, timeoutSeconds: 0 } })).toThrow()
      expect(() => parseCapability({ ...cap, request: { ...cap.request, timeoutSeconds: 601 } })).toThrow()
    } finally { timeout.mockRestore() }
  })
  it('starts without any configured provider or capability', async () => {
    const snapshot = await service.snapshot('/workspace')
    expect(snapshot.capabilities).toEqual([])
    expect(snapshot.effectiveRoot).toBe(path.join(directory, 'assets', 'library'))
  })
  it('preserves types, defaults and literal prompt text in request mappings', () => {
    const cap = parseCapability(capability())
    const inputs = compileInputs(cap.inputSchema).parse({ prompt: '" ${secret} `command`' })
    expect(mapRequest(cap.request.body, inputs)).toEqual({ text: '" ${secret} `command`', count: 1 })
    expect(() => compileInputs(cap.inputSchema).parse({ prompt: 'x', count: 100 })).toThrow()
    expect(() => compileInputs(cap.inputSchema).parse({ prompt: 'x', ignored: true })).toThrow()
  })
  it('rejects embedded credentials, unsupported fields and conflicting outputs', () => {
    const cap = capability()
    expect(() => parseCapability({ ...cap, request: { ...cap.request, headers: { Authorization: 'secret' } } })).toThrow()
    expect(() => parseCapability({ ...cap, output: { ...cap.output, urlPath: '/url' } })).toThrow()
    expect(() => parseCapability({ ...cap, hiddenFlag: true })).toThrow()
  })
  it('pins revisions and rejects a stale editor or stale tool', async () => {
    const first = await service.saveCapability(capability())
    await service.saveCapability(first)
    await expect(service.saveCapability(first)).rejects.toThrow('another window')
    await expect(submit()).rejects.toThrow('changed')
  })
})

describe('persistent generation lifecycle', () => {
  beforeEach(async () => { await service.saveCapability(capability()) })
  it.each([400, 401, 403, 404, 429])('records explicit HTTP %i rejection rather than submission_unknown', async status => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid parameter' }, debug: 'secret-response-must-not-leak' }), { status }))
    const job = await submit()
    await service.tick(); await service.tick()
    const failed = await service.job(job.id, '/workspace')
    expect(failed.state).toBe('failed')
    expect(failed.failure).toEqual({ kind: 'http', status, detail: 'Invalid parameter' })
    expect(failed.error).toContain(`HTTP ${status}`)
    expect(failed.error).not.toContain('secret-response')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('retains safe transport diagnostics and does not replay ambiguous requests', async () => {
    request.mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'CERT_HAS_EXPIRED' } }))
    const job = await submit(); await service.tick(); await service.tick()
    const failed = await service.job(job.id, '/workspace')
    expect(failed.state).toBe('submission_unknown')
    expect(failed.failure).toEqual({ kind: 'network', code: 'CERT_HAS_EXPIRED' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('retains HTTP 500 and invalid JSON diagnostics without treating them as safe to resubmit', async () => {
    request.mockResolvedValue(new Response('server error', { status: 500 }))
    const job = await submit(); await service.tick()
    expect(await service.job(job.id, '/workspace')).toMatchObject({ state: 'submission_unknown', failure: { kind: 'http', status: 500 } })
    request.mockResolvedValue(new Response('<html>private-cookie</html>'))
    const other = await submit('other'); await service.tick()
    const failed = await service.job(other.id, '/workspace')
    expect(failed.failure).toEqual({ kind: 'response', code: 'invalid_json' })
    expect(failed.error).not.toContain('private-cookie')
  })
  it('rejects malformed credentials before sending without revealing their value', async () => {
    service.stop()
    service = new AssetService(repo, { configDir: directory, fetch: request as typeof fetch, secret: async () => 'cookie=private\ninvalid' })
    await service.init()
    await service.saveCapability({ ...capability(), auth: { header: 'Cookie', prefix: '' } })
    const job = await service.submit('/workspace', 'test_image', 2, { prompt: 'x' }, 'bad-cookie')
    await service.tick()
    const failed = await service.job(job.id, '/workspace')
    expect(failed.state).toBe('failed')
    expect(failed.failure?.kind).toBe('credential')
    expect(failed.error).not.toContain('private')
    expect(request).not.toHaveBeenCalled()
  })
  it('deduplicates concurrent replays but permits intentional new variants', async () => {
    const [a, b] = await Promise.all([submit(), submit()])
    expect(a.id).toBe(b.id)
    expect((await submit('call-2')).id).not.toBe(a.id)
    expect(request).not.toHaveBeenCalled()
  })
  it('submits, validates and saves actual image bytes before becoming ready', async () => {
    const job = await submit()
    await service.tick()
    expect((await service.job(job.id, '/workspace')).state).toBe('collecting')
    await service.tick()
    const done = await service.job(job.id, '/workspace')
    expect(done.state).toBe('ready')
    expect(done.response).toBeUndefined()
    const asset = await service.asset(done.assetIds[0], '/workspace')
    expect(asset.width).toBe(8); expect(asset.height).toBe(6)
    expect(await fs.readFile(await service.filePath(asset))).toEqual(png)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('never resubmits an ambiguous network failure or a crashed submission', async () => {
    request.mockRejectedValue(new Error('network disconnected'))
    const job = await submit()
    await service.tick(); await service.tick()
    expect((await service.job(job.id, '/workspace')).state).toBe('submission_unknown')
    expect(request).toHaveBeenCalledTimes(1)
    const crashed: AssetJob = { ...job, state: 'submitting' }
    await repo.put('job', job.id, crashed)
    service.stop()
    service = new AssetService(repo, { configDir: directory, fetch: request as typeof fetch, secret: async () => undefined })
    await service.init(); await service.tick()
    expect((await service.job(job.id, '/workspace')).state).toBe('submission_unknown')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('recovers an async task by polling the same remote ID', async () => {
    const cap = capability()
    cap.async = { jobIdPath: '/id', statusUrl: 'https://example.test/jobs/{job_id}', statusPath: '/status', successValues: ['done'], failureValues: ['failed'], pollSeconds: 2 }
    await service.saveCapability(cap)
    request.mockResolvedValueOnce(json({ id: 'remote/1' }))
    request.mockResolvedValueOnce(json({ status: 'done', images: [{ data: png.toString('base64') }] }))
    const job = await service.submit('/workspace', cap.id, 2, { prompt: 'x' }, 'call')
    await service.tick()
    service.stop()
    service = new AssetService(repo, { configDir: directory, fetch: request as typeof fetch, secret: async () => undefined })
    await service.init(); await service.tick(); await service.tick()
    expect((await service.job(job.id, '/workspace')).state).toBe('ready')
    expect(request.mock.calls[1][0]).toBe('https://example.test/jobs/remote%2F1')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('retries failed collection without another generation request', async () => {
    const job = await submit()
    await service.tick()
    const stored = await service.job(job.id, '/workspace')
    stored.storageRoot = path.join(directory, 'missing-drive')
    await repo.put('job', job.id, stored)
    await service.tick()
    expect((await service.job(job.id, '/workspace')).state).toBe('failed')
    await fs.mkdir(stored.storageRoot)
    await service.retryCollection(job.id, '/workspace'); await service.tick()
    expect((await service.job(job.id, '/workspace')).state).toBe('ready')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('rejects an output URL outside the configured origins without fetching it', async () => {
    const cap = capability(); delete cap.output.base64Path; cap.output.urlPath = '/url'
    await service.saveCapability(cap)
    request.mockResolvedValue(json({ images: [{ url: 'http://127.0.0.1/private' }] }))
    const job = await service.submit('/workspace', cap.id, 2, { prompt: 'x' }, 'call')
    await service.tick(); await service.tick()
    expect((await service.job(job.id, '/workspace')).error).toContain('origin')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('cancels only unsubmitted jobs', async () => {
    const queued = await submit(); await service.cancel(queued.id, '/workspace'); await service.tick()
    expect(request).not.toHaveBeenCalled()
    const running = await submit('second'); await service.tick()
    await expect(service.cancel(running.id, '/workspace')).rejects.toThrow('Only locally queued')
  })
  it('checks workspace ownership on jobs and assets', async () => {
    const job = await submit(); await service.tick(); await service.tick()
    await expect(service.job(job.id, '/other')).rejects.toThrow('workspace')
    const done = await service.job(job.id, '/workspace')
    await expect(service.asset(done.assetIds[0], '/other')).rejects.toThrow('workspace')
  })
})

describe('bounded, workspace-scoped history', () => {
  beforeEach(async () => { await service.saveCapability(capability()) })
  it('paginates all records, including records beyond the snapshot limit', async () => {
    const template = await submit()
    service.stop()
    await repo.delete('job', template.id)
    for (let index = 0; index < 107; index++) {
      const job = { ...template, id: `history-${index}`, createdAt: index, state: 'failed' as const }
      await repo.put('job', job.id, job)
    }
    await repo.put('job', 'other', { ...template, id: 'other', workspace: '/other', createdAt: 1000 })
    const first = await service.history('/workspace', 'jobs', 1)
    expect(first).toMatchObject({ total: 107, page: 1, pageSize: 6, clearable: 107 })
    expect(first.jobs).toHaveLength(6)
    expect(first.jobs[0].id).toBe('history-106')
    const last = await service.history('/workspace', 'jobs', 100)
    expect(last.page).toBe(18)
    expect(last.jobs.map(job => job.id)).toEqual(['history-4', 'history-3', 'history-2', 'history-1', 'history-0'])
    expect(first.jobs[0]).not.toHaveProperty('inputs')
    expect(first.jobs[0].prompt).toBe('a product')
  })
  it('clears finished records while keeping active jobs, files and idempotency', async () => {
    const ready = await submit()
    await service.tick(); await service.tick()
    const done = await service.job(ready.id, '/workspace')
    const asset = await service.asset(done.assetIds[0], '/workspace')
    const active = await submit('active')
    service.stop()
    const other = await service.submit('/other', 'test_image', 1, { prompt: 'x' }, 'other')
    service.stop()
    await repo.put('job', other.id, { ...other, state: 'failed' })
    await expect(service.removeHistory('/workspace', 'jobs', active.id)).rejects.toThrow('finished')
    await expect(service.removeHistory('/workspace', 'jobs', other.id)).rejects.toThrow('workspace')
    expect(await service.removeHistory('/workspace', 'jobs')).toBe(1)
    expect((await service.history('/workspace', 'jobs', 1)).jobs.map(job => job.id)).toEqual([active.id])
    expect((await service.history('/other', 'jobs', 1)).total).toBe(1)
    expect((await submit()).id).toBe(ready.id)
    expect(await fs.readFile(await service.filePath(asset))).toEqual(png)
    expect((await service.snapshot('/workspace')).jobs.map(job => job.id)).toEqual([active.id])
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('removes a single record and clamps the now-empty last page', async () => {
    const template = await submit()
    service.stop()
    await repo.delete('job', template.id)
    for (let index = 0; index < 7; index++) await repo.put('job', `job-${index}`, { ...template, id: `job-${index}`, createdAt: index, state: 'failed' })
    expect(await service.removeHistory('/workspace', 'jobs', 'job-0')).toBe(1)
    const page = await service.history('/workspace', 'jobs', 2)
    expect(page).toMatchObject({ page: 1, total: 6 })
    expect(page.jobs.every(job => job.id !== 'job-0')).toBe(true)
    service = new AssetService(repo, { configDir: directory, fetch: request as typeof fetch, secret: async () => undefined })
    expect((await service.history('/workspace', 'jobs', 1)).total).toBe(6)
  })
  it('clears references without deleting their files or generated assets', async () => {
    const source = path.join(directory, 'reference.png')
    await fs.writeFile(source, png)
    const reference = await service.importImage(source, '/workspace')
    const job = await submit(); await service.tick(); await service.tick()
    const generated = (await service.job(job.id, '/workspace')).assetIds[0]
    await expect(service.removeHistory('/other', 'references', reference.id)).rejects.toThrow('workspace')
    await expect(service.removeHistory('/workspace', 'references', generated)).rejects.toThrow('reference')
    expect((await service.history('/workspace', 'references', 1)).assets.map(asset => asset.id)).toEqual([reference.id])
    expect(await service.removeHistory('/workspace', 'references')).toBe(1)
    expect((await service.history('/workspace', 'references', 1)).total).toBe(0)
    const retained = await service.asset(reference.id, '/workspace')
    expect(await fs.readFile(await service.filePath(retained))).toEqual(png)
    expect((await service.snapshot('/workspace')).assets.map(asset => asset.id)).toEqual([generated])
  })
})

describe('storage locations', () => {
  it('creates a project asset folder without a picker and keeps other workspaces unchanged', async () => {
    const workspace = await fs.realpath(directory)
    const global = await service.effectiveRoot('')
    await service.useProjectStorage(workspace)
    const projectRoot = await fs.realpath(path.join(workspace, '.adnify', 'assets'))
    expect(await service.effectiveRoot(workspace)).toBe(projectRoot)
    expect((await fs.stat(projectRoot)).isDirectory()).toBe(true)
    expect(await service.effectiveRoot('/other')).toBe(global)
    await service.useProjectStorage(workspace)
    expect(await service.effectiveRoot(workspace)).toBe(projectRoot)
    await service.setStorage(workspace, 'project')
    expect(await service.effectiveRoot(workspace)).toBe(global)
    await expect(service.useProjectStorage('')).rejects.toThrow('Open a project')
  })
  it('supports global/project overrides, reset and stable paths for old jobs', async () => {
    await service.saveCapability(capability())
    const old = await submit()
    const custom = path.join(directory, '自定义 素材')
    const project = path.join(directory, 'project assets')
    await service.setStorage('/workspace', 'global', custom)
    expect(await service.effectiveRoot('/workspace')).toBe(await fs.realpath(custom))
    await service.setStorage('/workspace', 'project', project)
    expect((await submit('new')).storageRoot).toBe(await fs.realpath(project))
    expect((await service.job(old.id, '/workspace')).storageRoot).toBe(old.storageRoot)
    await service.setStorage('/workspace', 'project')
    expect(await service.effectiveRoot('/workspace')).toBe(await fs.realpath(custom))
    await service.tick(); await service.tick()
    expect((await service.job(old.id, '/workspace')).state).toBe('ready')
  })
  it('does not recreate an unavailable custom root or fall back', async () => {
    await service.saveCapability(capability())
    const custom = path.join(directory, 'detached')
    await service.setStorage('/workspace', 'global', custom)
    const resolved = await service.effectiveRoot('/workspace')
    await fs.rmdir(custom)
    await expect(submit()).rejects.toThrow()
    expect(await service.effectiveRoot('/workspace')).toBe(resolved)
    expect(request).not.toHaveBeenCalled()
  })
  it('does not mistake a sibling directory for a contained path', () => {
    expect(isInside(directory, `${directory}-other`)).toBe(false)
    expect(isInside(directory, path.join(directory, 'child'))).toBe(true)
  })
})
