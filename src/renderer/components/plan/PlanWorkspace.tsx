import { memo, useMemo } from 'react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useStore } from '@/renderer/store'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { TaskBoard } from './TaskBoard'
import { t, asLanguage, type TranslationKey } from '@renderer/i18n'

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

function planStatusLabel(status: string, language: string): string {
  const key = PLAN_STATUS_KEYS[status as keyof typeof PLAN_STATUS_KEYS]
  // 未知状态原样显示，而不是空白 —— 后端加了新状态时至少看得出是哪个
  return key ? t(key, asLanguage(language)) : status
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
        <h2 className="text-sm font-semibold text-text-primary">{t('planWorkspace.waitingForAPlan', asLanguage(language))}</h2>
        <p className="mt-2 max-w-md text-xs leading-5 text-text-muted">{t('planWorkspace.describeTheRequestOn', asLanguage(language))}</p>
      </div>}
    </div>
  </div>
})

export default PlanWorkspace
