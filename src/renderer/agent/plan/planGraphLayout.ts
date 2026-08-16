import type { PlanTask } from './types'

export interface PlanGraphNode {
  task: PlanTask
  rank: number
  x: number
  y: number
  width: number
  height: number
}

export interface PlanGraphEdge {
  id: string
  from: string
  to: string
  points: Array<{ x: number, y: number }>
}

export interface PlanGraphLayout {
  nodes: PlanGraphNode[]
  edges: PlanGraphEdge[]
  width: number
  height: number
  hasCycle: boolean
  missingDependencies: Array<{ taskId: string, dependencyId: string }>
}

export interface PlanGraphLayoutOptions {
  nodeWidth?: number
  nodeHeight?: number
  columnGap?: number
  rowGap?: number
  paddingX?: number
  paddingY?: number
  minWidth?: number
}

/**
 * Deterministic top-to-bottom DAG layout used by the plan review canvas.
 *
 * Ranks are derived exclusively from task dependencies. Cycles never make the
 * board disappear: cyclic nodes are placed in a final fallback rank and the
 * layout reports `hasCycle` so the UI can surface the invalid plan.
 */
export function layoutPlanGraph(tasks: PlanTask[], options: PlanGraphLayoutOptions = {}): PlanGraphLayout {
  const nodeWidth = options.nodeWidth ?? 344
  const nodeHeight = options.nodeHeight ?? 158
  const columnGap = options.columnGap ?? 56
  const rowGap = options.rowGap ?? 70
  const paddingX = options.paddingX ?? 36
  const paddingY = options.paddingY ?? 28
  const minWidth = options.minWidth ?? 760
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const missingDependencies: Array<{ taskId: string, dependencyId: string }> = []
  const indegree = new Map(tasks.map(task => [task.id, 0]))
  const children = new Map(tasks.map(task => [task.id, [] as string[]]))

  for (const task of tasks) {
    for (const dependencyId of task.dependencies) {
      if (!taskById.has(dependencyId)) {
        missingDependencies.push({ taskId: task.id, dependencyId })
        continue
      }
      indegree.set(task.id, (indegree.get(task.id) || 0) + 1)
      children.get(dependencyId)?.push(task.id)
    }
  }

  const rankById = new Map<string, number>()
  const queue = tasks.filter(task => indegree.get(task.id) === 0).map(task => task.id)
  let cursor = 0
  while (cursor < queue.length) {
    const taskId = queue[cursor++]
    const rank = rankById.get(taskId) || 0
    for (const childId of children.get(taskId) || []) {
      rankById.set(childId, Math.max(rankById.get(childId) || 0, rank + 1))
      const nextDegree = (indegree.get(childId) || 0) - 1
      indegree.set(childId, nextDegree)
      if (nextDegree === 0) queue.push(childId)
    }
  }

  const hasCycle = queue.length < tasks.length
  const placedIds = new Set(queue)
  const fallbackRank = Math.max(0, ...Array.from(rankById.values())) + 1
  for (const task of tasks) {
    if (!placedIds.has(task.id)) rankById.set(task.id, fallbackRank)
    else if (!rankById.has(task.id)) rankById.set(task.id, 0)
  }

  const ranks = new Map<number, PlanTask[]>()
  for (const task of tasks) {
    const rank = rankById.get(task.id) || 0
    const items = ranks.get(rank) || []
    items.push(task)
    ranks.set(rank, items)
  }
  const orderedRanks = Array.from(ranks.keys()).sort((a, b) => a - b)
  const widestRank = Math.max(1, ...Array.from(ranks.values()).map(items => items.length))
  const contentWidth = widestRank * nodeWidth + Math.max(0, widestRank - 1) * columnGap
  const width = Math.max(minWidth, contentWidth + paddingX * 2)

  const nodes: PlanGraphNode[] = []
  for (const rank of orderedRanks) {
    const items = ranks.get(rank) || []
    const rowWidth = items.length * nodeWidth + Math.max(0, items.length - 1) * columnGap
    const startX = (width - rowWidth) / 2
    items.forEach((task, index) => nodes.push({
      task,
      rank,
      x: startX + index * (nodeWidth + columnGap),
      y: paddingY + rank * (nodeHeight + rowGap),
      width: nodeWidth,
      height: nodeHeight,
    }))
  }

  const nodeById = new Map(nodes.map(node => [node.task.id, node]))
  const edges: PlanGraphEdge[] = []
  for (const task of tasks) {
    const target = nodeById.get(task.id)
    if (!target) continue
    for (const dependencyId of task.dependencies) {
      const source = nodeById.get(dependencyId)
      if (!source) continue
      const start = { x: source.x + source.width / 2, y: source.y + source.height }
      const end = { x: target.x + target.width / 2, y: target.y }
      const middleY = start.y + Math.max(20, (end.y - start.y) / 2)
      edges.push({
        id: `${dependencyId}:${task.id}`,
        from: dependencyId,
        to: task.id,
        points: [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end],
      })
    }
  }

  const height = Math.max(260, paddingY * 2 + orderedRanks.length * nodeHeight + Math.max(0, orderedRanks.length - 1) * rowGap)
  return { nodes, edges, width, height, hasCycle, missingDependencies }
}
