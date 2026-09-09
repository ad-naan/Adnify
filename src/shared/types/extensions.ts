import type { AgentApprovalProof } from '@shared/security/executionPolicy'

export type ExtensionKind = 'mcp' | 'skill'
export type ExtensionScope = 'user' | 'workspace'
export type ExtensionChangeState =
  | 'prepared'
  | 'applying'
  | 'committed'
  | 'rolled_back'
  | 'failed'
  | 'expired'

export interface ExtensionSearchRequest {
  kind: ExtensionKind
  query: string
}

export interface ExtensionSearchResult {
  kind: ExtensionKind
  id: string
  name: string
  description: string
  source: string
  version?: string
  installs?: number
}

export interface ExtensionPrepareRequest {
  kind: ExtensionKind
  /** MCP registry server name, or skills.sh package in owner/repo@skill-id form. */
  source: string
  scope: ExtensionScope
  workspacePath?: string | null
}

export interface ExtensionCredentialRequirement {
  name: string
  description?: string
  secret: boolean
  required: boolean
  /** Stable identifier only; the secret value never crosses IPC back to the renderer. */
  reference?: string
  configured?: boolean
}

export interface ExtensionCredentialSetRequest {
  reference: string
  secret: string
}

export interface ExtensionCredentialStatus {
  reference: string
  configured: boolean
}

export interface ExtensionChangeSet {
  id: string
  kind: ExtensionKind
  source: string
  scope: ExtensionScope
  workspacePath?: string
  displayName: string
  resolvedVersion?: string
  summary: string
  risk: 'elevated' | 'dangerous'
  state: ExtensionChangeState
  createdAt: number
  expiresAt: number
  credentialRequirements: ExtensionCredentialRequirement[]
  error?: string
  verification?: ExtensionVerification
}

export interface ExtensionApplyRequest {
  changeSetId: string
  approval: AgentApprovalProof
}

export interface ExtensionVerification {
  ok: boolean
  status: string
  details?: Record<string, unknown>
}

export interface ExtensionOperationResult {
  success: boolean
  changeSet?: ExtensionChangeSet
  results?: ExtensionSearchResult[]
  verification?: ExtensionVerification
  installed?: InstalledExtensionSummary[]
  auditEvents?: ExtensionAuditEvent[]
  error?: string
}

export interface InstalledExtensionSummary {
  kind: ExtensionKind
  id: string
  name: string
  scope: ExtensionScope
  status: string
  sourcePath?: string
}

export type ExtensionAuditEventType =
  | 'prepared'
  | 'apply_started'
  | 'committed'
  | 'rolled_back'
  | 'failed'
  | 'verified'

export interface ExtensionAuditEvent {
  id: string
  changeSetId: string
  event: ExtensionAuditEventType
  kind: ExtensionKind
  scope: ExtensionScope
  source: string
  displayName: string
  state: ExtensionChangeState
  occurredAt: number
  status?: string
}
