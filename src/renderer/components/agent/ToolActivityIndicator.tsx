import { memo, useEffect, useState } from 'react'
import type { ToolCall } from '@renderer/agent/types'

type ActivityState = 'idle' | 'running' | 'success' | 'error'

/**
 * 时间轴行尾的操作位尺寸。文件修改行在这里放"在编辑器中打开"图标，
 * 其他行渲染同尺寸的占位符，让各类行的耗时列共用同一条右边界。
 */
export const TOOL_ROW_ACTION_SLOT_CLASS = 'h-[22px] w-[22px] shrink-0'

interface ToolActivityIndicatorProps {
  state: ActivityState
}

interface ToolElapsedTimeProps {
  state: ActivityState
  startedAt?: number
  durationMs?: number
  className?: string
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function getToolTiming(toolCall: ToolCall): { startedAt?: number; durationMs?: number } {
  const meta = toolCall.arguments?._meta
  if (!meta || typeof meta !== 'object') return {}
  const record = meta as Record<string, unknown>
  return {
    startedAt: asFiniteNumber(record.startedAt),
    durationMs: asFiniteNumber(record.durationMs),
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function ToolElapsedTime({ state, startedAt, durationMs, className = '' }: ToolElapsedTimeProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (state !== 'running' || !startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [startedAt, state])


  const elapsed = state === 'running' && startedAt
    ? Math.max(0, now - startedAt)
    : durationMs

  if (elapsed === undefined || elapsed <= 0) return null

  return <span className={`tool-activity-time ${className}`} data-state={state}>{formatDuration(elapsed)}</span>
}

// Icon state is a pure view of the conversation timeline, not another clock.
function ToolActivityIndicator({ state }: ToolActivityIndicatorProps) {
  return (
    <span className="tool-activity" data-state={state} aria-label={state}>
      <svg className="tool-activity-mark" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="tool-activity-arc" cx="9" cy="9" r="7" />
        <path className="tool-activity-check" d="M5.2 9.2 7.8 12l5.2-6" />
        <path className="tool-activity-cross" d="m6 6 6 6m0-6-6 6" />
      </svg>
    </span>
  )
}

export default memo(ToolActivityIndicator)
