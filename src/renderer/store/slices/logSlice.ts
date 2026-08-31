import { StateCreator } from 'zustand'
import type { SettingsSlice } from './settingsSlice'

/**
 * 工具调用日志条目
 */
export interface ToolCallLogEntry {
  id: string
  timestamp: Date
  threadId?: string
  type: 'request' | 'response'
  toolName: string
  data: unknown
  duration?: number
  success?: boolean
  error?: string
}

/**
 * 工具统计信息
 */
export interface ToolStats {
  toolName: string
  totalCalls: number
  successCalls: number
  failedCalls: number
  successRate: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  totalDuration: number
}

/**
 * 性能洞察
 */
export interface PerformanceInsight {
  type: 'slow_tool' | 'high_failure' | 'frequent_tool'
  severity: 'info' | 'warning' | 'critical'
  toolName: string
  message: string
  messageZh: string
  value: number
}

export interface LogSlice {
  toolCallLogs: ToolCallLogEntry[]
  addToolCallLog: (entry: Omit<ToolCallLogEntry, 'id' | 'timestamp'>) => void
  clearToolCallLogs: (threadId?: string) => void
  // 统计方法
  getToolStats: (threadId?: string) => ToolStats[]
  getPerformanceInsights: (threadId?: string) => PerformanceInsight[]
}

const MAX_LOGS = 200

type LogSliceStore = LogSlice & Pick<SettingsSlice, 'agentConfig'>

export const createLogSlice: StateCreator<LogSliceStore, [], [], LogSlice> = (set, get) => ({
  toolCallLogs: [],

  addToolCallLog: (entry) => {
    if (!get().agentConfig.enableToolCallLogging) return

    set((state) => {
      const newEntry: ToolCallLogEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: new Date(),
      }
      const newLogs = [newEntry, ...state.toolCallLogs].slice(0, MAX_LOGS)
      return { toolCallLogs: newLogs }
    })
  },

  clearToolCallLogs: (threadId) => set(state => ({
    toolCallLogs: threadId
      ? state.toolCallLogs.filter(log => log.threadId !== threadId)
      : [],
  })),

  getToolStats: (threadId) => {
    const logs = threadId
      ? get().toolCallLogs.filter(log => log.threadId === threadId)
      : get().toolCallLogs
    // 只统计 response 类型（包含执行结果）
    const responseLogs = logs.filter((l) => l.type === 'response')

    const toolGroups = new Map<string, ToolCallLogEntry[]>()
    for (const log of responseLogs) {
      const group = toolGroups.get(log.toolName) || []
      group.push(log)
      toolGroups.set(log.toolName, group)
    }

    const stats: ToolStats[] = []
    for (const [name, entries] of toolGroups) {
      const successEntries = entries.filter((e) => e.success !== false)
      const durations = entries.filter((e) => e.duration != null).map((e) => e.duration!)

      stats.push({
        toolName: name,
        totalCalls: entries.length,
        successCalls: successEntries.length,
        failedCalls: entries.length - successEntries.length,
        successRate: entries.length > 0 ? successEntries.length / entries.length : 0,
        avgDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        minDuration: durations.length > 0 ? Math.min(...durations) : 0,
        maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
        totalDuration: durations.reduce((a, b) => a + b, 0),
      })
    }

    return stats.sort((a, b) => b.totalCalls - a.totalCalls)
  },

  getPerformanceInsights: (threadId) => {
    const stats = get().getToolStats(threadId)
    const insights: PerformanceInsight[] = []

    for (const stat of stats) {
      // 慢工具 (平均 > 3s)
      if (stat.avgDuration > 3000 && stat.totalCalls >= 2) {
        insights.push({
          type: 'slow_tool',
          severity: stat.avgDuration > 8000 ? 'critical' : 'warning',
          toolName: stat.toolName,
          message: `Avg ${Math.round(stat.avgDuration)}ms`,
          messageZh: `平均 ${Math.round(stat.avgDuration)}ms`,
          value: stat.avgDuration,
        })
      }

      // 高失败率 (< 70% 成功，至少 3 次调用)
      if (stat.successRate < 0.7 && stat.totalCalls >= 3) {
        insights.push({
          type: 'high_failure',
          severity: stat.successRate < 0.4 ? 'critical' : 'warning',
          toolName: stat.toolName,
          message: `${Math.round((1 - stat.successRate) * 100)}% failed`,
          messageZh: `${Math.round((1 - stat.successRate) * 100)}% 失败`,
          value: 1 - stat.successRate,
        })
      }

      // 高频工具 (> 20 次调用)
      if (stat.totalCalls >= 20) {
        insights.push({
          type: 'frequent_tool',
          severity: 'info',
          toolName: stat.toolName,
          message: `${stat.totalCalls} calls`,
          messageZh: `${stat.totalCalls} 次调用`,
          value: stat.totalCalls,
        })
      }
    }

    const severityOrder = { critical: 0, warning: 1, info: 2 }
    return insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
  },
})
