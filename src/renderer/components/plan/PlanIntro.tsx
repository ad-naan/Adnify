import { ArrowRight, CheckCheck, GitBranch, MessageSquareText } from 'lucide-react'
import { OtterAsset } from '../brand/OtterAsset'
import { t, type Language } from '@shared/i18n'

/** Shared welcome for the canvas and the standalone plan workspace. */
export function PlanIntro({ language }: { language: Language }) {
  return <div className="plan-intro">
    <OtterAsset asset="creative" className="plan-intro-mascot" />
    <div className="plan-eyebrow">{t('planDesign.workspace', language)}</div>
    <h2>{t('planDesign.heading', language)}</h2>
    <p>{t('planDesign.subtitle', language)}</p>
    <ol className="plan-intro-steps" aria-label={t('planStageTrace.planStages', language)}>
      <li><MessageSquareText size={14} /><span>{t('common.brief', language)}</span><ArrowRight className="plan-intro-arrow" size={12} aria-hidden="true" /></li>
      <li><GitBranch size={14} /><span>{t('planStageTrace.plan', language)}</span><ArrowRight className="plan-intro-arrow" size={12} aria-hidden="true" /></li>
      <li><CheckCheck size={14} /><span>{t('planDesign.executeAndReview', language)}</span></li>
    </ol>
  </div>
}
