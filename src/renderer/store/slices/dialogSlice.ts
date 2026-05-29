/**
 * 对话框/弹窗状态切片
 * 统一管理所有模态框的显示状态
 */
import { StateCreator } from 'zustand'

export interface DialogSlice {
  showSettings: boolean
  showCommandPalette: boolean
  showQuickOpen: boolean
  showAbout: boolean
  showAvatarDialog: boolean

  setShowSettings: (show: boolean) => void
  setShowCommandPalette: (show: boolean) => void
  setShowQuickOpen: (show: boolean) => void
  setShowAbout: (show: boolean) => void
  setShowAvatarDialog: (show: boolean) => void
  closeAllDialogs: () => void
}

export const createDialogSlice: StateCreator<DialogSlice, [], [], DialogSlice> = (set) => ({
  showSettings: false,
  showCommandPalette: false,
  showQuickOpen: false,
  showAbout: false,
  showAvatarDialog: false,

  setShowSettings: (show) => set({ showSettings: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowQuickOpen: (show) => set({ showQuickOpen: show }),
  setShowAbout: (show) => set({ showAbout: show }),
  setShowAvatarDialog: (show) => set({ showAvatarDialog: show }),
  closeAllDialogs: () => set({
    showSettings: false,
    showCommandPalette: false,
    showQuickOpen: false,
    showAbout: false,
    showAvatarDialog: false,
  }),
})
