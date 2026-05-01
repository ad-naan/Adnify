import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@store'
import {
  workspaceAnalyticsService,
  type WorkspaceDashboardData,
} from '@renderer/services/workspaceAnalyticsService'

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
    const interval = window.setInterval(() => {
      void load()
    }, 30_000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [selectedDate, timeRange, workspaceKey])

  return { data, loading }
}
