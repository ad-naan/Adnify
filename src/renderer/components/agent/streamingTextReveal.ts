/**
 * 写入头渐显：刚到达的字符先淡后实，尾巴上自然拖出一段渐变。
 *
 * 相位是**距写入头多远**的连续函数，不是「哪一批」的阶梯。一次 flush 可能一口气送来
 * 十几个字，整批同相位的话它们会一起变实，看着就是一块一块地蹦。按位置在相邻两批的到达
 * 时间之间插值，拖尾就是连续的，跟流速无关。
 *
 * 相位也**不靠 span 的挂载时刻**，而是每次渲染显式算出来，写成负的 `animation-delay`。
 * 这一条是整个模块的地基：
 *
 *   - 流式渲染每 33ms 重建一次 markdown 树，span 的下标会随着老批次落定而前移。
 *     靠挂载计时的话，下标一移动 React 就把另一批字塞进同一个元素，已经实了的字
 *     会跟着重新闪一次。显式相位下元素身份无所谓 —— 第 i 个 span 拿到的是
 *     (文字, 年龄) 这一对，画出来永远是「每个字停在它该在的进度上」。
 *   - 动画由 CSS 自己跑完，所以流断在半路（模型在想事情，或这条消息已经收尾）
 *     不需要再渲染一帧去推进它，这里没有 rAF 循环。
 */

import type { Element, Parent, Root, RootContent, Text } from 'hast'

/** 一批同时到达的字符 */
export interface RevealSegment {
  readonly length: number
  /** 到达至今的毫秒数，0 表示刚到 */
  readonly ageMs: number
}

/** 切好的一段文字：没有 ageMs 的已经落定，有 ageMs 的要挂 `.stream-reveal` */
export interface RevealPart {
  readonly text: string
  readonly ageMs?: number
}

export const REVEAL_CLASS = 'stream-reveal'

/**
 * 必须与 globals.css 里 `.stream-reveal` 的 animation-duration 一致：这里算出的年龄
 * 会写成负延迟，超过这个时长的批次直接按落定处理。streamingTextReveal.test.ts 盯着这对值。
 */
export const REVEAL_DURATION_MS = 420

/** 一个动画窗口里最多留这么多批，超了丢最老的 —— 它们本就快跑完，提前落定看不出来 */
const MAX_REVEAL_SEGMENTS = 32

const EMPTY_SEGMENTS: readonly RevealSegment[] = []

interface ArrivalMark {
  at: number
  length: number
}

/**
 * 记录每次 flush 带来了多少字符，投影成「距结尾多少字 → 多老」的窗口。
 *
 * `update` 对状态是**幂等**的：同一段内容连着调不会再记一笔到达
 * （StrictMode 会把渲染跑两遍）。但年龄每次都重新算 —— 缓存住旧年龄的话，
 * 同一段内容因为别的原因再渲染一次时相位会往回跳，已经实了的字再闪一下。
 */
export class StreamingRevealTracker {
  private marks: ArrivalMark[] = []
  private seen: string | undefined

  update(content: string, isStreaming: boolean, now: number = Date.now()): readonly RevealSegment[] {
    if (content !== this.seen) {
      this.record(content, isStreaming, now)
      this.seen = content
    }

    return this.project(now, content.length)
  }

  private record(content: string, isStreaming: boolean, now: number): void {
    if (this.seen === undefined) {
      // 流式消息的第一帧：整段算刚到达。历史消息一上来就不是流式，直接落定，
      // 否则每次切会话都要把满屏文字重新淡入一遍。
      this.marks = isStreaming && content.length > 0 ? [{ at: now, length: content.length }] : []
      return
    }

    if (content.length > this.seen.length && content.startsWith(this.seen)) {
      this.marks.push({ at: now, length: content.length - this.seen.length })
      return
    }

    // 回滚、重写、或者内容被过滤器改过：mark 是按「距结尾多少字」定位的，
    // 内容一旦不是追加就全部错位，没有可信的到达时间可留，整段落定。
    this.marks = []
  }

  private project(now: number, contentLength: number): readonly RevealSegment[] {
    let expired = 0
    while (expired < this.marks.length && now - this.marks[expired].at >= REVEAL_DURATION_MS) expired++
    if (expired > 0) this.marks.splice(0, expired)
    if (this.marks.length > MAX_REVEAL_SEGMENTS) {
      this.marks.splice(0, this.marks.length - MAX_REVEAL_SEGMENTS)
    }
    if (this.marks.length === 0) return EMPTY_SEGMENTS

    let budget = contentLength
    const segments: RevealSegment[] = []
    for (let index = this.marks.length - 1; index >= 0 && budget > 0; index--) {
      const mark = this.marks[index]
      const length = Math.min(mark.length, budget)
      segments.unshift({ length, ageMs: Math.max(0, now - mark.at) })
      budget -= length
    }
    return segments
  }
}

