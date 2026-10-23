import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowUp, Check, CheckCheck, ChevronRight, FileText, GraduationCap, Lightbulb, ListTodo, LockKeyhole, MessageSquare, Play, Plus, RotateCcw, Square, Terminal, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '@/renderer/store'
import { useModeStore } from '@/renderer/modes/modeStore'
import { api } from '@/renderer/services/electronAPI'
import { flushEditorBufferSnapshots } from '@/renderer/services/editorBufferService'
import { validatePath, pathEquals, pathStartsWith } from '@shared/utils/pathUtils'
import { t, asLanguage } from '@shared/i18n'
import { globalConfirm } from '@/renderer/components/common/ConfirmDialog'
import { useDojoStore, canCompleteDojoStep, isFreshVerification } from './DojoStore'
import { askDojoMentor, cancelDojoOperation, checkDojoVerificationSnapshot, createDojoSession, decomposeRequirement, demonstrateStep, diagnoseFailure, observeDojoWorkspace, quizForStep, reviewStep, reviseDojoPlan, runVerification } from './DojoService'
import DojoMentorFeed from './DojoMentorFeed'
import DojoPlanView from './DojoPlanView'
import type { DojoMessage, DojoSession, DojoStep } from './types'
import './dojo.css'

const exampleKeys = ['dojo.example.1', 'dojo.example.2', 'dojo.example.3'] as const

