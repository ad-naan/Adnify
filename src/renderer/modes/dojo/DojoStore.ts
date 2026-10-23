import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { api } from '@/renderer/services/electronAPI'
import { resolvePathLexically, pathEquals } from '@shared/utils/pathUtils'
import type { DojoSession, DojoSkill, DojoSkillMastery, DojoStep, DojoVerifyResult, DojoMessage } from './types'

export function dojoWorkspaceKey(path: string): string {
  const normalized = resolvePathLexically(path, null).replace(/\/$/, '')
  return /^[a-z]:|^\/\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function isFreshVerification(session: DojoSession, step: DojoStep): boolean {
  const result = step.verification
  return Boolean(result?.success && !result.stale && result.stepId === step.id &&
    result.command === step.verifyCommand && pathEquals(result.workspacePath ?? '', session.workspacePath) &&
    result.codeRevision === (session.codeRevision ?? 0))
}

export function canCompleteDojoStep(session: DojoSession, step: DojoStep): boolean {
  const criteria = step.acceptanceCriteria ?? []
  return criteria.length > 0 && criteria.every(item => step.confirmedCriteria?.includes(item)) &&
    (!step.verifyCommand.trim() || isFreshVerification(session, step))
}

interface DojoStore {
  session: DojoSession | null
  sessions: Record<string, DojoSession>
  /** Keep the old unbound session intact; never silently apply it to another project. */
  legacySession: DojoSession | null
  activeWorkspacePath: string
  skills: DojoSkill[]
  mentorBusy: boolean
  activeMentorThreadId: string | null
  verifyResult: DojoVerifyResult | null
  error: string | null
  selectWorkspace: (path: string) => void
  startSession: (session: DojoSession) => void
  adoptLegacySession: (workspacePath: string) => void
  updateSession: (patch: Partial<Pick<DojoSession, 'blueprint' | 'status' | 'mentorThreadId'>>) => void
  replacePlan: (steps: DojoStep[], blueprint: string) => void
  updateStep: (stepId: string, patch: Partial<DojoStep>) => void
  selectStep: (stepId: string) => void
  revealHint: (stepId: string) => void
  advanceStep: () => void
  completeStep: (stepId: string) => boolean
  invalidateVerification: () => void
  appendMessage: (message: Omit<DojoMessage, 'id' | 'createdAt'>) => void
  recordSkill: (name: string, mastery: DojoSkillMastery) => void
  setMentorBusy: (busy: boolean) => void
  setActiveMentorThread: (threadId: string | null) => void
  setVerifyResult: (result: DojoVerifyResult | null) => void
  setError: (error: string | null) => void
  resetSession: () => void
}

const storage = {
  getItem: async (name: string): Promise<string | null> => {
    const value = await api.settings.get(`dojoStore.${name}`)
    return value == null ? null : JSON.stringify(value)
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await api.settings.set(`dojoStore.${name}`, JSON.parse(value))
  },
  removeItem: async (name: string): Promise<void> => { await api.settings.set(`dojoStore.${name}`, undefined) },
}

function sessionPatch(session: DojoSession, sessions: Record<string, DojoSession>) {
  const updated = { ...session, updatedAt: Date.now() }
  return { session: updated, sessions: { ...sessions, [dojoWorkspaceKey(session.workspacePath)]: updated } }
}

function invalidateStep(step: DojoStep): DojoStep {
  return {
    ...step,
    verification: step.verification ? { ...step.verification, stale: true } : undefined,
    confirmedCriteria: [],
    phase: step.phase === 'demo' ? 'demo' : 'handsOn',
  }
}

export const useDojoStore = create<DojoStore>()(persist((set, get) => ({
  session: null, sessions: {}, legacySession: null, activeWorkspacePath: '', skills: [],
  mentorBusy: false, activeMentorThreadId: null, verifyResult: null, error: null,

  selectWorkspace: (path) => {
    if (dojoWorkspaceKey(path) === dojoWorkspaceKey(get().activeWorkspacePath)) return
    const session = get().sessions[dojoWorkspaceKey(path)] ?? null
    set({ activeWorkspacePath: path, session, mentorBusy: false, activeMentorThreadId: null,
      verifyResult: session?.steps[session.currentStepIndex]?.verification ?? null, error: null })
  },
  startSession: (session) => {
    const normalized: DojoSession = { ...session, status: session.status ?? 'active', messages: session.messages ?? [], codeRevision: session.codeRevision ?? 0 }
    set({ ...sessionPatch(normalized, get().sessions), activeWorkspacePath: session.workspacePath, verifyResult: null, error: null })
  },
  adoptLegacySession: (workspacePath) => {
    const legacy = get().legacySession
    if (!legacy || !workspacePath) return
    get().startSession({ ...legacy, workspacePath, status: 'planning', mentorThreadId: undefined,
      steps: legacy.steps.map(step => ({ ...invalidateStep(step), skill: step.skill || step.goal || step.title,
        acceptanceCriteria: step.acceptanceCriteria?.length ? step.acceptanceCriteria : [step.goal || step.title] })) })
    set({ legacySession: null })
  },
  updateSession: (patch) => {
    const { session, sessions } = get()
    if (session) set(sessionPatch({ ...session, ...patch }, sessions))
  },
  replacePlan: (steps, blueprint) => {
    const { session, sessions } = get()
    if (!session || !steps.length) return
    set({ ...sessionPatch({ ...session, steps, blueprint, currentStepIndex: 0, status: 'planning' }, sessions), verifyResult: null })
  },
  updateStep: (stepId, patch) => {
    const { session, sessions } = get()
    if (!session) return
    const changesContract = ['verifyCommand', 'files', 'acceptanceCriteria', 'goal'].some(key => key in patch)
    const steps = session.steps.map(step => step.id === stepId
      ? changesContract ? invalidateStep({ ...step, ...patch }) : { ...step, ...patch }
      : step)
    set({ ...sessionPatch({ ...session, steps, ...(changesContract && session.status === 'completed' ? { status: 'active' as const } : {}) }, sessions),
      verifyResult: steps[session.currentStepIndex]?.verification ?? null })
  },
  selectStep: (stepId) => {
    const { session, sessions } = get()
    if (!session) return
    const index = session.steps.findIndex(step => step.id === stepId)
    if (index < 0) return
    set({ ...sessionPatch({ ...session, currentStepIndex: index }, sessions), verifyResult: session.steps[index].verification ?? null, error: null })
  },
  revealHint: (stepId) => {
    const step = get().session?.steps.find(item => item.id === stepId)
    if (step && step.hintsRevealed < step.hints.length) get().updateStep(stepId, { hintsRevealed: step.hintsRevealed + 1 })
  },
  advanceStep: () => {
    const { session } = get()
    if (!session) return
    const next = session.steps[Math.min(session.currentStepIndex + 1, session.steps.length - 1)]
    if (next) get().selectStep(next.id)
  },
  completeStep: (stepId) => {
    const { session, sessions } = get()
    const step = session?.steps.find(item => item.id === stepId)
    if (!session || !step || !canCompleteDojoStep(session, step)) return false
    const steps = session.steps.map(item => item.id === stepId ? { ...item, phase: 'passed' as const } : item)
    set(sessionPatch({ ...session, steps, status: steps.every(item => item.phase === 'passed') ? 'completed' : 'active' }, sessions))
    // Completion is evidence of practice, not proof of mastery or absence of help.
    get().recordSkill(step.skill || step.goal || step.title, 'passed')
    return true
  },
  invalidateVerification: () => {
    const { session, sessions } = get()
    if (!session) return
    const steps = session.steps.map((step, index) => index === session.currentStepIndex || step.phase !== 'passed'
      ? invalidateStep(step)
      : { ...step, verification: step.verification ? { ...step.verification, stale: true } : undefined })
    set({ ...sessionPatch({ ...session, steps, codeRevision: (session.codeRevision ?? 0) + 1,
      status: session.status === 'completed' ? 'active' : session.status }, sessions), verifyResult: steps[session.currentStepIndex]?.verification ?? null })
  },
  appendMessage: (message) => {
    const { session, sessions } = get()
    if (session) set(sessionPatch({ ...session, messages: [...(session.messages ?? []), { ...message, id: crypto.randomUUID(), createdAt: Date.now() }] }, sessions))
  },
  recordSkill: (name, mastery) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = trimmed.toLowerCase(), existing = get().skills.find(skill => skill.id === id)
    const rank: Record<DojoSkillMastery, number> = { learning: 0, passed: 1, mastered: 2 }
    const skill: DojoSkill = { id, name: trimmed, mastery: existing && rank[existing.mastery] >= rank[mastery] ? existing.mastery : mastery, lastSeenAt: Date.now() }
    set({ skills: existing ? get().skills.map(item => item.id === id ? skill : item) : [...get().skills, skill] })
  },
  setMentorBusy: (mentorBusy) => set({ mentorBusy }),
  setActiveMentorThread: (activeMentorThreadId) => set({ activeMentorThreadId }),
  setVerifyResult: (result) => {
    const { session, sessions } = get()
    if (!result) { set({ verifyResult: null }); return }
    if (!session || !result.stepId || !pathEquals(result.workspacePath ?? '', session.workspacePath)) return
    const step = session.steps.find(item => item.id === result.stepId)
    if (!step || step.verifyCommand !== result.command) return
    const verification = { ...result, stale: Boolean(result.stale || result.codeRevision !== (session.codeRevision ?? 0)) }
    const steps = session.steps.map(item => item.id === step.id ? { ...item, verification } : item)
    set({ ...sessionPatch({ ...session, steps }, sessions), verifyResult: steps[session.currentStepIndex]?.verification ?? null })
  },
  setError: (error) => set({ error }),
  resetSession: () => {
    const sessions = { ...get().sessions }
    delete sessions[dojoWorkspaceKey(get().activeWorkspacePath)]
    set({ session: null, sessions, verifyResult: null, error: null })
  },
}), {
  name: 'dojo-session', version: 2,
  storage: createJSONStorage(() => storage),
  partialize: state => ({ sessions: state.sessions, legacySession: state.legacySession, skills: state.skills }),
  migrate: (persisted) => {
    const old = persisted as Partial<DojoStore>
    return { sessions: old.sessions ?? {}, legacySession: old.legacySession ?? old.session ?? null, skills: old.skills ?? [] }
  },
  merge: (persisted, current) => {
    const saved = persisted as Partial<DojoStore> | undefined
    const sessions = saved?.sessions ?? {}
    const session = sessions[dojoWorkspaceKey(current.activeWorkspacePath)] ?? null
    return { ...current, sessions, legacySession: saved?.legacySession ?? null, skills: saved?.skills ?? [], session,
      verifyResult: session?.steps[session.currentStepIndex]?.verification ?? null }
  },
}))

export function useNormalizedDojoSession(): DojoSession | null {
  const session = useDojoStore(state => state.session)
  if (!session) return null
  return { ...session, currentStepIndex: Math.min(Math.max(session.currentStepIndex, 0), Math.max(session.steps.length - 1, 0)) }
}
