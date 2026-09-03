export const AGENT_DISCLOSURE_COLLAPSE_EVENT = 'agent-disclosure-collapse'
export const AGENT_DISCLOSURE_COLLAPSE_MS = 460
export const AGENT_DISCLOSURE_CLOSE_DELAY_MS = 850

/** globals.css 里 `tool-row-enter` 的时长：新行入场时动画的是真高度（0fr → 1fr）。 */
export const AGENT_ROW_ENTER_MS = 480

/**
 * 收起之后底部跟随要停多久，才不会把"这一行主动变矮"当成新输出去追。
 * 收起时长由事件带过来（不同抽屉可以不一样），这里只是那点余量。
 */
export const AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS = 48
export const AGENT_BOTTOM_FOLLOW_PAUSE_MS = AGENT_DISCLOSURE_COLLAPSE_MS + AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS

/**
 * 阶段节拍：一个阶段落定后，隔多久放出下一个。
 *
 * 这个值不能比"一次高度动画"短，否则时间轴永远处在有东西在动的状态：
 *
 * - 入场动画有 480ms，节拍比它短的话，好几行同时在长高。Virtuoso 开着
 *   `skipAnimationFrameInResizeObserver`，每一帧的高度变化都会同步走一遍它的补偿逻辑，
 *   而我们的 `stickToBottom` 也在同一帧写 `scrollTop` —— 两个写者抢一个滚动位置，
 *   正在流的文字就会抖。
 * - 收起会让底部跟随停 `AGENT_BOTTOM_FOLLOW_PAUSE_MS`（508ms）。节拍比它短的话，
 *   下一次收起会在上一次的停顿里续上，底部跟随被连续掐着：文字照长、视口不跟，
 *   等某次停顿终于过期再一把拽回底部 —— 那一下就是"文字抖动"。
 *
 * 所以取两者的上界再留一点余量。它同时是时间轴落后实时界面（状态托盘的待处理改动）的上限：
 * 每个待放阶段一拍。曾经是 1310ms（CLOSE_DELAY + COLLAPSE，那是收起还自己计时时的预算），
 * 一轮里连着几次工具调用就能让托盘先列出暂存文件、几秒后卡片才出现。
 */
export const AGENT_PLAYBACK_RELEASE_MS = Math.max(AGENT_ROW_ENTER_MS, AGENT_BOTTOM_FOLLOW_PAUSE_MS) + 12
