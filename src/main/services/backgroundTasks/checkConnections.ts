import { getBuiltinProvider } from '@shared/config/providers'
import type { BackgroundTaskActivity, ConnectionReport, McpConnectionCheck } from '@shared/types/backgroundTasks'

export async function checkModelEndpoint(model: BackgroundTaskActivity['model']): Promise<ConnectionReport['model']> {
  const endpoint = model?.baseUrl || (model && getBuiltinProvider(model.provider)?.baseUrl)
  if (!endpoint) return 'unconfigured'
  try {
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 'unreachable'
    url.search = ''
    url.hash = ''
    // Any HTTP response proves reachability, including 401 / 404 / 405.
    // Do not follow redirects, send credentials, or invoke a generation endpoint.
    const response = await fetch(url, {
      method: 'HEAD', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000),
    })
    await response.body?.cancel()
    return 'reachable'
  } catch {
    return 'unreachable'
  }
}

let pendingMcpCheck: Promise<McpConnectionCheck> | undefined
export async function checkConnections(model: BackgroundTaskActivity['model'], checkMcp: () => Promise<McpConnectionCheck>): Promise<ConnectionReport> {
  // MCP is shared by windows; waking several windows must not ping each server repeatedly.
  pendingMcpCheck ??= Promise.resolve().then(checkMcp)
    .finally(() => { pendingMcpCheck = undefined })
  const [modelResult, mcpResult] = await Promise.allSettled([checkModelEndpoint(model), pendingMcpCheck])
  return {
    checkedAt: Date.now(),
    model: modelResult.status === 'fulfilled' ? modelResult.value : 'unreachable',
    mcp: mcpResult.status === 'fulfilled' ? mcpResult.value : { checked: 0, failed: [] },
    checkFailed: mcpResult.status === 'rejected',
  }
}
