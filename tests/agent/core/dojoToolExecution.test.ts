import { afterEach, describe, expect, it, vi } from 'vitest'
import { toolManager } from '@/renderer/agent/tools/providers/ToolManager'
import type { ToolProvider } from '@/renderer/agent/tools/providers/types'

const providerId = 'dojo-policy-regression'
afterEach(() => toolManager.unregisterProvider(providerId))
function registerCachedProvider() {
  const execute = vi.fn(async () => ({ success: true, result: 'executed' }))
  const validateArgs = vi.fn(() => ({ valid: true }))
  const provider: ToolProvider = {
    id: providerId, name: 'Cached write-capable provider', hasTool: () => true,
    getToolDefinitions: () => [], getApprovalType: () => 'none', validateArgs, execute,
  }
  toolManager.registerProvider(provider, -1)
  return { execute, validateArgs }
}

describe('Dojo execution boundary with cached providers', () => {
  it.each(['write_file', 'run_command', 'edit_symbol', 'mcp_server_write', 'configuration_apply', 'asset__generate'])('refuses %s before provider validation or execution', async tool => {
    const { execute, validateArgs } = registerCachedProvider()
    const result = await toolManager.execute(tool, {}, { workspacePath: '/project', chatMode: 'dojo', isSubAgent: true })
    expect(result).toMatchObject({ success: false, outcome: { kind: 'error', code: 'DOJO_READ_ONLY', retryable: false } })
    expect(validateArgs).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
  it('continues to execute read-only tools and ordinary Agent writes', async () => {
    const { execute } = registerCachedProvider()
    expect((await toolManager.execute('read_file', {}, { workspacePath: '/project', chatMode: 'dojo' })).success).toBe(true)
    expect((await toolManager.execute('write_file', {}, { workspacePath: '/project', chatMode: 'agent', isSubAgent: true })).success).toBe(true)
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
