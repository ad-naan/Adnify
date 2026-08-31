export type ExecutionLaneStatus = 'pending' | 'active' | 'ready' | 'merged' | 'conflict' | 'failed'

export interface ExecutionLaneProjection {
  status: ExecutionLaneStatus
  path?: string
  branch?: string
  baseBranch?: string
  commit?: string
  conflicts?: string[]
  error?: string
}
