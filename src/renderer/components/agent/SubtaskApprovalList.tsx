import { useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { SubtaskApproval } from '@renderer/agent/presentation/subtaskApprovals'
import { ToolApprovalActions } from './ToolApprovalActions'
import { t, type Language } from '@shared/i18n'

function ApprovalRow({ approval, language, onDecision }: {
  approval: SubtaskApproval
  language: Language
  onDecision: (approval: SubtaskApproval, approved: boolean) => boolean
}) {
  const sent = useRef(false)
  const [submitted, setSubmitted] = useState(false)
  const decide = (approved: boolean) => {
    if (sent.current) return
    sent.current = true
    if (onDecision(approval, approved)) setSubmitted(true)
    else sent.current = false
  }
  const args = Object.entries(approval.toolCall.arguments).filter(([key]) => !key.startsWith('_'))
  return <div className="py-2">
    <div className="flex items-center gap-2 text-[11px]">
      <GitBranch className="h-3 w-3 shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate text-text-secondary" title={approval.title}>{approval.title || t('subAgentTaskCard.subAgentTask', language)}</span>
      {submitted
        ? <span role="status" className="text-[11px] text-text-muted">{t('subtaskApprovalList.submitted', language)}</span>
        : <ToolApprovalActions language={language} onApprove={() => decide(true)} onReject={() => decide(false)} />}
    </div>
    <div className="pl-5">
      <code className="text-[10px] text-text-muted">{approval.toolCall.name}</code>
      <dl className="mt-1 max-h-24 space-y-0.5 overflow-auto text-[11px] leading-5">
        {args.map(([key, value]) => <div key={key} className="flex items-start gap-2">
          <dt className="w-14 shrink-0 break-words text-[10px] text-text-muted">{key}</dt>
          <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-text-secondary">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</dd>
        </div>)}
      </dl>
    </div>
  </div>
}

export function SubtaskApprovalList({ approvals, language, onDecision }: {
  approvals: SubtaskApproval[]
  language: Language
  onDecision: (approval: SubtaskApproval, approved: boolean) => boolean
}) {
  if (!approvals.length) return null
  return <section aria-label={t('subtaskApprovalList.approvals', language)} className="px-4 py-1">
      {approvals.map(approval => <ApprovalRow key={`${approval.threadId}:${approval.requestId}:${approval.toolCall.id}`} approval={approval} language={language} onDecision={onDecision} />)}
  </section>
}

