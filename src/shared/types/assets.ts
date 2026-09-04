/** User-defined media capabilities. No provider-specific defaults. */
export type AssetKind = 'image' | 'video' | 'model3d' | 'audio' | 'file'
export interface AssetInputSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  properties?: Record<string, AssetInputSchema>
  required?: string[]
  items?: AssetInputSchema
  additionalProperties?: false
  /** Convert a registered image ID to a data URI before request mapping. */
  format?: 'asset-image'
}
export interface AssetCapability {
  id: string
  revision: number
  name: string
  description: string
  enabled: boolean
  kind: AssetKind
  inputSchema: AssetInputSchema & { type: 'object' }
  request: { url: string; body: unknown; headers?: Record<string, string>; timeoutSeconds?: number }
  auth?: { header: string; prefix: string }
  async?: {
    jobIdPath: string
    statusUrl: string
    statusPath: string
    successValues: string[]
    failureValues: string[]
    pollSeconds: number
  }
  output: {
    itemsPath: string
    urlPath?: string
    base64Path?: string
    mimeType: string
    allowedOrigins: string[]
    maxFileMB: number
  }
}
export interface AssetStorageSettings {
  defaultRoot: string
  customRoot?: string
  projectRoots: Record<string, string>
}
export type AssetJobState = 'queued' | 'submitting' | 'running' | 'collecting' | 'ready' | 'failed' | 'submission_unknown' | 'cancelled'
export interface AssetFailure {
  kind: 'http' | 'network' | 'timeout' | 'response' | 'credential'
  status?: number
  code?: string
  detail?: string
}
export interface AssetJob {
  id: string
  workspace: string
  threadId?: string
  idempotencyKey: string
  capability: AssetCapability
  inputs: Record<string, unknown>
  storageRoot: string
  state: AssetJobState
  revision: number
  remoteId?: string
  response?: unknown
  assetIds: string[]
  error?: string
  failure?: AssetFailure
  createdAt: number
  updatedAt: number
  historyDeletedAt?: number
}
export interface GeneratedAsset {
  id: string
  workspace: string
  jobId?: string
  name: string
  kind: AssetKind
  mimeType: string
  root: string
  relativePath: string
  bytes: number
  sha256: string
  width?: number
  height?: number
  createdAt: number
  historyDeletedAt?: number
}
export type AssetHistoryKind = 'jobs' | 'references'
export interface AssetHistoryPage {
  jobs: AssetJobSummary[]
  assets: GeneratedAsset[]
  total: number
  clearable: number
  page: number
  pageSize: number
}
export interface AssetSnapshot {
  capabilities: AssetCapability[]
  storage: AssetStorageSettings
  effectiveRoot: string
  workspace: string
  jobs: AssetJobSummary[]
  assets: GeneratedAsset[]
  credentials: string[]
}
export type AssetJobSummary = Omit<AssetJob, 'response' | 'inputs' | 'capability' | 'idempotencyKey'> & { capabilityName: string; prompt?: string; canRetryCollection?: boolean }
export type AssetAction =
  | { type: 'history'; kind: AssetHistoryKind; page: number }
  | { type: 'removeHistory'; kind: AssetHistoryKind; id: string }
  | { type: 'clearHistory'; kind: AssetHistoryKind }
  | { type: 'snapshot' }
  | { type: 'saveCapability'; capability: AssetCapability; secret?: string }
  | { type: 'deleteCapability'; id: string }
  | { type: 'chooseStorage'; scope: 'global' | 'project' }
  | { type: 'useProjectStorage' }
  | { type: 'resetStorage'; scope: 'global' | 'project' }
  | { type: 'openStorage' }
  | { type: 'submit'; capabilityId: string; revision: number; inputs: Record<string, unknown>; toolCallId: string; threadId?: string }
  | { type: 'job'; id: string }
  | { type: 'retryCollection'; id: string }
  | { type: 'cancel'; id: string }
  | { type: 'import'; path?: string }
  | { type: 'preview'; id: string }
  | { type: 'mediaPreview'; id: string }
  | { type: 'openAsset'; id: string }
  | { type: 'export'; id: string; destination?: string }

export interface AssetAPI {
  request<T = unknown>(action: AssetAction): Promise<T>
}

export function summarizeAssetJob(job: AssetJob): AssetJobSummary {
  const { response: _response, inputs: _inputs, capability, idempotencyKey: _key, ...summary } = job
  return { ...summary, capabilityName: capability.name, prompt: typeof _inputs?.prompt === 'string' ? _inputs.prompt : undefined, canRetryCollection: job.state === 'failed' && job.response !== undefined }
}
