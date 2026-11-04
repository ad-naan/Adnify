import { create } from 'zustand'
export const useStore = create(() => ({ language: 'en' as const }))
