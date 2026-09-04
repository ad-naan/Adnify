import { z } from 'zod'
import type { ToolProvider } from './types'
import type { ToolConfig } from '@shared/config/tools'
import type { ToolLoadingContext } from '@shared/config/toolGroups'
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '@shared/types'
import type { AssetCapability, AssetJobSummary, AssetSnapshot, GeneratedAsset } from '@shared/types/assets'
import { compileInputs } from '@shared/assets/capability'
import { assetService } from '@services/assetService'

const definitions: ToolDefinition[] = [
  { name: 'asset_capabilities', description: 'List user-configured generation capabilities and imported assets. No built-in providers. Use asset IDs as references.', parameters: { type: 'object', properties: {} } },
  { name: 'asset_import', description: 'Import a workspace image into the asset library. Returns a stable asset ID for generation inputs. Does not upload it.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'asset_job_get', description: 'Inspect a previous generation after reopening a conversation or stopping a wait. Generation tools already wait until finished; do not repeatedly call this to poll.', parameters: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  { name: 'asset_job_cancel', description: 'Cancel a locally queued generation. Running remote tasks cannot be cancelled by this tool.', parameters: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  { name: 'asset_export', description: 'Copy an asset into an existing workspace directory without overwriting. Returns the actual project path. Export only after the job is ready.', parameters: { type: 'object', properties: { asset_id: { type: 'string' }, destination: { type: 'string' } }, required: ['asset_id', 'destination'] } },
]
const id = z.string().min(1).max(200)
const activeStates = new Set(['queued', 'submitting', 'running', 'collecting'])
function jobResult(job: AssetJobSummary): string {
  return JSON.stringify({ ...job, assetUrls: job.state === 'ready' ? job.assetIds.map(id => `asset://${id}`) : [] })
}
function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new Error('Waiting stopped. The persisted job may still finish; do not resubmit it.')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve() }, 2000)
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
  })
}
const schemas: Record<string, z.ZodTypeAny> = {
  asset_capabilities: z.object({}).strict(), asset_import: z.object({ path: z.string().min(1) }).strict(),
  asset_job_get: z.object({ job_id: id }).strict(), asset_job_wait: z.object({ job_id: id, after_revision: z.number().optional() }).strict(),
  asset_job_cancel: z.object({ job_id: id }).strict(), asset_export: z.object({ asset_id: id, destination: z.string().min(1) }).strict(),
}

