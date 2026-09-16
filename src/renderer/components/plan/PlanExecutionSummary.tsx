import { t, type Language } from '@shared/i18n'

interface Props {
  total: number
  completed: number
  running: number
  approvals: number
  failed: number
  language: Language
  compact?: boolean
}

export function PlanExecutionSummary({ total, completed, running, approvals, failed, language, compact = false }: Props) {
  const percent = total ? Math.round(completed / total * 100) : 0
  return <section className={`plan-execution-summary ${compact ? 'plan-execution-summary-compact' : ''}`} aria-label={t('planDesign.progress', language)}>
    <div className="plan-progress-heading"><span>{t('planDesign.progress', language)}</span><strong>{percent}<small>%</small></strong></div>
    <div className="plan-progress-track" role="progressbar" aria-label={t('planDesign.progress', language)} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={completed}>
      <span style={{ width: `${percent}%` }} />
    </div>
    <dl className="plan-execution-metrics">
      <div><dt>{t('common.completed', language)}</dt><dd>{completed}<small> / {total}</small></dd></div>
      <div data-tone="active"><dt>{t('common.running', language)}</dt><dd>{running}</dd></div>
      <div data-tone={approvals ? 'warning' : undefined}><dt>{t('taskBoard.needsApproval', language)}</dt><dd>{approvals}</dd></div>
      <div data-tone={failed ? 'error' : undefined}><dt>{t('common.failed', language)}</dt><dd>{failed}</dd></div>
    </dl>
  </section>
}
