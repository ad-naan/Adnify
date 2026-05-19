import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@store'
import {
  workspaceAnalyticsService,
  type WorkspaceDashboardData,
} from '@renderer/services/workspaceAnalyticsService'
import { EMPTY_AI_DASHBOARD_DATA } from '@renderer/services/aiAttributionService'

const EMPTY_DASHBOARD_DATA: WorkspaceDashboardData = {
  overview: {
    fileChanges: { value: '0', rawValue: 0, trend: '+0.0%' },
    commits: { value: '0', rawValue: 0, trend: '+0.0%' },
    sessions: { value: '0', rawValue: 0, trend: '+0.0%' },
    activeHours: { value: '0.0', rawValue: 0, trend: '+0.0%' },
  },
  chartPoints: [0, 0, 0, 0, 0, 0, 0],
  workspace: {
    activityPercent: 0,
    activeProjects: 0,
    pendingTasks: 0,
    updatesToday: 0,
  },
  models: [],
  ai: EMPTY_AI_DASHBOARD_DATA,
}

export function useWorkspaceAnalytics(
  timeRange: 'daily' | 'weekly' | 'monthly',
  selectedDate: string,
) {
  const workspace = useStore(s => s.workspace)
  const workspaceKey = useMemo(() => workspace?.roots?.join('|') || '', [workspace])
  const [data, setData] = useState<WorkspaceDashboardData>(EMPTY_DASHBOARD_DATA)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }

      setLoading(true)
      try {
        const nextData = await workspaceAnalyticsService.getDashboardData(timeRange, selectedDate)
        if (active) {
          setData(nextData)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    const handleVisibilityRefresh = () => {
      if (!document.hidden) {
        void load()
      }
    }

    const shouldRefresh = shouldAutoRefresh(timeRange, selectedDate)
    const interval = shouldRefresh
      ? window.setInterval(() => {
        void load()
      }, 120_000)
      : null

    document.addEventListener('visibilitychange', handleVisibilityRefresh)
    window.addEventListener('focus', handleVisibilityRefresh)

    return () => {
      active = false
      if (interval !== null) {
        window.clearInterval(interval)
      }
      document.removeEventListener('visibilitychange', handleVisibilityRefresh)
      window.removeEventListener('focus', handleVisibilityRefresh)
    }
  }, [selectedDate, timeRange, workspaceKey])

  return { data, loading }
}

function shouldAutoRefresh(
  timeRange: 'daily' | 'weekly' | 'monthly',
  selectedDate: string,
): boolean {
  const selected = parseInputDate(selectedDate)
  const now = new Date()

  if (timeRange === 'daily') {
    return isSameDay(selected, now)
  }

  if (timeRange === 'weekly') {
    return getWeekStart(selected).getTime() === getWeekStart(now).getTime()
  }

  return selected.getFullYear() === now.getFullYear()
    && selected.getMonth() === now.getMonth()
}

function parseInputDate(input: string): Date {
  const [year, month, day] = input.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function getWeekStart(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  const day = next.getDay()
  const diff = day === 0 ? 6 : day - 1
  next.setDate(next.getDate() - diff)
  return next
}
