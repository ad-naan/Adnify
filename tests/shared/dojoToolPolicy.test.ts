import { describe, expect, it } from 'vitest'
import { DOJO_READ_ONLY_TOOLS, getToolsForContext, isDojoToolAllowed } from '@shared/config/toolGroups'
import { buildModeContract } from '@renderer/agent/prompts/promptContract'
import { ModeRegistry } from '@renderer/agent/domains/mode/ModeRegistry'

describe('Dojo mentor capabilities', () => {
  it('uses an explicit allowlist independent of role and subagent flags', () => {
    expect(getToolsForContext({ mode: 'dojo' })).toEqual(DOJO_READ_ONLY_TOOLS)
    expect(getToolsForContext({ mode: 'dojo', templateId: 'uiux-designer', isSubAgent: true })).toEqual(DOJO_READ_ONLY_TOOLS)
    for (const tool of ['write_file', 'edit_file', 'edit_symbol', 'rename_symbol', 'run_command', 'send_terminal_input', 'remember', 'task', 'ask_user', 'mcp_server_tool', 'configuration_apply', 'asset_import', 'browser_action']) {
      expect(isDojoToolAllowed(tool), tool).toBe(false)
    }
  })
  it('does not turn ordinary workers into read-only agents', () => {
    expect(getToolsForContext({ mode: 'agent', isSubAgent: true })).toContain('write_file')
    expect(getToolsForContext({ mode: 'agent', isSubAgent: true })).toContain('run_command')
  })
  it('uses mentor instructions before the generic subagent contract', () => {
    const contract = buildModeContract({ mode: 'dojo', isSubAgent: true, allowedTools: DOJO_READ_ONLY_TOOLS })
    expect(contract).toContain('read-only coding mentor')
    expect(contract).not.toContain('Complete only the delegated task')
  })
  it('registers Dojo without silently falling back to Agent', () => {
    const registry = new ModeRegistry()
    expect(registry.has('dojo')).toBe(true)
    expect(registry.getOrDefault('dojo').id).toBe('dojo')
  })
})
