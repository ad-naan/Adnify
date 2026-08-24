import { StateCreator } from 'zustand'
import { builtinThemes } from '@/renderer/config/themeConfig'

/** 内置主题 ID 联合类型 */
export type BuiltinThemeName = 'adnify-dark' | 'midnight' | 'dawn' | 'cyberpunk'

/** 主题名称，支持内置和自定义主题 */
export type ThemeName = string

export interface ThemeSlice {
    currentTheme: ThemeName;
    setTheme: (theme: ThemeName) => void;
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => {
    return {
        currentTheme: builtinThemes[0].id,
        setTheme: (theme) => set({ currentTheme: theme }),
    }
}
