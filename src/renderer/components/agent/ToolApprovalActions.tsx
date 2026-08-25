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
  // 审批条是卡片里的操作区，不是页面级主按钮：外层已有卡片边框和背景，
  // 这里再用大按钮会和内容抢视觉重量。次要动作（拒绝/停止）走无边框浅色文字，
  // 只有「允许」保留主色实心，一眼就能锁定主操作。
  const buttonHeight = compact ? 'h-6' : 'h-7'
  const secondaryButtonClass = compact
    ? 'w-6 px-0'
    : 'gap-1 px-2'

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
      className="flex min-w-0 flex-nowrap items-center justify-end gap-0.5"
      onClick={event => event.stopPropagation()}
    >
      {onReject && (
        <button
          type="button"
          onClick={onReject}
          aria-label={zh ? '拒绝当前操作' : 'Reject current action'}
          title={zh ? '仅拒绝当前操作，Agent 会收到拒绝结果并重新规划' : 'Reject only this action and let the agent re-plan'}
          className={`${buttonHeight} ${secondaryButtonClass} inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-[11px] text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/50`}
        >
          <X className="h-3 w-3 shrink-0" />
          <span className={compact ? 'sr-only' : undefined}>{zh ? '拒绝' : 'Reject'}</span>
        </button>
      )}

      {onStop && (
        <button
          type="button"
          onClick={onStop}
          aria-label={zh ? '停止当前任务' : 'Stop current task'}
          title={zh ? '停止当前任务，保留对话和已经完成的结果' : 'Stop this task but keep the conversation and completed results'}
          className={`${buttonHeight} ${secondaryButtonClass} inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border`}
        >
          <Square className="h-2.5 w-2.5 shrink-0 fill-current" />
          <span className={compact ? 'sr-only' : undefined}>{zh ? '停止' : 'Stop'}</span>
        </button>
      )}

      {onApproveAlways && (
        <button
          type="button"
          onClick={onApproveAlways}
          aria-label={zh ? '始终允许相似命令' : 'Always allow similar commands'}
          title={zh ? '保存程序和固定参数前缀，后续相似命令自动运行' : 'Save the executable and fixed argument prefix for future commands'}
          className={`${buttonHeight} ${compact ? 'w-6 px-0' : 'gap-1 px-2'} inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50`}
        >
          <ShieldCheck className="h-3 w-3 shrink-0" />
          <span className={compact ? 'sr-only' : undefined}>{zh ? '始终' : 'Always'}</span>
        </button>
      )}

      {onApprove && (
        <div className="ml-1 flex shrink-0 items-stretch overflow-hidden rounded-md border border-accent/35 bg-accent/[0.08] text-accent shadow-[0_1px_2px_rgba(var(--accent-rgb),0.08)]">
          <button
            type="button"
            onClick={onApprove}
            title={zh ? '仅允许当前这一次操作' : 'Allow only this action once'}
            className={`${buttonHeight} inline-flex cursor-pointer items-center justify-center gap-1 px-2.5 text-[11px] font-semibold transition-colors hover:bg-accent/15 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50`}
          >
            <Check className="h-3 w-3 shrink-0" />
            <span>{zh ? '允许' : 'Allow'}</span>
          </button>

          {onApproveForTask && (
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
                className={`${buttonHeight} flex ${compact ? 'w-5' : 'w-6'} cursor-pointer items-center justify-center border-l border-accent/25 transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50`}
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
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
                  className="fixed z-[1000] w-[min(17rem,calc(100vw-1rem))] isolate overflow-hidden rounded-xl border border-border p-1.5 text-text-primary"
                >
                <div className="px-2.5 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-text-muted/70">
                  {zh ? '选择授权范围' : 'Approval scope'}
                </div>
                {onApproveForTask && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { closeMenu(); onApproveForTask() }}
                    className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold">{zh ? '本任务允许此操作' : 'Allow this action for task'}</span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-text-muted">{zh ? '当前任务内复用完全相同的命令、目录或路径' : 'Reuse the exact command, directory, or path during this task'}</span>
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
