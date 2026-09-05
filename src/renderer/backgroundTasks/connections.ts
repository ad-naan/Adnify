import { create } from 'zustand'
import type { BackgroundConnectionState } from '@shared/types/backgroundTasks'

export const useBackgroundConnections = create<BackgroundConnectionState>(() => ({ checking: false, report: null }))
