import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { ToolConverter } from '../../src/main/services/llm/core/ToolConverter'
import { ConfigurationToolProvider } from '../../src/renderer/agent/tools/providers/ConfigurationToolProvider'

describe('configuration tool wire schema', () => {
  it('preserves nested settings patches and accepts scalar / array settings', () => {
    const tool = new ToolConverter().convert(new ConfigurationToolProvider().getToolDefinitions()).configuration_prepare
    const schema = tool.inputSchema as z.ZodTypeAny
    for (const value of [{ terminal: { cursorBlink: false }, fontSize: 18 }, 'zh', true, 18, [{ id: 'snippet' }]]) {
      const args = { kind: 'settings', source: 'example', scope: 'user', value }
      expect(schema.parse(args)).toEqual(args)
    }
    expect(schema.parse({ kind: 'skill', source: 'owner/repo@skill', scope: 'user' })).toMatchObject({ kind: 'skill' })
  })
})
