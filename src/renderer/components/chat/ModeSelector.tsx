import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, MessageSquare, Sparkles, Workflow } from 'lucide-react'
import { WorkMode } from '@/renderer/modes/types'
import { useStore } from '@store'

interface ModeSelectorProps {
  mode: WorkMode
  onModeChange: (mode: WorkMode) => void
  className?: string
}

const MODES: Array<{
  id: WorkMode
  icon: typeof MessageSquare
  labelKey: string
  descZh: string
  descEn: string
  color: string
}> = [
    {
      id: 'chat',
      icon: MessageSquare,
      labelKey: 'Chat',
      descZh: '普通对话，不执行工具',
      descEn: 'Chat only, no tool execution',
      color: 'text-blue-400',
    },
    {
      id: 'agent',
      icon: Sparkles,
      labelKey: 'Agent',
      descZh: 'AI 代理，可执行工具',
      descEn: 'AI agent with tool execution',
      color: 'text-accent',
    },
    {
      id: 'plan',
      icon: Workflow,
      labelKey: 'Plan',
      descZh: '多轮需求收集与任务规划',
      descEn: 'Requirement gathering & task planning',
      color: 'text-purple-400',
    },
  ]

export default function ModeSelector({ mode, onModeChange, className = '' }: ModeSelectorProps) {
  const language = useStore(s => s.language)
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return

      const width = 192
      setDropdownStyle({
        position: 'fixed',
        left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
        width,
        bottom: window.innerHeight - rect.top + 8,
        zIndex: 9999,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const currentMode = MODES.find((m) => m.id === mode) || MODES[0]
  const Icon = currentMode.icon

  const dropdown = isOpen && (
    <div
      ref={menuRef}
      style={dropdownStyle}
      className="bg-surface border border-border rounded-xl shadow-2xl py-1 animate-scale-in"
    >
      {MODES.map((m) => {
        const ModeIcon = m.icon
        const isSelected = mode === m.id
        return (
          <button
            key={m.id}
            onClick={() => {
              onModeChange(m.id)
              setIsOpen(false)
            }}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 text-left
              transition-colors
              ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover'}
            `}
          >
            <ModeIcon className={`w-4 h-4 ${m.color}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-medium ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                {m.labelKey}
              </div>
              <div className="text-[10px] text-text-muted truncate opacity-80">
                {language === 'zh' ? m.descZh : m.descEn}
              </div>
            </div>
            {isSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
          </button>
        )
      })}
    </div>
  )

  return (
    <div ref={triggerRef} className={`relative shrink-0 ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold border border-transparent whitespace-nowrap
          transition-all duration-200
          ${isOpen
            ? 'bg-surface-active text-text-primary shadow-[0_0_0_2px_rgba(var(--accent)/0.15)]'
            : 'bg-white/[0.03] text-text-secondary hover:text-text-primary hover:bg-white/[0.08]'
          }
        `}
      >
        <Icon className={`w-3.5 h-3.5 ${currentMode.color}`} />
        <span>{currentMode.labelKey}</span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {createPortal(dropdown, document.body)}
    </div>
  )
}
