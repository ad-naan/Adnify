/**
 * 编辑器跨文件导航状态
 *
 * 当跳转定义需要打开一个新文件时，Navigation 入口（useEditorActions）
 * 先调用 setPendingNavigation 存下目标行列，再调用 safeOpenFile 切换文件。
 * 文件切换后 Editor.tsx 的 activeFilePath effect 执行 consumePendingNavigation，
 * 并在编辑器 Model 稳定后精确定位光标。
 */

interface PendingNav {
  filePath: string
  line: number  // Monaco 1-indexed
  col: number   // Monaco 1-indexed
}

let pending: PendingNav | null = null

/** 设置待跳转位置（在打开文件之前调用） */
export function setPendingNavigation(nav: PendingNav): void {
  pending = nav
}

/**
 * 消费待跳转位置。
 * 仅当 filePath 与当前活跃文件匹配时才返回并清除；否则返回 null。
 */
export function consumePendingNavigation(activeFilePath: string): { line: number; col: number } | null {
  if (!pending) return null
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/([A-Za-z]):/, '$1:').toLowerCase()
  if (norm(pending.filePath) !== norm(activeFilePath)) return null
  const nav = { line: pending.line, col: pending.col }
  pending = null
  return nav
}
