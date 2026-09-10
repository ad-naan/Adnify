import { describe, expect, it } from 'vitest'
import { shouldUsePlanCanvas } from '@/renderer/agent/plan/planPresentation'
import { PLAN_BOARD_PATH } from '@/shared/types/planBoard'

const empty = { mode:'plan', activeFilePath:PLAN_BOARD_PATH, editorVisible:true, chatVisible:true,
  activeSidePanel:'explorer', focusedPanel:null, currentThreadId:'origin', revealed:false }

describe('Plan canvas presentation', () => {
  it('centers initial planning and waits for explicit review before splitting', () => {
    expect(shouldUsePlanCanvas(empty)).toBe(true)
    const ready = { ...empty, plan:{ id:'plan', status:'draft', originThreadId:'origin' } }
    expect(shouldUsePlanCanvas(ready)).toBe(true)
    expect(shouldUsePlanCanvas({ ...ready, revealed:true })).toBe(false)
    expect(shouldUsePlanCanvas({ ...ready, plan:{ ...ready.plan, status:'executing' } })).toBe(false)
  })
  it.each([
    { mode:'agent' }, { activeFilePath:'src/app.ts' }, { activeSidePanel:'shell' },
    { editorVisible:false }, { chatVisible:false }, { focusedPanel:'editor' },
    { threadOrigin:'plan-task' }, { threadMode:'agent' }, { debugVisible:true },
    { editorTerminalVisible:true }, { plan:{ id:'other', status:'draft', originThreadId:'another-thread' } },
  ])('keeps other workbench capabilities visible: %j', override => {
    expect(shouldUsePlanCanvas({ ...empty, ...override })).toBe(false)
  })
})
