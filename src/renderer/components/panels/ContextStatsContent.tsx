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
import { t as translate, asLanguage } from '@renderer/i18n'

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
    contextControl: translate('contextStatsContent.contextControl', asLanguage(language)),
    contextLoad: translate('contextStatsContent.contextLoad', asLanguage(language)),
    threadPeakUsage: translate('contextStatsContent.threadPeakUsage', asLanguage(language)),
    memoryState: translate('contextStatsContent.workingMemory', asLanguage(language)),
    compressionLevel: translate('contextStatsContent.compressionLevel', asLanguage(language)),
    windowUsage: translate('contextStatsContent.perRequestInputWindow', asLanguage(language)),
    loadStatus: translate('contextStatsContent.currentState', asLanguage(language)),
    input: translate('contextStatsContent.input', asLanguage(language)),
    inputUse: translate('contextStatsContent.inputUse', asLanguage(language)),
    strategy: translate('contextStatsContent.strategy', asLanguage(language)),
    summaryTiming: translate('contextStatsContent.whenSummaryStarts', asLanguage(language)),
    handoffTiming: translate('contextStatsContent.whenNewThreadStarts', asLanguage(language)),
    summaryTimingValue: translate('contextStatsContent.l3Around85', asLanguage(language)),
    handoffTimingValue: translate('contextStatsContent.l4Around95', asLanguage(language)),
    summaryHint: translate('contextStatsContent.aSummaryIsGenerated', asLanguage(language)),
    handoffHint: translate('contextStatsContent.whenARequestIs', asLanguage(language)),
    memoryScore: translate('contextStatsContent.continuityScore', asLanguage(language)),
    snapshotStatus: translate('contextStatsContent.snapshotStatus', asLanguage(language)),
    snapshotReady: translate('contextStatsContent.ready', asLanguage(language)),
    snapshotMissing: translate('contextStatsContent.notReady', asLanguage(language)),
    freshness: translate('contextStatsContent.freshness', asLanguage(language)),
    freshnessFresh: translate('contextStatsContent.fresh', asLanguage(language)),
    freshnessStale: translate('contextStatsContent.turnsBehind', asLanguage(language), { staleTurns }),
    scoreHint: translate('contextStatsContent.thisScoreMeasuresHow', asLanguage(language)),
    memoryEmptyHint: translate('contextStatsContent.noStructuredWorkingMemory', asLanguage(language)),
    lowRisk: translate('contextStatsContent.lowRisk', asLanguage(language)),
    mediumRisk: translate('contextStatsContent.mediumRisk', asLanguage(language)),
    highRisk: translate('contextStatsContent.highRisk', asLanguage(language)),
    staleTurnsLabel: translate('contextStatsContent.turnsSinceLastSummary', asLanguage(language)),
    manualHandoff: translate('contextStatsContent.compressToNewThread', asLanguage(language)),
    manualHandoffBusy: translate('contextStatsContent.switching', asLanguage(language)),
    noThread: translate('contextStatsContent.cannotCompress', asLanguage(language)),
    noThreadBody: translate('contextStatsContent.thereIsNoConversation', asLanguage(language)),
    switched: translate('contextStatsContent.switchedToNewThread', asLanguage(language)),
    switchedBody: translate('contextStatsContent.createdANewThread', asLanguage(language)),
    compressFailed: translate('contextStatsContent.compressionFailed', asLanguage(language)),
    compressFallback: translate('contextStatsContent.couldNotGenerateA', asLanguage(language)),
    currentTask: translate('contextStatsContent.currentTask', asLanguage(language)),
    handoffSnapshot: translate('contextStatsContent.handoffSnapshot', asLanguage(language)),
    compressionSnapshot: translate('contextStatsContent.compressionSnapshot', asLanguage(language)),
    noSnapshot: translate('contextStatsContent.noContextSnapshotYet', asLanguage(language)),
    next: translate('contextStatsContent.next', asLanguage(language)),
    strategyGuide: translate('contextStatsContent.compressionAndHandoffStrategy', asLanguage(language)),
    contextFull: translate('contextStatsContent.contextNearLimit', asLanguage(language)),
    contextFullHint: translate('contextStatsContent.considerCreatingANew', asLanguage(language)),
    totalTokens: translate('contextStatsContent.totalTokens', asLanguage(language)),
    totalIn: translate('contextStatsContent.total', asLanguage(language)),
    totalOut: translate('contextStatsContent.totalOut', asLanguage(language)),
    cacheRead: translate('contextStatsContent.cacheRead', asLanguage(language)),
    cacheWrite: translate('contextStatsContent.cacheWrite', asLanguage(language)),
    lastRequest: translate('contextStatsContent.lastRequest', asLanguage(language)),
    lastCache: translate('contextStatsContent.lastCache', asLanguage(language)),
    source: translate('contextStatsContent.source', asLanguage(language)),
    providerReported: translate('contextStatsContent.providerReported', asLanguage(language)),
    locallyEstimated: translate('contextStatsContent.locallyEstimated', asLanguage(language)),
    readProvider: translate('contextStatsContent.readProvider', asLanguage(language)),
    writeProvider: translate('contextStatsContent.writeProvider', asLanguage(language)),
    writeEstimated: translate('contextStatsContent.writeEstimated', asLanguage(language)),
    notAvailable: language === 'zh' ? '-' : '-',
    levelLabel: translate('contextStatsContent.currentStrategyLevel', asLanguage(language)),
  }), [language, staleTurns])

  const levelNames: Record<CompressionLevel, string> = {
    0: translate('contextStatsContent.fullContext', asLanguage(language)),
    1: translate('contextStatsContent.truncateArgs', asLanguage(language)),
    2: translate('contextStatsContent.clearOldResults', asLanguage(language)),
    3: translate('contextStatsContent.deepCompress', asLanguage(language)),
    4: translate('contextStatsContent.sessionHandoff', asLanguage(language)),
  }

  const levelDescriptions: Record<CompressionLevel, string> = {
    0: translate('contextStatsContent.keepFullMessageHistory', asLanguage(language)),
    1: translate('contextStatsContent.startTruncatingLongTool', asLanguage(language)),
    2: translate('contextStatsContent.clearOlderToolResults', asLanguage(language)),
    3: translate('contextStatsContent.deepCompressHistoryAnd', asLanguage(language)),
    4: translate('contextStatsContent.prepareAHandoffPacket', asLanguage(language)),
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
                {translate('contextStatsContent.generateAFreshHandoff', asLanguage(language))}
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
