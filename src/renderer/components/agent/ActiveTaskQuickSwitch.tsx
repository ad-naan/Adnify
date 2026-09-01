import { LoaderCircle, ShieldAlert, Split } from 'lucide-react'
import { useMemo } from 'react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import {
  flattenTaskNodes, isAgentTaskThread, projectTaskCenter, type TaskCenterGroup, } from './taskCenterProjection'
import { t, type Language } from '@shared/i18n'

interface ActiveTaskQuickSwitchProps {
  language: Language
  onOpenTaskCenter: () => void
}

function targetThreadId(group: TaskCenterGroup): string | undefined {
  const nodes = flattenTaskNodes(group.nodes)
  return nodes.find(node => node.status === 'waiting')?.threadId
    || nodes.find(node => node.status === 'running' || node.status === 'handoff')?.threadId
    || nodes[0]?.threadId
}

export default function ActiveTaskQuickSwitch({ language, onOpenTaskCenter }: ActiveTaskQuickSwitchProps) {
  const threads = useAgentStore(state => state.threads)
  const branches = useAgentStore(state => state.branches)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const switchThread = useAgentStore(state => state.switchThread)

  const activeGroups = useMemo(() => {
    const agentThreads = Object.fromEntries(Object.entries(threads).filter(([, thread]) => isAgentTaskThread(thread)))
    return projectTaskCenter(agentThreads, [], branches)
      .filter(group => group.status === 'running' || group.status === 'handoff' || group.status === 'waiting')
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }, [branches, threads])

  if (activeGroups.length === 0) return null

  const visible = activeGroups.slice(0, 3)
  const hiddenCount = activeGroups.length - visible.length

  return <div className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-label={t('activeTaskQuickSwitch.activeTasks', language)}>
    {visible.map(group => {
      const threadId = targetThreadId(group)
      const current = Boolean(threadId && threadId === currentThreadId)
      return <button
        key={group.id}
        type="button"
        disabled={!threadId}
        onClick={() => threadId && switchThread(threadId)}
        title={`${group.title} · ${group.status === 'waiting' ? (t('activeTaskQuickSwitch.needsInput', language)) : group.status === 'handoff' ? (t('activeTaskQuickSwitch.handingOff', language)) : (t('common.running', language))}`}
        className={`flex h-7 min-w-0 max-w-32 items-center gap-1.5 rounded-lg px-2 text-[9px] transition-colors focus-visible:ring-2 focus-visible:ring-accent/45 ${current ? 'bg-accent/[0.1] text-accent' : group.status === 'waiting' ? 'bg-amber-400/[0.07] text-amber-500 hover:bg-amber-400/[0.11]' : 'bg-surface/35 text-text-secondary hover:bg-surface-hover'}`}
      >
        {group.status === 'waiting'
          ? <ShieldAlert className="h-3 w-3 shrink-0" />
          : group.status === 'handoff'
            ? <Split className="h-3 w-3 shrink-0" />
            : <LoaderCircle className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" />}
        <span className="truncate">{group.title}</span>
      </button>
    })}
    {hiddenCount > 0 && <button type="button" onClick={onOpenTaskCenter} title={t('activeTaskQuickSwitch.viewMoreTasks', language, { hiddenCount })} className="flex h-7 shrink-0 items-center rounded-lg bg-surface/35 px-2 text-[9px] tabular-nums text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45">+{hiddenCount}</button>}
  </div>
}
