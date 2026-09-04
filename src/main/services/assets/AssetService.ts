import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { AssetRequestError, describeAssetFailure, isRejectedSubmission, readAssetHttpError } from './assetErrors'
import type { AssetCapability, AssetInputSchema, AssetJob, AssetSnapshot, AssetStorageSettings, GeneratedAsset, AssetHistoryKind, AssetHistoryPage } from '@shared/types/assets'
import { summarizeAssetJob } from '@shared/types/assets'
import { compileInputs, mapRequest, parseCapability, readPointer } from '@shared/assets/capability'
import type { AssetRepository } from './AssetRepository'

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
const finalStates = new Set(['ready', 'failed', 'submission_unknown', 'cancelled'])
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'model/gltf-binary': 'glb', 'application/octet-stream': 'bin' }
export interface AssetServiceOptions {
  configDir: string
  fetch?: typeof fetch
  secret: (id: string) => Promise<string | undefined>
}

/** Main-process coordinator; SQL is owned by a dedicated worker. */
export class AssetService {
  private timer?: ReturnType<typeof setTimeout>
  private busy = false
  private stopped = false
  private initialized?: Promise<void>
  private mutation: Promise<unknown> = Promise.resolve()
  private nextPoll = new Map<string, number>()
  private readonly request: typeof fetch
  constructor(readonly repository: AssetRepository, private options: AssetServiceOptions) { this.request = options.fetch || fetch }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.catch(() => {})
    return result
  }
  async init(): Promise<void> {
    if (!this.initialized) this.initialized = (async () => {
      await fs.mkdir(path.join(this.options.configDir, 'assets', 'library'), { recursive: true })
      if (!await this.repository.get('settings', 'storage')) {
        await this.repository.put('settings', 'storage', { defaultRoot: path.join(this.options.configDir, 'assets', 'library'), projectRoots: {} })
      }
      for (const job of await this.repository.list<AssetJob>('job')) {
        if (job.state === 'submitting') {
          job.state = 'submission_unknown'
          job.error = 'Submission was interrupted. Check the service before creating a new generation.'
          await this.saveJob(job)
        }
      }
    })()
    await this.initialized
  }
  start(): void { this.stopped = false; this.schedule() }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer) }
  private schedule(): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.tick().catch(() => {}).finally(() => this.schedule())
    }, 2000)
    this.timer.unref()
  }
  async storage(): Promise<AssetStorageSettings> { await this.init(); return (await this.repository.get<AssetStorageSettings>('settings', 'storage'))! }
  async effectiveRoot(workspace: string): Promise<string> {
    const settings = await this.storage()
    return settings.projectRoots[workspace] || settings.customRoot || settings.defaultRoot
  }
  async setStorage(workspace: string, scope: 'global' | 'project', root?: string): Promise<void> {
    await this.init()
    if (root) {
      if (!path.isAbsolute(root)) throw new Error('Storage location must be absolute')
      await fs.mkdir(root, { recursive: true })
      await this.checkWritable(root)
      root = await fs.realpath(root)
    }
    if (scope === 'project' && !workspace) throw new Error('Open a project before configuring project storage')
    await this.exclusive(async () => {
      const settings = await this.storage()
      if (scope === 'global') settings.customRoot = root
      else if (root) settings.projectRoots[workspace] = root
      else delete settings.projectRoots[workspace]
      await this.repository.put('settings', 'storage', settings)
    })
  }
  async useProjectStorage(workspace: string): Promise<void> {
    if (!workspace || !path.isAbsolute(workspace)) throw new Error('Open a project before configuring project storage')
    const root = await fs.realpath(workspace)
    await this.setStorage(root, 'project', path.join(root, '.adnify', 'assets'))
  }
  private async checkWritable(root: string): Promise<void> {
    const probe = path.join(root, `.adnify-write-${randomUUID()}`)
    await fs.writeFile(probe, '', { flag: 'wx' })
    await fs.unlink(probe)
  }
  async saveCapability(value: unknown, encryptedSecret?: string): Promise<AssetCapability> {
    const capability = parseCapability(value)
    return this.exclusive(async () => {
      const old = await this.repository.get<AssetCapability>('capability', capability.id)
      if (old && capability.revision !== old.revision) throw new Error('Capability changed in another window. Reload before saving.')
      capability.revision = (old?.revision || 0) + 1
      await this.repository.putMany([
        { table: 'capability', id: capability.id, value: capability },
        ...(encryptedSecret ? [{ table: 'secret' as const, id: capability.id, value: encryptedSecret }] : []),
      ])
      return capability
    })
  }
  async snapshot(workspace: string): Promise<AssetSnapshot> {
    await this.init()
    const [capabilities, jobs, assets, storage] = await Promise.all([
      this.repository.list<AssetCapability>('capability'), this.repository.list<AssetJob>('job'),
      this.repository.list<GeneratedAsset>('asset'), this.storage(),
    ])
    return {
      capabilities, storage, workspace, effectiveRoot: await this.effectiveRoot(workspace),
      jobs: jobs.filter(j => j.workspace === workspace && !j.historyDeletedAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(summarizeAssetJob),
      assets: assets.filter(a => a.workspace === workspace && !a.historyDeletedAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
      credentials: [],
    }
  }
  async job(id: string, workspace: string): Promise<AssetJob> {
    const job = await this.repository.get<AssetJob>('job', id)
    if (!job || job.workspace !== workspace) throw new Error('Asset job not found in this workspace')
    return job
  }
  async history(workspace: string, kind: AssetHistoryKind, requestedPage: number): Promise<AssetHistoryPage> {
    await this.init()
    const jobs = kind === 'jobs' ? (await this.repository.list<AssetJob>('job')).filter(j => j.workspace === workspace && !j.historyDeletedAt).sort((a, b) => b.createdAt - a.createdAt) : []
    const assets = kind === 'references' ? (await this.repository.list<GeneratedAsset>('asset')).filter(a => a.workspace === workspace && !a.jobId && !a.historyDeletedAt).sort((a, b) => b.createdAt - a.createdAt) : []
    const total = jobs.length + assets.length, pageSize = 6
    const page = Math.min(Math.max(1, requestedPage), Math.max(1, Math.ceil(total / pageSize)))
    const offset = (page - 1) * pageSize
    return { jobs: jobs.slice(offset, offset + pageSize).map(summarizeAssetJob), assets: assets.slice(offset, offset + pageSize), total, page, pageSize, clearable: kind === 'jobs' ? jobs.filter(j => finalStates.has(j.state)).length : assets.length }
  }
  async removeHistory(workspace: string, kind: AssetHistoryKind, id?: string): Promise<number> {
    await this.init()
    return this.exclusive(async () => {
      const table = kind === 'jobs' ? 'job' : 'asset'
      const values = await this.repository.list<AssetJob | GeneratedAsset>(table)
      const owned = values.filter(value => value.workspace === workspace && !value.historyDeletedAt && (!id || value.id === id))
      if (id && !owned.length) throw new Error('History record not found in this workspace')
      const removable = owned.filter(value => kind === 'jobs' ? finalStates.has((value as AssetJob).state) : !(value as GeneratedAsset).jobId)
      if (id && !removable.length) throw new Error('Only finished tasks or reference records can be removed')
      // Tombstones preserve tool-call idempotency and existing references; never unlink media here.
      await this.repository.putMany(removable.map(value => ({ table, id: value.id, value: { ...value, historyDeletedAt: Date.now() } })))
      return removable.length
    })
  }
  async asset(id: string, workspace: string): Promise<GeneratedAsset> {
    const asset = await this.repository.get<GeneratedAsset>('asset', id)
    if (!asset || asset.workspace !== workspace) throw new Error('Asset not found in this workspace')
    return asset
  }
  async submit(workspace: string, capabilityId: string, revision: number, rawInputs: unknown, toolCallId: string, threadId?: string): Promise<AssetJob> {
    await this.init()
    if (!toolCallId || toolCallId.length > 200) throw new Error('A stable tool call ID is required')
    return this.exclusive(async () => {
      const key = JSON.stringify([workspace, threadId || '', toolCallId])
      const previous = (await this.repository.list<AssetJob>('job')).find(job => job.idempotencyKey === key)
      if (previous) return previous
      const capability = await this.repository.get<AssetCapability>('capability', capabilityId)
      if (!capability?.enabled) throw new Error('Capability is disabled or missing')
      if (revision !== capability.revision) throw new Error('Capability changed. Refresh tools before submitting.')
      const inputs = compileInputs(capability.inputSchema).parse(rawInputs) as Record<string, unknown>
      mapRequest(capability.request.body, inputs)
      if (capability.auth && !await this.options.secret(capabilityId)) throw new Error('Configure a credential for this capability')
      const storageRoot = await this.effectiveRoot(workspace)
      await this.checkWritable(storageRoot)
      const job: AssetJob = {
        id: randomUUID(), workspace, threadId, idempotencyKey: key, capability, inputs, storageRoot,
        state: 'queued', revision: 1, assetIds: [], createdAt: Date.now(), updatedAt: Date.now(),
      }
      await this.repository.put('job', job.id, job)
      this.start()
      return job
    })
  }
  private async saveJob(job: AssetJob): Promise<void> {
    job.revision++; job.updatedAt = Date.now()
    await this.repository.put('job', job.id, job)
  }
  async cancel(id: string, workspace: string): Promise<AssetJob> {
    return this.exclusive(async () => {
      const job = await this.job(id, workspace)
      if (job.state !== 'queued') throw new Error('Only locally queued jobs can be cancelled. Remote cancellation is not configured; the service may continue charging.')
      job.state = 'cancelled'; await this.saveJob(job); return job
    })
  }
  async retryCollection(id: string, workspace: string): Promise<AssetJob> {
    return this.exclusive(async () => {
      const job = await this.job(id, workspace)
      if (job.state !== 'failed' || job.response === undefined) throw new Error('Only a failed download can be retried; generation will not be resubmitted')
      job.state = 'collecting'; job.error = undefined; job.failure = undefined; await this.saveJob(job); this.start(); return job
    })
  }
  /** Public for deterministic scheduler tests. Network work is serialized, bounded and never auto-resubmitted. */
  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.init()
      const jobs = await this.repository.list<AssetJob>('job')
      for (const candidate of jobs) {
        if (finalStates.has(candidate.state) || (this.nextPoll.get(candidate.id) || 0) > Date.now()) continue
        const job = await this.exclusive(async () => {
          const current = await this.job(candidate.id, candidate.workspace)
          if (current.state === 'queued') {
            const cap = await this.repository.get<AssetCapability>('capability', current.capability.id)
            if (!cap?.enabled) { current.state = 'failed'; current.error = 'Capability was disabled before execution'; await this.saveJob(current); return current }
            current.state = 'submitting'; await this.saveJob(current)
          }
          return current
        })
        if (finalStates.has(job.state)) continue
        try {
          if (job.state === 'submitting') await this.executeSubmission(job)
          else if (job.state === 'running') await this.poll(job)
          else if (job.state === 'collecting') await this.collect(job)
        } catch (error) {
          const { message, failure } = describeAssetFailure(error)
          job.failure = failure
          if (job.state === 'submitting') { job.state = isRejectedSubmission(failure) ? 'failed' : 'submission_unknown'; job.error = message }
          else if (job.state === 'running') {
            job.error = message
            this.nextPoll.set(job.id, Date.now() + 30_000)
          } else { job.state = 'failed'; job.error = message }
          await this.saveJob(job)
        }
      }
    } finally { this.busy = false }
  }
  private async headers(cap: AssetCapability): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...cap.request.headers }
    if (cap.auth) {
      const secret = await this.options.secret(cap.id)
      if (!secret) throw new Error('Capability credential unavailable')
      headers[cap.auth.header] = cap.auth.prefix + secret
    }
    for (const [name, value] of Object.entries(headers)) {
      try { validateHeaderName(name); validateHeaderValue(name, value) }
      catch { throw new AssetRequestError({ kind: 'credential' }, 'Invalid HTTP header format. Check header names and credentials for unsupported characters or line breaks.') }
    }
    return headers
  }
  private async responseBytes(response: Response, limit: number, secrets: string[] = []): Promise<Buffer> {
    if (!response.ok) throw await readAssetHttpError(response, secrets)
    if (Number(response.headers.get('content-length') || 0) > limit) { await response.body?.cancel(); throw new AssetRequestError({ kind: 'response', code: 'size_limit' }, 'Response exceeds configured size limit') }
    const reader = response.body?.getReader()
    if (!reader) throw new AssetRequestError({ kind: 'response', code: 'empty' }, 'Empty HTTP response')
    const chunks: Buffer[] = []; let total = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        total += chunk.value.length
        if (total > limit) throw new AssetRequestError({ kind: 'response', code: 'size_limit' }, 'Response exceeds configured size limit')
        chunks.push(Buffer.from(chunk.value))
      }
    } finally { await reader.cancel().catch(() => {}) }
    return Buffer.concat(chunks)
  }
  private async json(url: string, init: RequestInit, timeoutSeconds = 60, secrets: string[] = []): Promise<unknown> {
    const response = await this.request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutSeconds * 1000) })
    const bytes = await this.responseBytes(response, 32 * 1024 * 1024, secrets)
    try { return JSON.parse(bytes.toString('utf8')) }
    catch { throw new AssetRequestError({ kind: 'response', code: 'invalid_json' }, 'The service returned an invalid JSON response.') }
  }
  private async resolveInputs(schema: AssetInputSchema, value: unknown, workspace: string): Promise<unknown> {
    if (schema.format === 'asset-image') {
      const asset = await this.asset(String(value), workspace)
      if (asset.kind !== 'image' || asset.bytes > 15 * 1024 * 1024) throw new Error('Reference must be an image under 15 MB')
      const bytes = await fs.readFile(await this.filePath(asset))
      return `data:${asset.mimeType};base64,${bytes.toString('base64')}`
    }
    if (schema.type === 'object' && value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await this.resolveInputs(schema.properties![key], child, workspace)]))
      return Object.fromEntries(entries)
    }
    if (schema.type === 'array' && Array.isArray(value)) return Promise.all(value.map(v => this.resolveInputs(schema.items!, v, workspace)))
    return value
  }
  private async executeSubmission(job: AssetJob): Promise<void> {
    // Resolve all local inputs before making a chargeable request.
    let body: unknown; let headers: Record<string, string>
    try {
      await this.checkWritable(job.storageRoot)
      body = mapRequest(job.capability.request.body, await this.resolveInputs(job.capability.inputSchema, job.inputs, job.workspace))
      headers = await this.headers(job.capability)
    } catch (error) { job.state = 'failed'; throw error }
    const secrets = job.capability.auth ? [headers[job.capability.auth.header]] : []
    const response = await this.json(job.capability.request.url, { method: 'POST', headers, body: JSON.stringify(body) }, job.capability.request.timeoutSeconds, secrets)
    if (job.capability.async) {
      const id = readPointer(response, job.capability.async.jobIdPath)
      if (!['string', 'number'].includes(typeof id) || String(id).length > 500) throw new Error('Missing remote job ID')
      job.remoteId = String(id); job.state = 'running'
    } else { job.response = response; job.state = 'collecting' }
    await this.saveJob(job)
  }
  private async poll(job: AssetJob): Promise<void> {
    const spec = job.capability.async!
    const headers = await this.headers(job.capability)
    const response = await this.json(spec.statusUrl.replaceAll('{job_id}', encodeURIComponent(job.remoteId!)), { headers }, 60, job.capability.auth ? [headers[job.capability.auth.header]] : [])
    const status = String(readPointer(response, spec.statusPath))
    if (spec.failureValues.includes(status)) { job.state = 'failed'; job.error = `Remote generation failed (${status})` }
    else if (spec.successValues.includes(status)) { job.response = response; job.state = 'collecting'; job.error = undefined; job.failure = undefined }
    else { job.error = undefined; job.failure = undefined; this.nextPoll.set(job.id, Date.now() + spec.pollSeconds * 1000) }
    await this.saveJob(job)
  }
  private async collect(job: AssetJob): Promise<void> {
    const spec = job.capability.output
    const raw = readPointer(job.response, spec.itemsPath)
    const items = Array.isArray(raw) ? raw : [raw]
    if (!items.length || items.length > 16) throw new Error('Expected 1–16 output files')
    for (let index = 0; index < items.length; index++) {
      const id = `${job.id}-${index}`
      const existing = await this.repository.get<GeneratedAsset>('asset', id)
      if (existing) { if (!job.assetIds.includes(id)) job.assetIds.push(id); continue }
      let bytes: Buffer
      const limit = spec.maxFileMB * 1024 * 1024
      if (spec.urlPath !== undefined) {
        const url = new URL(String(readPointer(items[index], spec.urlPath)))
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || ![new URL(job.capability.request.url).origin, ...spec.allowedOrigins].includes(url.origin)) throw new Error('Output URL origin is not allowed by this capability')
        const response = await this.request(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) })
        bytes = await this.responseBytes(response, limit)
      } else {
        const encoded = readPointer(items[index], spec.base64Path!)
        if (typeof encoded !== 'string' || encoded.length > Math.ceil(limit * 4 / 3) + 100) throw new Error('Invalid or oversized Base64 output')
        bytes = Buffer.from(encoded.replace(/^data:[^;]+;base64,/, ''), 'base64')
      }
      if (!bytes.length || bytes.length > limit) throw new Error('Empty or oversized output')
      const asset = await this.writeAsset(id, job.workspace, job.storageRoot, job.capability.kind, spec.mimeType, bytes, job.id)
      job.assetIds.push(asset.id)
      await this.saveJob(job)
    }
    job.state = 'ready'; job.response = undefined; job.error = undefined; job.failure = undefined
    await this.saveJob(job)
  }
  private async writeAsset(id: string, workspace: string, root: string, kind: GeneratedAsset['kind'], mimeType: string, bytes: Buffer, jobId?: string): Promise<GeneratedAsset> {
    // Do not create a missing root here: a disconnected custom drive must not silently fall back.
    await fs.access(root)
    let width: number | undefined; let height: number | undefined
    if (kind === 'image') {
      // Use sharp's native CommonJS entry in the CJS Electron main process.
      // Its ESM entry depends on import.meta.url, which can be lost by dev loaders.
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Preserve sharp's native CommonJS entry for Electron dev loaders.
      const sharp = require('sharp') as typeof import('sharp').default
      const meta = await sharp(bytes).metadata()
      if (!['png', 'jpeg', 'webp', 'gif'].includes(meta.format || '')) throw new Error('Supported image outputs: PNG, JPEG, WebP, GIF')
      mimeType = `image/${meta.format}`; width = meta.width; height = meta.height
    }
    const partition = workspace ? createHash('sha256').update(workspace).digest('hex').slice(0, 24) : 'unassigned'
    const name = `original.${extensions[mimeType] || 'bin'}`
    const relativePath = path.join('workspaces', partition, kind, id, name)
    const destination = path.join(root, relativePath)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const realRoot = await fs.realpath(root)
    if (!isInside(realRoot, await fs.realpath(path.dirname(destination)))) throw new Error('Asset directory escapes storage root')
    const temporary = `${destination}.${randomUUID()}.partial`
    try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, destination) }
    finally { await fs.unlink(temporary).catch(() => {}) }
    const asset: GeneratedAsset = { id, workspace, jobId, root, relativePath, name, kind, mimeType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), width, height, createdAt: Date.now() }
    await this.repository.put('asset', id, asset)
    return asset
  }
  async filePath(asset: GeneratedAsset): Promise<string> {
    const root = await fs.realpath(asset.root)
    const target = await fs.realpath(path.join(root, asset.relativePath))
    if (!isInside(root, target)) throw new Error('Asset file escapes storage root')
    return target
  }
  async importImage(source: string, workspace: string): Promise<GeneratedAsset> {
    const stat = await fs.stat(source)
    if (!stat.isFile() || stat.size > 15 * 1024 * 1024) throw new Error('Choose an image file under 15 MB')
    const root = await this.effectiveRoot(workspace)
    await this.checkWritable(root)
    return this.writeAsset(randomUUID(), workspace, root, 'image', 'image/png', await fs.readFile(source))
  }
  async preview(id: string, workspace: string): Promise<string | null> {
    const asset = await this.asset(id, workspace)
    if (asset.kind !== 'image') return null
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- Preserve sharp's native CommonJS entry for Electron dev loaders.
    const sharp = require('sharp') as typeof import('sharp').default
    const buffer = await sharp(await this.filePath(asset)).resize(960, 960, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
    return `data:image/webp;base64,${buffer.toString('base64')}`
  }
}