export class AssetToolProvider implements ToolProvider {
  readonly id = 'assets'
  readonly name = 'Asset tools'
  private context: ToolLoadingContext = { mode: 'agent' }
  private active: AssetCapability[] = []
  // Versioned names keep concurrent model turns from silently switching schemas.
  private versions = new Map<string, AssetCapability>()
  setContext(context: ToolLoadingContext): void { this.context = context }
  async refresh(): Promise<void> {
    this.active = []
    if (typeof window === 'undefined' || !window.electronAPI?.assetRequest) return
    const snapshot = await assetService.request<AssetSnapshot>({ type: 'snapshot' })
    this.active = snapshot.capabilities.filter(cap => cap.enabled)
    for (const cap of this.active) this.versions.set(this.toolName(cap), cap)
  }
  private toolName(cap: AssetCapability): string { return `asset__${cap.id}__r${cap.revision}` }
  hasTool(name: string): boolean { return !!schemas[name] || this.versions.has(name) }
  getToolDefinitions(): ToolDefinition[] {
    const readOnly = this.context.isSubAgent || (this.context.mode === 'plan' && this.context.planPhase !== 'executing')
    const common = readOnly ? definitions.filter(d => ['asset_capabilities', 'asset_job_get'].includes(d.name)) : definitions
    return [...common, ...(readOnly ? [] : this.active.map(cap => ({
      name: this.toolName(cap), description: `${cap.description}\nGenerates ${cap.kind} using the user's configured service and waits for the final assets in this single call. May incur charges. Progress and previews appear automatically in its asset card. Do not call other tools to poll, resubmit, or display the same result. If embedding an image in your reply, use a returned assetUrls entry verbatim as the Markdown image URL. Never infer a filename from storageRoot.`,
      parameters: cap.inputSchema as ToolDefinition['parameters'],
    })))]
  }
  getApprovalType(name: string) { return this.versions.has(name) || name === 'asset_export' ? 'dangerous' as const : 'none' as const }
  getMetadata(name: string): ToolConfig | undefined {
    if (!this.hasTool(name)) return undefined
    return {
      name, displayName: this.versions.get(name)?.name || name, description: 'User-defined asset tool',
      category: 'network', approvalType: this.getApprovalType(name), parallel: false, outputFormat: 'json',
      retryPolicy: { maxAttempts: 1 }, requiresWorkspace: false, enabled: true, parameters: {},
    }
  }
  validateArgs(name: string, args: unknown) {
    const cap = this.versions.get(name)
    const clean = { ...(args as Record<string, unknown>) }; delete clean._meta
    const result = (cap ? compileInputs(cap.inputSchema) : schemas[name])?.safeParse(clean)
    return { valid: !!result?.success, error: result && !result.success ? result.error.message : undefined }
  }
  async execute(name: string, rawArgs: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (ctx.abortSignal?.aborted) throw new Error('Execution stopped before starting the asset operation')
    if ((ctx.isSubAgent || (ctx.chatMode === 'plan' && ctx.planPhase !== 'executing')) && !['asset_capabilities', 'asset_job_get'].includes(name)) throw new Error('This asset operation is unavailable in planning or hidden agents')
    const args = { ...rawArgs }; delete args._meta
    const cap = this.versions.get(name)
    if (this.getApprovalType(name) !== 'none' && !ctx.securityApproval) throw new Error('This asset operation requires approval')
    let result: unknown
    if (cap) {
      const job = await assetService.request<AssetJobSummary>({ type: 'submit', capabilityId: cap.id, revision: cap.revision, inputs: args, toolCallId: ctx.toolCallId!, threadId: ctx.threadId || undefined })
      return this.waitForResult(job, ctx, cap.kind)
    } else if (name === 'asset_capabilities') {
      const snapshot = await assetService.request<AssetSnapshot>({ type: 'snapshot' })
      result = { capabilities: snapshot.capabilities.filter(c => c.enabled).slice(0, 20).map(c => ({ tool: this.toolName(c), name: c.name, kind: c.kind })), assets: snapshot.assets.slice(0, 10).map(a => ({ id: a.id, kind: a.kind, width: a.width, height: a.height })), jobs: snapshot.jobs.slice(0, 5).map(j => ({ id: j.id, state: j.state, assetIds: j.assetIds })) }
    } else if (name === 'asset_import') result = await assetService.request<GeneratedAsset>({ type: 'import', path: args.path as string })
    else if (name === 'asset_export') result = await assetService.request({ type: 'export', id: args.asset_id as string, destination: args.destination as string })
    else if (name === 'asset_job_cancel') result = await assetService.request({ type: 'cancel', id: args.job_id as string })
    else {
      const job = await assetService.request<AssetJobSummary>({ type: 'job', id: args.job_id as string })
      if (name === 'asset_job_wait') {
        // Execute persisted legacy calls, but no longer advertise a separate wait tool.
        return this.waitForResult(job, ctx)
      }
      result = job
    }
    const job = result as AssetJobSummary
    return { success: true, result: job?.capabilityName ? jobResult(job) : JSON.stringify(result), richContent: job?.capabilityName ? [{ type: 'asset-job', jobId: job.id }] : undefined }
  }
  private async waitForResult(initial: AssetJobSummary, ctx: ToolExecutionContext, kind?: AssetCapability['kind']): Promise<ToolExecutionResult> {
    let job = initial
    const presentation = { meta: { assetJobId: job.id, assetName: job.capabilityName, assetKind: kind }, richContent: [{ type: 'asset-job' as const, jobId: job.id }] }
    ctx.onProgress?.(presentation)
    try {
      while (activeStates.has(job.state)) {
        await pause(ctx.abortSignal)
        job = await assetService.request<AssetJobSummary>({ type: 'job', id: job.id })
      }
      const success = job.state === 'ready'
      return { ...presentation, success, result: jobResult(job), error: success ? undefined : `Asset job ${job.id}: ${job.error || job.state}. Do not automatically resubmit generation.`, outcome: { kind: success ? 'success' : 'error', retryable: false } }
    } catch (error) {
      return { ...presentation, success: false, result: JSON.stringify(job), error: `Asset job ${job.id}: ${(error as Error).message}. The job is retained; do not create another generation to recover it.`, outcome: { kind: 'error', retryable: false } }
    }
  }
}
export const assetToolProvider = new AssetToolProvider()
