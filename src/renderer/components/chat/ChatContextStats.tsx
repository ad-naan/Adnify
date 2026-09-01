/**
 * 上下文统计显示组件
 */
import { memo } from 'react'
import { Database, History, FileText, Code } from 'lucide-react'
import type { ContextStats } from '@/renderer/agent/types'
import { Language, t } from '@shared/i18n'

interface ChatContextStatsProps {
  stats: ContextStats
  language: Language
  compact?: boolean
}

function ChatContextStats({ stats, language, compact = false }: ChatContextStatsProps) {
  const usagePercent = stats.totalChars / stats.maxChars

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-[10px] text-text-muted select-none">
        {/* 上下文使用量 */}
        <div
          className="flex items-center gap-1.5"
          title={t('chatContextStats.contextUsageKK', language, { value: (stats.totalChars / 1000).toFixed(1), value2: (stats.maxChars / 1000).toFixed(0) })}
        >
          <Database className="w-3 h-3" />
          <div className="w-12 h-1 bg-text-primary/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${usagePercent > 0.95
                ? 'bg-status-error shadow-[0_0_5px_rgba(var(--status-error),0.5)]'
                : usagePercent > 0.8
                  ? 'bg-status-warning'
                  : 'bg-accent shadow-[0_0_5px_rgba(var(--accent),0.5)]'
                }`}
              style={{ width: `${Math.min(100, usagePercent * 100)}%` }}
            />
          </div>
        </div>

        {/* 历史消息 */}
        <div
          className="flex items-center gap-1"
          title={t('chatContextStats.historyMessages', language, { messageCount: stats.messageCount, maxMessages: stats.maxMessages })}
        >
          <History className="w-3 h-3" />
          <span className="font-medium">{stats.messageCount}</span>
        </div>

        {/* 上下文文件 */}
        {stats.fileCount > 0 && (
          <div
            className="flex items-center gap-1"
            title={t('chatContextStats.contextFiles', language, { fileCount: stats.fileCount, maxFiles: stats.maxFiles })}
          >
            <FileText className="w-3 h-3" />
            <span className="font-medium">{stats.fileCount}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-1.5 border-b border-border bg-transparent flex items-center gap-4 text-[10px] text-text-muted animate-fade-in select-none">
      {/* 上下文使用量 */}
      <div
        className="flex items-center gap-1.5"
        title={t('chatContextStats.contextUsage', language)}
      >
        <Database className="w-3 h-3" />
        <span className="font-medium">
          {(stats.totalChars / 1000).toFixed(1)}K / {(stats.maxChars / 1000).toFixed(0)}K
        </span>
        <div className="w-16 h-1 bg-text-primary/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 shadow-[0_0_5px_rgba(var(--accent),0.5)] ${usagePercent > 0.95
              ? 'bg-status-error'
              : usagePercent > 0.8
                ? 'bg-status-warning'
                : 'bg-accent'
              }`}
            style={{ width: `${Math.min(100, usagePercent * 100)}%` }}
          />
        </div>
      </div>

      {/* 历史消息 */}
      <div
        className="flex items-center gap-1.5"
        title={t('chatContextStats.historyMessages2', language)}
      >
        <History className="w-3 h-3" />
        <span className="font-medium">
          {stats.messageCount} / {stats.maxMessages}
        </span>
      </div>

      {/* 上下文文件 */}
      {stats.fileCount > 0 && (
        <div
          className="flex items-center gap-1.5"
          title={t('chatContextStats.contextFiles2', language)}
        >
          <FileText className="w-3 h-3" />
          <span className="font-medium">
            {stats.fileCount} / {stats.maxFiles}
          </span>
        </div>
      )}

      {/* 语义搜索结果 */}
      {stats.semanticResultCount > 0 && (
        <div
          className="flex items-center gap-1.5"
          title={t('chatContextStats.semanticResults', language)}
        >
          <Code className="w-3 h-3" />
          <span className="font-medium">{stats.semanticResultCount}</span>
        </div>
      )}
    </div>
  )
}

export default memo(ChatContextStats)