/**
 * 相位量化到一帧。连续插值出来的年龄几乎每个字都不一样，量化之后相邻的字才能并成一段，
 * span 数量因此封顶在 REVEAL_DURATION_MS / 这个值（~27 个），跟流速无关。
 */
const PHASE_QUANTUM_MS = 16

interface RevealBound {
  /** 距源码结尾小于这个距离的字符属于这一批 */
  until: number
  length: number
  /** 这一批最右（最新）那个字的年龄 */
  newestMs: number
  /** 这一批最左（最老）那个字的年龄 */
  oldestMs: number
}

/**
 * 把批次投影成一条**连续**的年龄曲线，节点用各批的实际到达时间。
 *
 * 一次 flush 的字在物理上是同时到的，但它们是在上一次 flush 之后的那段时间里逐渐生成的，
 * 所以按位置在「上一批的年龄 → 自己的年龄」之间插值 —— 视觉上就是一条平滑的拖尾，而不是
 * 一整块字同时变实。最老那批的左边界取 REVEAL_DURATION_MS，正好和已落定的文字接上，
 * 整个窗口从头到尾没有断点。
 */
function revealBounds(segments: readonly RevealSegment[]): RevealBound[] {
  const bounds: RevealBound[] = []
  let covered = 0
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    covered += segment.length
    bounds.push({
      until: covered,
      length: segment.length,
      newestMs: segment.ageMs,
      oldestMs: index > 0 ? segments[index - 1].ageMs : REVEAL_DURATION_MS,
    })
  }
  return bounds
}

/** 窗口一共盖住结尾多少个字符 */
export function revealWindowLength(segments: readonly RevealSegment[]): number {
  let total = 0
  for (const segment of segments) total += segment.length
  return total
}

function phaseAt(distance: number, bounds: readonly RevealBound[]): number | undefined {
  for (const bound of bounds) {
    if (distance >= bound.until) continue
    // 0 = 这一批最右（最新）那个字，1 = 最左（最老）那个
    const fromNewest = distance - (bound.until - bound.length)
    const ratio = bound.length > 1 ? fromNewest / (bound.length - 1) : 0
    const ageMs = bound.newestMs + (bound.oldestMs - bound.newestMs) * ratio
    // 已经跑完的不必再挂 span：窗口最左边那几个字会自然并进落定的前缀里
    if (ageMs >= REVEAL_DURATION_MS) return undefined
    // 向下取整，相位只会偏年轻一点，绝不会因为量化跳到动画结束之后
    return Math.floor(ageMs / PHASE_QUANTUM_MS) * PHASE_QUANTUM_MS
  }
  return undefined
}

/** 低位代理：切在这里会把一个字拆成两个乱码方块 */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function revealPart(text: string, ageMs: number | undefined): RevealPart {
  return ageMs === undefined ? { text } : { text, ageMs }
}

/**
 * 给一段文字标相位：只看「这个字距源码结尾多远」，相位在窗口内连续变化，
 * 量化之后相邻同相位的字并成一段。
 *
 * @param distanceOfLast 这段文字的最后一个字符距源码结尾多远（0 = 它就是最后一个字）
 */
export function assignRevealPhases(
  text: string,
  distanceOfLast: number,
  segments: readonly RevealSegment[],
): RevealPart[] {
  if (!text) return []
  if (segments.length === 0) return [{ text }]

  // 窗口只盖住结尾那点字符，前面全是落定的：从窗口左边界开始扫就行。推理过程那条通道
  // 会把整段几千字的正文交进来，每 33ms 一次，逐字扫全段纯属白烧 CPU。
  const start = distanceOfLast + text.length - revealWindowLength(segments)
  if (start >= text.length) return [{ text }]

  const bounds = revealBounds(segments)
  const distanceOf = (index: number) => distanceOfLast + text.length - 1 - index

  const parts: RevealPart[] = []
  // 窗口左边那一截连着落定的前缀，自然并成一段
  let runStart = 0
  let runPhase: number | undefined
  for (let index = Math.max(0, start); index < text.length; index++) {
    if (index > 0 && isLowSurrogate(text.charCodeAt(index))) continue
    const phase = phaseAt(distanceOf(index), bounds)
    if (phase === runPhase) continue
    if (index > runStart) parts.push(revealPart(text.slice(runStart, index), runPhase))
    runStart = index
    runPhase = phase
  }
  parts.push(revealPart(text.slice(runStart), runPhase))
  return parts
}

/**
 * `pre`/`code` 切开会破坏高亮和复制，math 见下。表格单元格跳过是另一码事：
 * fixMarkdownTables 会重写表格行来补齐单元格，源码长度一变，「距结尾多远」就对不上了
 * —— 表格里不淡入，比淡错位置强。
 */
