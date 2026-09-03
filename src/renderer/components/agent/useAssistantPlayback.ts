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
import { AGENT_PLAYBACK_MAX_STAGE_BACKLOG, AGENT_PLAYBACK_RELEASE_MS } from '@renderer/agent/presentation/disclosureMotion'

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
  /** 这一拍呈现中的工具行（并发批次会有多个）。 */
  presentingToolIds: string[]
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
  if (blockingIndex < 0) return parts.length - 1
  return findLiveToolRunEnd(parts, blockingIndex)
}

function isToolCall(part: AssistantPart | undefined): boolean {
  return !!part && isToolCallPart(part)
}

function isLiveToolCall(part: AssistantPart | undefined): boolean {
  return isToolCall(part) && isPlaybackBarrier(part!)
}

/**
 * 并发批次的终点：从一个还活着的工具调用出发，把紧跟着的工具调用一起算进这一拍。
 *
 * 模型一条消息里发好几个工具调用时，它们在真实世界里是同时在跑的。一拍放一个的话，界面在说
 * "它们排着队"，而状态托盘里早就列出了后面那几个工具改的文件 —— 界面自己打自己的脸。
 *
 * 中间夹着已经 success 的也算同一批：能在前面那个还没跑完时就返回，本身就说明它们是并发的
 * （顺序执行下后一个工具根本还没被创建）。文字、思考这些非工具的部分会断开一批，所以
 * "上一拍的工具 + 这一拍的工具" 不会被误并。
 */
export function findLiveToolRunEnd(parts: AssistantPart[], startIndex: number): number {
  if (!isLiveToolCall(parts[startIndex])) return startIndex
  let end = startIndex
  while (end + 1 < parts.length && isToolCall(parts[end + 1])) end += 1
  return end
}

/**
 * 并发批次的起点：包含 frontierIndex 的那段连着的工具调用里，最前面那个还活着的。
 *
 * 顺序执行时前一行早已落定（success），走到它就停 —— 上一拍放出来的行不会被重新拉进这一拍
 * （否则它会重播入场动画、并被按住不许收起）。整批都落定了就退回 frontierIndex 自己，
 * 这时"呈现中"只剩交接用的那一行。
 */
export function findLiveToolRunStart(parts: AssistantPart[], frontierIndex: number): number {
  let start = frontierIndex
  for (let index = frontierIndex; index >= 0; index -= 1) {
    if (!isToolCall(parts[index])) break
    if (isPlaybackBarrier(parts[index])) start = index
  }
  return start
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
    // 并发批次是一个阶段，不是好几个：连着的活工具调用一起放。
    if (isPresentationStage(parts[index])) return Math.min(findLiveToolRunEnd(parts, index), target)
  }

  return target
}

/** 时间轴还差多少个阶段才追上源头。并发批次按一个阶段算。 */
export function countPendingStages(
  parts: AssistantPart[],
  releasedFrontier: number,
  sourceFrontier: number,
): number {
  const target = Math.min(sourceFrontier, parts.length - 1)
  let count = 0
  let index = releasedFrontier + 1
  while (index <= target) {
    if (!isPresentationStage(parts[index])) {
      index += 1
      continue
    }
    count += 1
    index = findLiveToolRunEnd(parts, index) + 1
  }
  return count
}

export type PlaybackPacing = 'beat' | 'catch-up'

/**
 * 还能不能慢慢来。
 *
 * `beat` 是常态：一拍一个阶段，高度动画有空跑完，滚动位置只有一个写者。
 * `catch-up` 是止损：时间轴落后太多，或者用户正被审批卡着 —— 那一行就是他要点的东西，
 * 这时候动画好不好看已经不重要了，先让界面说真话。
 */
export function decidePlaybackPacing({
  backlog,
  isAwaitingApproval,
}: {
  backlog: number
  isAwaitingApproval: boolean
}): PlaybackPacing {
  if (isAwaitingApproval) return 'catch-up'
  return backlog >= AGENT_PLAYBACK_MAX_STAGE_BACKLOG ? 'catch-up' : 'beat'
}

/**
 * 这一拍"呈现中"的工具行（可能是一批并发的）。
 *
 * 两个用途都要覆盖整批：入场动画（少一行就少一次长高，那一行会不带动画地蹦出来），
 * 以及"按住展开等交接"（收起要等后继阶段挂载）。
 */
export function findPresentingToolIds(
  parts: AssistantPart[],
  frontierIndex: number,
  settlingFrontier: number | null,
): string[] {
  if (frontierIndex < 0 || frontierIndex >= parts.length) return []

  const part = parts[frontierIndex]
  if (!isToolCallPart(part)) return []
  if (!isPlaybackBarrier(part) && settlingFrontier !== frontierIndex) return []

  const ids: string[] = []
  for (let index = findLiveToolRunStart(parts, frontierIndex); index <= frontierIndex; index += 1) {
    const runPart = parts[index]
    if (isToolCallPart(runPart)) ids.push(runPart.toolCall.id)
  }
  return ids
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

  // 时间轴的字数进度也要有上限：可见时间轴在没露完的文字那儿就断了，后面的工具行根本挂不上来
  // （见 buildVisibleTimeline 的 break）。所以"落后太多/被审批卡住"时先把字赶完，
  // 否则托盘已经在说"有暂存文件、等你审批"，卡片还在等打字机。
  const pacing = decidePlaybackPacing({
    backlog: countPendingStages(parts, frontierIndex, sourceFrontier),
    isAwaitingApproval,
  })
  const visibleText = usePlaybackClock(playableText, hasBeenLiveRef.current, pacing === 'catch-up')
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

    const catchUpTarget = Math.min(sourceFrontier, parts.length - 1)
    const releasePacing = decidePlaybackPacing({
      backlog: countPendingStages(parts, machine.releasedFrontier, sourceFrontier),
      isAwaitingApproval,
    })
    const nextTarget = () => (releasePacing === 'catch-up'
      ? catchUpTarget
      : findNextPlaybackFrontier(parts, machine.releasedFrontier, sourceFrontier))

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
        publishFrontier(nextTarget())
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
        // 攒了太多阶段（或用户被审批卡着）就不再等这一拍：一次补齐，让界面和托盘说同一件事。
        if (releasePacing === 'catch-up') {
          clearReleaseTimer()
          publishFrontier(catchUpTarget)
          break
        }
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
  const presentingToolIds = useMemo(
    () => findPresentingToolIds(parts, frontierIndex, settlingFrontier),
    [frontierIndex, parts, settlingFrontier],
  )

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
    presentingToolIds,
    summary: projection.summary,
  }
}
