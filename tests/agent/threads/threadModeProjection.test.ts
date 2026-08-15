import { describe, expect, it } from 'vitest'
import { createEmptyThread } from '@/renderer/agent/store/slices/threadSlice'
import { findMostRecentThreadForMode, projectThreadsForMode } from '@/renderer/agent/threads/threadModeProjection'

describe('threadModeProjection', () => {
  it('separates Agent and Plan histories and hides plan workers', () => {
    const agent = { ...createEmptyThread({ mode: 'agent', origin: 'user' }), id: 'agent', lastModified: 10 }
    const plan = { ...createEmptyThread({ mode: 'plan', origin: 'user' }), id: 'plan', lastModified: 20 }
    const worker = { ...createEmptyThread({ mode: 'plan', origin: 'plan-task' }), id: 'worker', lastModified: 30 }

    expect(projectThreadsForMode([agent, plan, worker], 'agent').map(thread => thread.id)).toEqual(['agent'])
    expect(projectThreadsForMode([agent, plan, worker], 'plan').map(thread => thread.id)).toEqual(['plan'])
  })

  it('selects the most recently used top-level thread for a mode', () => {
    const older = { ...createEmptyThread({ mode: 'plan', origin: 'user' }), id: 'older', lastModified: 10 }
    const newer = { ...createEmptyThread({ mode: 'plan', origin: 'user' }), id: 'newer', lastModified: 20 }
    expect(findMostRecentThreadForMode([older, newer], 'plan')?.id).toBe('newer')
  })
})
