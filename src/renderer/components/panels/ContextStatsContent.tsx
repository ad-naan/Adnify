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
import { t, type Language } from '@shared/i18n'

interface ContextStatsContentProps {
  totalUsage: TokenUsage
  lastUsage?: TokenUsage
  language: Language
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
  language,
}: ContextStatsContentProps) {
  const compressionStats = useAgentStore(selectCompressionStats)
  const currentThread = useAgentStore(selectCurrentThread)
  const latestSnapshot = useAgentStore(selectLatestContextSnapshot)
  const [isCreatingHandoff, setIsCreatingHandoff] = useState(false)

  const currentLevel = (compressionStats?.level ?? 0) as CompressionLevel
  const needsHandoff = compressionStats?.needsHandoff ?? currentLevel >= 4
  const ratio = compressionStats?.ratio ?? 0
  const memoryHealth = compressionStats?.memoryHealth
  const hasMemoryHealth = Boolean(currentThread?.contextSummary && memoryHealth)
  const memoryScore = memoryHealth?.score ?? 0
  const contextLimit = compressionStats?.contextLimit ?? 128000
  const inputTokens = compressionStats?.inputTokens ?? 0
  const peakRatio = compressionStats?.peakRatio ?? ratio
  const peakInputTokens = Math.round(peakRatio * contextLimit)
  const staleTurns = memoryHealth?.staleTurns ?? 0

  const labels = useMemo(() => ({
    contextControl: t('contextStatsContent.contextControl', language),
    contextLoad: t('contextStatsContent.contextLoad', language),
    threadPeakUsage: t('contextStatsContent.threadPeakUsage', language),
    memoryState: t('contextStatsContent.workingMemory', language),
    compressionLevel: t('contextStatsContent.compressionLevel', language),
    windowUsage: t('contextStatsContent.perRequestInputWindow', language),
    loadStatus: t('contextStatsContent.currentState', language),
    input: t('contextStatsContent.input', language),
    strategy: t('contextStatsContent.strategy', language),
    summaryTiming: t('contextStatsContent.whenSummaryStarts', language),
    handoffTiming: t('contextStatsContent.whenNewThreadStarts', language),
    summaryTimingValue: t('contextStatsContent.l3Around85', language),
    handoffTimingValue: t('contextStatsContent.l4Around95', language),
    summaryHint: t('contextStatsContent.aSummaryIsGenerated', language),
    handoffHint: t('contextStatsContent.whenARequestIs', language),
    memoryScore: t('contextStatsContent.continuityScore', language),
    snapshotStatus: t('contextStatsContent.snapshotStatus', language),
    snapshotReady: t('contextStatsContent.ready', language),
    snapshotMissing: t('contextStatsContent.notReady', language),
    freshness: t('contextStatsContent.freshness', language),
    freshnessFresh: t('contextStatsContent.fresh', language),
    freshnessStale: t('contextStatsContent.turnsBehind', language, { staleTurns }),
    scoreHint: t('contextStatsContent.thisScoreMeasuresHow', language),
    memoryEmptyHint: t('contextStatsContent.noStructuredWorkingMemory', language),
    lowRisk: t('contextStatsContent.lowRisk', language),
    mediumRisk: t('contextStatsContent.mediumRisk', language),
    highRisk: t('contextStatsContent.highRisk', language),
    staleTurnsLabel: t('contextStatsContent.turnsSinceLastSummary', language),
    manualHandoff: t('contextStatsContent.compressToNewThread', language),
    manualHandoffBusy: t('contextStatsContent.switching', language),
    noThread: t('contextStatsContent.cannotCompress', language),
    noThreadBody: t('contextStatsContent.thereIsNoConversation', language),
    switched: t('contextStatsContent.switchedToNewThread', language),
    switchedBody: t('contextStatsContent.createdANewThread', language),
    compressFailed: t('contextStatsContent.compressionFailed', language),
    compressFallback: t('contextStatsContent.couldNotGenerateA', language),
    currentTask: t('contextStatsContent.currentTask', language),
    handoffSnapshot: t('contextStatsContent.handoffSnapshot', language),
    compressionSnapshot: t('contextStatsContent.compressionSnapshot', language),
    noSnapshot: t('contextStatsContent.noContextSnapshotYet', language),
    next: t('contextStatsContent.next', language),
    strategyGuide: t('contextStatsContent.compressionAndHandoffStrategy', language),
    contextFull: t('contextStatsContent.contextNearLimit', language),
    contextFullHint: t('contextStatsContent.considerCreatingANew', language),
    totalTokens: t('contextStatsContent.totalTokens', language),
    totalIn: t('contextStatsContent.total', language),
    totalOut: t('contextStatsContent.totalOut', language),
    cacheRead: t('contextStatsContent.cacheRead', language),
    cacheWrite: t('contextStatsContent.cacheWrite', language),
    lastRequest: t('contextStatsContent.lastRequest', language),
    lastCache: t('contextStatsContent.lastCache', language),
    source: t('contextStatsContent.source', language),
    providerReported: t('contextStatsContent.providerReported', language),
    locallyEstimated: t('contextStatsContent.locallyEstimated', language),
    readProvider: t('contextStatsContent.readProvider', language),
    writeProvider: t('contextStatsContent.writeProvider', language),
    writeEstimated: t('contextStatsContent.writeEstimated', language),
    notAvailable: '-',
    levelLabel: t('contextStatsContent.currentStrategyLevel', language),
  }), [language, staleTurns])

  const levelNames: Record<CompressionLevel, string> = {
    0: t('contextStatsContent.fullContext', language),
    1: t('contextStatsContent.truncateArgs', language),
    2: t('contextStatsContent.clearOldResults', language),
    3: t('contextStatsContent.deepCompress', language),
    4: t('contextStatsContent.sessionHandoff', language),
  }

  const levelDescriptions: Record<CompressionLevel, string> = {
    0: t('contextStatsContent.keepFullMessageHistory', language),
    1: t('contextStatsContent.startTruncatingLongTool', language),
    2: t('contextStatsContent.clearOlderToolResults', language),
    3: t('contextStatsContent.deepCompressHistoryAnd', language),
    4: t('contextStatsContent.prepareAHandoffPacket', language),
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
    ? labels.providerReported
    : undefined

  const cacheWriteHint = totalUsage?.cacheWriteSource === 'provider-reported'
    ? labels.providerReported
    : totalUsage?.cacheWriteSource === 'estimated'
      ? labels.locallyEstimated
      : undefined

  const memoryProgressColor = useMemo(() => {
    if (!hasMemoryHealth) return 'bg-text-muted/30'
    if (memoryScore >= 80) return 'bg-emerald-500'
    if (memoryScore >= 55) return 'bg-yellow-500'
    return 'bg-red-500'
  }, [hasMemoryHealth, memoryScore])

  const inputProgressColor = useMemo(() => {
    if (peakRatio >= 0.95) return 'bg-red-500'
    if (peakRatio >= 0.85) return 'bg-orange-500'
    if (peakRatio >= 0.7) return 'bg-yellow-500'
    return 'bg-blue-500'
  }, [peakRatio])

  const memoryRiskLabel = memoryHealth?.risk === 'low'
    ? labels.lowRisk
    : memoryHealth?.risk === 'medium'
      ? labels.mediumRisk
      : labels.highRisk

  const freshnessLabel = !hasMemoryHealth
    ? labels.snapshotMissing
    : staleTurns === 0
      ? labels.freshnessFresh
      : labels.freshnessStale

  const handleManualCompress = async () => {
    if (!currentThread || isCreatingHandoff) return

    if (currentThread.messages.length === 0) {
      toast.error(labels.noThread, labels.noThreadBody)
      return
    }

    setIsCreatingHandoff(true)

    try {
      await createManualHandoffSession(currentThread.id)
      toast.success(labels.switched, labels.switchedBody)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(labels.compressFailed, message || labels.compressFallback)
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
              {labels.contextControl}
            </div>
            <div className="mt-1 text-xs text-text-secondary">
              {labels.loadStatus}
            </div>
          </div>
          <div className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${LEVEL_BG[currentLevel]}/20 ${LEVEL_COLORS[currentLevel]}`}>
            {labels.levelLabel}: L{currentLevel}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <MetricCard label={labels.input} value={formatK(inputTokens)} />
          <MetricCard label={labels.threadPeakUsage} value={`${Math.round(peakRatio * 100)}%`} tone="secondary" />
          <MetricCard label={labels.strategy} value={`L${currentLevel}`} valueClassName={LEVEL_COLORS[currentLevel]} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Scale className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{labels.contextLoad}</span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {labels.threadPeakUsage}
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-text-primary">
                {formatK(peakInputTokens)} / {formatK(contextLimit)}
              </div>
            </div>
            <div className={`text-right ${LEVEL_COLORS[currentLevel]}`}>
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {labels.compressionLevel}
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
              style={{ width: `${Math.min(peakRatio * 100, 100)}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted">
            <span>0%</span>
            <span>{Math.round(peakRatio * 100)}%</span>
            <span>100%</span>
          </div>

          <div className="mt-4 rounded-xl border border-border/30 bg-background/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  {labels.loadStatus}
                </div>
                <div className={`mt-1 text-sm font-semibold ${LEVEL_COLORS[currentLevel]}`}>
                  {levelNames[currentLevel]}
                </div>
              </div>
              {needsHandoff && (
                <div className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400">
                  {labels.contextFull}
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
              {levelDescriptions[currentLevel]}
            </p>
            <div className="mt-3 text-[10px] text-text-muted">
              {labels.windowUsage}: <span className="font-mono text-text-primary">{Math.round(ratio * 100)}%</span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{labels.memoryState}</span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {labels.memoryScore}
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-text-primary">
                {hasMemoryHealth ? `${Math.round(memoryScore)}%` : '--'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                {labels.snapshotStatus}
              </div>
              <div className={`mt-1 text-sm font-semibold ${hasMemoryHealth ? 'text-emerald-400' : 'text-text-muted'}`}>
                {hasMemoryHealth ? labels.snapshotReady : labels.snapshotMissing}
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
            <span>{labels.freshness}</span>
            <span className={hasMemoryHealth ? 'text-yellow-400' : 'text-text-muted'}>
              {freshnessLabel}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <MetricCard label={labels.snapshotStatus} value={hasMemoryHealth ? labels.snapshotReady : labels.snapshotMissing} valueClassName={hasMemoryHealth ? 'text-emerald-300' : 'text-text-muted'} />
            <MetricCard label={labels.staleTurnsLabel} value={hasMemoryHealth ? String(staleTurns) : '--'} valueClassName={hasMemoryHealth ? 'text-text-primary' : 'text-text-muted'} />
          </div>

          <div className="mt-4 rounded-xl border border-border/30 bg-background/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
                {labels.loadStatus}
              </span>
              <span className={`text-[10px] font-semibold ${hasMemoryHealth ? 'text-yellow-400' : 'text-text-muted'}`}>
                {hasMemoryHealth ? memoryRiskLabel : labels.snapshotMissing}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
              {hasMemoryHealth ? labels.scoreHint : labels.memoryEmptyHint}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <TimerReset className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{labels.strategyGuide}</span>
          </div>

          <div className="space-y-3">
            <StrategyRow
              icon={<BrainCircuit className="h-3.5 w-3.5 text-orange-400" />}
              label={labels.summaryTiming}
              value={labels.summaryTimingValue}
              description={labels.summaryHint}
            />
            <StrategyRow
              icon={<ArrowRightCircle className="h-3.5 w-3.5 text-red-400" />}
              label={labels.handoffTiming}
              value={labels.handoffTimingValue}
              description={labels.handoffHint}
            />
          </div>

          {needsHandoff && (
            <div className="mt-4 flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <h4 className="text-xs font-bold text-red-400">
                  {labels.contextFull}
                </h4>
                <p className="mt-1 text-[10px] leading-relaxed text-red-400/80">
                  {labels.contextFullHint}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-accent/80">
                {labels.manualHandoff}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                {t('contextStatsContent.generateAFreshHandoff', language)}
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
              <span>{isCreatingHandoff ? labels.manualHandoffBusy : labels.manualHandoff}</span>
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-surface/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Coins className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-secondary">{labels.totalTokens}</span>
            <span className="ml-auto text-lg font-bold font-mono text-accent">
              {formatK(totalUsage?.totalTokens ?? 0)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatRow label={labels.totalIn} value={formatNumber(totalUsage?.promptTokens ?? 0)} />
            <StatRow label={labels.totalOut} value={formatNumber(totalUsage?.completionTokens ?? 0)} />
            <StatRow label={labels.cacheRead} value={formatNumber(totalUsage?.cachedInputTokens ?? 0)} valueClassName="text-emerald-300" hint={cacheReadHint} />
            <StatRow label={labels.cacheWrite} value={formatNumber(totalUsage?.cacheWriteTokens ?? 0)} valueClassName="text-sky-300" hint={cacheWriteHint} />
          </div>

          {lastUsage && (
            <>
              <div className="mt-3 flex items-center justify-between text-[10px] text-text-muted">
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {labels.lastRequest}
                </span>
                <span>
                  {formatK(lastUsage.promptTokens)} <ChevronRight className="inline h-3 w-3" /> {formatK(lastUsage.completionTokens)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
                <span>{labels.lastCache}</span>
                <span>
                  {formatK(lastUsage.cachedInputTokens ?? 0)} <ChevronRight className="inline h-3 w-3" /> {formatK(lastUsage.cacheWriteTokens ?? 0)}
                </span>
              </div>
              {(lastUsage.cacheReadSource || lastUsage.cacheWriteSource) && (
                <div className="mt-1 flex items-center justify-between text-[9px] text-text-muted/70">
                  <span>{labels.source}</span>
                  <span>
                    {lastUsage.cacheReadSource === 'provider-reported' ? labels.readProvider : labels.notAvailable}
                    {' / '}
                    {lastUsage.cacheWriteSource === 'provider-reported'
                      ? labels.writeProvider
                      : lastUsage.cacheWriteSource === 'estimated'
                        ? labels.writeEstimated
                        : labels.notAvailable}
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
                {labels.currentTask}
              </div>
              <span className="text-[9px] uppercase tracking-[0.18em] text-text-muted">
                {latestSnapshot.source === 'handoff' ? labels.handoffSnapshot : labels.compressionSnapshot}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-secondary line-clamp-3">
              {latestSnapshot.summary.objective}
            </p>
            {latestSnapshot.summary.pendingSteps[0] && (
              <p className="mt-2 text-[10px] leading-relaxed text-text-muted line-clamp-2">
                {labels.next} {latestSnapshot.summary.pendingSteps[0]}
              </p>
            )}
          </section>
        ) : (
          <section className="rounded-2xl border border-border/30 bg-surface/20 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {labels.currentTask}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              {labels.noSnapshot}
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
