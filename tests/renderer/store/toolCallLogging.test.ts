import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createLogSlice, type LogSlice } from '@/renderer/store/slices/logSlice'
import { createSettingsSlice, type SettingsSlice } from '@/renderer/store/slices/settingsSlice'
import { cleanAgentConfig } from '@/shared/config/configCleaner'

type TestStore = LogSlice & SettingsSlice

function createTestStore() {
  return createStore<TestStore>()((...args) => ({
    ...createSettingsSlice(...args),
    ...createLogSlice(...args),
  }))
}

describe('tool call logging preference', () => {
  it('defaults to off and does not retain log payloads', () => {
    const store = createTestStore()

    expect(store.getState().agentConfig.enableToolCallLogging).toBe(false)
    store.getState().addToolCallLog({
      type: 'request',
      toolName: 'read_file',
      data: { path: 'large-payload.txt' },
    })

    expect(store.getState().toolCallLogs).toEqual([])
  })

  it('starts retaining calls after the shared setting is enabled', () => {
    const store = createTestStore()
    store.getState().update('agentConfig', { enableToolCallLogging: true })

    store.getState().addToolCallLog({
      type: 'response',
      toolName: 'read_file',
      data: 'ok',
      success: true,
    })

    expect(store.getState().toolCallLogs).toHaveLength(1)
  })

  it('keeps the preference when persisted settings are cleaned', () => {
    expect(cleanAgentConfig({ enableToolCallLogging: true })).toEqual({
      enableToolCallLogging: true,
    })
  })
})
