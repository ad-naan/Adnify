import { describe, expect, it } from 'vitest'
import { selectBranches, type AgentStore } from '@/renderer/agent/store/AgentStore'
import type { Branch } from '@/renderer/agent/store/slices/branchSlice'

/**
 * selectBranches 的引用稳定性是硬要求，不是性能优化：
 * zustand v5 通过 useSyncExternalStore 用严格引用比较判断快照是否变化，
 * 每次返回新数组会被认为"状态一直在变"，直接触发
 * "The result of getSnapshot should be cached" + Maximum update depth exceeded。
 */

function makeBranch(id: string): Branch {
  return {
    id,
    name: id,
    messages: [],
    createdAt: 1,
    parentMessageId: 'm1',
  } as unknown as Branch
}

function makeState(overrides: Partial<AgentStore>): AgentStore {
  return {
    currentThreadId: 'thread-1',
    branches: {},
    threads: {},
    ...overrides,
  } as unknown as AgentStore
}

describe('selectBranches reference stability', () => {
  it('returns the same reference when the thread has no branches', () => {
    const state = makeState({ branches: {} })

    expect(selectBranches(state)).toBe(selectBranches(state))
    expect(selectBranches(state)).toEqual([])
  })

  it('returns the same reference when there is no current thread', () => {
    const state = makeState({ currentThreadId: null })

    expect(selectBranches(state)).toBe(selectBranches(state))
  })

  it('returns the same reference when the branch list only holds the mainline', () => {
    const state = makeState({ branches: { 'thread-1': [makeBranch('__mainline__')] } })

    expect(selectBranches(state)).toBe(selectBranches(state))
    expect(selectBranches(state)).toEqual([])
  })

  it('filters out the mainline and keeps the filtered array stable across calls', () => {
    const branches = [makeBranch('__mainline__'), makeBranch('branch-a')]
    const state = makeState({ branches: { 'thread-1': branches } })

    const first = selectBranches(state)
    expect(first.map(branch => branch.id)).toEqual(['branch-a'])
    expect(selectBranches(state)).toBe(first)
  })

  it('recomputes when the underlying branch array is replaced', () => {
    const state = makeState({ branches: { 'thread-1': [makeBranch('branch-a')] } })
    const first = selectBranches(state)

    const next = makeState({ branches: { 'thread-1': [makeBranch('branch-a'), makeBranch('branch-b')] } })
    const second = selectBranches(next)

    expect(second).not.toBe(first)
    expect(second.map(branch => branch.id)).toEqual(['branch-a', 'branch-b'])
  })
})
