import { describe, expect, it } from 'vitest'
import { changedReviewTasks, snapshotTasksForReview } from '@/renderer/agent/plan/planTaskReview'
import type { PlanTask } from '@/renderer/agent/plan/types'

const task: PlanTask = { id:'one',title:'布局调整',description:'保留现有功能',provider:'test',model:'test',role:'default',dependencies:[],status:'pending' }
const changes = (before:PlanTask[], after:PlanTask[]) => changedReviewTasks(snapshotTasksForReview(before),snapshotTasksForReview(after)).map(item=>item.id)
describe('Plan review changes', () => {
  it('does not report execution progress as a plan edit', () => {
    expect(changes([task],[{ ...task,status:'completed',output:'done',startedAt:10,completedAt:20 }])).toEqual([])
  })
  it('reports modified configuration, additions and removals', () => {
    expect(changes([task],[{ ...task,model:'new' }])).toEqual(['one'])
    expect(changes([task],[{ ...task,dependencies:['dependency'] }])).toEqual(['one'])
    expect(changes([task],[{ ...task,id:'two' }])).toEqual(['two','one'])
  })
  it('ignores dependency ordering and proof status changes', () => {
    const before:PlanTask = { ...task, dependencies:['b','a'],acceptanceCriteria:[{id:'c',text:'行为不变',status:'pending',evidenceIds:[]}] }
    const after:PlanTask = { ...before,dependencies:['a','b'],acceptanceCriteria:[{id:'c',text:'行为不变',status:'proven',evidenceIds:['proof']}] }
    expect(changes([before],[after])).toEqual([])
  })
})