/** A mentor panel in the normal workbench, not a second editor/IDE. */
export default function DojoWorkbench() {
  const workspacePath = useStore(state => state.workspacePath) ?? ''
  const language = asLanguage(useStore(state => state.language))
  const selectedCode = useStore(state => state.selectedCode)
  const activeFilePath = useStore(state => state.activeFilePath)
  const llmConfig = useStore(state => state.llmConfig)
  const currentMode = useModeStore(state => state.currentMode)
  const session = useDojoStore(state => state.session)
  const legacySession = useDojoStore(state => state.legacySession)
  const busy = useDojoStore(state => state.mentorBusy)
  const threadId = useDojoStore(state => state.activeMentorThreadId)
  const error = useDojoStore(state => state.error)
  const skills = useDojoStore(state => state.skills)
  const [view, setView] = useState<'conversation' | 'plan'>('conversation')
  const [requirement, setRequirement] = useState('')
  const [input, setInput] = useState('')
  const [includeSelection, setIncludeSelection] = useState(false)
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null)
  const operationRef = useRef(false)
  const seqRef = useRef(0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const followsTail = useRef(true)
  const step = session?.steps[session.currentStepIndex]

  useEffect(() => {
    useDojoStore.getState().selectWorkspace(workspacePath)
    if (!workspacePath || currentMode !== 'dojo') return
    const unsubscribe = observeDojoWorkspace(workspacePath)
    return () => { seqRef.current += 1; cancelDojoOperation(); unsubscribe(); operationRef.current = false; useDojoStore.getState().setMentorBusy(false) }
  }, [workspacePath, currentMode])

  useEffect(() => { setInput(''); setRetry(null); setView(session?.status === 'planning' && session.steps.length ? 'plan' : 'conversation'); followsTail.current = true }, [session?.id])
  useEffect(() => { setIncludeSelection(false) }, [activeFilePath])
  useEffect(() => {
    if (followsTail.current && timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight
  }, [session?.messages, threadId, view, step?.id])

  // Restore persisted evidence conservatively: content may have changed while Dojo was closed.
  useEffect(() => {
    if (!session || !step?.verification || step.verification.stale || currentMode !== 'dojo') return
    const sessionId = session.id
    let alive = true
    void checkDojoVerificationSnapshot(step, workspacePath).then(valid => {
      if (alive && !valid && useDojoStore.getState().session?.id === sessionId) useDojoStore.getState().invalidateVerification()
    }).catch(() => {
      if (alive && useDojoStore.getState().session?.id === sessionId) useDojoStore.getState().invalidateVerification()
    })
    return () => { alive = false }
  }, [session?.id, step?.id, currentMode, workspacePath])

  const runOperation = useCallback(async (work: () => Promise<void>) => {
    if (operationRef.current) return
    operationRef.current = true
    const seq = ++seqRef.current
    const state = useDojoStore.getState()
    state.setMentorBusy(true); state.setError(null)
    setRetry(null)
    try { await work() } catch (err) {
      if (seq === seqRef.current) {
        useDojoStore.getState().setError(err instanceof Error ? err.message : String(err))
        setRetry(() => work)
      }
    } finally {
      if (seq === seqRef.current) { operationRef.current = false; useDojoStore.getState().setMentorBusy(false) }
    }
  }, [])

  const stop = () => {
    seqRef.current += 1; cancelDojoOperation(); operationRef.current = false
    useDojoStore.getState().setMentorBusy(false)
  }

  const newTraining = async () => {
    if (session) {
      const ok = await globalConfirm({ title: t('dojo.confirmNewTrainingTitle', language), message: t('dojo.confirmNewTrainingDesc', language), confirmText: t('dojo.newTraining', language), cancelText: t('dojo.continueTraining', language), variant: 'warning' })
      if (!ok) return
    }
    stop(); useDojoStore.getState().resetSession(); setRequirement(''); setInput(''); setRetry(null); setView('conversation')
  }
  const exit = () => { stop(); useModeStore.getState().restorePreviousMode(); if (useModeStore.getState().currentMode === 'dojo') useModeStore.getState().setMode('agent') }

  const openFile = async (path: string) => {
    const checked = validatePath(path, workspacePath)
    if (!checked.valid || !checked.sanitizedPath) { useDojoStore.getState().setError(checked.error || t('dojo.invalidFile', language)); return }
    const fullPath = checked.sanitizedPath
    const state = useStore.getState()
    const existing = state.openFiles.find(file => pathEquals(file.path, fullPath))
    if (existing) { state.setActiveFile(existing.path); state.setEditorVisible(true); return }
    try {
      const content = await api.file.readFull(fullPath)
      if (!pathEquals(workspacePath, useStore.getState().workspacePath ?? '')) return
      state.openFile(fullPath, content ?? '')
      state.setEditorVisible(true)
    } catch (err) { useDojoStore.getState().setError(String(err)) }
  }

  const applyPlan = (result: { briefing: string; steps: DojoStep[] }) => {
    useDojoStore.getState().replacePlan(result.steps, result.briefing)
    useDojoStore.getState().appendMessage({ role: 'mentor', content: result.briefing || t('dojo.planReady', language) })
    setView('plan')
  }
  const start = () => {
    const text = requirement.trim()
    if (!text || !workspacePath || !llmConfig) return
    const draft = createDojoSession(text, workspacePath)
    useDojoStore.getState().startSession(draft)
    useDojoStore.getState().appendMessage({ role: 'user', content: text })
    const work = async () => { const result = await decomposeRequirement(text, workspacePath); if (useDojoStore.getState().session?.id === draft.id) applyPlan(result) }
    void runOperation(work)
  }
  const beginPlan = () => {
    useDojoStore.getState().updateSession({ status: 'active' })
    for (const item of session?.steps ?? []) useDojoStore.getState().recordSkill(item.skill || item.goal || item.title, 'learning')
    useDojoStore.getState().appendMessage({ role: 'system', content: t('dojo.trainingStarted', language) })
    setView('conversation')
    const first = session?.steps[0]?.files[0]
    if (first) void openFile(first)
  }

  const mentorAction = (label: string, work: () => Promise<string>, kind: DojoMessage['kind'] = 'conversation') => {
    if (!session) return
    const sessionId = session.id, stepId = step?.id, revision = session.codeRevision ?? 0
    useDojoStore.getState().appendMessage({ role: 'user', content: label, stepId })
    setView('conversation')
    void runOperation(async () => {
      const reply = await work()
      if (useDojoStore.getState().session?.id !== sessionId) return
      useDojoStore.getState().appendMessage({ role: 'mentor', content: reply, kind, stepId, codeRevision: revision })
      if (stepId && kind === 'demo') useDojoStore.getState().updateStep(stepId, { demo: reply })
      if (stepId && kind === 'review') useDojoStore.getState().updateStep(stepId, { review: reply })
    })
  }
  const send = () => {
    const text = input.trim()
    if (!text || !session || busy) return
    setInput('')
    if (view === 'plan' || session.status === 'planning') {
      const sessionId = session.id
      useDojoStore.getState().appendMessage({ role: 'user', content: text })
      void runOperation(async () => { const result = await reviseDojoPlan(text, workspacePath); if (useDojoStore.getState().session?.id === sessionId) applyPlan(result) })
    } else mentorAction(text, () => askDojoMentor(text, workspacePath, step, includeSelection))
  }

  const revealHint = () => {
    if (!step) return
    const hint = step.hints[step.hintsRevealed]
    if (!hint) { mentorAction(t('dojo.giveHint', language), () => askDojoMentor('I am stuck. Inspect my current code and give one small directional hint, no full solution.', workspacePath, step)); return }
    useDojoStore.getState().revealHint(step.id)
    useDojoStore.getState().appendMessage({ role: 'mentor', content: hint, stepId: step.id, kind: 'hint' })
    setView('conversation')
  }
  const verify = () => {
    if (!session || !step) return
    const sessionId = session.id, task = step
    setView('conversation')
    void runOperation(async () => {
      const result = await runVerification(task.verifyCommand, workspacePath, task)
      if (useDojoStore.getState().session?.id !== sessionId) return
      useDojoStore.getState().setVerifyResult(result)
      const stored = useDojoStore.getState().session?.steps.find(item => item.id === task.id)?.verification
      useDojoStore.getState().appendMessage({ role: 'system', stepId: task.id, kind: 'verification', content: `${t(stored?.stale ? 'dojo.verifyStale' : result.success ? 'dojo.verifyPassed' : 'dojo.verifyFailed', language)}\n${task.verifyCommand}` })
    })
  }
  const complete = () => {
    if (!session || !step) return
    const sessionId = session.id, task = step
    void runOperation(async () => {
      flushEditorBufferSnapshots()
      if (useStore.getState().openFiles.some(file => !file.remote && pathStartsWith(file.path, workspacePath) && file.isDirty)) throw new Error(t('dojo.saveBeforeVerify', language))
      if (task.verifyCommand && !await checkDojoVerificationSnapshot(task, workspacePath)) {
        useDojoStore.getState().invalidateVerification(); throw new Error(t('dojo.verifyStale', language))
      }
      if (useDojoStore.getState().session?.id !== sessionId) return
      if (!useDojoStore.getState().completeStep(task.id)) throw new Error(t('dojo.completeRequirements', language))
      useDojoStore.getState().appendMessage({ role: 'system', stepId: task.id, content: `${t('dojo.taskCompleted', language)} · ${task.title}` })
    })
  }

  const fresh = session && step ? isFreshVerification(session, step) : false
  const ready = session && step ? canCompleteDojoStep(session, step) : false
  const done = session?.steps.filter(item => item.phase === 'passed').length ?? 0
  const messages = session?.messages ?? []
  const selectionAvailable = Boolean(selectedCode && activeFilePath)

  return <section className="dojo-surface" data-dojo-panel>
    <header className="dojo-header">
      <div className="dojo-brand"><GraduationCap size={19} /><span>{t('dojo.title', language)}<small>{t('dojo.mentorLabel', language)}</small></span></div>
      <div className="dojo-header-actions"><button type="button" className="dojo-icon-button" onClick={() => void newTraining()} aria-label={t('dojo.newTraining', language)} title={t('dojo.newTraining', language)} disabled={busy}><Plus size={16} /></button><button type="button" className="dojo-icon-button" onClick={exit} aria-label={t('dojo.exit', language)} title={t('dojo.exit', language)}><X size={16} /></button></div>
    </header>
    <div className="dojo-permission"><LockKeyhole size={12} /><span>{t('dojo.aiWriteLock', language)}</span><span className="dojo-workspace" title={workspacePath}>{workspacePath.split(/[\\/]/).filter(Boolean).pop()}</span></div>
    {session && <div className="dojo-session-bar">
      <p title={session.requirement}>{session.requirement}</p>
      <div className="dojo-session-progress"><span>{t('dojo.stepsDone', language, { done, total: session.steps.length })}</span><div><span style={{ width: `${session.steps.length ? done / session.steps.length * 100 : 0}%` }} /></div></div>
      <nav className="dojo-view-tabs" aria-label={t('dojo.trainingViews', language)}><button type="button" aria-pressed={view === 'conversation'} onClick={() => setView('conversation')}><MessageSquare size={13} />{t('dojo.conversation', language)}</button><button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><ListTodo size={13} />{t('dojo.planTab', language)}<span>{session.steps.length}</span></button></nav>
    </div>}
    {error && <div className="dojo-error" role="alert"><AlertTriangle size={14} /><div>{error}{retry && !busy && <button type="button" onClick={() => void runOperation(retry)}><RotateCcw size={12} />{t('dojo.retryOperation', language)}</button>}</div><button className="dojo-icon-button" type="button" aria-label={t('dojo.dismissError', language)} onClick={() => useDojoStore.getState().setError(null)}><X size={12} /></button></div>}

    {!session ? <div className="dojo-empty-scroll">
      <div className="dojo-empty">
        <div className="dojo-intro-icon"><GraduationCap size={31} /></div><p className="dojo-eyebrow">{t('dojo.tagline', language)}</p><h1>{t('dojo.startTitle', language)}</h1><p className="dojo-intro-desc">{t('dojo.startDesc', language)}</p>
        <ol className="dojo-intro-steps"><li><ListTodo size={14} />{t('dojo.planTab', language)}</li><ChevronRight size={12} /><li><FileText size={14} />{t('dojo.practice', language)}</li><ChevronRight size={12} /><li><CheckCheck size={14} />{t('dojo.feedback', language)}</li></ol>
        <form className="dojo-start-form" onSubmit={event => { event.preventDefault(); start() }}><textarea aria-label={t('dojo.requirementPlaceholder', language)} placeholder={t('dojo.requirementPlaceholder', language)} value={requirement} onChange={event => setRequirement(event.target.value)} rows={5} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); start() } }} /><div><span>{t('dojo.submitHint', language)}</span><button className="dojo-primary" type="submit" disabled={!requirement.trim() || !workspacePath || !llmConfig}>{t('dojo.startTraining', language)}<ChevronRight size={14} /></button></div></form>
        {!llmConfig && <p className="dojo-helper">{t('dojo.configRequired', language)}<button type="button" className="dojo-text-button" onClick={() => useStore.getState().setShowSettings(true)}>{t('dojo.openSettings', language)}</button></p>}
        {!workspacePath && <p className="dojo-helper">{t('dojo.workspaceMissing', language)}</p>}
        <div className="dojo-examples"><p>{t('dojo.examplesTitle', language)}</p>{exampleKeys.map(key => <button key={key} type="button" onClick={() => setRequirement(t(key, language))}>{t(key, language)}<ChevronRight size={12} /></button>)}</div>
        {legacySession && <div className="dojo-legacy"><p>{t('dojo.legacySession', language)}</p><strong>{legacySession.requirement}</strong><button type="button" className="dojo-secondary" onClick={() => useDojoStore.getState().adoptLegacySession(workspacePath)}>{t('dojo.restoreLegacy', language)}</button></div>}
      </div>
    </div> : <>
      <div className="dojo-main">
        {view === 'plan' ? <DojoPlanView session={session} language={language} disabled={busy} onOpenFile={path => void openFile(path)} onStart={beginPlan} /> : <>
          {step && session.status !== 'planning' && <TaskCard session={session} step={step} language={language} busy={busy} fresh={fresh} onOpenFile={path => void openFile(path)} onVerify={verify} onComplete={complete} ready={ready} onHint={revealHint} onDemo={() => mentorAction(t('dojo.requestDemo', language), () => demonstrateStep(step, session.requirement, workspacePath), 'demo')} onReview={() => mentorAction(t('dojo.requestReview', language), () => reviewStep(step, session.requirement, workspacePath), 'review')} onQuiz={() => mentorAction(t('dojo.requestQuiz', language), () => quizForStep(step, workspacePath))} onDiagnose={() => mentorAction(t('dojo.askDiagnosis', language), async () => { const text = await diagnoseFailure(step, step.verification?.output ?? '', workspacePath); useDojoStore.getState().updateStep(step.id, { diagnosis: text }); return text })} />}
          <div ref={timelineRef} className="dojo-timeline" onScroll={() => { const el = timelineRef.current; if (el) followsTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50 }} role="log" aria-label={t('dojo.conversation', language)}>
            {!messages.length && <p className="dojo-helper">{t('dojo.mentorWaiting', language)}</p>}
            {messages.map(item => <article key={item.id} className={`dojo-message dojo-message-${item.role}`}>
              <div className="dojo-message-meta">{t(item.role === 'mentor' ? 'dojo.mentorLabel' : item.role === 'user' ? 'dojo.you' : 'dojo.evidence', language)}{item.codeRevision !== undefined && item.codeRevision !== (session.codeRevision ?? 0) && <span>{t('dojo.earlierCode', language)}</span>}</div>
              <div className="dojo-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown></div>
            </article>)}
            {busy && threadId && <DojoMentorFeed threadId={threadId} language={language} />}
            {busy && !threadId && <p className="dojo-helper dojo-working">{t('dojo.working', language)}</p>}
            {session.status === 'completed' && <div className="dojo-summary"><CheckCheck size={20} /><h2>{t('dojo.trainingComplete', language)}</h2><p>{t('dojo.summaryHelp', language)}</p><div>{skills.filter(skill => session.steps.some(item => (item.skill || item.goal || item.title).toLowerCase() === skill.id)).map(skill => <span key={skill.id}>{skill.name}</span>)}</div></div>}
          </div>
        </>}
      </div>
      <form className="dojo-composer" onSubmit={event => { event.preventDefault(); send() }}>
        {selectionAvailable && <label className="dojo-selection"><input type="checkbox" checked={includeSelection} onChange={event => setIncludeSelection(event.target.checked)} />{t('dojo.includeSelection', language)}<span title={activeFilePath ?? ''}>{activeFilePath?.split(/[\\/]/).pop()}</span></label>}
        <textarea aria-label={t('dojo.askPlaceholder', language)} placeholder={t(view === 'plan' || session.status === 'planning' ? 'dojo.revisePlaceholder' : 'dojo.askPlaceholder', language)} value={input} onChange={event => setInput(event.target.value)} rows={3} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send() } }} />
        <div className="dojo-composer-footer"><span>{t('dojo.sendHint', language)}</span>{busy ? <button type="button" className="dojo-secondary" onClick={stop}><Square size={12} />{t('dojo.stop', language)}</button> : <button type="submit" className="dojo-primary" disabled={!input.trim() || !llmConfig}><ArrowUp size={14} />{t(view === 'plan' || session.status === 'planning' ? 'dojo.revisePlan' : 'dojo.send', language)}</button>}</div>
      </form>
    </>}
  </section>
}

