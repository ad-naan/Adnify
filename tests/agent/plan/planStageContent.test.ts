import { describe, expect, it } from 'vitest'
import {
  hasCompletePlanStageMap,
  normalizePlanStageMap,
  renderPlanStageMarkdown,
} from '@/renderer/agent/plan/planStageContent'

const stage = (title: string) => ({
  title,
  summary: `${title} summary`,
  sections: [{
    id: `${title}-scope`,
    title: 'Scope',
    kind: 'checklist',
    items: [{ id: 'item-1', title: 'Concrete item', status: 'confirmed' }],
  }],
})

describe('planStageContent', () => {
  it('accepts a complete AI-authored four-stage model', () => {
    const normalized = normalizePlanStageMap({
      requirements: stage('Requirements'),
      plan: stage('Plan'),
      execution: stage('Execution'),
      validation: stage('Validation'),
    })

    expect(hasCompletePlanStageMap(normalized)).toBe(true)
    expect(normalized.execution?.sections[0].items[0].status).toBe('confirmed')
  })

  it('rejects an incomplete model and produces auditable markdown', () => {
    const normalized = normalizePlanStageMap({ requirements: stage('Requirements') })
    expect(hasCompletePlanStageMap(normalized)).toBe(false)
    expect(renderPlanStageMarkdown(normalized.requirements!)).toContain('- [x] **Concrete item**')
  })
})
