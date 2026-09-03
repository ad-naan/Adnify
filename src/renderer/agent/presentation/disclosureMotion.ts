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

/**
 * 时间轴最多落后实时界面几个阶段。
 *
 * 状态托盘（dock）里的待处理改动来自工具**结果**，一落地就写进 store —— 它天生跑在按节拍重放的
 * 时间轴前面。一拍一个阶段，一轮里连着几次工具调用就能攒出好几秒的差：托盘先列出暂存文件，
 * 卡片几秒后才出现，用户看到的是两套互相矛盾的状态。
 *
 * 所以给这个差一个上限：积压到这么多阶段就不再按节拍，一次补齐到源头。
 */
export const AGENT_PLAYBACK_MAX_STAGE_BACKLOG = 2

/**
 * 交接式收起没有自己的延迟：后继阶段挂载的那一刻就是收起的那一刻。
 * 择时由时间轴（`presentingToolId`）决定，抽屉自己不再计时。
 */
export const AGENT_DISCLOSURE_HANDOFF_CLOSE_MS = 0

/**
 * 折叠余量的上限，按视口比例算。
 *
 * 一行变矮时我们把文档总高按住（底部补等高的空白），于是让出的空间从底部出，上面的内容
 * 一动不动 —— 这就是"往上折叠、整体不往下掉"。但抽屉可以很高（292 条 lint 明细），
 * 无上限地按住会在底部留一大片空白，所以超出这个比例的部分照旧夹回去。
 */
export const AGENT_COLLAPSE_CREDIT_VIEWPORT_RATIO = 0.6
