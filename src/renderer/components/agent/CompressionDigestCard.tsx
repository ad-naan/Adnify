import { memo, useMemo } from 'react'
import { Archive, ChevronDown, Layers3, ListTodo, MessageSquareQuote, Sparkles } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@shared/i18n'
import type { ContextSnapshotPart } from '@/renderer/agent/types'
import SmoothCollapse from './SmoothCollapse'
import { useDisclosureState } from '@renderer/hooks'

interface CompressionDigestCardProps {
  part: ContextSnapshotPart
  variant?: 'card' | 'timeline'
}

const levelTone: Record<number, { badge: string; dot: string; glow: string }> = {
  0: { badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400', glow: 'shadow-emerald-500/10' },
  1: { badge: 'text-blue-300 bg-blue-500/10 border-blue-500/20', dot: 'bg-blue-400', glow: 'shadow-blue-500/10' },
  2: { badge: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20', dot: 'bg-yellow-400', glow: 'shadow-yellow-500/10' },
  3: { badge: 'text-orange-300 bg-orange-500/10 border-orange-500/20', dot: 'bg-orange-400', glow: 'shadow-orange-500/10' },
  4: { badge: 'text-red-300 bg-red-500/10 border-red-500/20', dot: 'bg-red-400', glow: 'shadow-red-500/10' },
}

function getCopy(language: Language, part: ContextSnapshotPart, activeTaskCount: number) {
  const isHandoff = part.snapshotKind === 'handoff'

  return {
    title: isHandoff
      ? t('compressionDigestCard.contextHandoffSnapshot', language)
      : t('compressionDigestCard.contextCompressionSnapshot', language),
    subtitle: isHandoff
      ? t('compressionDigestCard.aNewThreadShould', language)
      : t('compressionDigestCard.olderHistoryWasFolded', language),
    objective: t('compressionDigestCard.objective', language),
    lastRequest: t('compressionDigestCard.lastRequest', language),
    pending: t('compressionDigestCard.pendingSteps', language),
    tasks: t('compressionDigestCard.taskList', language),
    noObjective: t('compressionDigestCard.noObjectiveRecorded', language),
    completedStat: t('compressionDigestCard.completed', language, { count: part.summary.completedSteps.length }),
    pendingStat: t('compressionDigestCard.pending', language, { count: part.summary.pendingSteps.length }),
    taskStat: t('compressionDigestCard.activeTasks', language, { count: activeTaskCount }),
  }
}

export const CompressionDigestCard = memo(({ part, variant = 'card' }: CompressionDigestCardProps) => {
  const language = useStore(state => state.language || 'zh')
  const lang = language
  const { isOpen: expanded, toggle: toggleExpanded } = useDisclosureState({})
  const todos = part.summary.todos || []
  const activeTodos = todos.filter(todo => todo.status !== 'completed')
  const tone = levelTone[part.level] || levelTone[3]
  const copy = getCopy(lang, part, activeTodos.length)

  const visiblePending = useMemo(() => part.summary.pendingSteps.slice(0, 5), [part.summary.pendingSteps])
  const visibleTodos = useMemo(() => activeTodos.slice(0, 5), [activeTodos])
  const note = part.note || copy.subtitle

  if (variant === 'timeline') {
    const title = t('compressionDigestCard.contextCompressedAndContinued', lang)
    const detailLabel = expanded
      ? t('compressionDigestCard.hideDetails', lang)
      : t('compressionDigestCard.viewSnapshotDetails', lang)

    return (
      <div className="my-4 w-full">
        <button
          onClick={toggleExpanded}
          className="group flex w-full items-center gap-3 text-left text-text-muted transition-colors hover:text-text-secondary"
        >
          <div className="h-px flex-1 bg-border/50 transition-colors group-hover:bg-border" />
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-border/50 bg-surface/35 px-3 py-1.5 text-[11px] shadow-sm backdrop-blur-sm">
            <div className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            <span className="truncate font-medium text-text-secondary">{title}</span>
            <span className="shrink-0 text-text-muted/70">· {detailLabel}</span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          </div>
          <div className="h-px flex-1 bg-border/50 transition-colors group-hover:bg-border" />
        </button>

        <SmoothCollapse open={expanded}>
              <div className="mx-8 mt-3 space-y-2 rounded-xl border border-border/40 bg-surface/25 px-3 py-3 text-[11px] text-text-secondary">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted/70">{copy.objective}</div>
                  <div className="leading-relaxed">{part.summary.objective || copy.noObjective}</div>
                </div>

                {part.lastUserRequest && (
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted/70">{copy.lastRequest}</div>
                    <div className="leading-relaxed">{part.lastUserRequest}</div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 text-[10px] text-text-muted/80">
                  <span className="rounded-full bg-text-primary/[0.04] px-2 py-0.5">{copy.completedStat}</span>
                  <span className="rounded-full bg-text-primary/[0.04] px-2 py-0.5">{copy.pendingStat}</span>
                  <span className="rounded-full bg-text-primary/[0.04] px-2 py-0.5">{copy.taskStat}</span>
                </div>
              </div>
        </SmoothCollapse>
      </div>
    )
  }

  return (
    <div className={`my-3 overflow-hidden rounded-2xl border border-border/50 bg-surface/40 backdrop-blur-md shadow-[0_10px_30px_-18px_rgba(0,0,0,0.45)] transition-all ${tone.glow}`}>
      <button
        onClick={toggleExpanded}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-text-primary/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className="text-[11px] font-semibold tracking-wide text-text-primary">{copy.title}</span>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tone.badge}`}>
              L{part.level}
            </span>
          </div>

          <div className="text-[11px] leading-relaxed text-text-muted">{note}</div>

          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-text-muted/80">
            <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/[0.04] px-2 py-0.5">
              <Sparkles className="h-3 w-3 text-accent/80" />
              {copy.completedStat}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/[0.04] px-2 py-0.5">
              <Archive className="h-3 w-3 text-orange-300" />
              {copy.pendingStat}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/[0.04] px-2 py-0.5">
              <ListTodo className="h-3 w-3 text-blue-300" />
              {copy.taskStat}
            </span>
          </div>
        </div>

        <ChevronDown className={`mt-0.5 h-4 w-4 text-text-muted transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>

      <SmoothCollapse open={expanded}>
            <div className="space-y-3 px-4 pb-4">
              {part.lastUserRequest && (
                <div className="rounded-xl border border-border/40 bg-background/15 px-3 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted/70">
                    <MessageSquareQuote className="h-3 w-3" />
                    {copy.lastRequest}
                  </div>
                  <div className="text-[11px] leading-relaxed text-text-secondary">
                    {part.lastUserRequest}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border/40 bg-background/25 px-3 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted/70">
                  <Layers3 className="h-3 w-3" />
                  {copy.objective}
                </div>
                <div className="text-[12px] leading-relaxed text-text-primary/90">
                  {part.summary.objective || copy.noObjective}
                </div>
              </div>

              {visiblePending.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-background/20 px-3 py-2.5">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-text-muted/70">{copy.pending}</div>
                  <div className="space-y-1.5">
                    {visiblePending.map((step, index) => (
                      <div key={`${part.id}-pending-${index}`} className="text-[11px] leading-relaxed text-text-secondary">
                        {index + 1}. {step}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visibleTodos.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-background/20 px-3 py-2.5">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-text-muted/70">{copy.tasks}</div>
                  <div className="space-y-1.5">
                    {visibleTodos.map((todo, index) => (
                      <div key={`${part.id}-todo-${index}`} className="flex items-start gap-2 text-[11px] leading-relaxed text-text-secondary">
                        <span className={`mt-[4px] h-1.5 w-1.5 rounded-full ${todo.status === 'in_progress' ? 'bg-accent animate-pulse' : 'bg-text-muted/40'}`} />
                        <span>{todo.status === 'in_progress' ? todo.activeForm : todo.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
      </SmoothCollapse>
    </div>
  )
})

CompressionDigestCard.displayName = 'CompressionDigestCard'
