/**
 * Dojo（道场）模式导出
 */
export { useDojoStore, useNormalizedDojoSession } from './DojoStore'
export {
  decomposeRequirement,
  demonstrateStep,
  diagnoseFailure,
  disposeVerifyTerminal,
  gradeAnswer,
  quizForStep,
  reviewStep,
  runVerification,
} from './DojoService'
export type { DojoSession, DojoSkill, DojoSkillMastery, DojoStep, DojoStepPhase, DojoVerifyResult } from './types'
