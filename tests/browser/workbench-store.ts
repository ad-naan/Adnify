import { create } from 'zustand'
import { createLayoutSlice, type LayoutSlice } from '@renderer/store/slices/layoutSlice'
import { normalizeWorkbenchLayout } from '@renderer/components/layout/workbenchLayout'

export const useStore = create<LayoutSlice & { language: 'zh' | 'en'; workspace: { roots: string[] }; currentTheme: string; setTheme: (theme: string) => void; editorConfig: { layoutDensity: string; uiScale: number }; set: (key: string, value: unknown) => void }>()((...args) => ({ ...createLayoutSlice(...args), language: 'zh', workspace: { roots: ['E:/Project/blog'] }, currentTheme: 'dawn', setTheme: theme => args[0]({ currentTheme: theme }), editorConfig: { layoutDensity: 'comfortable', uiScale: 1 }, set: (key, value) => args[0]({ [key]: value }) }))
const saved = localStorage.getItem('workbench-fixture-layout')
if (saved) useStore.setState({ workbenchLayout: normalizeWorkbenchLayout(JSON.parse(saved)) })
useStore.subscribe((state, previous) => {
  if (state.workbenchLayout !== previous.workbenchLayout) localStorage.setItem('workbench-fixture-layout', JSON.stringify(state.workbenchLayout))
})
Object.assign(window, { dockTestStore: useStore })
