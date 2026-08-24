import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CheckCheck, ChevronDown, ShieldCheck, Square, X } from 'lucide-react'

interface ToolApprovalActionsProps {
  language: 'zh' | 'en'
  onApprove?: () => void
  onApproveForTask?: () => void
  onApproveAlways?: () => void
  onReject?: () => void
  onStop?: () => void
  compact?: boolean
}

export function ToolApprovalActions({
  language,
  onApprove,
  onApproveForTask,
  onApproveAlways,
  onReject,
  onStop,
  compact = false,
}: ToolApprovalActionsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, ready: false })
  const zh = language === 'zh'
  const closeMenu = () => setMenuOpen(false)
  const buttonHeight = compact ? 'h-7' : 'h-8'

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current || !menuRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    const menu = menuRef.current.getBoundingClientRect()
    const gap = 6
    const viewportPadding = 8
    const fitsAbove = trigger.top >= menu.height + gap + viewportPadding
    const top = fitsAbove
      ? trigger.top - menu.height - gap
      : Math.min(trigger.bottom + gap, window.innerHeight - menu.height - viewportPadding)
    const left = Math.min(
      Math.max(viewportPadding, trigger.right - menu.width),
      window.innerWidth - menu.width - viewportPadding,
    )
    setMenuPosition({ left, top: Math.max(viewportPadding, top), ready: true })
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    const handleViewportChange = () => closeMenu()
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [menuOpen])

  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-end gap-1"
      onClick={event => event.stopPropagation()}
    >
      {onReject && (
        <button
          type="button"
          onClick={onReject}
          title={zh ? '仅拒绝当前操作，Agent 会收到拒绝结果并重新规划' : 'Reject only this action and let the agent re-plan'}
          className={`${buttonHeight} inline-flex cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50`}
        >
          <X className="h-3.5 w-3.5 shrink-0" />
          <span>{zh ? '拒绝' : 'Reject'}</span>
        </button>
      )}

      {onStop && (
        <button
          type="button"
          onClick={onStop}
          title={zh ? '停止当前任务，保留对话和已经完成的结果' : 'Stop this task but keep the conversation and completed results'}
          className={`${buttonHeight} inline-flex cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border`}
        >
          <Square className="h-3 w-3 shrink-0 fill-current" />
          <span>{zh ? (compact ? '停止' : '停止任务') : (compact ? 'Stop' : 'Stop task')}</span>
        </button>
      )}

      {onApprove && (
        <div className="flex shrink-0 items-stretch rounded-md border border-accent/25 bg-accent/10 text-accent">
          <button
            type="button"
            onClick={onApprove}
            title={zh ? '允许当前操作；符合复用条件的相同操作两分钟内不再询问' : 'Allow this action; eligible identical actions are reused for two minutes'}
            className={`${buttonHeight} inline-flex cursor-pointer items-center justify-center gap-1 rounded-l-md px-2.5 text-[11px] font-semibold transition-colors hover:bg-accent/15 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}
          >
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{zh ? '允许' : 'Allow'}</span>
          </button>

          {(onApproveForTask || onApproveAlways) && (
            <>
              <button
                ref={triggerRef}
                type="button"
                aria-label={zh ? '更多允许方式' : 'More approval options'}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                title={zh ? '更多允许方式' : 'More approval options'}
                onClick={() => setMenuOpen(value => {
                  if (!value) setMenuPosition(position => ({ ...position, ready: false }))
                  return !value
                })}
                className={`${buttonHeight} flex w-7 cursor-pointer items-center justify-center rounded-r-md border-l border-accent/20 transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
              </button>
              {menuOpen && typeof document !== 'undefined' && createPortal(
                <div
                  ref={menuRef}
                  id={menuId}
                  role="menu"
                  style={{
                    left: menuPosition.left,
                    top: menuPosition.top,
                    visibility: menuPosition.ready ? 'visible' : 'hidden',
                    backgroundColor: 'rgb(var(--surface))',
                    boxShadow: '0 14px 34px rgb(0 0 0 / 0.20), 0 3px 10px rgb(0 0 0 / 0.10)',
                  }}
                  className="fixed z-[1000] w-64 isolate overflow-hidden rounded-lg border border-border p-1.5 text-text-primary"
                >
                {onApproveForTask && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { closeMenu(); onApproveForTask() }}
                    className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold">{zh ? '本任务允许相同操作' : 'Allow identical actions for task'}</span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-text-muted">{zh ? '仅限当前任务和完全相同的命令或路径' : 'Only this task and the exact same command or path'}</span>
                    </span>
                  </button>
                )}
                {onApproveAlways && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { closeMenu(); onApproveAlways() }}
                    className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold">{zh ? '配置相似命令规则' : 'Configure similar-command rule'}</span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-text-muted">{zh ? '保存到安全设置，执行前仍检查危险参数' : 'Saved in Security settings; dangerous arguments are still checked'}</span>
                    </span>
                  </button>
                )}
                </div>,
                document.body,
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
