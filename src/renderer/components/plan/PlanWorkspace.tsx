import { memo, useEffect, useMemo } from 'react'
import { History, ListChecks } from 'lucide-react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useStore } from '@/renderer/store'
import { Select } from '@/renderer/components/ui'
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
  const activePlan = plans.find(plan => plan.id === activePlanId) || sortedPlans[0]
  const options = useMemo(() => sortedPlans.map(plan => ({
    value: plan.id,
    label: `${plan.name} · ${planStatusLabel(plan.status, language)}`,
  })), [language, sortedPlans])

  useEffect(() => {
    if (!activePlanId && sortedPlans[0]) setActivePlan(sortedPlans[0].id)
  }, [activePlanId, setActivePlan, sortedPlans])

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3">
      <History className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="shrink-0 text-[11px] font-medium text-text-secondary">{copy(language, '计划历史', 'Plan history')}</span>
      {options.length > 0 ? <Select
        className="min-w-0 max-w-[420px] flex-1"
        options={options}
        value={activePlan?.id || ''}
        onChange={setActivePlan}
      /> : <span className="text-[11px] text-text-muted">{copy(language, '历史计划会显示在这里', 'Plan history appears here')}</span>}
      <span className="ml-auto shrink-0 text-[10px] text-text-muted/70">{plans.length} {copy(language, '条记录', 'plans')}</span>
    </header>

    <div className="min-h-0 flex-1">
      {activePlan ? <TaskBoard planId={activePlan.id} /> : <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-surface/30 text-text-muted"><ListChecks className="h-5 w-5" /></div>
        <h2 className="text-sm font-semibold text-text-primary">{copy(language, '正在等待计划', 'Waiting for a plan')}</h2>
        <p className="mt-2 max-w-md text-xs leading-5 text-text-muted">{copy(language, '请在右侧描述需求。完成必要的澄清后，计划会自动创建并显示在这里。', 'Describe the request on the right. After clarification, the plan will be created and shown here automatically.')}</p>
      </div>}
    </div>
  </div>
})

export default PlanWorkspace
