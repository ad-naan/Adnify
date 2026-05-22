/**
 * Theme system configuration.
 * Uses RGB strings so Tailwind alpha utilities keep working.
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'

export interface ThemeColors {
  background: string
  backgroundSecondary: string
  backgroundTertiary: string
  surface: string
  surfaceHover: string
  surfaceActive: string
  surfaceMuted: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textInverted: string
  border: string
  borderSubtle: string
  borderActive: string
  accent: string
  accentHover: string
  accentActive: string
  accentForeground: string
  accentSubtle: string
  statusSuccess: string
  statusWarning: string
  statusError: string
  statusInfo: string
}

export interface Theme {
  id: string
  name: string
  type: 'dark' | 'light'
  colors: ThemeColors
  monacoTheme: string
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0 0'
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
}

export const builtinThemes: Theme[] = [
  {
    id: 'adnify-dark',
    name: 'Adnify Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '18 18 21',
      backgroundSecondary: '25 25 29',
      backgroundTertiary: '32 32 37',
      surface: '25 25 29',
      surfaceHover: '38 38 44',
      surfaceActive: '45 45 52',
      surfaceMuted: '63 63 70',
      textPrimary: '242 242 247',
      textSecondary: '185 185 205',
      textMuted: '138 138 156',
      textInverted: '18 18 21',
      border: '40 40 48',
      borderSubtle: '32 32 37',
      borderActive: '82 82 100',
      accent: '139 92 246',
      accentHover: '124 58 237',
      accentActive: '109 40 217',
      accentForeground: '255 255 255',
      accentSubtle: '167 139 250',
      statusSuccess: '52 211 153',
      statusWarning: '251 191 36',
      statusError: '248 113 113',
      statusInfo: '96 165 250',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '22 27 34',
      backgroundSecondary: '28 33 42',
      backgroundTertiary: '37 43 54',
      surface: '28 33 42',
      surfaceHover: '45 51 65',
      surfaceActive: '55 61 75',
      surfaceMuted: '70 78 94',
      textPrimary: '220 225 235',
      textSecondary: '168 178 198',
      textMuted: '122 132 152',
      textInverted: '22 27 34',
      border: '45 51 65',
      borderSubtle: '30 36 48',
      borderActive: '80 90 110',
      accent: '56 189 248',
      accentHover: '14 165 233',
      accentActive: '2 132 199',
      accentForeground: '15 23 42',
      accentSubtle: '125 211 252',
      statusSuccess: '46 160 90',
      statusWarning: '210 160 30',
      statusError: '240 80 80',
      statusInfo: '60 160 240',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '3 3 5',
      backgroundSecondary: '10 10 15',
      backgroundTertiary: '20 20 30',
      surface: '10 10 15',
      surfaceHover: '30 30 45',
      surfaceActive: '50 50 70',
      surfaceMuted: '80 80 100',
      textPrimary: '255 255 255',
      textSecondary: '184 184 206',
      textMuted: '138 138 162',
      textInverted: '0 0 0',
      border: '40 40 60',
      borderSubtle: '20 20 30',
      borderActive: '255 0 128',
      accent: '255 0 128',
      accentHover: '255 50 150',
      accentActive: '200 0 100',
      accentForeground: '255 255 255',
      accentSubtle: '255 100 200',
      statusSuccess: '0 255 150',
      statusWarning: '255 240 0',
      statusError: '255 50 50',
      statusInfo: '0 240 255',
    },
  },
  {
    id: 'dawn',
    name: 'Dawn',
    type: 'light',
    monacoTheme: 'vs',
    colors: {
      background: '255 255 255',
      backgroundSecondary: '248 249 250',
      backgroundTertiary: '241 243 245',
      surface: '255 255 255',
      surfaceHover: '241 243 245',
      surfaceActive: '233 236 239',
      surfaceMuted: '222 226 230',
      textPrimary: '33 37 41',
      textSecondary: '73 80 87',
      textMuted: '134 142 150',
      textInverted: '255 255 255',
      border: '222 226 230',
      borderSubtle: '241 243 245',
      borderActive: '173 181 189',
      accent: '37 99 235',
      accentHover: '29 78 216',
      accentActive: '30 70 190',
      accentForeground: '255 255 255',
      accentSubtle: '96 165 250',
      statusSuccess: '22 163 74',
      statusWarning: '217 119 6',
      statusError: '220 38 38',
      statusInfo: '37 99 235',
    },
  },
]

const LOCAL_STORAGE_THEME_KEY = 'adnify-theme-id'
const LOCAL_STORAGE_CUSTOM_THEMES_KEY = 'adnify-custom-themes'

function isValidTheme(themeInput: unknown): themeInput is Theme {
  if (!themeInput || typeof themeInput !== 'object') return false
  const theme = themeInput as Record<string, unknown>
  if (typeof theme.id !== 'string' || typeof theme.name !== 'string') return false
  if (!theme.colors || typeof theme.colors !== 'object') return false
  const colors = theme.colors as Record<string, unknown>
  return typeof colors.background === 'string' && typeof colors.accent === 'string'
}

class ThemeManager {
  private currentTheme: Theme = builtinThemes[0]
  private customThemes: Theme[] = []
  private listeners: Set<(theme: Theme) => void> = new Set()
  private initialized = false

  constructor() {
    try {
      const savedThemeId = localStorage.getItem(LOCAL_STORAGE_THEME_KEY)
      const savedCustomThemes = localStorage.getItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY)

      if (savedCustomThemes) {
        const parsed = JSON.parse(savedCustomThemes)
        if (Array.isArray(parsed)) {
          this.customThemes = parsed.filter(isValidTheme)
        }
      }

      if (savedThemeId) {
        const theme = this.getThemeById(savedThemeId)
        if (theme) {
          this.currentTheme = theme
          this.applyTheme(theme)
        }
      }
    } catch {
      // Ignore localStorage errors.
    }
  }

  async loadFromConfig() {
    try {
      const [savedCurrentTheme, savedThemeId, savedCustomThemes] = await Promise.all([
        api.settings.get('currentTheme'),
        api.settings.get('themeId'),
        api.settings.get('customThemes'),
      ])

      if (savedCustomThemes && Array.isArray(savedCustomThemes)) {
        this.customThemes = savedCustomThemes.filter(isValidTheme)
      }

      const themeId = typeof savedCurrentTheme === 'string'
        ? savedCurrentTheme
        : typeof savedThemeId === 'string'
          ? savedThemeId
          : null
      const theme = themeId ? this.getThemeById(themeId) : null
      if (theme) {
        this.currentTheme = theme
      }

      this.applyTheme(this.currentTheme)
      this.initialized = true
    } catch (error) {
      logger.settings.warn('[ThemeManager] Failed to load theme config:', error)
      this.applyTheme(this.currentTheme)
    }
  }

  init() {
    if (this.initialized) return
    this.applyTheme(this.currentTheme)
    this.initialized = true
  }

  getCurrentTheme() {
    return this.currentTheme
  }

  getThemeById(id: string) {
    return [...builtinThemes, ...this.customThemes].find(theme => theme.id === id)
  }

  getAllThemes() {
    return [...builtinThemes, ...this.customThemes]
  }

  setTheme(themeId: string) {
    const theme = this.getThemeById(themeId)
    if (!theme) return

    this.currentTheme = theme
    this.applyTheme(theme)

    try {
      localStorage.setItem(LOCAL_STORAGE_THEME_KEY, theme.id)
      localStorage.setItem('adnify-current-theme', theme.id)
      localStorage.setItem('adnify-theme-type', theme.type)
      localStorage.setItem('adnify-theme-bg', theme.colors.background)
    } catch {
      // Ignore localStorage errors.
    }

    api.settings.set('themeId', theme.id).catch(error => {
      logger.settings.warn('[ThemeManager] Failed to persist theme:', error)
    })
    api.settings.set('themeBg', theme.colors.background).catch(error => {
      logger.settings.warn('[ThemeManager] Failed to persist theme background:', error)
    })
    api.settings.set('currentTheme', theme.id).catch(error => {
      logger.settings.warn('[ThemeManager] Failed to persist current theme:', error)
    })

    this.listeners.forEach(listener => listener(theme))
  }

  addCustomTheme(theme: Theme) {
    this.customThemes = [...this.customThemes.filter(item => item.id !== theme.id), theme]
    this.persistCustomThemes()
  }

  removeCustomTheme(themeId: string) {
    this.customThemes = this.customThemes.filter(theme => theme.id !== themeId)
    this.persistCustomThemes()
  }

  subscribe(listener: (theme: Theme) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  applyTheme(theme: Theme) {
    const root = document.documentElement
    const { colors } = theme

    root.style.setProperty('--background', colors.background)
    root.style.setProperty('--background-secondary', colors.backgroundSecondary)
    root.style.setProperty('--background-tertiary', colors.backgroundTertiary)
    root.style.setProperty('--surface', colors.surface)
    root.style.setProperty('--surface-hover', colors.surfaceHover)
    root.style.setProperty('--surface-active', colors.surfaceActive)
    root.style.setProperty('--surface-muted', colors.surfaceMuted)
    root.style.setProperty('--text-primary', colors.textPrimary)
    root.style.setProperty('--text-secondary', colors.textSecondary)
    root.style.setProperty('--text-muted', colors.textMuted)
    root.style.setProperty('--text-inverted', colors.textInverted)
    root.style.setProperty('--border', colors.border)
    root.style.setProperty('--border-subtle', colors.borderSubtle)
    root.style.setProperty('--border-active', colors.borderActive)
    root.style.setProperty('--accent', colors.accent)
    root.style.setProperty('--accent-hover', colors.accentHover)
    root.style.setProperty('--accent-active', colors.accentActive)
    root.style.setProperty('--accent-foreground', colors.accentForeground)
    root.style.setProperty('--accent-subtle', colors.accentSubtle)
    root.style.setProperty('--status-success', colors.statusSuccess)
    root.style.setProperty('--status-warning', colors.statusWarning)
    root.style.setProperty('--status-error', colors.statusError)
    root.style.setProperty('--status-info', colors.statusInfo)
    root.setAttribute('data-theme', theme.type)
  }

  private persistCustomThemes() {
    try {
      localStorage.setItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY, JSON.stringify(this.customThemes))
    } catch {
      // Ignore localStorage errors.
    }

    api.settings.set('customThemes', this.customThemes).catch(error => {
      logger.settings.warn('[ThemeManager] Failed to persist custom themes:', error)
    })
  }
}

export const themeManager = new ThemeManager()

export function createThemeFromHexColors(
  id: string,
  name: string,
  type: 'dark' | 'light',
  palette: Partial<Record<keyof ThemeColors, string>>
): Theme {
  const fallback = type === 'light'
    ? builtinThemes.find(theme => theme.id === 'dawn')!
    : builtinThemes.find(theme => theme.id === 'adnify-dark')!

  const colors = Object.fromEntries(
    (Object.keys(fallback.colors) as Array<keyof ThemeColors>).map(key => {
      const nextColor = palette[key]
      return [key, nextColor ? hexToRgb(nextColor) : fallback.colors[key]]
    })
  ) as unknown as ThemeColors

  return {
    id,
    name,
    type,
    monacoTheme: type === 'light' ? 'vs' : 'vs-dark',
    colors,
  }
}
