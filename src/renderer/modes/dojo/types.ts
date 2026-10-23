/** Hands-on project training. Teaching strategies are optional, completion is evidence-based. */
export type DojoStepPhase = 'demo' | 'handsOn' | 'quiz' | 'review' | 'passed'
export type DojoSessionStatus = 'planning' | 'active' | 'completed'

export interface DojoStep {
  id: string
  title: string
  goal: string
  skill?: string
  files: string[]
  verifyCommand: string
  /** Observable behavior, not just a successful build. Confirmed by the learner. */
  acceptanceCriteria?: string[]
  confirmedCriteria?: string[]
  hints: string[]
  hintsRevealed: number
  demo?: string
  quiz?: { question: string; lastAnswer?: string; attempts: number; passed: boolean; feedback?: string }
  review?: string
  diagnosis?: string
  verification?: DojoVerifyResult
  phase: DojoStepPhase
}

export type DojoSkillMastery = 'learning' | 'passed' | 'mastered'
export interface DojoSkill {
  id: string
  name: string
  mastery: DojoSkillMastery
  lastSeenAt: number
}

export interface DojoMessage {
  id: string
  role: 'user' | 'mentor' | 'system'
  content: string
  createdAt: number
  stepId?: string
  codeRevision?: number
  kind?: 'conversation' | 'demo' | 'hint' | 'verification' | 'review'
}

export interface DojoSession {
  id: string
  workspacePath: string
  requirement: string
  blueprint?: string
  status?: DojoSessionStatus
  mentorThreadId?: string
  messages?: DojoMessage[]
  steps: DojoStep[]
  currentStepIndex: number
  createdAt: number
  updatedAt?: number
  /** Changes when workspace source or an editor buffer changes. */
  codeRevision?: number
}

export interface DojoVerifyResult {
  success: boolean
  exitCode: number | null
  /** Immutable raw command output. Mentor feedback lives in step.diagnosis. */
  output: string
  ranAt: number
  /** Bind evidence to its training session and the task contract that was actually checked. */
  sessionId?: string
  stepContract?: string
  stepId?: string
  workspacePath?: string
  command?: string
  codeRevision?: number
  /** Content fingerprints for the files observed when the command started. */
  fileVersions?: Record<string, string>
  stale?: boolean
  cancelled?: boolean
}
