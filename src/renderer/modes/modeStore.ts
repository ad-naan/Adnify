/**
 * 模式状态管理
 * 
 * 通过 electron-store (preferencesStore) 持久化，
 * 与其他设置统一存储后端，通过 IPC 调用 settings:get/set
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { normalizeMode, type WorkMode } from './types'
import { api } from '@/renderer/services/electronAPI'

const STORE_KEY = 'modeStore'

interface ModeState {
    /** 当前工作模式 */
    currentMode: WorkMode
    /** 上一个模式（用于切换回去） */
    previousMode: WorkMode | null
}

interface ModeActions {
    /** 设置当前模式 */
    setMode: (mode: WorkMode) => void
    /** 切换回上一个模式 */
    restorePreviousMode: () => void
    /** 检查是否为指定模式 */
    isMode: (mode: WorkMode) => boolean
}

type ModeStore = ModeState & ModeActions

/**
 * 自定义 Storage：通过 IPC 存到 electron-store 的 preferencesStore
 * 统一与其他设置的存储后端，避免使用 localStorage
 */
const electronStoreStorage = {
    getItem: async (name: string): Promise<string | null> => {
        try {
            const storageKey = `${STORE_KEY}.${name}`
            let value = await api.settings.get(storageKey)
            if (value !== undefined && value !== null) {
                removeLegacyModeValue()
                return JSON.stringify(value)
            }

            const legacyDurable = await api.settings.get(`${STORE_KEY}.adnify-mode-store`)
            const legacyMode = (legacyDurable as { state?: { currentMode?: unknown } } | undefined)
                ?.state?.currentMode
            if (legacyMode !== undefined) {
                const currentMode = normalizeMode(legacyMode)
                await api.settings.set(storageKey, currentMode)
                await api.settings.set(`${STORE_KEY}.adnify-mode-store`, undefined)
                removeLegacyModeValue()
                return JSON.stringify({ [name]: currentMode })
            }

            value = readLegacyModeValue(name)
            return JSON.stringify(value)
        } catch {
            return null
        }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        try {
            const parsed = JSON.parse(value)
            await api.settings.set(`${STORE_KEY}.${name}`, parsed)
            removeLegacyModeValue()
        } catch { /* ignore */ }
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            await api.settings.set(`${STORE_KEY}.${name}`, undefined)
        } catch { /* ignore */ }
    },
}

function removeLegacyModeValue(): void {
    try {
        localStorage.removeItem('adnify-mode-store')
    } catch { /* ignore */ }
}

function readLegacyModeValue(name: string): unknown {
    if (typeof localStorage === 'undefined') return null
        try {
            const raw = localStorage.getItem('adnify-mode-store')
            if (!raw) return null
            const parsed = JSON.parse(raw) as { state?: Record<string, unknown> }
            const value = parsed?.state?.[name]
            return value === undefined ? null : value
    } catch {
        return null
    }
}

export const useModeStore = create<ModeStore>()(
    persist(
        (set, get) => ({
            currentMode: 'agent', // 默认 Agent 模式
            previousMode: null,

            setMode: (requestedMode) => {
                const mode = normalizeMode(requestedMode)
                const current = get().currentMode
                if (current !== mode) {
                    set({
                        currentMode: mode,
                        previousMode: current
                    })
                }
            },

            restorePreviousMode: () => {
                const previous = get().previousMode
                if (previous) {
                    set({
                        currentMode: previous,
                        previousMode: null
                    })
                }
            },

            isMode: (mode) => get().currentMode === mode
        }),
        {
            name: 'adnify-mode-store',
            storage: createJSONStorage(() => electronStoreStorage),
            version: 2,
            migrate: (persisted) => {
                const state = (persisted || {}) as Partial<ModeState>
                return { ...state, currentMode: normalizeMode(state.currentMode), previousMode: null }
            },
            partialize: (state) => ({
                currentMode: state.currentMode
            })
        }
    )
)
