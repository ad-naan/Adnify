import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantPart } from '@renderer/agent/types'
import {
  isLintCheckPart,
  isReasoningPart,
  isSearchPart,
  isTextPart,
  isToolCallPart,
} from '@renderer/agent/types'
import { projectAssistantTurn, type AssistantProcessSummary } from './assistantTurnProjection'
import { usePlaybackClock } from './usePlaybackClock'
import { AGENT_PLAYBACK_RELEASE_MS } from '@renderer/agent/presentation/disclosureMotion'

type TextBearingPart = Extract<AssistantPart, { type: 'text' | 'reasoning' }>

interface AssistantPlaybackOptions {
  parts: AssistantPart[]
  isTransportActive: boolean
  isAwaitingApproval: boolean
  hasContextMeta: boolean
}

export interface AssistantPlayback {
  alertParts: AssistantPart[]
  finalReplyParts: AssistantPart[]
  processParts: AssistantPart[]
  activeFinalReplyPart?: AssistantPart
  activeProcessPart?: AssistantPart
  hasProcessContent: boolean
  isProcessActive: boolean
  presentingToolId?: string
  summary: AssistantProcessSummary
}

function isTextBearingPart(part: AssistantPart): part is TextBearingPart {
  return isTextPart(part) || isReasoningPart(part)
}

export function isPlaybackBarrier(part: AssistantPart): boolean {
  if (isReasoningPart(part) || isSearchPart(part)) return !!part.isStreaming
  if (isToolCallPart(part)) {
    return part.toolCall.status === 'pending'
      || part.toolCall.status === 'awaiting'
      || part.toolCall.status === 'running'
  }
  return isLintCheckPart(part) && part.status === 'checking'
}

export function findPlaybackFrontier(parts: AssistantPart[]): number {
  const blockingIndex = parts.findIndex(isPlaybackBarrier)
  return blockingIndex >= 0 ? blockingIndex : parts.length - 1
}

function isPresentationStage(part: AssistantPart | undefined): boolean {
  return !!part && (
    isReasoningPart(part)
    || isSearchPart(part)
    || isToolCallPart(part)
    || isLintCheckPart(part)
  )
}

/** Release at most one visual stage from an accumulated source update. */
export function findNextPlaybackFrontier(
  parts: AssistantPart[],
  releasedFrontier: number,
  sourceFrontier: number,
): number {
  const target = Math.min(sourceFrontier, parts.length - 1)
  if (target <= releasedFrontier) return target

  for (let index = releasedFrontier + 1; index <= target; index += 1) {
    if (isPresentationStage(parts[index])) return index
  }

  return target
}

export function findPresentingToolId(
  parts: AssistantPart[],
  frontierIndex: number,
  settlingFrontier: number | null,
): string | undefined {
  if (frontierIndex < 0 || frontierIndex >= parts.length) return undefined

  const part = parts[frontierIndex]
  if (!isToolCallPart(part)) return undefined
  return isPlaybackBarrier(part) || settlingFrontier === frontierIndex
    ? part.toolCall.id
    : undefined
}

export function buildPlayableText(parts: AssistantPart[], frontierIndex: number): string {
  if (frontierIndex < 0) return ''
  return parts
    .slice(0, frontierIndex + 1)
    .filter(isTextBearingPart)
    .map(part => part.content)
    .join('')
}

interface VisibleTimeline {
  bySource: Map<AssistantPart, AssistantPart>
  activeSource?: AssistantPart
}

interface ReleaseMachine {
  releasedFrontier: number
  pendingFrontier: number
  previousBarrier: number
  completedBarrier: boolean
  releaseReadyAt: number | null
  timer: number | null
}

export type PlaybackFrontierAction =
  | 'wait-for-successor'
  | 'follow-source'
  | 'reactivate-current'
  | 'drain-current'
  | 'collapse-current'

