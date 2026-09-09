import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigurationToolProvider } from './ConfigurationToolProvider'
import { api } from '@services/electronAPI'
import type { ToolExecutionContext } from '@shared/types'

vi.mock('@services/electronAPI', () => ({ api: { extensions: { search: vi.fn(), list: vi.fn(), prepare: vi.fn(), apply: vi.fn() } } }))
beforeEach(() => vi.clearAllMocks())

describe('ConfigurationToolProvider', () => {
  it('exposes only the three configuration lifecycle tools to the executing Agent', () => {
    const provider = new ConfigurationToolProvider()
    expect(provider.getToolDefinitions().map(tool => tool.name)).toEqual([
      'configuration_discover',
      'configuration_prepare',
      'configuration_apply',
    ])
    expect(provider.hasTool('extension_verify')).toBe(false)
  })

  it('exposes only discovery while planning or running a hidden agent', () => {
    const provider = new ConfigurationToolProvider()
    provider.setContext({ mode: 'plan', planPhase: 'planning' })
    expect(provider.getToolDefinitions().map(tool => tool.name)).toEqual(['configuration_discover'])

    provider.setContext({ mode: 'agent', isSubAgent: true })
    expect(provider.getToolDefinitions().map(tool => tool.name)).toEqual(['configuration_discover'])
  })

  it('requires approval only for applying a prepared change', () => {
    const provider = new ConfigurationToolProvider()
    expect(provider.getApprovalType('configuration_discover')).toBe('none')
    expect(provider.getApprovalType('configuration_prepare')).toBe('none')
    expect(provider.getApprovalType('configuration_apply')).toBe('dangerous')
  })

  it('accepts installed inspection and catalog discovery arguments', () => {
    const provider = new ConfigurationToolProvider()
    expect(provider.validateArgs('configuration_discover', {}).valid).toBe(true)
    expect(provider.validateArgs('configuration_discover', { query: 'browser automation' }).valid).toBe(true)
    expect(provider.validateArgs('configuration_discover', { kind: 'skill', query: 'review' }).valid).toBe(true)
    expect(provider.validateArgs('configuration_discover', { query: '' }).valid).toBe(false)
  })

  it('requires a settings value and rejects workspace application preferences', () => {
    const provider = new ConfigurationToolProvider()
    expect(provider.validateArgs('configuration_prepare', { kind: 'settings', source: 'language', scope: 'user', value: 'zh' }).valid).toBe(true)
    expect(provider.validateArgs('configuration_prepare', { kind: 'settings', source: 'editorConfig', scope: 'user', value: { fontSize: 18 } }).valid).toBe(true)
    expect(provider.validateArgs('configuration_prepare', { kind: 'settings', source: 'language', scope: 'user' }).valid).toBe(false)
    expect(provider.validateArgs('configuration_prepare', { kind: 'settings', source: 'language', scope: 'workspace', value: 'zh' }).valid).toBe(false)
  })

  it('preserves useful matches when another catalog rejects', async () => {
    vi.mocked(api.extensions.search).mockImplementation(async ({ kind }) => {
      if (kind === 'skill') throw new Error('skills.sh timed out')
      return kind === 'settings' ? { success: true, settings: [] } : { success: true, results: [{ kind: 'mcp', id: 'mcp', name: 'Browser', source: 'browser', description: '' }] }
    })
    const result = await new ConfigurationToolProvider().execute('configuration_discover', { query: 'browser' }, {} as ToolExecutionContext)
    expect(result.success).toBe(true)
    expect(JSON.parse(result.result as string)).toMatchObject({ partial: true, results: [{ id: 'mcp' }], warnings: [expect.stringContaining('skills.sh timed out')] })
  })

  it('does not report failed catalogs as successful zero-match searches', async () => {
    vi.mocked(api.extensions.search).mockResolvedValue({ success: false, error: 'offline' })
    const result = await new ConfigurationToolProvider().execute('configuration_discover', { query: 'browser' }, {} as ToolExecutionContext)
    expect(result.success).toBe(false)
    expect(result.error).toContain('offline')
  })

  it('routes repository queries only to Skills and settings inspection only to local settings', async () => {
    vi.mocked(api.extensions.search).mockResolvedValue({ success: true, results: [] })
    const provider = new ConfigurationToolProvider()
    await provider.execute('configuration_discover', { query: 'anthropics/skills' }, {} as ToolExecutionContext)
    expect(api.extensions.search).toHaveBeenCalledExactlyOnceWith({ kind: 'skill', query: 'anthropics/skills' })
    vi.clearAllMocks()
    await provider.execute('configuration_discover', { kind: 'settings' }, {} as ToolExecutionContext)
    expect(api.extensions.search).toHaveBeenCalledExactlyOnceWith({ kind: 'settings', query: '*' })
    expect(api.extensions.list).not.toHaveBeenCalled()
  })
})
