import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/renderer/services/electronAPI', () => ({ api: { settings: { get: async () => null, set: async () => true } } }))
import { useDojoStore, isFreshVerification, canCompleteDojoStep, dojoWorkspaceKey, dojoStepContract } from '@/renderer/modes/dojo/DojoStore'
import type { DojoSession, DojoStep } from '@/renderer/modes/dojo/types'
const step = (id = 's1', patch: Partial<DojoStep> = {}): DojoStep => ({ id, title: 'Wire export', goal: 'Event flow', skill: 'event handlers', files: ['src/settings.ts'], verifyCommand: 'pnpm test', acceptanceCriteria: ['Click exports current config'], confirmedCriteria: [], hints: ['Inspect the handler'], hintsRevealed: 0, phase: 'handsOn', ...patch })
const training = (workspacePath = '/project/a', steps = [step()]): DojoSession => ({ id: workspacePath, workspacePath, requirement: 'Export config', steps, currentStepIndex: 0, codeRevision: 0, createdAt: 1, status: 'active' })
  it('rejects evidence from an earlier training even when task ids are reused', () => {
    useDojoStore.getState().startSession(training())
    evidence()
    const result = useDojoStore.getState().verifyResult!
    useDojoStore.getState().startSession({ ...training(), id: 'replacement-training' })
    useDojoStore.getState().setVerifyResult(result)
    expect(useDojoStore.getState().verifyResult).toBeNull()
  })
  it('rejects a late result after task files or behavior criteria change', () => {
    useDojoStore.getState().startSession(training())
    evidence()
    const result = useDojoStore.getState().verifyResult!
    useDojoStore.getState().updateStep('s1', { files: ['src/other.ts'] })
    useDojoStore.getState().setVerifyResult(result)
    expect(useDojoStore.getState().verifyResult?.stale).toBe(true)
    expect(isFreshVerification(useDojoStore.getState().session!, useDojoStore.getState().session!.steps[0])).toBe(false)
  })
  it('never treats cancelled commands or nonzero exits as passing evidence', () => {
    useDojoStore.getState().startSession(training())
    evidence({ cancelled: true })
    let session = useDojoStore.getState().session!
    expect(isFreshVerification(session, session.steps[0])).toBe(false)
    evidence({ exitCode: 1 })
    session = useDojoStore.getState().session!
    expect(isFreshVerification(session, session.steps[0])).toBe(false)
  })
  it('does not complete a proposed plan before the learner starts practice', () => {
    useDojoStore.getState().startSession({ ...training('/project/a', [step('s1', { verifyCommand: '', confirmedCriteria: ['Click exports current config'] })]), status: 'planning' })
    expect(useDojoStore.getState().completeStep('s1')).toBe(false)
  })


function evidence(patch = {}) {
  const session = useDojoStore.getState().session!
  useDojoStore.getState().setVerifyResult({ success: true, exitCode: 0, output: 'tests passed', ranAt: 2, sessionId: session.id, stepContract: dojoStepContract(session.steps[0]), stepId: 's1', command: 'pnpm test', workspacePath: '/project/a', codeRevision: 0, fileVersions: { 'src/settings.ts': 'abc' }, ...patch })
}
beforeEach(() => useDojoStore.setState({ session: null, sessions: {}, skills: [], legacySession: null, activeWorkspacePath: '', verifyResult: null, mentorBusy: false, error: null }))