export function decidePlaybackFrontierAction({
  sourceFrontier,
  releasedFrontier,
  activeBarrier,
  completedBarrier,
  frontierDrained,
}: {
  sourceFrontier: number
  releasedFrontier: number
  activeBarrier: number
  completedBarrier: boolean
  frontierDrained: boolean
}): PlaybackFrontierAction {
  if (sourceFrontier < releasedFrontier) return 'follow-source'
  if (activeBarrier >= 0 && activeBarrier <= releasedFrontier) return 'reactivate-current'
  if (sourceFrontier <= releasedFrontier) return 'wait-for-successor'
  if (!completedBarrier) return 'follow-source'
  if (!frontierDrained) return 'drain-current'
  return 'collapse-current'
}

export type PlaybackReleaseOutcome =
  | 'publish-successor'
  | 'retain-settling'
  | 'clear-settling'

/**
 * 节拍到点时怎么办。
 *
 * 呈现中的阶段（settling）同时是那一行"被按住展开"的凭据，收起要等后继行挂载来接手。所以没有
 * 后继可交接、而回合还在跑的时候不能松手：松手就是让这一行在下方没有任何新内容时独自收起，
 * 而钉在底部的时间轴会把整屏内容往下拽一段 —— 正是"先展开后折叠、内容上下摆动"。
 * 模型在两次工具之间想事情（几百毫秒到几秒都有）恰好落在这个窗口里。
 *
 * 回合结束就没有后继了，这时才松手。
 */
export function decidePlaybackReleaseOutcome({
  hasPendingSuccessor,
  isTransportActive,
}: {
  hasPendingSuccessor: boolean
  isTransportActive: boolean
}): PlaybackReleaseOutcome {
  if (hasPendingSuccessor) return 'publish-successor'
  return isTransportActive ? 'retain-settling' : 'clear-settling'
}

export function buildVisibleTimeline(
  parts: AssistantPart[],
  frontierIndex: number,
  revealedCharacters: number,
  isTransportActive: boolean,
): VisibleTimeline {
  const bySource = new Map<AssistantPart, AssistantPart>()
  let textOffset = 0
  let activeSource: AssistantPart | undefined

  for (let index = 0; index <= frontierIndex; index += 1) {
    const part = parts[index]
    if (!part) break

    if (!isTextBearingPart(part)) {
      bySource.set(part, part)
      continue
    }

    const content = part.content
    const visibleLength = Math.max(0, Math.min(content.length, revealedCharacters - textOffset))

    if (content.length === 0) {
      if (isPlaybackBarrier(part)) {
        const visiblePart = isReasoningPart(part)
          ? { ...part, isStreaming: true }
          : part
        bySource.set(part, visiblePart)
        activeSource = part
        break
      }
      continue
    }

    if (visibleLength <= 0) break

    const isPartial = visibleLength < content.length
    const visiblePart = isReasoningPart(part)
      ? { ...part, content: content.slice(0, visibleLength), isStreaming: isPartial }
      : { ...part, content: content.slice(0, visibleLength) }
    bySource.set(part, visiblePart)

    if (isPartial) {
      activeSource = part
      break
    }

    textOffset += content.length

    if (
      index === frontierIndex
      && (isPlaybackBarrier(part) || (isTransportActive && frontierIndex === parts.length - 1))
    ) {
      activeSource = part
      if (isReasoningPart(part)) {
        bySource.set(part, { ...part, isStreaming: true })
      }
    }
  }

  return { activeSource, bySource }
}

function materializeParts(
  sourceParts: AssistantPart[],
  visibleBySource: Map<AssistantPart, AssistantPart>,
): AssistantPart[] {
  return sourceParts.flatMap(part => {
    const visible = visibleBySource.get(part)
    return visible ? [visible] : []
  })
}

/**
 * Owns the assistant turn's only character clock.
 *
 * Source parts stay authoritative and append-only. The first running part is a
 * barrier: later text is not mounted until that part settles and all preceding
 * text has drained through this one writer.
 */
