import { ChevronDown, ChevronUp, MessageSquareText, Settings2 } from 'lucide-react'
import type { PlanTask } from '@/renderer/agent/plan/types'
import { getPlanProviderDisplayName } from '@/renderer/agent/plan/planProviderCatalog'
import { t, type Language } from '@shared/i18n'

interface Props {
  tasks: PlanTask[]
  language: Language
  expandedTaskId: string | null
  onExpand: (id: string | null) => void
  onConfigure: (task: PlanTask) => void
  onDiscuss: (task: PlanTask) => void
  canDiscuss: boolean
}

/** A second presentation of the same tasks; editing stays in PlanTaskInspector. */
export function PlanTaskList({ tasks, language, expandedTaskId, onExpand, onConfigure, onDiscuss, canDiscuss }: Props) {
  return <div className="plan-review-list custom-scrollbar">
    {tasks.map((task, index) => {
      const expanded = expandedTaskId === task.id
      const dependencies = task.dependencies.map(id => tasks.find(item => item.id === id)?.title || id)
      return <section key={task.id}>
        <button type="button" className="plan-review-row" aria-expanded={expanded} onClick={() => onExpand(expanded ? null : task.id)}>
          <span className="self-start pt-1 font-mono text-xs text-text-muted">{String(index + 1).padStart(2, '0')}</span>
          <span className="min-w-0"><strong>{task.title}</strong><small className="line-clamp-2">{task.description}</small></span>
          <span className="plan-review-dependencies max-w-36 truncate text-xs text-text-muted" title={dependencies.join('、')}>{dependencies.length ? `${t('common.depends', language)} · ${dependencies.length}` : ''}</span>
          {expanded ? <ChevronUp className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
        </button>
        {expanded && <div className="plan-review-detail">
          <p>{task.description}</p>
          {dependencies.length > 0 && <><h3>{t('common.depends', language)}</h3><p>{dependencies.join('、')}</p></>}
          {Boolean(task.acceptanceCriteria?.length) && <><h3>{t('taskBoard.acceptanceMatrix', language)}</h3><ul>{task.acceptanceCriteria!.map(criterion => <li key={criterion.id}>{criterion.text}</li>)}</ul></>}
          {Boolean(task.producesFiles?.length) && <><h3>{t('taskBoard.artifacts', language)}</h3>{task.producesFiles!.map(file => <code className="block" key={file}>{file}</code>)}</>}
          <h3>{t('taskBoard.executionSetup', language)}</h3>
          <p>{task.role} · {getPlanProviderDisplayName(task.provider)} · {task.model}</p>
          <div className="mt-4 flex flex-wrap gap-5 text-xs">
            <button type="button" onClick={() => onConfigure(task)} className="inline-flex items-center gap-2 py-2 text-accent"><Settings2 className="h-3.5 w-3.5" />{t('taskBoard.configure', language)}</button>
            {canDiscuss && <button type="button" onClick={() => onDiscuss(task)} className="inline-flex items-center gap-2 py-2 text-accent"><MessageSquareText className="h-3.5 w-3.5" />{t('planDesign.discussTask', language)}</button>}
          </div>
        </div>}
      </section>
    })}
  </div>
}