describe('Dojo evidence and workspace boundaries', () => {
  it('isolates and restores sessions by workspace', () => {
    const store = useDojoStore.getState()
    store.startSession(training())
    store.appendMessage({ role: 'mentor', content: 'project A context' })
    store.selectWorkspace('/project/b')
    expect(useDojoStore.getState().session).toBeNull()
    store.startSession(training('/project/b'))
    store.selectWorkspace('/project/a')
    expect(useDojoStore.getState().session?.messages?.[0].content).toBe('project A context')
    expect(useDojoStore.getState().session?.workspacePath).toBe('/project/a')
  })
  it('normalizes Windows workspace paths without collapsing Linux case', () => {
    expect(dojoWorkspaceKey('D:\\Repo\\App\\')).toBe(dojoWorkspaceKey('d:/repo/app'))
    expect(dojoWorkspaceKey('/repo/App')).not.toBe(dojoWorkspaceKey('/repo/app'))
  })
  it('requires behavior evidence in addition to a passing command', () => {
    useDojoStore.getState().startSession(training())
    evidence()
    let session = useDojoStore.getState().session!
    expect(isFreshVerification(session, session.steps[0])).toBe(true)
    expect(canCompleteDojoStep(session, session.steps[0])).toBe(false)
    useDojoStore.getState().updateStep('s1', { confirmedCriteria: ['Click exports current config'] })
    session = useDojoStore.getState().session!
    expect(canCompleteDojoStep(session, session.steps[0])).toBe(true)
  })
  it('invalidates old checks and confirmations on code change without destroying raw logs', () => {
    useDojoStore.getState().startSession(training())
    evidence()
    useDojoStore.getState().updateStep('s1', { confirmedCriteria: ['Click exports current config'], diagnosis: 'Your handler is not connected' })
    useDojoStore.getState().invalidateVerification()
    const session = useDojoStore.getState().session!
    expect(session.codeRevision).toBe(1)
    expect(isFreshVerification(session, session.steps[0])).toBe(false)
    expect(session.steps[0].verification?.output).toBe('tests passed')
    expect(session.steps[0].diagnosis).toBe('Your handler is not connected')
    expect(session.steps[0].confirmedCriteria).toEqual([])
  })
  it('rejects foreign results and marks late results stale', () => {
    useDojoStore.getState().startSession(training())
    evidence({ workspacePath: '/project/b' })
    expect(useDojoStore.getState().verifyResult).toBeNull()
    useDojoStore.getState().invalidateVerification()
    evidence()
    expect(useDojoStore.getState().verifyResult?.stale).toBe(true)
  })
  it('invalidates evidence when the check or criteria are edited', () => {
    useDojoStore.getState().startSession(training())
    evidence()
    useDojoStore.getState().updateStep('s1', { verifyCommand: 'pnpm test --filter export' })
    const session = useDojoStore.getState().session!
    expect(isFreshVerification(session, session.steps[0])).toBe(false)
    expect(session.steps[0].verification?.output).toBe('tests passed')
  })
  it('completes manual-only tasks and records the same skill on the final task', () => {
    useDojoStore.getState().startSession(training('/project/a', [step('s1', { verifyCommand: '', confirmedCriteria: ['Click exports current config'], hintsRevealed: 1 })]))
    useDojoStore.getState().recordSkill('event handlers', 'learning')
    expect(useDojoStore.getState().completeStep('s1')).toBe(true)
    expect(useDojoStore.getState().session?.status).toBe('completed')
    expect(useDojoStore.getState().skills).toEqual([expect.objectContaining({ id: 'event handlers', mastery: 'passed' })])
  })
  it('does not award mastery merely because no hints were revealed', () => {
    useDojoStore.getState().startSession(training('/project/a', [step('s1', { verifyCommand: '', confirmedCriteria: ['Click exports current config'] })]))
    expect(useDojoStore.getState().completeStep('s1')).toBe(true)
    expect(useDojoStore.getState().skills[0].mastery).toBe('passed')
  })
  it('keeps completed earlier practice while making its old evidence stale', () => {
    useDojoStore.getState().startSession(training('/project/a', [step('s1', { phase: 'passed', verifyCommand: '' }), step('s2')]))
    useDojoStore.getState().selectStep('s2')
    useDojoStore.getState().invalidateVerification()
    expect(useDojoStore.getState().session?.steps[0].phase).toBe('passed')
  })
  it('requires explicit migration before applying an unbound legacy session', () => {
    useDojoStore.setState({ legacySession: { ...training(), workspacePath: '' } })
    useDojoStore.getState().selectWorkspace('/project/a')
    expect(useDojoStore.getState().session).toBeNull()
    useDojoStore.getState().adoptLegacySession('/project/a')
    expect(useDojoStore.getState().session?.status).toBe('planning')
    expect(useDojoStore.getState().session?.workspacePath).toBe('/project/a')
    expect(useDojoStore.getState().legacySession).toBeNull()
  })
})