export function useAssistantPlayback({
  parts,
  isTransportActive,
  isAwaitingApproval,
  hasContextMeta,
}: AssistantPlaybackOptions): AssistantPlayback {
  const projection = useMemo(() => projectAssistantTurn(parts, {
    hasContextMeta,
  }), [hasContextMeta, parts])

  const sourceFrontier = useMemo(() => findPlaybackFrontier(parts), [parts])
  const activeBarrier = parts.findIndex(isPlaybackBarrier)
  const startsLive = isTransportActive || isAwaitingApproval || activeBarrier >= 0
  const initialFrontierRef = useRef<number | null>(null)
  if (initialFrontierRef.current === null) {
    initialFrontierRef.current = startsLive
      ? findNextPlaybackFrontier(parts, -1, sourceFrontier)
      : sourceFrontier
  }
  const initialFrontier = initialFrontierRef.current ?? sourceFrontier
  const [frontierIndex, setFrontierIndex] = useState(initialFrontier)
  const initialPart = parts[initialFrontier]
  const [settlingFrontier, setSettlingFrontier] = useState<number | null>(() => (
    startsLive && isPresentationStage(initialPart) && !isPlaybackBarrier(initialPart)
      ? initialFrontier
      : null
  ))
  const partsRef = useRef(parts)
  partsRef.current = parts
  const releaseMachineRef = useRef<ReleaseMachine | null>(null)
  if (releaseMachineRef.current === null) {
    releaseMachineRef.current = {
      releasedFrontier: initialFrontier,
      pendingFrontier: sourceFrontier,
      previousBarrier: activeBarrier,
      completedBarrier: startsLive && isPresentationStage(initialPart) && !isPlaybackBarrier(initialPart),
      releaseReadyAt: null,
      timer: null,
    }
  }
  const playableText = useMemo(
    () => buildPlayableText(parts, frontierIndex),
    [frontierIndex, parts],
  )

  const hasBeenLiveRef = useRef(false)
  if (isTransportActive || isAwaitingApproval || parts.some(isPlaybackBarrier)) {
    hasBeenLiveRef.current = true
  }
  // 节拍定时器要读"到点那一刻"的传输状态，不是排定时捕获的那个：回合可能在等待期间就结束了。
  const transportActiveRef = useRef(isTransportActive)
  transportActiveRef.current = isTransportActive || isAwaitingApproval

  const visibleText = usePlaybackClock(playableText, hasBeenLiveRef.current)
  const frontierDrained = visibleText.length >= playableText.length

  useEffect(() => {
    const machine = releaseMachineRef.current!
    machine.pendingFrontier = sourceFrontier

    const clearReleaseTimer = () => {
      if (machine.timer === null) return
      window.clearTimeout(machine.timer)
      machine.timer = null
    }

    const publishFrontier = (nextFrontier: number) => {
      const nextPart = partsRef.current[nextFrontier]
      const isSettledStage = isPresentationStage(nextPart) && !isPlaybackBarrier(nextPart)
      const shouldPresentSettledStage = hasBeenLiveRef.current && isSettledStage
      machine.releasedFrontier = nextFrontier
      machine.completedBarrier = shouldPresentSettledStage
      machine.releaseReadyAt = null
      setSettlingFrontier(shouldPresentSettledStage ? nextFrontier : null)
      setFrontierIndex(nextFrontier)
    }

    const scheduleRelease = () => {
      if (machine.timer !== null) return
      const remaining = Math.max(
        0,
        (machine.releaseReadyAt ?? Date.now() + AGENT_PLAYBACK_RELEASE_MS) - Date.now(),
      )
      machine.timer = window.setTimeout(() => {
        machine.timer = null
        const outcome = decidePlaybackReleaseOutcome({
          hasPendingSuccessor: machine.pendingFrontier > machine.releasedFrontier,
          isTransportActive: transportActiveRef.current,
        })
        if (outcome === 'publish-successor') {
          publishFrontier(findNextPlaybackFrontier(
            partsRef.current,
            machine.releasedFrontier,
            machine.pendingFrontier,
          ))
          return
        }
        // 继续按住：releaseReadyAt 留在过去，后继一到就零延迟发布。
        if (outcome === 'retain-settling') return
        machine.completedBarrier = false
        machine.releaseReadyAt = null
        setSettlingFrontier(current => (
          current === machine.releasedFrontier ? null : current
        ))
      }, remaining)
    }

    if (
      machine.previousBarrier >= 0
      && machine.previousBarrier <= machine.releasedFrontier
      && activeBarrier !== machine.previousBarrier
    ) {
      // Remember the completed stage even when its successor arrives in a later
      // store publish. This is what prevents the first final glyph from escaping
      // between Thought completion and the next chunk.
      machine.completedBarrier = true
      machine.releaseReadyAt = Date.now() + AGENT_PLAYBACK_RELEASE_MS
      setSettlingFrontier(machine.releasedFrontier)
    }
    machine.previousBarrier = activeBarrier

    if (machine.completedBarrier && frontierDrained && machine.releaseReadyAt === null) {
      machine.releaseReadyAt = Date.now() + AGENT_PLAYBACK_RELEASE_MS
    }

    const action = decidePlaybackFrontierAction({
      sourceFrontier,
      releasedFrontier: machine.releasedFrontier,
      activeBarrier,
      completedBarrier: machine.completedBarrier,
      frontierDrained,
    })

    switch (action) {
      case 'follow-source':
        clearReleaseTimer()
        publishFrontier(findNextPlaybackFrontier(
          parts,
          machine.releasedFrontier,
          sourceFrontier,
        ))
        break
      case 'reactivate-current':
        clearReleaseTimer()
        machine.completedBarrier = false
        machine.releaseReadyAt = null
        setSettlingFrontier(null)
        break
      case 'wait-for-successor':
        if (machine.completedBarrier && frontierDrained) scheduleRelease()
        break
      case 'drain-current':
        break
      case 'collapse-current':
        scheduleRelease()
        break
    }
  }, [activeBarrier, frontierDrained, frontierIndex, isAwaitingApproval, isTransportActive, parts, sourceFrontier])

  useEffect(() => () => {
    const machine = releaseMachineRef.current!
    if (machine.timer !== null) window.clearTimeout(machine.timer)
    machine.timer = null
  }, [])

  const timeline = useMemo(
    () => buildVisibleTimeline(parts, frontierIndex, visibleText.length, isTransportActive),
    [frontierIndex, isTransportActive, parts, visibleText.length],
  )

  const processParts = materializeParts(projection.processParts, timeline.bySource)
  const finalReplyParts = materializeParts(projection.finalReplyParts, timeline.bySource)
  const alertParts = materializeParts(projection.alertParts, timeline.bySource)
  const activeVisiblePart = timeline.activeSource
    ? timeline.bySource.get(timeline.activeSource)
    : undefined
  const hasSourceBarrier = parts.some(isPlaybackBarrier)
  const sourceStage = parts[sourceFrontier]
  const processOwnsPendingStage = !!sourceStage && projection.processParts.includes(sourceStage)
  const settlingStage = settlingFrontier === null ? undefined : parts[settlingFrontier]
  const processOwnsSettlingStage = !!settlingStage && projection.processParts.includes(settlingStage)
  const isProcessActive = projection.hasProcessContent && (
    isAwaitingApproval
    || hasSourceBarrier
    || processOwnsSettlingStage
    || (isTransportActive && processOwnsPendingStage)
  )
  const presentingToolId = findPresentingToolId(parts, frontierIndex, settlingFrontier)

  return {
    alertParts,
    finalReplyParts,
    processParts,
    activeFinalReplyPart: timeline.activeSource && projection.finalReplyParts.includes(timeline.activeSource)
      ? activeVisiblePart
      : undefined,
    activeProcessPart: timeline.activeSource && projection.processParts.includes(timeline.activeSource)
      ? activeVisiblePart
      : undefined,
    hasProcessContent: projection.hasProcessContent,
    isProcessActive,
    presentingToolId,
    summary: projection.summary,
  }
}
