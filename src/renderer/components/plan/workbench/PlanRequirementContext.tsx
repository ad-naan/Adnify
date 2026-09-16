import { CheckCircle2, ChevronDown, FileText } from 'lucide-react'
import { t, type Language } from '@shared/i18n'

export function PlanRequirementContext({ request, answers, language }: { request: string; answers?: string[]; language: Language }) {
  return <details className="plan-requirement-context">
    <summary>
      <FileText size={14} aria-hidden="true" />
      <span className="shrink-0">{t('common.objective', language)}</span>
      <span className="plan-context-preview">{request}</span>
      <ChevronDown size={14} className="plan-context-chevron" aria-hidden="true" />
    </summary>
    <div className="plan-context-content">
      <p>{request}</p>
      {!!answers?.length && <div className="plan-context-answers"><CheckCircle2 size={14} /><span>{answers.join(t('planRequirementContext.answerSeparator', language))}</span></div>}
    </div>
  </details>
}
