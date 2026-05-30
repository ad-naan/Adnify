/**
 * 布局相关状态切片
 * 管理面板尺寸、可见性等布局状态
 */
import { StateCreator } from 'zustand'

export type SidePanel = 'explorer' | 'search' | 'git' | 'problems' | 'outline' | 'history' | 'extensions' | 'emotion' | 'shell' | null

export interface LayoutSlice {
  activeSidePanel: SidePanel
  terminalVisible: boolean
  debugVisible: boolean
  chatVisible: boolean
  sidebarWidth: number
  chatWidth: number
  terminalLayout: 'tabs' | 'split'
  userAvatarStyle: string
  userAvatarSeed: string
  userDisplayName: string

  setActiveSidePanel: (panel: SidePanel) => void
  setTerminalVisible: (visible: boolean) => void
  setDebugVisible: (visible: boolean) => void
  setChatVisible: (visible: boolean) => void
  setSidebarWidth: (width: number) => void
  setChatWidth: (width: number) => void
  setTerminalLayout: (layout: 'tabs' | 'split') => void
  toggleTerminal: () => void
  toggleDebug: () => void
  setUserAvatar: (style: string, seed: string) => void
  setUserDisplayName: (name: string) => void
}

export const createLayoutSlice: StateCreator<LayoutSlice, [], [], LayoutSlice> = (set) => ({
  activeSidePanel: 'explorer',
  terminalVisible: false,
  debugVisible: false,
  chatVisible: true,
  sidebarWidth: 260,
  chatWidth: 450,
  terminalLayout: 'tabs',
  userAvatarStyle: localStorage.getItem('userAvatarStyle') || 'adventurer',
  userAvatarSeed: localStorage.getItem('userAvatarSeed') || 'Adnify',
  userDisplayName: localStorage.getItem('userDisplayName') || 'You',

  setActiveSidePanel: (panel) => set({ activeSidePanel: panel }),
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),
  setDebugVisible: (visible) => set({ debugVisible: visible }),
  setChatVisible: (visible) => set({ chatVisible: visible }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setChatWidth: (width) => set({ chatWidth: width }),
  setTerminalLayout: (layout) => set({ terminalLayout: layout }),
  toggleTerminal: () => set((state) => ({ terminalVisible: !state.terminalVisible })),
  toggleDebug: () => set((state) => ({ debugVisible: !state.debugVisible })),
  setUserAvatar: (style, seed) => {
    localStorage.setItem('userAvatarStyle', style)
    localStorage.setItem('userAvatarSeed', seed)
    set({ userAvatarStyle: style, userAvatarSeed: seed })
  },
  setUserDisplayName: (name) => {
    localStorage.setItem('userDisplayName', name)
    set({ userDisplayName: name })
  },
})