const REVEAL_SKIP_TAGS = new Set(['pre', 'code', 'math', 'semantics', 'annotation', 'td', 'th'])

/** hast 的 className 按类型是 string[]，但插件产出的树里也可能是空格分隔的字符串 */
function classNames(node: Element): string[] {
  const raw: unknown = node.properties?.className
  if (Array.isArray(raw)) return raw.filter((name): name is string => typeof name === 'string')
  return typeof raw === 'string' ? raw.split(/\s+/) : []
}

/** katex / remark-math 的产物是按元素文字去解析公式的，往里塞 span 会把公式拆坏 */
function isMathLike(node: Element): boolean {
  return classNames(node).some(name => (
    name === 'math' || name.startsWith('math-') || name.startsWith('katex')
  ))
}

interface RevealTarget {
  host: Parent
  index: number
}

/**
 * 收集可能落在窗口里的文字节点，document order。
 *
 * `minEnd` 是窗口最左边那个字符的源码偏移：结束位置在它之前的节点整棵跳过。一段几千字的
 * 正文里，窗口只盖住最后十几个字，剩下的子树一次都不用进 —— 这一步每 33ms 跑一遍，
 * 不剪枝的话就是每帧全树遍历。
 */
function collectRevealTargets(host: Parent, out: RevealTarget[], minEnd: number): void {
  for (let index = 0; index < host.children.length; index++) {
    const child = host.children[index]
    const end = child.position?.end?.offset
    if (end !== undefined && end <= minEnd) continue
    if (child.type === 'text') {
      if (child.value.length > 0) out.push({ host, index })
    } else if (child.type === 'element' && !REVEAL_SKIP_TAGS.has(child.tagName) && !isMathLike(child)) {
      collectRevealTargets(child, out, minEnd)
    }
  }
}

function buildRevealNodes(parts: readonly RevealPart[]): RootContent[] {
  return parts.map((part): RootContent => {
    if (part.ageMs === undefined) return { type: 'text', value: part.text }
    return {
      type: 'element',
      tagName: 'span',
      properties: { className: [REVEAL_CLASS], style: `animation-delay:-${Math.round(part.ageMs)}ms` },
      children: [{ type: 'text', value: part.text }],
    }
  })
}

/** 没有 root position 时的兜底：最靠后那个文字节点的结束偏移 */
function lastTargetEnd(targets: readonly RevealTarget[]): number {
  let last = 0
  for (const target of targets) {
    const end = (target.host.children[target.index] as Text).position?.end?.offset
    if (end !== undefined && end > last) last = end
  }
  return last
}

/**
 * rehype 插件：把树里**最靠后**的那些文字节点按窗口切成 `.stream-reveal` span。
 *
 * 相位按每个文字节点在**源码**里的位置算，而不是按渲染出来的文字长度累加 ——
 * `**粗体**` 收尾时那 4 个星号会从渲染结果里消失，按长度累加的话窗口会往前多吃几个字，
 * 把已经实了的字重新淡入一遍。位置用「距源码结尾多远」表示，所以前面插了什么都不影响。
 *
 * 挂在 rehypeKatex 之后。整段 markdown 仍按原样解析，尾巴上不会出现「先看到裸的 `**`
 * 再变粗」这种闪烁。
 */
export function rehypeStreamingReveal(segments: readonly RevealSegment[]) {
  return function attachStreamingReveal() {
    return function transformStreamingReveal(tree: Root): void {
      const windowLength = revealWindowLength(segments)
      if (windowLength === 0) return

      const rootEnd = tree.position?.end?.offset
      const targets: RevealTarget[] = []
      // 没有 root position 的树（别的插件重建过的）：拿不到源码长度，只能整棵收集再回退
      collectRevealTargets(tree, targets, rootEnd === undefined ? -1 : rootEnd - windowLength)
      const end = rootEnd ?? lastTargetEnd(targets)

      // 从后往前：splice 只顺移下标更大的兄弟节点，而那些已经处理完了。
      // 距离越往前越大，整段都落定之后就没必要再往前找了。
      for (let cursor = targets.length - 1; cursor >= 0; cursor--) {
        const { host, index } = targets[cursor]
        const node = host.children[index] as Text
        const from = node.position?.start?.offset
        const to = node.position?.end?.offset
        if (from === undefined || to === undefined) continue
        // 源码区间和文字长度不一致（HTML 实体、软换行之类）：宁可不淡入，也不要淡错位置
        if (to - from !== node.value.length) continue

        const distanceOfLast = end - to
        if (distanceOfLast >= windowLength) break

        const parts = assignRevealPhases(node.value, distanceOfLast, segments)
        if (!parts.some(part => part.ageMs !== undefined)) continue
        host.children.splice(index, 1, ...buildRevealNodes(parts))
      }
    }
  }
}
