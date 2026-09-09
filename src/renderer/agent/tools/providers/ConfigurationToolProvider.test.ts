import { describe, expect, it } from 'vitest'
import { ConfigurationToolProvider } from './ConfigurationToolProvider'

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
})
