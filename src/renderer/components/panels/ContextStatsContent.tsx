import {
  AlertTriangle,
  ArrowRightCircle,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Coins,
  Loader2,
  Scale,
  TimerReset,
  Zap,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
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
  const memoryHealth = compressionStats?.memoryHealth
  const hasMemoryHealth = Boolean(memoryHealth)
  const memoryScore = memoryHealth?.score ?? 0
  const contextLimit = compressionStats?.contextLimit ?? 128000
  const inputTokens = compressionStats?.inputTokens ?? 0
  const peakRatio = compressionStats?.peakRatio ?? ratio
  const staleTurns = memoryHealth?.staleTurns ?? 0

  const t = useMemo(() => ({
    contextControl: language === 'zh' ? '上下文管理' : 'Context Control',
    contextLoad: language === 'zh' ? '上下文负载' : 'Context Load',
    threadPeakUsage: language === 'zh' ? '线程峰值占用' : 'Thread peak usage',
    memoryState: language === 'zh' ? '工作记忆' : 'Working Memory',
    compressionLevel: language === 'zh' ? '压缩等级' : 'Compression Level',
    windowUsage: language === 'zh' ? '本轮输入窗口占用' : 'Per-request input window usage',
    loadStatus: language === 'zh' ? '当前状态' : 'Current state',
    input: language === 'zh' ? '输入' : 'Input',
    inputUse: language === 'zh' ? '输入占用' : 'Input Use',
    strategy: language === 'zh' ? '策略' : 'Strategy',
    summaryTiming: language === 'zh' ? '总结触发时机' : 'When summary starts',
    handoffTiming: language === 'zh' ? '切线程触发时机' : 'When new thread starts',
    summaryTimingValue: language === 'zh' ? 'L3，约 85% 以上' : 'L3, around 85%+',
    handoffTimingValue: language === 'zh' ? 'L4，约 95% 以上' : 'L4, around 95%+',
    summaryHint: language === 'zh'
      ? '系统会在上下文进入高水位时生成摘要，用于后续压缩和续接。'
      : 'A summary is generated once context usage is high enough to support compression and resume continuity.',
    handoffHint: language === 'zh'
      ? '当单次请求接近上下文上限时，系统会准备续接包，并建议或自动切到新线程继续。'
      : 'When a request is close to the context limit, the app prepares a handoff packet and suggests or auto-starts a new thread.',
    memoryScore: language === 'zh' ? '连续性分数' : 'Continuity score',
    snapshotStatus: language === 'zh' ? '摘要状态' : 'Snapshot status',
    snapshotReady: language === 'zh' ? '已生成' : 'Ready',
    snapshotMissing: language === 'zh' ? '未生成' : 'Not ready',
    freshness: language === 'zh' ? '新鲜度' : 'Freshness',
    freshnessFresh: language === 'zh' ? '最新' : 'Fresh',
    freshnessStale: language === 'zh' ? `落后 ${staleTurns} 轮` : `${staleTurns} turns behind`,
    scoreHint: language === 'zh'
      ? '它衡量的是摘要对目标、待办、已完成项、用户要求和文件改动的覆盖度，以及是否过期。'
      : 'This score measures how well the summary covers the objective, pending work, completed work, user instructions, and file changes, plus how stale it is.',
    memoryEmptyHint: language === 'zh'
      ? '当前还没有结构化工作记忆。通常要在进入 L3 后才会自动生成。'
      : 'No structured working memory exists yet. It is usually generated automatically once the thread reaches L3.',
    lowRisk: language === 'zh' ? '低风险' : 'Low Risk',
    mediumRisk: language === 'zh' ? '中风险' : 'Medium Risk',
    highRisk: language === 'zh' ? '高风险' : 'High Risk',
    staleTurnsLabel: language === 'zh' ? '距摘要后的新增轮次' : 'Turns since last summary',
    manualHandoff: language === 'zh' ? '压缩并切到新线程' : 'Compress to New Thread',
    manualHandoffBusy: language === 'zh' ? '正在切换' : 'Switching',
    noThread: language === 'zh' ? '无法压缩' : 'Cannot compress',
    noThreadBody: language === 'zh' ? '当前对话还没有可压缩的内容。' : 'There is no conversation content to compress yet.',
    switched: language === 'zh' ? '已切到新线程' : 'Switched to new thread',
    switchedBody: language === 'zh' ? '已基于最新上下文快照创建续接线程。' : 'Created a new thread from the latest context snapshot.',
    compressFailed: language === 'zh' ? '压缩失败' : 'Compression failed',
    compressFallback: language === 'zh' ? '未能生成上下文续接快照。' : 'Could not generate a handoff snapshot.',
    currentTask: language === 'zh' ? '当前任务' : 'Current Task',
    handoffSnapshot: language === 'zh' ? '续接快照' : 'Handoff Snapshot',
    compressionSnapshot: language === 'zh' ? '压缩快照' : 'Compression Snapshot',
    noSnapshot: language === 'zh' ? '暂无上下文快照' : 'No context snapshot yet',
    next: language === 'zh' ? '下一步：' : 'Next:',
    strategyGuide: language === 'zh' ? '压缩与续接策略' : 'Compression and Handoff Strategy',
    contextFull: language === 'zh' ? '上下文接近上限' : 'Context near limit',
    contextFullHint: language === 'zh'
      ? '建议尽快生成续接线程，避免下一轮请求丢失历史。'
      : 'Consider creating a new thread soon to avoid losing useful history on the next request.',
    totalTokens: language === 'zh' ? '总消耗' : 'Total Tokens',
    totalIn: language === 'zh' ? '累计输入' : 'Total In',
    totalOut: language === 'zh' ? '累计输出' : 'Total Out',
    cacheRead: language === 'zh' ? '缓存命中' : 'Cache Read',
    cacheWrite: language === 'zh' ? '缓存写入' : 'Cache Write',
    lastRequest: language === 'zh' ? '最近一次' : 'Last request',
    lastCache: language === 'zh' ? '最近缓存' : 'Last cache',
    source: language === 'zh' ? '来源' : 'Source',
    providerReported: language === 'zh' ? '服务商返回' : 'Provider reported',
    locallyEstimated: language === 'zh' ? '本地估算' : 'Locally estimated',
    readProvider: language === 'zh' ? '读: 服务商' : 'Read: provider',
    writeProvider: language === 'zh' ? '写: 服务商' : 'Write: provider',
    writeEstimated: language === 'zh' ? '写: 估算' : 'Write: estimated',
    notAvailable: language === 'zh' ? '-' : '-',
    levelLabel: language === 'zh' ? '当前策略级别' : 'Current strategy level',
  }), [language, staleTurns])

  const levelNames: Record<CompressionLevel, string> = {
    0: language === 'zh' ? '完整保留' : 'Full Context',
    1: language === 'zh' ? '截断参数' : 'Truncate Args',
    2: language === 'zh' ? '清理旧结果' : 'Clear Old Results',
    3: language === 'zh' ? '深度压缩' : 'Deep Compress',
    4: language === 'zh' ? '续接切换' : 'Session Handoff',
  }

  const levelDescriptions: Record<CompressionLevel, string> = {
    0: language === 'zh' ? '保留完整消息历史。' : 'Keep full message history.',
    1: language === 'zh' ? '开始截断较长的工具参数。' : 'Start truncating long tool arguments.',
    2: language === 'zh' ? '清理较早的工具执行结果。' : 'Clear older tool results.',
    3: language === 'zh' ? '深度压缩历史，并生成工作摘要。' : 'Deep-compress history and generate a working summary.',
    4: language === 'zh' ? '准备续接包，建议切到新线程继续。' : 'Prepare a handoff packet and continue in a new thread.',
  }

  const formatK = (n: number | undefined) => {
    if (n === undefined || n === null || Number.isNaN(n)) return '0'
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
  }

  const formatNumber = (n: number | undefined) => {
    if (n === undefined || n === null || Number.isNaN(n)) return '0'
    return n.toLocaleString()
  }

  const cacheReadHint = totalUsage?.cacheReadSource === 'provider-reported'
    ? t.providerReported
    : undefined

  const cacheWriteHint = totalUsage?.cacheWriteSource === 'provider-reported'
    ? t.providerReported
    : totalUsage?.cacheWriteSource === 'estimated'
      ? t.locallyEstimated
      : undefined

  const memoryProgressColor = useMemo(() => {
    if (!hasMemoryHealth) return 'bg-text-muted/30'
    if (memoryScore >= 80) return 'bg-emerald-500'
    if (memoryScore >= 55) return 'bg-yellow-500'
    return 'bg-red-500'
  }, [hasMemoryHealth, memoryScore])

  const inputProgressColor = useMemo(() => {
    if (ratio >= 0.95) return 'bg-red-500'
    if (ratio >= 0.85) return 'bg-orange-500'
    if (ratio >= 0.7) return 'bg-yellow-500'
    return 'bg-blue-500'
  }, [ratio])

  const memoryRiskLabel = memoryHealth?.risk === 'low'
    ? t.lowRisk
    : memoryHealth?.risk === 'medium'
      ? t.mediumRisk
      : t.highRisk

  const freshnessLabel = !hasMemoryHealth
    ? t.snapshotMissing
    : staleTurns === 0
      ? t.freshnessFresh
      : t.freshnessStale

  const handleManualCompress = async () => {
    if (!currentThread || isCreatingHandoff) return

    if (currentThread.messages.length === 0) {
      toast.error(t.noThread, t.noThreadBody)
      return
    }

    setIsCreatingHandoff(true)

    try {
      await createManualHandoffSession(currentThread.id)
      toast.success(t.switched, t.switchedBody)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t.compressFailed, message || t.compressFallback)
    } finally {
      setIsCreatingHandoff(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-background/50 backdrop-blur-xl select-none">
      <div className="border-b border-border/40 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
              {t.contextControl}
            </div>
            <div className="mt-1 text-xs text-text-secondary">
              {t.loadStatus}
            </div>
          </div>
          <div className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${LEVEL_BG[currentLevel]}/20 ${LEVEL_COLORS[currentLevel]}`}>
            {t.levelLabel}: L{currentLevel}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <MetricCard label={t.input} value={formatK(inputTokens)} />
          <MetricCard label={t.inputUse} value={`${Math.round(ratio * 100)}%`} tone="secondary" />
          <MetricCard label={t.strategy} value={`L${currentLevel}`} valueClassName={LEVEL_COLORS[currentLevel]} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Scale className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{t.contextLoad}</span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {t.windowUsage}
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-text-primary">
                {formatK(inputTokens)} / {formatK(contextLimit)}
              </div>
            </div>
            <div className={`text-right ${LEVEL_COLORS[currentLevel]}`}>
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {t.compressionLevel}
              </div>
              <div className="mt-1 text-lg font-bold font-mono">
                L{currentLevel}
              </div>
              <div className="text-[10px]">
                {levelNames[currentLevel]}
              </div>
            </div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-text-primary/[0.05]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${inputProgressColor}`}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted">
            <span>0%</span>
            <span>{Math.round(ratio * 100)}%</span>
            <span>100%</span>
          </div>

          <div className="mt-4 rounded-xl border border-border/30 bg-background/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  {t.loadStatus}
                </div>
                <div className={`mt-1 text-sm font-semibold ${LEVEL_COLORS[currentLevel]}`}>
                  {levelNames[currentLevel]}
                </div>
              </div>
              {needsHandoff && (
                <div className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400">
                  {t.contextFull}
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
              {levelDescriptions[currentLevel]}
            </p>
            <div className="mt-3 text-[10px] text-text-muted">
              {t.threadPeakUsage}: <span className="font-mono text-text-primary">{Math.round(peakRatio * 100)}%</span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{t.memoryState}</span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {t.memoryScore}
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-text-primary">
                {hasMemoryHealth ? `${Math.round(memoryScore)}%` : '--'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {t.snapshotStatus}
              </div>
              <div className={`mt-1 text-sm font-semibold ${hasMemoryHealth ? 'text-emerald-400' : 'text-text-muted'}`}>
                {hasMemoryHealth ? t.snapshotReady : t.snapshotMissing}
              </div>
            </div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-text-primary/[0.05]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${memoryProgressColor}`}
              style={{ width: `${hasMemoryHealth ? Math.min(memoryScore, 100) : 0}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted">
            <span>{t.freshness}</span>
            <span className={hasMemoryHealth ? 'text-yellow-400' : 'text-text-muted'}>
              {freshnessLabel}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <MetricCard label={t.snapshotStatus} value={hasMemoryHealth ? t.snapshotReady : t.snapshotMissing} valueClassName={hasMemoryHealth ? 'text-emerald-300' : 'text-text-muted'} />
            <MetricCard label={t.staleTurnsLabel} value={hasMemoryHealth ? String(staleTurns) : '--'} valueClassName={hasMemoryHealth ? 'text-text-primary' : 'text-text-muted'} />
          </div>

          <div className="mt-4 rounded-xl border border-border/30 bg-background/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
                {t.loadStatus}
              </span>
              <span className={`text-[10px] font-semibold ${hasMemoryHealth ? 'text-yellow-400' : 'text-text-muted'}`}>
                {hasMemoryHealth ? memoryRiskLabel : t.snapshotMissing}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
              {hasMemoryHealth ? t.scoreHint : t.memoryEmptyHint}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <TimerReset className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{t.strategyGuide}</span>
          </div>

          <div className="space-y-3">
            <StrategyRow
              icon={<BrainCircuit className="h-3.5 w-3.5 text-orange-400" />}
              label={t.summaryTiming}
              value={t.summaryTimingValue}
              description={t.summaryHint}
            />
            <StrategyRow
              icon={<ArrowRightCircle className="h-3.5 w-3.5 text-red-400" />}
              label={t.handoffTiming}
              value={t.handoffTimingValue}
              description={t.handoffHint}
            />
          </div>

          {needsHandoff && (
            <div className="mt-4 flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <h4 className="text-xs font-bold text-red-400">
                  {t.contextFull}
                </h4>
                <p className="mt-1 text-[10px] leading-relaxed text-red-400/80">
                  {t.contextFullHint}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-accent/80">
                {t.manualHandoff}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                {language === 'zh'
                  ? '手动生成一份最新续接快照，并切到新的线程继续当前任务。'
                  : 'Generate a fresh handoff snapshot and continue the current task in a new thread.'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleManualCompress}
              disabled={!currentThread || isCreatingHandoff}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingHandoff ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowRightCircle className="h-3 w-3" />
              )}
              <span>{isCreatingHandoff ? t.manualHandoffBusy : t.manualHandoff}</span>
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Coins className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{t.totalTokens}</span>
            <span className="ml-auto text-lg font-bold font-mono text-accent">
              {formatK(totalUsage?.totalTokens ?? 0)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatRow label={t.totalIn} value={formatNumber(totalUsage?.promptTokens ?? 0)} />
            <StatRow label={t.totalOut} value={formatNumber(totalUsage?.completionTokens ?? 0)} />
            <StatRow label={t.cacheRead} value={formatNumber(totalUsage?.cachedInputTokens ?? 0)} valueClassName="text-emerald-300" hint={cacheReadHint} />
            <StatRow label={t.cacheWrite} value={formatNumber(totalUsage?.cacheWriteTokens ?? 0)} valueClassName="text-sky-300" hint={cacheWriteHint} />
          </div>

          {lastUsage && (
            <>
              <div className="mt-3 flex items-center justify-between text-[10px] text-text-muted">
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {t.lastRequest}
                </span>
                <span>
                  {formatK(lastUsage.promptTokens)} <ChevronRight className="inline h-3 w-3" /> {formatK(lastUsage.completionTokens)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
                <span>{t.lastCache}</span>
                <span>
                  {formatK(lastUsage.cachedInputTokens ?? 0)} <ChevronRight className="inline h-3 w-3" /> {formatK(lastUsage.cacheWriteTokens ?? 0)}
                </span>
              </div>
              {(lastUsage.cacheReadSource || lastUsage.cacheWriteSource) && (
                <div className="mt-1 flex items-center justify-between text-[9px] text-text-muted/70">
                  <span>{t.source}</span>
                  <span>
                    {lastUsage.cacheReadSource === 'provider-reported' ? t.readProvider : t.notAvailable}
                    {' / '}
                    {lastUsage.cacheWriteSource === 'provider-reported'
                      ? t.writeProvider
                      : lastUsage.cacheWriteSource === 'estimated'
                        ? t.writeEstimated
                        : t.notAvailable}
                  </span>
                </div>
              )}
            </>
          )}
        </section>

        {latestSnapshot ? (
          <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
                {t.currentTask}
              </div>
              <span className="text-[9px] uppercase tracking-[0.18em] text-text-muted">
                {latestSnapshot.source === 'handoff' ? t.handoffSnapshot : t.compressionSnapshot}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-secondary line-clamp-3">
              {latestSnapshot.summary.objective}
            </p>
            {latestSnapshot.summary.pendingSteps[0] && (
              <p className="mt-2 text-[10px] leading-relaxed text-text-muted line-clamp-2">
                {t.next} {latestSnapshot.summary.pendingSteps[0]}
              </p>
            )}
          </section>
        ) : (
          <section className="rounded-2xl border border-border/30 bg-surface/20 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.currentTask}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              {t.noSnapshot}
            </p>
          </section>
        )}
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  tone = 'primary',
  valueClassName,
}: {
  label: string
  value: string
  tone?: 'primary' | 'secondary'
  valueClassName?: string
}) {
  return (
    <div className="rounded-lg border border-text-primary/[0.05] bg-surface/50 p-2">
      <div className="text-[9px] uppercase text-text-muted">
        {label}
      </div>
      <div className={`text-sm font-mono font-bold ${valueClassName || (tone === 'secondary' ? 'text-text-secondary' : 'text-text-primary')}`}>
        {value}
      </div>
    </div>
  )
}

function StrategyRow({
  icon,
  label,
  value,
  description,
}: {
  icon: ReactNode
  label: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-background/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
            {label}
          </span>
        </div>
        <span className="text-[10px] font-semibold text-text-primary">
          {value}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
        {description}
      </p>
    </div>
  )
}

function StatRow({
  label,
  value,
  valueClassName = 'text-text-primary',
  hint,
}: {
  label: string
  value: string
  valueClassName?: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-text-primary/[0.05] bg-surface/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-text-muted">{label}</span>
        <span className={`text-xs font-mono ${valueClassName}`}>{value}</span>
      </div>
      {hint && (
        <div className="mt-1 text-[9px] text-text-muted/70">
          {hint}
        </div>
      )}
    </div>
  )
}
