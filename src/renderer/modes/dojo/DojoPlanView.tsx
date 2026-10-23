import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, FileText, Pencil, X } from 'lucide-react'
import { t, asLanguage } from '@shared/i18n'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useDojoStore } from './DojoStore'
import type { DojoSession, DojoStep } from './types'

interface StepDraft { title: string; goal: string; files: string; verifyCommand: string; criteria: string }
const draftFor = (step: DojoStep): StepDraft => ({ title: step.title, goal: step.goal, files: step.files.join('\n'), verifyCommand: step.verifyCommand, criteria: (step.acceptanceCriteria ?? []).join('\n') })
const lines = (value: string) => [...new Set(value.split('\n').map(item => item.trim()).filter(Boolean))]

export default function DojoPlanView({ session, language, disabled, onOpenFile, onStart }: {
  session: DojoSession; language: string; disabled: boolean; onOpenFile: (path: string) => void; onStart: () => void
}) {
  const lang = asLanguage(language)
  const [expandedId, setExpandedId] = useState<string | undefined>(session.steps[session.currentStepIndex]?.id)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<StepDraft | null>(null)
  useEffect(() => { setExpandedId(session.steps[session.currentStepIndex]?.id); setEditingId(null); setDraft(null) }, [session.id])
  const edit = (step: DojoStep) => { setEditingId(step.id); setExpandedId(step.id); setDraft(draftFor(step)) }
  const save = () => {
    if (!draft || !editingId || disabled || !draft.title.trim() || !lines(draft.criteria).length) return
    useDojoStore.getState().updateStep(editingId, { title: draft.title.trim(), goal: draft.goal.trim(), files: lines(draft.files), verifyCommand: draft.verifyCommand.trim(), acceptanceCriteria: lines(draft.criteria) })
    setEditingId(null); setDraft(null)
  }
  return <div className="dojo-plan">
    <div className="dojo-section-heading"><h2>{t('dojo.blueprint', lang)}</h2><span>{t('dojo.stepsTotal', lang, { total: session.steps.length })}</span></div>
    <p className="dojo-helper">{t('dojo.planHelp', lang)}</p>
    {session.blueprint && <div className="dojo-markdown dojo-blueprint"><ReactMarkdown remarkPlugins={[remarkGfm]}>{session.blueprint}</ReactMarkdown></div>}
    <ol className="dojo-plan-list">
      {session.steps.map((step, index) => {
        const expanded = expandedId === step.id, editing = editingId === step.id
        return <li key={step.id} className="dojo-plan-card" data-current={session.currentStepIndex === index || undefined}>
          <div className="dojo-plan-row">
            <button type="button" className="dojo-plan-toggle" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? undefined : step.id)}>
              <span className="dojo-step-number">{step.phase === 'passed' ? <Check size={13} /> : index + 1}</span>
              <span><strong>{step.title}</strong><small>{step.skill || step.goal}</small></span>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <button type="button" className="dojo-icon-button" disabled={disabled} title={t('dojo.editStep', lang)} aria-label={t('dojo.editStep', lang)} onClick={() => edit(step)}><Pencil size={13} /></button>
          </div>
          {expanded && <div className="dojo-plan-detail">
            {editing && draft ? <form onSubmit={event => { event.preventDefault(); save() }} className="dojo-step-form">
              <label>{t('dojo.taskTitle', lang)}<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} required disabled={disabled} /></label>
              <label>{t('dojo.stepGoal', lang)}<textarea value={draft.goal} onChange={event => setDraft({ ...draft, goal: event.target.value })} rows={2} disabled={disabled} /></label>
              <label>{t('dojo.stepFiles', lang)}<textarea value={draft.files} onChange={event => setDraft({ ...draft, files: event.target.value })} rows={2} disabled={disabled} spellCheck={false} /></label>
              <label>{t('dojo.verifyCommand', lang)}<input value={draft.verifyCommand} onChange={event => setDraft({ ...draft, verifyCommand: event.target.value })} disabled={disabled} spellCheck={false} /></label>
              <p className="dojo-helper">{t('dojo.commandHelp', lang)}</p>
              <label>{t('dojo.acceptance', lang)}<textarea value={draft.criteria} onChange={event => setDraft({ ...draft, criteria: event.target.value })} rows={3} disabled={disabled} required /></label>
              <p className="dojo-helper">{t('dojo.criteriaHelp', lang)}</p>
              <div className="dojo-action-row"><button type="submit" className="dojo-primary" disabled={disabled || !draft.title.trim() || !lines(draft.criteria).length}>{t('dojo.savePlan', lang)}</button><button type="button" className="dojo-secondary" onClick={() => { setEditingId(null); setDraft(null) }}><X size={12} />{t('cancel', lang)}</button></div>
            </form> : <>
              {step.goal && <p>{step.goal}</p>}
              <div className="dojo-file-links">{step.files.map(path => <button type="button" key={path} onClick={() => onOpenFile(path)} title={path}><FileText size={12} /><span>{path}</span></button>)}</div>
              {step.verifyCommand && <code className="dojo-command-text">{step.verifyCommand}</code>}
              <ul className="dojo-criteria-list">{(step.acceptanceCriteria ?? []).map(item => <li key={item}>{item}</li>)}</ul>
              {session.status !== 'planning' && <button type="button" className="dojo-secondary" disabled={disabled} onClick={() => useDojoStore.getState().selectStep(step.id)}>{t('dojo.workOnStep', lang)}</button>}
            </>}
          </div>}
        </li>
      })}
    </ol>
    {session.status === 'planning' && session.steps.length > 0 && <button type="button" className="dojo-primary dojo-full" disabled={disabled || Boolean(editingId) || session.steps.some(step => !step.acceptanceCriteria?.length)} onClick={onStart}>{t('dojo.confirmStart', lang)}<ChevronRight size={14} /></button>}
  </div>
}
