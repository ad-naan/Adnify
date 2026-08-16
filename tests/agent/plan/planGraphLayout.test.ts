import { describe, expect, it } from 'vitest'
import { layoutPlanGraph } from '../../../src/renderer/agent/plan/planGraphLayout'
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
    expect(layout.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual([
      'start->left', 'start->right', 'left->merge', 'right->merge',
    ])
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
})
