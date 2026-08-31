import { gitService } from '@/renderer/services/gitService'
import { WorktreeLaneService, type WorktreeLaneCompletion, type WorktreeLaneHandle } from './WorktreeLaneService'

export type ExecutionNodeKind = 'agent-session' | 'sub-agent' | 'plan-task'

export interface ExecutionLaneIntent {
  kind: ExecutionNodeKind
  workspacePath: string | null
  label: string
  mayWrite: boolean
  concurrent: boolean
}

export interface ExecutionLaneAssignment {
  workspacePath: string | null
  isolated: boolean
  lane?: WorktreeLaneHandle
}

class ExecutionLaneCoordinatorClass {
  async acquire(intent: ExecutionLaneIntent): Promise<ExecutionLaneAssignment> {
    if (!intent.workspacePath || !intent.mayWrite || !intent.concurrent) {
      return { workspacePath: intent.workspacePath, isolated: false }
    }
    if (!await gitService.getCurrentBranch(intent.workspacePath)) {
      throw new Error(`Concurrent write execution requires a Git repository (${intent.kind}). Run this task exclusively instead.`)
    }
    const lane = await WorktreeLaneService.create(intent.workspacePath, intent.label)
    return { workspacePath: lane.path, isolated: true, lane }
  }

  async complete(assignment: ExecutionLaneAssignment, message: string): Promise<WorktreeLaneCompletion | null> {
    return assignment.lane ? WorktreeLaneService.complete(assignment.lane, message) : null
  }
}

export const ExecutionLaneCoordinator = new ExecutionLaneCoordinatorClass()
