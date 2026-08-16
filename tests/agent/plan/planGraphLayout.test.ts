import { describe, expect, it } from 'vitest'
import { layoutPlanGraph, wouldCreateDependencyCycle } from '../../../src/renderer/agent/plan/planGraphLayout'
import type { PlanTask } from '../../../src/renderer/agent/plan/types'

function task(id: string, dependencies: string[] = []): PlanTask {
  return { id, title: id, description: id, provider: 'test', model: 'test', role: 'default', dependencies, status: 'pending' }
}

describe('layoutPlanGraph', () => {
  it('places fan-out branches together and their merge below them', () => {
    const layout = layoutPlanGraph([
      task('start'),
      task('left', ['start']),
      task('right', ['start']),
      task('merge', ['left', 'right']),
    ])
    const nodes = new Map(layout.nodes.map(node => [node.task.id, node]))

    expect(nodes.get('start')?.rank).toBe(0)
    expect(nodes.get('left')?.rank).toBe(1)
    expect(nodes.get('right')?.rank).toBe(1)
    expect(nodes.get('merge')?.rank).toBe(2)
    expect(nodes.get('left')?.x).not.toBe(nodes.get('right')?.x)
    expect(nodes.get('start')!.width).toBeGreaterThan(nodes.get('left')!.width)
    expect(nodes.get('merge')!.width).toBeGreaterThan(nodes.get('right')!.width)
    expect(layout.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual([
      'start->left', 'start->right', 'left->merge', 'right->merge',
    ])
  })

  it('uses a readable full lane for a purely sequential plan', () => {
    const layout = layoutPlanGraph([task('one'), task('two', ['one']), task('three', ['two'])])
    expect(layout.nodes.every(node => node.width >= 520)).toBe(true)
  })

  it('surfaces missing dependencies without dropping the task', () => {
    const layout = layoutPlanGraph([task('orphan', ['missing'])])
    expect(layout.nodes.map(node => node.task.id)).toEqual(['orphan'])
    expect(layout.missingDependencies).toEqual([{ taskId: 'orphan', dependencyId: 'missing' }])
  })

  it('keeps cyclic plans visible in a fallback diagnostic rank', () => {
    const layout = layoutPlanGraph([task('a', ['b']), task('b', ['a'])])
    expect(layout.hasCycle).toBe(true)
    expect(layout.nodes).toHaveLength(2)
    expect(new Set(layout.nodes.map(node => node.rank)).size).toBe(1)
  })

  it('rejects dependency edits that introduce a cycle', () => {
    const tasks = [task('a'), task('b', ['a']), task('c', ['b'])]
    expect(wouldCreateDependencyCycle(tasks, 'a', ['c'])).toBe(true)
    expect(wouldCreateDependencyCycle(tasks, 'c', ['a'])).toBe(false)
  })
})
