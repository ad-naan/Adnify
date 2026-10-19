/**
 * Dojo（道场）工作台 —— 手艺训练模式的全屏界面
 *
 * 三栏：
 * - 左：任务阶梯 + 手艺图谱
 * - 中：学员专属编辑器（AI 写入锁定的物理体现：这里的一切改动只来自键盘）
 * - 右：导师面板（示范 / 分级提示 / 双门禁 / 复盘）
 *
 * 复用：Agent 循环（导师 = 隐藏线程只读代理）、终端执行（第一门禁）、
 * Monaco（loader 已由主编辑器配置，这里幂等再配一次）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import MonacoEditor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { GraduationCap, X, Play, ChevronRight, Lightbulb, Terminal, RotateCcw, Save } from 'lucide-react'
import { t, tDynamic, asLanguage } from '@shared/i18n'
import { useStore } from '@/renderer/store'
import { useModeStore } from '@/renderer/modes/modeStore'
import { api } from '@/renderer/services/electronAPI'
import { useDojoStore } from './DojoStore'
import {
  decomposeRequirement,
  demonstrateStep,
  diagnoseFailure,
  disposeVerifyTerminal,
  gradeAnswer,
  quizForStep,
  reviewStep,
  runVerification,
} from './DojoService'
import type { DojoStep, DojoStepPhase } from './types'

loader.config({ monaco })

const PHASE_LABEL: Record<DojoStepPhase, string> = {
  demo: 'dojo.phaseDemo',
  handsOn: 'dojo.phaseHandsOn',
  quiz: 'dojo.phaseQuiz',
  review: 'dojo.phaseReview',
  passed: 'dojo.phasePassed',
}

/** 静态字面量引用：locale parity 测试通过扫描源码引号字面量识别键 */
const MASTERY_LABEL: Record<string, string> = {
  learning: 'dojo.mastery.learning',
  passed: 'dojo.mastery.passed',
  mastered: 'dojo.mastery.mastered',
}

const HINT_LABEL: string[] = ['dojo.hintLevel.1', 'dojo.hintLevel.2', 'dojo.hintLevel.3']

function joinPath(workspacePath: string, relative: string): string {
  const clean = relative.replace(/^[./\\]+/, '').replace(/\\/g, '/')
  return `${workspacePath.replace(/[\\/]+$/, '')}/${clean}`
}

