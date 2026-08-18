import { memo, useMemo } from 'react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useStore } from '@/renderer/store'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { TaskBoard } from './TaskBoard'

const copy = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

function planStatusLabel(status: string, language: string): string {
  const labels: Record<string, [string, string]> = {
    draft: ['待审核', 'Draft'], approved: ['待执行', 'Ready'], executing: ['执行中', 'Running'],
    pausing: ['暂停中', 'Pausing'], paused: ['已暂停', 'Paused'], stopping: ['停止中', 'Stopping'],
    stopped: ['已停止', 'Stopped'], completed: ['已完成', 'Completed'], failed: ['失败', 'Failed'],
  }
  return labels[status]?.[language === 'zh' ? 0 : 1] || status
}

export const PlanWorkspace = memo(function PlanWorkspace() {
  const language = useStore(state => state.language)
  const plans = useAgentStore(state => state.plans)
  const activePlanId = useAgentStore(state => state.activePlanId)
  const setActivePlan = useAgentStore(state => state.setActivePlan)

  const sortedPlans = useMemo(() => [...plans].sort((a, b) => b.updatedAt - a.updatedAt), [plans])
  const activePlan = plans.find(plan => plan.id === activePlanId)
  const options = useMemo(() => sortedPlans.map(plan => ({
    value: plan.id,
    label: `${plan.name} · ${planStatusLabel(plan.status, language)}`,
  })), [language, sortedPlans])

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="min-h-0 flex-1">
      {activePlan ? <TaskBoard planId={activePlan.id} planOptions={options} onPlanChange={setActivePlan} /> : <div className="flex h-full flex-col items-center justify-center px-8 pb-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/45 bg-surface/[0.12]"><OtterAsset asset="plans" className="h-11 w-11 object-contain" alt="" /></div>
        <h2 className="text-sm font-semibold text-text-primary">{copy(language, '正在等待计划', 'Waiting for a plan')}</h2>
        <p className="mt-2 max-w-md text-xs leading-5 text-text-muted">{copy(language, '请在右侧描述需求。完成必要的澄清后，计划会自动创建并显示在这里。', 'Describe the request on the right. After clarification, the plan will be created and shown here automatically.')}</p>
      </div>}
    </div>
  </div>
})

export default PlanWorkspace
