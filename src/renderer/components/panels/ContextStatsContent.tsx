import { Layers, Coins, Zap, AlertTriangle, ChevronRight, ArrowRightCircle, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  useAgentStore,
  selectCompressionStats,
  selectCurrentThread,
  selectLatestContextSnapshot,
} from '@/renderer/agent/store/AgentStore'
import { createManualHandoffSession } from '@/renderer/agent/services/handoffSessionService'
import type { CompressionLevel } from '@/renderer/agent/domains/context/types'
import type { TokenUsage } from '@renderer/agent/types'
import { toast } from '../common/ToastProvider'

interface ContextStatsContentProps {
  totalUsage: TokenUsage
  lastUsage?: TokenUsage
  language?: 'zh' | 'en'
}

const LEVEL_COLORS: Record<CompressionLevel, string> = {
  0: 'text-emerald-400',
  1: 'text-blue-400',
  2: 'text-yellow-400',
  3: 'text-orange-400',
  4: 'text-red-400',
}

const LEVEL_BG: Record<CompressionLevel, string> = {
  0: 'bg-emerald-400',
  1: 'bg-blue-400',
  2: 'bg-yellow-400',
  3: 'bg-orange-400',
  4: 'bg-red-400',
}

export default function ContextStatsContent({
  totalUsage,
  lastUsage,
  language = 'en',
}: ContextStatsContentProps) {
  const compressionStats = useAgentStore(selectCompressionStats)
  const currentThread = useAgentStore(selectCurrentThread)
  const latestSnapshot = useAgentStore(selectLatestContextSnapshot)
  const [isCreatingHandoff, setIsCreatingHandoff] = useState(false)

  const currentLevel = (compressionStats?.level ?? 0) as CompressionLevel
  const needsHandoff = compressionStats?.needsHandoff ?? currentLevel >= 4
  const ratio = compressionStats?.ratio ?? 0
  const contextLimit = compressionStats?.contextLimit ?? 128000
  const inputTokens = compressionStats?.inputTokens ?? 0

  const levelNames = {
    0: language === 'zh' ? '完整' : 'Full',
    1: language === 'zh' ? '截断' : 'Truncate',
    2: language === 'zh' ? '滑窗' : 'Window',
    3: language === 'zh' ? '深压' : 'Deep',
    4: language === 'zh' ? '交接' : 'Handoff',
  }

  const formatK = (n: number | undefined) => {
    if (n === undefined || n === null || isNaN(n)) return '0'
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
  }

  const formatNumber = (n: number | undefined) => {
    if (n === undefined || n === null || isNaN(n)) return '0'
    return n.toLocaleString()
  }

  const progressColor = useMemo(() => {
    if (ratio >= 0.95) return 'bg-red-500'
    if (ratio >= 0.85) return 'bg-orange-500'
    if (ratio >= 0.7) return 'bg-yellow-500'
    return 'bg-emerald-500'
  }, [ratio])

  const handleManualCompress = async () => {
    if (!currentThread || isCreatingHandoff) return

    if (currentThread.messages.length === 0) {
      toast.error(
        language === 'zh' ? '无法压缩' : 'Cannot compress',
        language === 'zh' ? '当前对话还没有可压缩的内容' : 'There is no conversation content to compress yet.',
      )
      return
    }

    setIsCreatingHandoff(true)

    try {
      await createManualHandoffSession(currentThread.id)
      toast.success(
        language === 'zh' ? '已切换到新线程' : 'Switched to new thread',
        language === 'zh' ? '已基于最新上下文快照创建续接线程' : 'Created a new thread from the latest context snapshot.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(
        language === 'zh' ? '压缩失败' : 'Compression failed',
        message || (language === 'zh' ? '未能生成上下文续接快照' : 'Could not generate a handoff snapshot.'),
      )
    } finally {
      setIsCreatingHandoff(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background/50 backdrop-blur-xl select-none">
      <div className="p-4 border-b border-border/40">
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-text-muted" />
              <span className="text-xs font-medium text-text-secondary">
                {language === 'zh' ? '上下文使用' : 'Context Usage'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold font-mono ${LEVEL_COLORS[currentLevel]}`}>
                {Math.round(ratio * 100)}%
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${LEVEL_BG[currentLevel]}/20 ${LEVEL_COLORS[currentLevel]}`}>
                L{currentLevel}
              </span>
            </div>
          </div>

          <div className="h-2 bg-text-primary/[0.05] rounded-full overflow-hidden">
            <div
              className={`h-full ${progressColor} transition-all duration-500 rounded-full`}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>

          <div className="flex justify-between mt-1 text-[9px] text-text-muted/50 font-mono">
            <span>0</span>
            <span className="text-yellow-500/50">50%</span>
            <span className="text-red-500/50">100%</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
            <div className="text-[9px] text-text-muted uppercase">
              {language === 'zh' ? '当前输入' : 'Input'}
            </div>
            <div className="text-sm font-mono font-bold text-text-primary">
              {formatK(inputTokens)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
            <div className="text-[9px] text-text-muted uppercase">
              {language === 'zh' ? '上下文限制' : 'Limit'}
            </div>
            <div className="text-sm font-mono font-bold text-text-secondary">
              {formatK(contextLimit)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
            <div className="text-[9px] text-text-muted uppercase">
              {language === 'zh' ? '压缩等级' : 'Level'}
            </div>
            <div className={`text-sm font-mono font-bold ${LEVEL_COLORS[currentLevel]}`}>
              {levelNames[currentLevel]}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 border-b border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-4 h-4 text-accent" />
          <span className="text-xs font-medium text-text-secondary">
            {language === 'zh' ? '费用统计' : 'Cost Stats'}
          </span>
          <span className="ml-auto text-lg font-bold font-mono text-accent">
            {formatK(totalUsage?.totalTokens ?? 0)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatRow
            label={language === 'zh' ? '累计输入' : 'Total In'}
            value={formatNumber(totalUsage?.promptTokens ?? 0)}
          />
          <StatRow
            label={language === 'zh' ? '累计输出' : 'Total Out'}
            value={formatNumber(totalUsage?.completionTokens ?? 0)}
          />
          <StatRow
            label={language === 'zh' ? '缓存命中' : 'Cache Read'}
            value={formatNumber(totalUsage?.cachedInputTokens ?? 0)}
            valueClassName="text-emerald-300"
          />
          <StatRow
            label={language === 'zh' ? '缓存写入' : 'Cache Write'}
            value={formatNumber(totalUsage?.cacheWriteTokens ?? 0)}
            valueClassName="text-sky-300"
          />
        </div>

        {lastUsage && (
          <>
            <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {language === 'zh' ? '最近一次' : 'Last request'}
              </span>
              <span>
                {formatK(lastUsage.promptTokens)} <ChevronRight className="w-3 h-3 inline" /> {formatK(lastUsage.completionTokens)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
              <span>{language === 'zh' ? '最近缓存' : 'Last cache'}</span>
              <span>
                {formatK(lastUsage.cachedInputTokens ?? 0)} <ChevronRight className="w-3 h-3 inline" /> {formatK(lastUsage.cacheWriteTokens ?? 0)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {needsHandoff && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex gap-3 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-red-400 mb-0.5">
                {language === 'zh' ? '上下文已满' : 'Context Full'}
              </h4>
              <p className="text-[10px] text-red-400/70">
                {language === 'zh' ? '建议压缩后切换到新线程继续' : 'Compress and continue in a new thread.'}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[9px] text-text-muted uppercase tracking-wider">
              {language === 'zh' ? '压缩策略' : 'Compression Strategy'}
            </div>
            <button
              type="button"
              onClick={handleManualCompress}
              disabled={!currentThread || isCreatingHandoff}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingHandoff ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowRightCircle className="w-3 h-3" />
              )}
              <span>
                {language === 'zh' ? '手动压缩并新开线程' : 'Compress to New Thread'}
              </span>
            </button>
          </div>

          {([0, 1, 2, 3, 4] as CompressionLevel[]).map(level => (
            <div
              key={level}
              className={`flex items-center gap-2 p-2 rounded-lg transition-all ${level === currentLevel ? 'bg-text-primary/[0.05] ring-1 ring-text-primary/[0.1]' : 'opacity-50'}`}
            >
              <span className={`text-[9px] font-bold font-mono w-6 ${LEVEL_COLORS[level]}`}>
                L{level}
              </span>
              <span className="text-[10px] text-text-secondary flex-1">
                {level === 0 && (language === 'zh' ? '保留全部消息' : 'Keep all messages')}
                {level === 1 && (language === 'zh' ? '截断工具参数' : 'Truncate tool args')}
                {level === 2 && (language === 'zh' ? '清理旧工具结果' : 'Clear old results')}
                {level === 3 && (language === 'zh' ? '深度压缩 + 摘要' : 'Deep compress + summary')}
                {level === 4 && (language === 'zh' ? '需要新会话' : 'New session needed')}
              </span>
              {level === currentLevel && (
                <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_BG[level]}`} />
              )}
            </div>
          ))}
        </div>

        {latestSnapshot ? (
          <div className="mt-4 p-3 rounded-xl bg-surface/30 border border-border/40">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[9px] text-accent font-bold uppercase tracking-wider">
                {language === 'zh' ? '当前任务' : 'Current Task'}
              </div>
              <span className="text-[9px] text-text-muted uppercase tracking-wider">
                {latestSnapshot.source === 'handoff'
                  ? (language === 'zh' ? '续接快照' : 'Handoff Snapshot')
                  : (language === 'zh' ? '压缩快照' : 'Compression Snapshot')}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">
              {latestSnapshot.summary.objective}
            </p>
            {latestSnapshot.summary.pendingSteps[0] && (
              <p className="mt-2 text-[10px] text-text-muted leading-relaxed line-clamp-2">
                {language === 'zh' ? '下一步：' : 'Next:'} {latestSnapshot.summary.pendingSteps[0]}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-surface/20 border border-border/30">
            <div className="text-[9px] text-text-muted uppercase tracking-wider mb-1">
              {language === 'zh' ? '当前任务' : 'Current Task'}
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              {language === 'zh' ? '暂无上下文快照' : 'No context snapshot yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatRow({
  label,
  value,
  valueClassName = 'text-text-primary',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
      <span className="text-[10px] text-text-muted">{label}</span>
      <span className={`text-xs font-mono ${valueClassName}`}>{value}</span>
    </div>
  )
}