export default function DojoWorkbench() {
  const language = useStore(state => state.language)
  const lang = asLanguage(language)
  const workspacePath = useStore(state => state.workspacePath) ?? ''
  const setMode = useModeStore(state => state.setMode)

  const session = useDojoStore(state => state.session)
  const skills = useDojoStore(state => state.skills)
  const mentorBusy = useDojoStore(state => state.mentorBusy)
  const verifyResult = useDojoStore(state => state.verifyResult)
  const error = useDojoStore(state => state.error)

  const step = useMemo<DojoStep | null>(() => {
    if (!session || !session.steps.length) return null
    return session.steps[Math.min(session.currentStepIndex, session.steps.length - 1)] ?? null
  }, [session])

  const exitDojo = useCallback(() => {
    setMode('agent')
  }, [setMode])

  useEffect(() => () => { void disposeVerifyTerminal() }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent text-text-primary">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-2">
        <div className="flex items-center gap-2 text-accent">
          <GraduationCap size={18} />
          <span className="text-sm font-semibold">{t('dojo.title', lang)}</span>
        </div>
        <span className="truncate text-xs text-text-muted">
          {session ? session.requirement : t('dojo.tagline', lang)}
        </span>
        <span className="ml-auto rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] text-amber-400">
          {t('dojo.aiWriteLock', lang)}
        </span>
        <button
          onClick={exitDojo}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <X size={14} />
          {t('dojo.exit', lang)}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {!session ? (
          <StartScreen />
        ) : !step ? (
          <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
            {t('dojo.emptySteps', lang)}
          </div>
        ) : (
          <>
            {/* 左栏：阶梯 + 手艺图谱 */}
            <aside className="flex w-60 shrink-0 flex-col border-r border-border/60">
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t('dojo.ladder', lang)}
                </h2>
                <ol className="space-y-1.5">
                  {session.steps.map((item, index) => {
                    const isCurrent = index === session.currentStepIndex
                    return (
                      <li
                        key={item.id}
                        className={`rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                          isCurrent
                            ? 'border-accent/50 bg-accent/10 text-text-primary'
                            : item.phase === 'passed'
                              ? 'border-transparent bg-surface/30 text-text-muted'
                              : 'border-transparent bg-surface/20 text-text-secondary'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`tabular-nums ${isCurrent ? 'text-accent' : 'text-text-muted'}`}>
                            {item.phase === 'passed' ? '✓' : index + 1}
                          </span>
                          <span className="truncate">{item.title}</span>
                        </div>
                        {isCurrent && (
                          <div className="mt-1 text-[10px] text-text-muted">
                            {tDynamic(PHASE_LABEL[item.phase], lang, PHASE_LABEL[item.phase])}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </div>
              <div className="border-t border-border/60 p-3">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t('dojo.skillGraph', lang)}
                </h2>
                {skills.length === 0 ? (
                  <p className="text-[11px] text-text-muted">{t('dojo.skillEmpty', lang)}</p>
                ) : (
                  <ul className="space-y-1">
                    {skills.map(skill => (
                      <li key={skill.id} className="flex items-center justify-between text-[11px]">
                        <span className="truncate text-text-secondary">{skill.name}</span>
                        <span
                          className={`ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${
                            skill.mastery === 'mastered'
                              ? 'bg-emerald-400/10 text-emerald-400'
                              : skill.mastery === 'passed'
                                ? 'bg-accent/10 text-accent'
                                : 'bg-surface-hover text-text-muted'
                          }`}
                        >
                          {tDynamic(MASTERY_LABEL[skill.mastery] ?? skill.mastery, lang, skill.mastery)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>

            {/* 中栏：学员编辑器 */}
            <LearnerEditor workspacePath={workspacePath} step={step} language={lang} />

            {/* 右栏：导师面板 */}
            <MentorPanel
              step={step}
              workspacePath={workspacePath}
              language={lang}
              mentorBusy={mentorBusy}
              verifyResult={verifyResult}
              error={error}
            />
          </>
        )}
      </div>
    </div>
  )
}

/* ==================== 开始屏 ==================== */

function StartScreen() {
  const language = useStore(state => state.language)
  const lang = asLanguage(language)
  const workspacePath = useStore(state => state.workspacePath)
  const startSession = useDojoStore(state => state.startSession)
  const setMentorBusy = useDojoStore(state => state.setMentorBusy)
  const setError = useDojoStore(state => state.setError)
  const error = useDojoStore(state => state.error)
  const busy = useDojoStore(state => state.mentorBusy)
  const [requirement, setRequirement] = useState('')

  const handleStart = useCallback(async () => {
    const trimmed = requirement.trim()
    if (!trimmed || !workspacePath) return
    setMentorBusy(true)
    setError(null)
    try {
      const steps = await decomposeRequirement(trimmed, workspacePath)
      startSession({
        id: crypto.randomUUID(),
        requirement: trimmed,
        steps: steps.map(({ skill: _skill, ...step }) => step),
        currentStepIndex: 0,
        createdAt: Date.now(),
      })
      // 技能先记为 learning，结业时按表现升级
      const { recordSkill } = useDojoStore.getState()
      for (const item of steps) recordSkill(item.skill, 'learning')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMentorBusy(false)
    }
  }, [requirement, workspacePath, startSession, setMentorBusy, setError])

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold">{t('dojo.startTitle', lang)}</h1>
      <p className="text-sm leading-relaxed text-text-secondary">{t('dojo.startDesc', lang)}</p>
      <textarea
        value={requirement}
        onChange={event => setRequirement(event.target.value)}
        placeholder={t('dojo.requirementPlaceholder', lang)}
        rows={5}
        className="w-full resize-none rounded-xl border border-border/60 bg-surface/40 px-3 py-2.5 text-sm outline-none placeholder:text-text-muted focus:border-accent/50"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        onClick={() => void handleStart()}
        disabled={busy || !requirement.trim() || !workspacePath}
        className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      >
        {busy ? t('dojo.decomposing', lang) : t('dojo.startTraining', lang)}
      </button>
    </div>
  )
}

/* ==================== 学员编辑器 ==================== */

function LearnerEditor({ workspacePath, step, language }: {
  workspacePath: string
  step: DojoStep
  language: string
}) {
  const lang = asLanguage(language)
  const [relativePath, setRelativePath] = useState(step.files[0] ?? '')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    setRelativePath(step.files[0] ?? '')
    setStatus(null)
  }, [step.id, step.files])

  const open = useCallback(async () => {
    const trimmed = relativePath.trim()
    if (!trimmed || !workspacePath) return
    setStatus(null)
    const text = await api.file.readFull(joinPath(workspacePath, trimmed))
    if (text === null || text === undefined) {
      setStatus(t('dojo.fileNotFound', lang))
      return
    }
    setContent(text)
    setDirty(false)
  }, [relativePath, workspacePath, lang])

  const save = useCallback(async () => {
    const trimmed = relativePath.trim()
    if (!trimmed || !workspacePath) return
    const result = await api.file.writeDetailed(joinPath(workspacePath, trimmed), content)
    setStatus(result?.success ? t('dojo.saved', lang) : t('dojo.saveFailed', lang))
    if (result?.success) setDirty(false)
  }, [relativePath, workspacePath, content, lang])

  // 步骤切换时自动打开第一个涉及的文件
  useEffect(() => {
    void open()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id])

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <input
          value={relativePath}
          onChange={event => setRelativePath(event.target.value)}
          placeholder={t('dojo.filePathPlaceholder', lang)}
          className="min-w-0 flex-1 rounded-lg border border-border/50 bg-surface/30 px-2 py-1 font-mono text-xs outline-none focus:border-accent/50"
        />
        {step.files.length > 1 && (
          <div className="flex shrink-0 gap-1">
            {step.files.slice(0, 4).map(file => (
              <button
                key={file}
                onClick={() => setRelativePath(file)}
                title={file}
                className={`max-w-28 truncate rounded px-1.5 py-1 text-[10px] transition-colors ${
                  relativePath === file ? 'bg-accent/10 text-accent' : 'bg-surface/40 text-text-muted hover:bg-surface-hover'
                }`}
              >
                {file}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => void save()}
          disabled={!dirty}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
        >
          <Save size={12} />
          {t('dojo.save', lang)}
        </button>
        {status && <span className="shrink-0 text-[10px] text-text-muted">{status}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <MonacoEditor
          height="100%"
          theme="adnify-dynamic"
          language={guessLanguage(relativePath)}
          value={content}
          onChange={value => {
            setContent(value ?? '')
            setDirty(true)
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </section>
  )
}

function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown',
    py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
    sh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql',
  }
  return map[ext] ?? 'plaintext'
}

/* ==================== 导师面板 ==================== */

function MentorPanel({ step, workspacePath, language, mentorBusy, verifyResult, error }: {
  step: DojoStep
  workspacePath: string
  language: string
  mentorBusy: boolean
  verifyResult: { success: boolean; exitCode: number | null; output: string; ranAt: number } | null
  error: string | null
}) {
  const lang = asLanguage(language)
  const updateStep = useDojoStore(state => state.updateStep)
  const revealHint = useDojoStore(state => state.revealHint)
  const advanceStep = useDojoStore(state => state.advanceStep)
  const setMentorBusy = useDojoStore(state => state.setMentorBusy)
  const setVerifyResult = useDojoStore(state => state.setVerifyResult)
  const setError = useDojoStore(state => state.setError)
  const recordSkill = useDojoStore(state => state.recordSkill)
  const session = useDojoStore(state => state.session)

  const [answer, setAnswer] = useState('')
  useEffect(() => { setAnswer('') }, [step.id, step.quiz?.question])

  const runMentor = useCallback(async (label: string, fn: () => Promise<void>) => {
    setMentorBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(`${label}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setMentorBusy(false)
    }
  }, [setMentorBusy, setError])

  const handleDemo = () => runMentor(t('dojo.demo', lang), async () => {
    const demo = await demonstrateStep(step, session?.requirement ?? '', workspacePath)
    updateStep(step.id, { demo })
  })

  const handleBeginHandsOn = () => updateStep(step.id, { phase: 'handsOn' })

  const handleVerify = () => runMentor(t('dojo.verify', lang), async () => {
    const result = await runVerification(step.verifyCommand, workspacePath)
    setVerifyResult(result)
    if (result.success) updateStep(step.id, { phase: 'quiz' })
  })

  const handleDiagnose = () => runMentor(t('dojo.diagnose', lang), async () => {
    const diagnosis = await diagnoseFailure(step, verifyResult?.output ?? '', workspacePath)
    setVerifyResult({ ...(verifyResult ?? { success: false, exitCode: null, output: '', ranAt: Date.now() }), output: diagnosis, ranAt: Date.now() })
  })

  const handleQuiz = () => runMentor(t('dojo.quiz', lang), async () => {
    const question = await quizForStep(step, workspacePath)
    updateStep(step.id, { quiz: { question, attempts: 0, passed: false } })
  })

  const handleGrade = () => runMentor(t('dojo.grade', lang), async () => {
    if (!step.quiz) return
    const graded = await gradeAnswer(step, step.quiz.question, answer, workspacePath)
    updateStep(step.id, {
      quiz: {
        ...step.quiz,
        lastAnswer: answer,
        attempts: step.quiz.attempts + 1,
        passed: graded.passed,
        feedback: graded.feedback,
      },
      ...(graded.passed ? { phase: 'review' as const } : {}),
    })
  })

  const handleReview = () => runMentor(t('dojo.review', lang), async () => {
    const review = await reviewStep(step, session?.requirement ?? '', workspacePath)
    updateStep(step.id, { review, phase: 'passed' })
  })

  const handleAdvance = () => {
    // 结业：零提示 = 掌握，否则 = 及格
    const mastery = step.hintsRevealed === 0 ? 'mastered' : 'passed'
    recordSkill(step.goal || step.title, mastery)
    advanceStep()
  }

  const primaryButton = 'flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40'
  const ghostButton = 'flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-surface/40 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40'

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border/60">
      <div className="border-b border-border/60 px-4 py-2.5">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          {t('dojo.stepN', lang, { index: (session?.currentStepIndex ?? 0) + 1, total: session?.steps.length ?? 0 })}
        </div>
        <h2 className="text-sm font-semibold">{step.title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{step.goal}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {error && (
          <p className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-400">{error}</p>
        )}

        {/* —— 示范阶段 —— */}
        {step.phase === 'demo' && (
          <section className="space-y-3">
            <button onClick={() => void handleDemo()} disabled={mentorBusy} className={primaryButton}>
              <Play size={13} />
              {mentorBusy ? t('dojo.mentorThinking', lang) : step.demo ? t('dojo.redemo', lang) : t('dojo.requestDemo', lang)}
            </button>
            {step.demo && (
              <>
                <Markdown className="rounded-xl border border-border/50 bg-surface/30 p-3 text-xs leading-relaxed">{step.demo}</Markdown>
                <button onClick={handleBeginHandsOn} disabled={mentorBusy} className={primaryButton}>
                  <ChevronRight size={13} />
                  {t('dojo.startHandsOn', lang)}
                </button>
              </>
            )}
          </section>
        )}

        {/* —— 动手阶段 —— */}
        {step.phase === 'handsOn' && (
          <section className="space-y-3">
            <p className="text-xs text-text-secondary">{t('dojo.handsOnHint', lang)}</p>

            {step.hints.length > 0 && (
              <div className="space-y-1.5">
                {step.hints.slice(0, step.hintsRevealed).map((hint, index) => (
                  <div key={index} className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs leading-relaxed text-text-secondary">
                    <span className="mr-1 font-semibold text-amber-400">
                      {tDynamic(HINT_LABEL[index] ?? `L${index + 1}`, lang, `L${index + 1}:`)}
                    </span>
                    {hint}
                  </div>
                ))}
                {step.hintsRevealed < step.hints.length && (
                  <button onClick={() => revealHint(step.id)} className={ghostButton}>
                    <Lightbulb size={13} />
                    {t('dojo.revealHint', lang, { level: step.hintsRevealed + 1, total: step.hints.length })}
                  </button>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border/50 bg-surface/30 px-3 py-2 font-mono text-[11px] text-text-muted">
              <div className="mb-1 flex items-center gap-1"><Terminal size={11} />{t('dojo.verifyCommand', lang)}</div>
              <div className="text-text-secondary">{step.verifyCommand || '—'}</div>
            </div>

            <button onClick={() => void handleVerify()} disabled={mentorBusy} className={primaryButton}>
              <Terminal size={13} />
              {mentorBusy ? t('dojo.verifying', lang) : t('dojo.runVerify', lang)}
            </button>

            {verifyResult && !verifyResult.success && (
              <div className="space-y-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-red-400/40 bg-red-400/[0.06] p-3 text-[11px] text-text-secondary">
                  {verifyResult.output || t('dojo.verifyFailedNoOutput', lang)}
                </pre>
                <button onClick={() => void handleDiagnose()} disabled={mentorBusy} className={ghostButton}>
                  <RotateCcw size={13} />
                  {t('dojo.askDiagnosis', lang)}
                </button>
              </div>
            )}
          </section>
        )}

        {/* —— 抽问阶段（第二门禁） —— */}
        {step.phase === 'quiz' && (
          <section className="space-y-3">
            <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/[0.08] px-3 py-2 text-xs text-emerald-400">
              ✓ {t('dojo.verifyPassed', lang)}
            </div>
            {!step.quiz ? (
              <button onClick={() => void handleQuiz()} disabled={mentorBusy} className={primaryButton}>
                {mentorBusy ? t('dojo.mentorThinking', lang) : t('dojo.requestQuiz', lang)}
              </button>
            ) : (
              <>
                <div className="rounded-xl border border-accent/40 bg-accent/[0.06] px-3 py-2.5 text-xs leading-relaxed text-text-primary">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-accent">{t('dojo.mentorQuiz', lang)}</div>
                  {step.quiz.question}
                </div>
                <textarea
                  value={answer}
                  onChange={event => setAnswer(event.target.value)}
                  placeholder={t('dojo.answerPlaceholder', lang)}
                  rows={4}
                  disabled={step.quiz.passed}
                  className="w-full resize-none rounded-xl border border-border/50 bg-surface/30 px-3 py-2 text-xs outline-none placeholder:text-text-muted focus:border-accent/50"
                />
                {!step.quiz.passed && (
                  <button onClick={() => void handleGrade()} disabled={mentorBusy || !answer.trim()} className={primaryButton}>
                    {mentorBusy ? t('dojo.grading', lang) : t('dojo.submitAnswer', lang)}
                  </button>
                )}
                {step.quiz.attempts > 0 && step.quiz.feedback && (
                  <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${step.quiz.passed ? 'border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-400' : 'border-amber-400/40 bg-amber-400/[0.06] text-amber-400'}`}>
                    {step.quiz.feedback}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* —— 复盘阶段 —— */}
        {step.phase === 'review' && (
          <section className="space-y-3">
            <button onClick={() => void handleReview()} disabled={mentorBusy} className={primaryButton}>
              {mentorBusy ? t('dojo.mentorThinking', lang) : t('dojo.requestReview', lang)}
            </button>
          </section>
        )}

        {/* —— 结业 —— */}
        {step.phase === 'passed' && step.review && (
          <section className="space-y-3">
            <Markdown className="rounded-xl border border-border/50 bg-surface/30 p-3 text-xs leading-relaxed">{step.review}</Markdown>
            {session && session.currentStepIndex < session.steps.length - 1 && (
              <button onClick={handleAdvance} className={primaryButton}>
                <ChevronRight size={13} />
                {t('dojo.nextStep', lang)}
              </button>
            )}
            {session && session.currentStepIndex >= session.steps.length - 1 && (
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/[0.08] px-3 py-3 text-xs text-emerald-400">
                {t('dojo.trainingComplete', lang)}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}

function Markdown({ className, children }: { className?: string; children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} className={className}>
      {children}
    </ReactMarkdown>
  )
}
