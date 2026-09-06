/**
 * 布局相关状态切片
 * 管理面板尺寸、可见性等布局状态
 */
import { StateCreator } from 'zustand'
import { loadUserProfile, saveUserProfile } from '@renderer/settings/userProfile'
import { createWorkbenchLayout, normalizeWorkbenchLayout, type WorkbenchLayout, type WorkbenchPanel, type LayoutPreset, type TerminalPosition } from '@renderer/components/layout/workbenchLayout'

export type SidePanel = 'explorer' | 'search' | 'git' | 'problems' | 'outline' | 'history' | 'extensions' | 'emotion' | 'shell' | null

export interface LayoutSlice {
  activeSidePanel: SidePanel
  terminalVisible: boolean
  debugVisible: boolean
  chatVisible: boolean
  editorVisible: boolean
  focusedPanel: WorkbenchPanel | null
  workbenchLayout: WorkbenchLayout
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
  setEditorVisible: (visible: boolean) => void
  setFocusedPanel: (panel: WorkbenchPanel | null) => void
  setWorkbenchLayout: (layout: WorkbenchLayout) => void
  applyLayoutPreset: (preset: LayoutPreset) => void
  setTerminalPosition: (position: TerminalPosition) => void
  restoreWorkbenchLayout: (layout: unknown, legacy?: { sidebarWidth?: number; chatWidth?: number }) => void
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
  editorVisible: true,
  focusedPanel: null,
  workbenchLayout: createWorkbenchLayout(),
  sidebarWidth: 260,
  chatWidth: 450,
  terminalLayout: 'tabs',
  userAvatarStyle: loadUserProfile().avatarStyle,
  userAvatarSeed: loadUserProfile().avatarSeed,
  userDisplayName: loadUserProfile().displayName,

  setActiveSidePanel: (panel) => set(state => ({ activeSidePanel: panel, focusedPanel: null, ...(!panel && !state.chatVisible ? { editorVisible: true } : {}) })),
  setTerminalVisible: (visible) => set(state => ({ terminalVisible: visible, ...(visible ? {
    focusedPanel: null,
    ...(state.activeSidePanel === 'shell' ? { activeSidePanel: 'explorer' as const } : {}),
    ...(state.workbenchLayout.terminalPosition === 'agent' ? { chatVisible: true } : { editorVisible: true }),
  } : {}) })),
  setDebugVisible: (visible) => set({ debugVisible: visible, ...(visible ? { editorVisible: true, focusedPanel: null } : {}) }),
  setChatVisible: (visible) => set(state => ({ chatVisible: visible, focusedPanel: null, ...(!visible && !state.activeSidePanel ? { editorVisible: true } : {}) })),
  setEditorVisible: (visible) => set(state => ({ editorVisible: visible || (!state.chatVisible && (!state.activeSidePanel || state.activeSidePanel === 'shell')), focusedPanel: null })),
  setFocusedPanel: (panel) => set({ focusedPanel: panel }),
  setWorkbenchLayout: (layout) => set({ workbenchLayout: layout }),
  applyLayoutPreset: (preset) => set(state => ({
    workbenchLayout: { ...createWorkbenchLayout(preset), terminalPosition: state.workbenchLayout.terminalPosition, terminalHeight: state.workbenchLayout.terminalHeight },
    activeSidePanel: state.activeSidePanel && state.activeSidePanel !== 'shell' ? state.activeSidePanel : 'explorer',
    editorVisible: true, chatVisible: true, focusedPanel: null,
  })),
  setTerminalPosition: (position) => set(state => ({ workbenchLayout: { ...state.workbenchLayout, terminalPosition: position }, focusedPanel: null, terminalVisible: true, ...(position === 'agent' ? { chatVisible: true } : { editorVisible: true }), ...(state.activeSidePanel === 'shell' ? { activeSidePanel: 'explorer' as const } : {}) })),
  restoreWorkbenchLayout: (layout, legacy) => set({ workbenchLayout: normalizeWorkbenchLayout(layout, legacy), focusedPanel: null }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setChatWidth: (width) => set({ chatWidth: width }),
  setTerminalLayout: (layout) => set({ terminalLayout: layout }),
  toggleTerminal: () => set(state => ({ terminalVisible: !state.terminalVisible, focusedPanel: null, editorVisible: true, chatVisible: state.workbenchLayout.terminalPosition === 'agent' ? true : state.chatVisible, ...(state.activeSidePanel === 'shell' ? { activeSidePanel: 'explorer' as const } : {}) })),
  toggleDebug: () => set((state) => ({ debugVisible: !state.debugVisible, editorVisible: true, focusedPanel: null })),
  setUserAvatar: (style, seed) => {
    saveUserProfile({ ...loadUserProfile(), avatarStyle: style, avatarSeed: seed })
    set({ userAvatarStyle: style, userAvatarSeed: seed })
  },
  setUserDisplayName: (name) => {
    saveUserProfile({ ...loadUserProfile(), displayName: name })
    set({ userDisplayName: name })
  },
})
