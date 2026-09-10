import { memo, useMemo } from 'react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useStore, useModeStore } from '@/renderer/store'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { TaskBoard } from './TaskBoard'
import { t, type TranslationKey, type Language } from '@shared/i18n'
import { Button } from '@/renderer/components/ui'
import { usePlanViewStore } from '@/renderer/agent/plan/planViewStore'
import './plan-workspace.css'

/**
 * 计划状态 → 文案 key。
 *
 * 以前这里是 `[中文, 英文]` 二元组加一个按语言算出来的下标，加第三种语言要改数据结构。
 * `satisfies` 让写错 key 直接编译不过。
 */
const PLAN_STATUS_KEYS = {
  draft: 'planWorkspace.statusDraft',
  approved: 'planWorkspace.statusReady',
  executing: 'common.running',
  pausing: 'planWorkspace.statusPausing',
  paused: 'planWorkspace.statusPaused',
  stopping: 'planWorkspace.statusStopping',
  stopped: 'planWorkspace.statusStopped',
  completed: 'common.completed',
  failed: 'common.failed',
} satisfies Record<string, TranslationKey>

function planStatusLabel(status: string, language: Language): string {
  const key = PLAN_STATUS_KEYS[status as keyof typeof PLAN_STATUS_KEYS]
  // 未知状态原样显示，而不是空白 —— 后端加了新状态时至少看得出是哪个
  return key ? t(key, language) : status
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

  return <div className="plan-surface flex h-full min-h-0 flex-col bg-background">
    <div className="min-h-0 flex-1">
      {activePlan ? <TaskBoard planId={activePlan.id} planOptions={options} onPlanChange={id => { usePlanViewStore.getState().revealPlan(id); setActivePlan(id) }} /> : <div className="flex h-full flex-col items-center justify-center gap-5 px-8 pb-16 text-center">
        <OtterAsset asset="creative" className="h-24 w-24 object-contain" alt="" />
        <h2 className="text-2xl font-semibold text-text-primary">{t('planDesign.heading', language)}</h2>
        <p className="max-w-md text-sm leading-6 text-text-muted">{t('planDesign.subtitle', language)}</p>
        <Button onClick={() => { useModeStore.getState().setMode('plan'); useStore.getState().setChatVisible(true) }}>{t('planDesign.openDiscussion', language)}</Button>
      </div>}
    </div>
  </div>
})

export default PlanWorkspace
