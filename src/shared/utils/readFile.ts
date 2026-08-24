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

export function normalizeReadFileArgs(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data }
  if (Array.isArray(normalized.paths)) {
    delete normalized.path
    delete normalized.start_line
    delete normalized.end_line
  }
  return normalized
}

export function resolveReadFileRequest(data: Record<string, unknown>): ReadFileResolution {
  const normalized = normalizeReadFileArgs(data)
  const paths = normalized.paths

  if (Array.isArray(paths)) {
    if (paths.length === 0) {
      return { ok: false, normalized, error: 'paths must not be empty' }
    }

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
