/**
 * Dojo 状态管理
 *
 * 训练会话与手艺图谱通过 electron-store (preferencesStore) 持久化，
 * 与 modeStore 同一套 IPC 存储后端。瞬时态（导师忙碌/验收结果）不持久化。
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { api } from '@/renderer/services/electronAPI'
import type { DojoSession, DojoSkill, DojoSkillMastery, DojoStep, DojoVerifyResult } from './types'

const STORE_KEY = 'dojoStore'

interface DojoState {
    session: DojoSession | null
    skills: DojoSkill[]
}

interface DojoTransientState {
    /** 导师是否在思考（阻止重复派发） */
    mentorBusy: boolean
    /** 最近一次验收结果 */
    verifyResult: DojoVerifyResult | null
    /** 最近一次操作错误（展示在导师面板） */
    error: string | null
}

interface DojoActions {
    startSession: (session: DojoSession) => void
    updateStep: (stepId: string, patch: Partial<DojoStep>) => void
    revealHint: (stepId: string) => void
    advanceStep: () => void
    recordSkill: (name: string, mastery: DojoSkillMastery) => void
    setMentorBusy: (busy: boolean) => void
    setVerifyResult: (result: DojoVerifyResult | null) => void
    setError: (error: string | null) => void
    resetSession: () => void
}

type DojoStore = DojoState & DojoTransientState & DojoActions

const electronStoreStorage = {
    getItem: async (name: string): Promise<string | null> => {
        try {
            const value = await api.settings.get(`${STORE_KEY}.${name}`)
            return value === undefined || value === null ? null : JSON.stringify(value)
        } catch {
            return null
        }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        try {
            await api.settings.set(`${STORE_KEY}.${name}`, JSON.parse(value))
        } catch { /* ignore */ }
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            await api.settings.set(`${STORE_KEY}.${name}`, undefined)
        } catch { /* ignore */ }
    },
}

function currentStepIndex(steps: DojoStep[], index: number): number {
    return Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0))
}

export const useDojoStore = create<DojoStore>()(
    persist(
        (set, get) => ({
            session: null,
            skills: [],
            mentorBusy: false,
            verifyResult: null,
            error: null,

            startSession: (session) => set({
                session,
                verifyResult: null,
                error: null,
            }),

            updateStep: (stepId, patch) => {
                const { session } = get()
                if (!session) return
                set({
                    session: {
                        ...session,
                        steps: session.steps.map(step => step.id === stepId ? { ...step, ...patch } : step),
                    },
                })
            },

            revealHint: (stepId) => {
                const { session } = get()
                if (!session) return
                const step = session.steps.find(item => item.id === stepId)
                if (!step || step.hintsRevealed >= step.hints.length) return
                set({
                    session: {
                        ...session,
                        steps: session.steps.map(item =>
                            item.id === stepId ? { ...item, hintsRevealed: item.hintsRevealed + 1 } : item,
                        ),
                    },
                })
            },

            advanceStep: () => {
                const { session } = get()
                if (!session) return
                const next = session.currentStepIndex + 1
                set({
                    session: {
                        ...session,
                        currentStepIndex: next < session.steps.length ? next : session.steps.length - 1,
                    },
                    verifyResult: null,
                })
            },

            recordSkill: (name, mastery) => {
                const trimmed = name.trim()
                if (!trimmed) return
                const { skills } = get()
                const id = trimmed.toLowerCase()
                const existing = skills.find(skill => skill.id === id)
                // 掌握度只升不降：mastered > passed > learning
                const rank: Record<DojoSkillMastery, number> = { learning: 0, passed: 1, mastered: 2 }
                const merged = existing && rank[existing.mastery] >= rank[mastery] ? existing.mastery : mastery
                const updated: DojoSkill = {
                    id,
                    name: trimmed,
                    mastery: merged,
                    lastSeenAt: Date.now(),
                }
                set({
                    skills: existing
                        ? skills.map(skill => skill.id === id ? updated : skill)
                        : [...skills, updated],
                })
            },

            setMentorBusy: (mentorBusy) => set({ mentorBusy }),
            setVerifyResult: (verifyResult) => set({ verifyResult }),
            setError: (error) => set({ error }),

            resetSession: () => set({
                session: null,
                verifyResult: null,
                error: null,
            }),
        }),
        {
            name: 'dojo-session',
            storage: createJSONStorage(() => electronStoreStorage),
            version: 1,
            partialize: (state) => ({
                session: state.session,
                skills: state.skills,
            }),
        },
    ),
)

/** 持久化会话的步骤索引矫正（防止历史数据越界） */
export function useNormalizedDojoSession(): DojoSession | null {
    const session = useDojoStore(state => state.session)
    if (!session) return null
    return { ...session, currentStepIndex: currentStepIndex(session.steps, session.currentStepIndex) }
}