function TaskCard({ session, step, language, busy, fresh, ready, onOpenFile, onVerify, onComplete, onHint, onDemo, onReview, onQuiz, onDiagnose }: {
  session: DojoSession; step: DojoStep; language: ReturnType<typeof asLanguage>; busy: boolean; fresh: boolean; ready: boolean | null;
  onOpenFile: (path: string) => void; onVerify: () => void; onComplete: () => void; onHint: () => void; onDemo: () => void; onReview: () => void; onQuiz: () => void; onDiagnose: () => void
}) {
  const result = step.verification
  return <div className="dojo-task">
    <div className="dojo-task-heading"><span>{t('dojo.stepN', language, { index: session.currentStepIndex + 1, total: session.steps.length })}</span><select aria-label={t('dojo.selectTask', language)} value={step.id} disabled={busy} onChange={event => useDojoStore.getState().selectStep(event.target.value)}>{session.steps.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title}{item.phase === 'passed' ? ' ✓' : ''}</option>)}</select></div>
    <h2>{step.title}</h2><p>{step.goal}</p><div className="dojo-file-links">{step.files.map(path => <button type="button" key={path} onClick={() => onOpenFile(path)} title={path}><FileText size={12} /><span>{path.split(/[\\/]/).pop()}</span></button>)}</div>
    <details className="dojo-task-details"><summary>{t('dojo.acceptance', language)}<span>{step.confirmedCriteria?.length ?? 0}/{step.acceptanceCriteria?.length ?? 0}</span></summary><p className="dojo-helper">{t('dojo.manualEvidence', language)}</p>{(step.acceptanceCriteria ?? []).map(item => <label key={item} className="dojo-criterion"><input type="checkbox" disabled={busy || step.phase === 'passed'} checked={step.confirmedCriteria?.includes(item) ?? false} onChange={event => useDojoStore.getState().updateStep(step.id, { confirmedCriteria: event.target.checked ? [...(step.confirmedCriteria ?? []), item] : (step.confirmedCriteria ?? []).filter(value => value !== item) })} /><span>{item}</span></label>)}
      {step.verifyCommand ? <div className="dojo-command"><Terminal size={12} /><code>{step.verifyCommand}</code></div> : <p className="dojo-helper">{t('dojo.manualOnly', language)}</p>}
      {result && <div className="dojo-verification" data-state={result.stale ? 'stale' : result.success ? 'success' : 'failed'}><p>{t(result.stale ? 'dojo.verifyStale' : result.success ? 'dojo.verifyPassed' : 'dojo.verifyFailed', language)} · {result.exitCode ?? '—'}</p><pre>{result.output || t('dojo.verifyNoOutput', language)}</pre>{!result.success && <button type="button" className="dojo-secondary" disabled={busy} onClick={onDiagnose}>{t('dojo.askDiagnosis', language)}</button>}</div>}
    </details>
    <div className="dojo-action-row">
      {step.phase === 'passed' ? <><span className="dojo-passed"><Check size={13} />{t('dojo.taskCompleted', language)}</span>{session.currentStepIndex < session.steps.length - 1 && <button type="button" className="dojo-primary" disabled={busy} onClick={() => useDojoStore.getState().advanceStep()}>{t('dojo.nextStep', language)}<ChevronRight size={13} /></button>}</> : <>
        {step.verifyCommand && <button type="button" className={fresh ? 'dojo-secondary' : 'dojo-primary'} disabled={busy} onClick={onVerify}><Play size={12} />{t('dojo.runVerify', language)}</button>}
        <button type="button" className={fresh || !step.verifyCommand ? 'dojo-primary' : 'dojo-secondary'} disabled={busy || !ready} onClick={onComplete} title={!ready ? t('dojo.completeRequirements', language) : undefined}><Check size={13} />{t('dojo.completeTask', language)}</button>
      </>}
      <button type="button" className="dojo-secondary" disabled={busy} onClick={onHint}><Lightbulb size={13} />{t('dojo.giveHint', language)}</button>
    </div>
    <details className="dojo-optional"><summary>{t('dojo.moreSupport', language)}</summary><div className="dojo-action-row"><button className="dojo-secondary" type="button" disabled={busy} onClick={onDemo}>{t('dojo.requestDemo', language)}</button><button className="dojo-secondary" type="button" disabled={busy} onClick={onQuiz}>{t('dojo.requestQuiz', language)}</button><button className="dojo-secondary" type="button" disabled={busy} onClick={onReview}>{t('dojo.requestReview', language)}</button></div></details>
  </div>
}
