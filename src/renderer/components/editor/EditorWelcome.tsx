/**
 * 编辑器欢迎页组件
 */

import { Search, Terminal } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { Logo } from '../common/Logo'

export function EditorWelcome() {
  const language = useStore((state) => state.language)

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent/5 rounded-full blur-[120px] opacity-50" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative z-10 animate-fade-in p-8">
        <div className="text-center mb-12">
          <div className="relative inline-block mb-6 group">
            <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full group-hover:bg-accent/30 transition-all duration-700" />
            <div className="relative z-10 transform group-hover:scale-110 transition-transform duration-500 ease-out">
              <Logo className="w-24 h-24" glow />
            </div>
          </div>

          <h1 className="text-4xl font-bold text-text-primary mb-3 tracking-tight">
            Adnify
          </h1>
          <p className="text-text-muted text-lg font-medium opacity-60">
            Advanced AI-Powered Editor
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
          <QuickActionButton
            icon={<Search className="w-5 h-5 text-accent" />}
            iconBg="bg-accent/10 group-hover:bg-accent/20"
            title={t('searchFile', language)}
            subtitle="Search and open files"
            shortcut={['Ctrl', 'P']}
            onClick={() => useStore.getState().setShowQuickOpen(true)}
          />

          <QuickActionButton
            icon={<Terminal className="w-5 h-5 text-purple-400" />}
            iconBg="bg-purple-500/10 group-hover:bg-purple-500/20"
            title={t('commandPalette', language)}
            subtitle="Run commands"
            shortcut={['Ctrl', 'Shift', 'O']}
            onClick={() => useStore.getState().setShowCommandPalette(true)}
          />
        </div>

        <div className="mt-16 flex items-center gap-8 text-xs text-text-muted/60 font-medium">
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-border font-mono">Ctrl</kbd>
            <span>+</span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-border font-mono">,</kbd>
            <span>Settings</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-text-muted/20" />
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-border font-mono">F12</kbd>
            <span>DevTools</span>
          </div>
        </div>
      </div>
    </div>
  )
}

interface QuickActionButtonProps {
  icon: React.ReactNode
  iconBg: string
  title: string
  subtitle: string
  shortcut: string[]
  onClick: () => void
}

function QuickActionButton({ icon, iconBg, title, subtitle, shortcut, onClick }: QuickActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between p-5 rounded-2xl bg-surface/20 hover:bg-surface/40 border border-border hover:border-accent/30 transition-all duration-300 backdrop-blur-sm shadow-sm hover:shadow-md hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center transition-colors duration-300`}>
          {icon}
        </div>
        <div className="text-left">
          <div className="text-sm font-bold text-text-primary group-hover:text-accent transition-colors">
            {title}
          </div>
          <div className="text-xs text-text-muted mt-0.5 opacity-80">{subtitle}</div>
        </div>
      </div>
      <div className="flex gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
        {shortcut.map((key, index) => (
          <kbd key={index} className="h-6 px-2 rounded-md bg-black/20 border border-white/5 text-[10px] font-mono flex items-center text-text-secondary">
            {key}
          </kbd>
        ))}
      </div>
    </button>
  )
}
