import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    settings: {
      get: async () => null,
      set: async () => true,
    },
  },
}))

import { useDojoStore } from '@/renderer/modes/dojo/DojoStore'
import type { DojoStep } from '@/renderer/modes/dojo/types'

function makeStep(id: string, overrides: Partial<DojoStep> = {}): DojoStep {
  return {
    id,
    title: `Step ${id}`,
    goal: 'goal',
    files: [],
    verifyCommand: 'pnpm typecheck',
    hints: ['direction', 'pseudocode', 'api'],
    hintsRevealed: 0,
    phase: 'demo',
    ...overrides,
  }
}

function seedSession(steps: DojoStep[], currentStepIndex = 0): void {
  useDojoStore.getState().startSession({
    id: 'session-1',
    requirement: 'test requirement',
    steps,
    currentStepIndex,
    createdAt: Date.now(),
  })
}

describe('DojoStore state machine', () => {
  beforeEach(() => {
    useDojoStore.getState().resetSession()
    useDojoStore.setState({ skills: [] })
  })

  it('revealHint stops at the last hint level', () => {
    seedSession([makeStep('s1')])
    const { revealHint } = useDojoStore.getState()

    revealHint('s1')
    revealHint('s1')
    revealHint('s1')
    revealHint('s1')

    const step = useDojoStore.getState().session?.steps[0]
    expect(step?.hintsRevealed).toBe(3)
  })

  it('updateStep patches only the target step', () => {
    seedSession([makeStep('s1'), makeStep('s2')])

    useDojoStore.getState().updateStep('s2', { phase: 'quiz' })

    const steps = useDojoStore.getState().session?.steps ?? []
    expect(steps[0].phase).toBe('demo')
    expect(steps[1].phase).toBe('quiz')
  })

  it('advanceStep clamps at the last step and clears verify result', () => {
    seedSession([makeStep('s1'), makeStep('s2')], 1)
    useDojoStore.getState().setVerifyResult({ success: true, exitCode: 0, output: '', ranAt: 1 })

    useDojoStore.getState().advanceStep()

    const session = useDojoStore.getState().session
    expect(session?.currentStepIndex).toBe(1)
    expect(useDojoStore.getState().verifyResult).toBeNull()
  })

  it('recordSkill upgrades mastery and never downgrades it', () => {
    const { recordSkill } = useDojoStore.getState()

    recordSkill('zustand store slices', 'passed')
    recordSkill('zustand store slices', 'learning')
    expect(useDojoStore.getState().skills[0].mastery).toBe('passed')

    recordSkill('zustand store slices', 'mastered')
    expect(useDojoStore.getState().skills[0].mastery).toBe('mastered')
  })

  it('recordSkill merges by normalized id instead of duplicating', () => {
    const { recordSkill } = useDojoStore.getState()

    recordSkill('Zustand Store Slices', 'passed')
    recordSkill('zustand store slices', 'mastered')

    const skills = useDojoStore.getState().skills
    expect(skills).toHaveLength(1)
    expect(skills[0].mastery).toBe('mastered')
  })
})
