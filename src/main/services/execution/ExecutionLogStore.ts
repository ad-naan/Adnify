import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { isExecutionFinished, type ExecutionSnapshot } from '@shared/types/execution'
import { normalizeExecutionSettings, type ExecutionSettings } from '@shared/config/executionSettings'

interface RecordEntry { snapshot: ExecutionSnapshot; bytes: number; pending: string; active: boolean }
export function utf8Tail(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text)
  let start = Math.max(0, bytes.length - maxBytes)
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString('utf8')
}

/** One serialized writer, bounded pending output, and no process resurrection on recovery. */
export class ExecutionLogStore {
  private records = new Map<string, RecordEntry>()
  private settings: ExecutionSettings
  private timer?: ReturnType<typeof setTimeout>
  private chain = Promise.resolve()
  private readonly ready: Promise<void>
  constructor(private readonly directory: string, settings?: unknown) {
    this.settings = normalizeExecutionSettings(settings)
    this.ready = this.restore().catch(error => {
      for (const row of this.records.values()) { row.snapshot.logError = String(error); row.snapshot.logTruncated = true }
    })
  }
  private file(id: string): string {
    const recovered = /^recovered:([a-f0-9]{64})$/.exec(id)
    return path.join(this.directory, (recovered?.[1] || createHash('sha256').update(id).digest('hex')) + '.log')
  }
  private async restore(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    try {
      const stat = await fs.stat(path.join(this.directory, 'index.json'))
      if (stat.size > 8 * 1024 * 1024) throw new Error('Archive index is too large')
      const rows: ExecutionSnapshot[] = JSON.parse(await fs.readFile(path.join(this.directory, 'index.json'), 'utf8'))
      if (!Array.isArray(rows)) throw new Error('Invalid archive index')
      for (const row of rows.slice(-1024)) {
        if (!row || typeof row.jobId !== 'string' || row.jobId.length > 512) continue
        const snapshot = { ...row, output: '', archived: true, hosted: false, logTruncated: Boolean(row.logTruncated) }
        if (!isExecutionFinished(snapshot.status)) {
          snapshot.status = 'unknown'
          snapshot.reason = 'application_restarted_unconfirmed'
        }
        const bytes = await fs.stat(this.file(row.jobId)).then(s => s.size).catch(() => 0)
        // A new live job may have been registered while disk recovery was pending.
        if (!this.records.has(row.jobId)) this.records.set(row.jobId, { snapshot, bytes, pending: '', active: false })
      }
    } catch { /* first launch or damaged index; never infer that old processes restarted */ }
    // A crash can leave a log written before the index commit. Recover it as read-only history
    // so its bytes remain accounted for, instead of leaking an invisible file on every restart.
    const known = new Set([...this.records.keys()].map(id => path.basename(this.file(id))))
    for (const name of await fs.readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.log$/.test(name) || known.has(name)) continue
      const stat = await fs.stat(path.join(this.directory, name))
      const id = `recovered:${name.slice(0, -4)}`
      this.records.set(id, { bytes: stat.size, pending: '', active: false, snapshot: {
        jobId: id, requestKey: '', threadId: '', command: name, cwd: '', shell: '', mode: 'command',
        submittedAt: stat.mtimeMs, status: 'unknown', exitCode: null, output: '', truncated: true,
        revision: 1, archived: true, logTruncated: true, reason: 'application_restarted_unconfirmed',
      } })
    }
  }
  configure(settings: ExecutionSettings): void { this.settings = settings; this.schedule() }
  update(snapshot: ExecutionSnapshot, active = !isExecutionFinished(snapshot.status)): void {
    const existing = this.records.get(snapshot.jobId)
    const saved = { ...snapshot, output: '', command: snapshot.command.slice(0, 4096), requestKey: '',
      pinned: existing?.snapshot.pinned, logTruncated: Boolean(existing?.snapshot.logTruncated), logError: existing?.snapshot.logError }
    if (existing) { existing.snapshot = saved; existing.active = active }
    else this.records.set(snapshot.jobId, { snapshot: saved, bytes: 0, pending: '', active })
    this.schedule()
  }
  append(id: string, text: string): void {
    const entry = this.records.get(id)
    if (!entry || !text) return
    const pending = entry.pending + text
    entry.pending = utf8Tail(pending, this.settings.outputBytes)
    if (Buffer.byteLength(pending) > Buffer.byteLength(entry.pending)) entry.snapshot.logTruncated = true
    let total = [...this.records.values()].reduce((n, r) => n + Buffer.byteLength(r.pending), 0)
    for (const row of this.records.values()) {
      if (total <= this.settings.memoryBytes) break
      const size = Buffer.byteLength(row.pending)
      if (!size) continue
      total -= size
      row.pending = ''
      row.snapshot.logTruncated = true
    }
    this.schedule()
  }
  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, 250)
    this.timer.unref?.()
  }
  flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined
    this.chain = this.chain.then(async () => {
      await this.ready
      for (const [id, row] of [...this.records]) {
        const pending = row.pending
        row.pending = ''
        try {
          if (pending) {
            await fs.appendFile(this.file(id), pending, { mode: 0o600 })
            row.bytes += Buffer.byteLength(pending)
          }
          if (row.bytes > this.settings.logBytes) await this.trim(id, row, this.settings.logBytes)
        } catch (error) {
          row.snapshot.logError = error instanceof Error ? error.message : String(error)
          row.snapshot.logTruncated = true
        }
      }
      // Metadata is bounded too. Pinned history stays ahead of ordinary finished history.
      const ordered = [...this.records].sort(([, a], [, b]) => Number(a.active) - Number(b.active)
        || Number(Boolean(a.snapshot.pinned)) - Number(Boolean(b.snapshot.pinned))
        || a.snapshot.submittedAt - b.snapshot.submittedAt)
      for (const [id, row] of ordered) {
        if (this.records.size <= 1024) break
        if (row.active || row.snapshot.pinned) continue
        await fs.rm(this.file(id), { force: true })
        this.records.delete(id)
      }
      const metadata = () => JSON.stringify([...this.records.values()].map(row => row.snapshot))
      let total = [...this.records.values()].reduce((n, row) => n + row.bytes, 0) + Buffer.byteLength(metadata())
      for (const [id, row] of ordered) {
        if (total <= this.settings.diskBytes) break
        if (!this.records.has(id) || !row.bytes) continue
        // Keep pinned logs intact. Refuse further pinning if their reservation cannot fit.
        if (row.snapshot.pinned) continue
        const before = row.bytes
        await this.trim(id, row, Math.max(0, row.bytes - (total - this.settings.diskBytes)))
        total -= before - row.bytes
      }
      // A configured reduction can exceed pinned reservations: truncate visibly, never grow forever.
      for (const [id, row] of ordered) {
        if (total <= this.settings.diskBytes) break
        if (!this.records.has(id) || !row.bytes) continue
        const before = row.bytes
        await this.trim(id, row, Math.max(0, row.bytes - (total - this.settings.diskBytes)))
        total -= before - row.bytes
      }
      // Drop old metadata only after its log is gone; retained logs never become orphan files.
      for (const [id, row] of ordered) {
        if (Buffer.byteLength(metadata()) <= Math.min(this.settings.diskBytes / 4, 4 * 1024 * 1024)) break
        if (row.active || row.snapshot.pinned) continue
        await fs.rm(this.file(id), { force: true }); this.records.delete(id)
      }
      await fs.writeFile(path.join(this.directory, 'index.tmp'), metadata(), { mode: 0o600 })
      await fs.rename(path.join(this.directory, 'index.tmp'), path.join(this.directory, 'index.json'))
    }).catch(error => {
      for (const row of this.records.values()) {
        row.snapshot.logError = error instanceof Error ? error.message : String(error)
        row.snapshot.logTruncated = true
      }
    })
    return this.chain
  }
  private async trim(id: string, row: RecordEntry, size: number): Promise<void> {
    const handle = await fs.open(this.file(id), 'r')
    let text: string
    try {
      const buffer = Buffer.alloc(Math.floor(size))
      const result = await handle.read(buffer, 0, buffer.length, Math.max(0, row.bytes - buffer.length))
      let start = 0
      while (start < result.bytesRead && (buffer[start] & 0xc0) === 0x80) start++
      text = buffer.subarray(start, result.bytesRead).toString('utf8')
    } finally { await handle.close() }
    await fs.writeFile(this.file(id), text)
    row.bytes = Buffer.byteLength(text)
    row.snapshot.logTruncated = true
  }
  async list(): Promise<ExecutionSnapshot[]> {
    await this.ready
    return [...this.records.values()].map(r => ({ ...r.snapshot, archived: !r.active }))
      .sort((a, b) => b.submittedAt - a.submittedAt)
  }
  async read(id: string): Promise<{ output: string; truncated: boolean; error?: string }> {
    await this.flush()
    const row = this.records.get(id)
    if (!row) throw new Error('log_not_found')
    const output = await fs.readFile(this.file(id), 'utf8').catch(() => '')
    return { output: utf8Tail(output, 1024 * 1024), truncated: Boolean(row.snapshot.logTruncated) || Buffer.byteLength(output) > 1024 * 1024, error: row.snapshot.logError }
  }
  async pin(id: string, pinned: boolean): Promise<void> {
    await this.flush()
    const row = this.records.get(id)
    if (!row) throw new Error('log_not_found')
    if (pinned && row.active) throw new Error('Only finished logs can be pinned')
    const reserved = [...this.records.values()].filter(r => r.snapshot.pinned && r !== row).reduce((n, r) => n + r.bytes, 0)
    if (pinned && (reserved + row.bytes > this.settings.diskBytes * 0.75 || [...this.records.values()].filter(r => r.snapshot.pinned).length >= 256)) {
      throw new Error('Pinned log budget is full; export or unpin older logs first')
    }
    row.snapshot.pinned = pinned
    await this.flush()
  }
  async delete(id: string): Promise<void> {
    await this.flush()
    if (this.records.get(id)?.active) throw new Error('Cannot delete a live execution log')
    this.records.delete(id)
    await fs.rm(this.file(id), { force: true })
    await this.flush()
  }
  async export(id: string, target: string): Promise<void> {
    await this.flush()
    if (!this.records.has(id)) throw new Error('log_not_found')
    await fs.copyFile(this.file(id), target)
  }
}
