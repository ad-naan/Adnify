export interface ReadFileSingleArgs {
  path: string
  start_line?: number
  end_line?: number
}

export interface ReadFileMultiArgs {
  paths: string[]
}

export type ReadFileResolution =
  | { ok: true; mode: 'single'; normalized: Record<string, unknown>; args: ReadFileSingleArgs }
  | { ok: true; mode: 'multi'; normalized: Record<string, unknown>; args: ReadFileMultiArgs }
  | { ok: false; normalized: Record<string, unknown>; error: string }

/**
 * 判断调用方是否真的在请求多文件读取。
 *
 * 注意 `paths: []` —— 模型极常发 `{ path: 'a.ts', paths: [] }` 这种形状
 * （空数组只是占位）。空数组在 JS 里是真值，早期实现用 `Boolean(paths)`
 * 判断，于是把它当成「同时给了 path 和 paths」而整体拒绝，导致
 * read_file 100% 失败。这里以「有无实际元素」为准。
 */
export function hasMultiPaths(data: Record<string, unknown>): boolean {
  return Array.isArray(data.paths) && data.paths.some(p => typeof p === 'string' && p.length > 0)
}

/**
 * 是否给出了可用的单文件路径。
 */
export function hasSinglePath(data: Record<string, unknown>): boolean {
  return typeof data.path === 'string' && data.path.length > 0
}

/**
 * 合并 path 与 paths，去重后保持出现顺序。
 *
 * 模型常把两个字段一起发（日志里 51 次调用全是这样）。旧实现视为冲突并整体拒绝，
 * 于是 read_file 完全不可用。这里改为取并集：调用方要的文件一个都不会丢，
 * 也不存在「静默忽略了 path」的歧义。
 */
function collectPaths(data: Record<string, unknown>): string[] {
  const out: string[] = []
  const push = (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0) return
    if (!out.includes(value)) out.push(value)
  }

  push(data.path)
  if (Array.isArray(data.paths)) data.paths.forEach(push)

  return out
}

/**
 * 归一化 read_file 参数。
 *
 * 规则很简单：把 path 与 paths 取并集去重，然后
 * - 1 个文件 → 单文件模式，保留行范围
 * - 多个文件 → 多文件模式，丢弃行范围（行号对多文件没有意义）
 *
 * 这样无论模型怎么组合这两个字段都不会失败，也不会静默丢文件。
 */
export function normalizeReadFileArgs(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data }
  const collected = collectPaths(normalized)

  if (collected.length === 0) {
    // 交给 resolveReadFileRequest 统一报错
    delete normalized.paths
    return normalized
  }

  if (collected.length === 1) {
    normalized.path = collected[0]
    delete normalized.paths
    return normalized
  }

  normalized.paths = collected
  delete normalized.path
  delete normalized.start_line
  delete normalized.end_line
  return normalized
}

export function resolveReadFileRequest(data: Record<string, unknown>): ReadFileResolution {
  const normalized = normalizeReadFileArgs(data)
  const paths = normalized.paths

  if (Array.isArray(paths)) {
    return {
      ok: true,
      mode: 'multi',
      normalized,
      args: { paths: paths as string[] },
    }
  }

  const parsedPath = normalized.path

  if (typeof parsedPath !== 'string' || parsedPath.length === 0) {
    return { ok: false, normalized, error: 'path is required' }
  }

  const start_line = normalized.start_line
  const end_line = normalized.end_line

  if (start_line !== undefined && typeof start_line !== 'number') {
    return { ok: false, normalized, error: 'start_line must be a number' }
  }

  if (end_line !== undefined && typeof end_line !== 'number') {
    return { ok: false, normalized, error: 'end_line must be a number' }
  }

  if (typeof start_line === 'number' && typeof end_line === 'number' && start_line > end_line) {
    // Models frequently invert the range; auto-correct for reads instead of failing the tool call.
    return {
      ok: true,
      mode: 'single',
      normalized: {
        ...normalized,
        start_line: end_line,
        end_line: start_line,
      },
      args: {
        path: parsedPath,
        start_line: end_line,
        end_line: start_line,
      },
    }
  }

  return {
    ok: true,
    mode: 'single',
    normalized,
    args: {
      path: parsedPath,
      ...(typeof start_line === 'number' ? { start_line } : {}),
      ...(typeof end_line === 'number' ? { end_line } : {}),
    },
  }
}
