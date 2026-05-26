import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/mcpService', () => ({
  mcpService: {
    callTool: vi.fn().mockResolvedValue({ success: true, content: [], isError: false }),
  },
}))

vi.mock('@renderer/agent/utils/AgentConfig', () => ({
  getAgentConfig: vi.fn(() => ({
    toolTimeoutMs: 4321,
  })),
}))

vi.mock('@renderer/store', () => ({
  useStore: {
    getState: vi.fn(() => ({
      mcpServers: [
        {
          id: 'server-1',
          status: 'connected',
          config: { id: 'server-1', name: 'Server 1', autoApprove: [] },
          tools: [{ name: 'tool-a', inputSchema: { type: 'object', properties: {} } }],
          resources: [],
          prompts: [],
        },
      ],
    })),
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    agent: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

import { mcpService } from '@renderer/services/mcpService'
import { McpToolProvider } from '@renderer/agent/tools/providers/McpToolProvider'

describe('McpToolProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the configured agent tool timeout to mcpService', async () => {
    const provider = new McpToolProvider()
    const fullToolName = McpToolProvider.getFullToolName('server-1', 'tool-a')
    const result = await provider.execute(fullToolName, {}, {} as any)

    expect(result.success).toBe(true)
    expect(mcpService.callTool).toHaveBeenCalledWith(
      {
        serverId: 'server-1',
        toolName: 'tool-a',
        arguments: {},
      },
      4321,
    )
  })
})
