import { AGENT_COLLAPSE_CREDIT_VIEWPORT_RATIO } from './disclosureMotion'

/**
 * 折叠余量：让抽屉"往上折叠"，而不是把上面的内容往下拽。
 *
 * 钉在底部的滚动容器里，一行矮了 H，浏览器会把 scrollTop 也夹掉 H —— 视口在文档坐标里整体
 * 上移一段，于是收起处**下面**的内容看着没动，**上面**的内容一起往下掉 H。那就是"整个内容
 * 上下摆动"里向下的那一半。
 *
 * 办法是收起的同时在容器底部补一块等高的空白，把文档总高按住：scrollTop 不再被夹，上面的内容
 * 一动不动，让出的空间从底部出。之后新长出来的内容（流式正文、下一行工具）先去吃这块空白，
 * 总高不变，什么都不用动 —— 吃完了才恢复"长高就往上推"。
 *
 * 代价是收起那一刻视口底部会空出一块（必须有一样东西动：要么上面掉，要么底边抬）。所以余量有
 * 上限，见 {@link resolveMaxCollapseCredit}。
 */
export function resolveMaxCollapseCredit(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0
  return Math.floor(viewportHeight * AGENT_COLLAPSE_CREDIT_VIEWPORT_RATIO)
}

/**
 * 当前该补多少空白。
 *
 * 一个式子同时管"按住"和"吃掉"：`heldTotal` 是收起开始那一刻的总高，内容比它矮多少就补多少，
 * 内容长回去余量自己就没了。超过上限的部分照旧让浏览器夹（宁愿掉一点，也不留半屏空白）。
 */
export function reconcileCollapseCredit({
  heldTotal,
  contentHeight,
  maxCredit,
}: {
  heldTotal: number | null
  contentHeight: number
  maxCredit: number
}): number {
  if (heldTotal === null || maxCredit <= 0) return 0
  const shortfall = heldTotal - contentHeight
  if (shortfall <= 0) return 0
  return Math.min(shortfall, maxCredit)
}

/**
 * 用户自己滚上去时把余量还掉，能还多少还多少。
 *
 * 只还"视口下面已经空着"的那部分：还掉之后 scrollTop 仍然合法，屏幕上一个像素都不会动。
 * 于是往回翻历史的时候，底部那块空白会随着翻动慢慢消失，而不是一直挂在那儿。
 */
export function retireCollapseCredit({
  credit,
  distanceFromBottom,
}: {
  credit: number
  distanceFromBottom: number
}): number {
  if (credit <= 0) return 0
  if (distanceFromBottom <= 0) return credit
  return Math.max(0, credit - distanceFromBottom)
}
