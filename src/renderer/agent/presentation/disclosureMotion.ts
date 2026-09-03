export const AGENT_DISCLOSURE_COLLAPSE_EVENT = 'agent-disclosure-collapse'
export const AGENT_DISCLOSURE_COLLAPSE_MS = 460
export const AGENT_DISCLOSURE_CLOSE_DELAY_MS = 850

/**
 * 阶段节拍：一个阶段落定后，隔多久放出下一个。
 *
 * 曾经写成 CLOSE_DELAY + COLLAPSE，那是"等上一行自己收完，再放下一行"的预算。收起改成交接式
 * （见 AGENT_DISCLOSURE_HANDOFF_CLOSE_MS）之后这个预算变成了循环等待：时间轴在等一次要由时间轴
 * 自己触发的收起。现在它只负责"一行一行地出" —— 取入场动画（globals.css 的 tool-row-enter
 * 480ms）的一半，下一行在上一行入场到一半时开始，读起来是级联而不是齐刷刷一片。
 *
 * 它同时是时间轴落后于实时界面（状态托盘的待处理改动、编辑器里的文件）的上限：每个待放阶段一拍。
 * 一拍 1310ms 时，一轮里连着几次工具调用就够让托盘先列出暂存文件、几秒后卡片才出现；而且工具跑得
 * 快一点，卡片挂载时状态已经是成功 —— 于是它没有"活内容"可展开，看起来就是"有的行一直不展开"。
 */
export const AGENT_PLAYBACK_RELEASE_MS = 240

/**
 * 交接式收起：不再自己计时，收起由"下一阶段接手呈现"这件事触发。
 *
 * 时间轴钉在底部，收起最后一行会让浏览器把 scrollTop 夹回去 —— 视觉上整屏内容往下掉。
 * 所以延时必须是 0：收起和后继行的挂载落在同一次提交里，一涨一缩互相抵掉，
 * 而不是先掉一次、隔一拍再涨一次（那就是用户看到的上下摆动）。
 */
export const AGENT_DISCLOSURE_HANDOFF_CLOSE_MS = 0
