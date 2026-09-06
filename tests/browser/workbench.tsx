import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import WorkspaceWorkbench from '@renderer/components/layout/WorkspaceWorkbench'
import TitleBarActions from '@renderer/components/layout/TitleBarActions'
import { useStore } from './workbench-store'
import { themeManager } from '@renderer/config/themeConfig'

Object.assign(window, { dockMounts: {} })
function Fixture() {
  const currentTheme = useStore(s => s.currentTheme)
  useStore(s => s.language)
  useEffect(() => { themeManager.setTheme(currentTheme) }, [currentTheme])
  return <div className="h-screen flex flex-col bg-background text-text-primary">
    <header className="h-12 shrink-0 border-b border-border flex items-center px-4 gap-4 relative z-50 bg-surface"><span className="text-accent font-medium">A</span><span className="text-sm">blog</span><span className="text-xs text-text-muted">工作台</span><button className="ml-auto text-xs" onClick={() => useStore.getState().setTheme(currentTheme === 'dawn' ? 'adnify-dark' : 'dawn')}>切换主题</button><button className="text-xs" onClick={() => useStore.setState({ language: useStore.getState().language === 'zh' ? 'en' : 'zh' })}>EN / 中</button><TitleBarActions /></header>
    <div className="flex-1 flex min-h-0"><nav className="w-12 shrink-0 border-r border-border flex flex-col gap-5 p-2 text-xs text-accent">
      <button onClick={() => useStore.getState().setActiveSidePanel(useStore.getState().activeSidePanel === 'explorer' ? null : 'explorer')}>资源</button>
      <button onClick={() => useStore.getState().setActiveSidePanel('shell')}>Shell</button>
      <button onClick={() => useStore.getState().toggleTerminal()}>终端</button>
    </nav><WorkspaceWorkbench /></div>
    <footer className="h-6 border-t border-border text-xs text-text-muted px-4">main · TypeScript</footer>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
