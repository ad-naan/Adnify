/**
 * Dojo（道场）工作台 —— 手艺训练模式的全屏界面
 *
 * 四栏，从"看懂项目"到"学会这步"形成闭环：
 * 1. 最左：项目目录树（步骤涉及文件高亮）+ 手艺图谱 —— 学员随时掌握项目全貌
 * 2. 左二：拆解蓝图 + 训练阶梯 —— 为什么这样拆、每步的知识点/文件/验收
 * 3. 中间：学员专属编辑器（AI 写入锁定的物理体现：改动只来自键盘）
 * 4. 右侧：导师面板（示范 / 分级提示 / 双门禁 / 复盘）
 *
 * 拆解不再是黑盒 spinner：进入"勘察"阶段后订阅导师隐藏线程的消息流，
 * 实时展示它读了哪些文件、搜了什么、想了什么，结束后沉淀为蓝图供审阅。
 *
 * 复用：Agent 循环（导师 = 隐藏线程只读代理）、终端执行（第一门禁）、
 * 目录缓存（directoryCacheService）、Monaco（loader 已由主编辑器配置）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MonacoEditor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  GraduationCap,
  LayoutPanelLeft,
  Lightbulb,
  Loader2,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from 'lucide-react'
import { t, tDynamic, asLanguage } from '@shared/i18n'
import { useStore } from '@/renderer/store'
import { useModeStore } from '@/renderer/modes/modeStore'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { materializeThreadMessages } from '@/renderer/agent/types'
import type { AssistantMessage, ChatMessage } from '@/renderer/agent/types'
import { api } from '@/renderer/services/electronAPI'
import { globalConfirm } from '@/renderer/components/common/ConfirmDialog'
import FileIcon from '@/renderer/components/common/FileIcon'
import { useDojoStore } from './DojoStore'
import { DojoFileTree } from './DojoFileTree'
import {
  abortMentor,
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

/** 训练环的推进顺序：passed 表示整环已走完 */
const PHASE_ORDER: Record<DojoStepPhase, number> = {
  demo: 0,
  handsOn: 1,
  quiz: 2,
  review: 3,
  passed: 4,
}

/** 导师面板顶部的进度环（与 PHASE_ORDER 对齐） */
const PHASE_RAIL = [
  { phase: 'demo', label: 'dojo.rail.demo' },
  { phase: 'handsOn', label: 'dojo.rail.handsOn' },
  { phase: 'quiz', label: 'dojo.rail.quiz' },
  { phase: 'review', label: 'dojo.rail.review' },
] as const

/** 目录树/文件读取用的路径拼接 */
function joinPath(workspacePath: string, relative: string): string {
  const clean = relative.replace(/^[./\\]+/, '').replace(/\\/g, '/')
  return `${workspacePath.replace(/[\\/]+$/, '')}/${clean}`
}

/* ==================== 导师实时动态 ==================== */

interface MentorFeedItem {
  key: string
  kind: 'tool' | 'text'
  toolName?: string
  toolDetail?: string
  text?: string
  streaming?: boolean
}

const TOOL_ARG_KEYS = ['file_path', 'path', 'target_file', 'pattern', 'query', 'command', 'glob', 'url', 'symbol', 'name']

function truncate(value: string, max = 76): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 从工具参数里挑出人类最关心的那一个（文件名 / 搜索词 / 命令） */
function summarizeToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  for (const key of TOOL_ARG_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return truncate(value.trim())
    if (Array.isArray(value)) {
      const joined = value.filter((item): item is string => typeof item === 'string').join(', ')
      if (joined) return truncate(joined)
    }
  }
  const first = Object.values(args).find(value => typeof value === 'string' && value.trim())
  return typeof first === 'string' ? truncate(first) : ''
}

/**
 * 拆解回复末尾的阶梯 JSON 不属于"过程展示"，从流里切掉。
 * 只切 json 围栏（或包含 "steps" 的那个围栏），保留简报里的普通代码块。
 */
function stripTrailingJson(text: string): string {
  const jsonFence = text.search(/```json/i)
  if (jsonFence !== -1) return text.slice(0, jsonFence).trim()

  const stepsAt = text.indexOf('"steps"')
  if (stepsAt !== -1) {
    const fence = text.lastIndexOf('```', stepsAt)
    if (fence !== -1) return text.slice(0, fence).trim()
  }
  return text.trim()
}

function buildMentorFeed(messages: ChatMessage[]): MentorFeedItem[] {
  const items: MentorFeedItem[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const assistant = message as AssistantMessage
    if (assistant.parts.length === 0) {
      const text = stripTrailingJson(assistant.content ?? '')
      if (text) {
        items.push({ key: `${assistant.id}:content`, kind: 'text', text, streaming: assistant.isStreaming })
      }
      continue
    }
    assistant.parts.forEach((part, index) => {
      if (part.type === 'tool_call') {
        const toolCall = part.toolCall
        items.push({
          key: `${assistant.id}:tool:${toolCall.id || index}`,
          kind: 'tool',
          toolName: toolCall.name,
          toolDetail: summarizeToolArgs(toolCall.arguments),
        })
        return
      }
      if (part.type === 'text') {
        const text = stripTrailingJson(part.content ?? '')
        if (text) {
          items.push({ key: `${assistant.id}:text:${index}`, kind: 'text', text, streaming: assistant.isStreaming })
        }
      }
    })
  }
  return items
}

function MentorLiveFeed({ threadId, language }: { threadId: string | null; language: string }) {
  const lang = asLanguage(language)
  const thread = useAgentStore(state => (threadId ? state.threads[threadId] : undefined))
  // 流式期间权威内容是 liveAssistantMessage 覆盖层，thread.messages 是上一版快照
  const items = useMemo(
    () => (thread ? buildMentorFeed(materializeThreadMessages(thread)) : []),
    [thread],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastItem = items.length ? items[items.length - 1] : null
  const lastSignature = lastItem ? (lastItem.text ?? lastItem.toolDetail ?? '') : ''

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [items.length, lastSignature])

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3"
      aria-live="polite"
    >
      {items.length === 0 && (
        <p className="text-xs text-text-muted">{t('dojo.mentorWaiting', lang)}</p>
      )}
      {items.map(item => (
        item.kind === 'tool' ? (
          <div key={item.key} className="flex items-start gap-2 rounded-lg border border-border/40 bg-surface/25 px-2.5 py-1.5">
            <Wrench size={12} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-text-secondary">{item.toolName}</div>
              {item.toolDetail && (
                <div className="truncate font-mono text-[10px] text-text-muted" title={item.toolDetail}>
                  {item.toolDetail}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p key={item.key} className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
            {item.text}
            {item.streaming && (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle" />
            )}
          </p>
        )
      ))}
    </div>
  )
}

/* ==================== 主界面 ==================== */

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
  const resetSession = useDojoStore(state => state.resetSession)

  const [activeFile, setActiveFile] = useState('')
  const [treeTick, setTreeTick] = useState(0)
  const [panelsOpen, setPanelsOpen] = useState(true)
  /** 草稿可能属于别的步骤的文件：只告诉界面「有几份在等着保存」 */
  const [dirtyCount, setDirtyCount] = useState(0)
  const unsaved = dirtyCount > 0
  /** 用户手动开合过项目面板后，窗口缩放就不再替他做主 */
  const panelsPinned = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 窄窗口下「目录 + 蓝图 + 导师」会把编辑器挤成一条缝：先替用户收起，再把决定权交回
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth
      if (!panelsPinned.current) setPanelsOpen(width >= 1180)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const step = useMemo<DojoStep | null>(() => {
    if (!session || !session.steps.length) return null
    return session.steps[Math.min(session.currentStepIndex, session.steps.length - 1)] ?? null
  }, [session])

  const stepId = step?.id ?? ''
  const stepFirstFile = step?.files[0] ?? ''
  // 进入新步骤时，默认打开本步第一个涉及的文件
  useEffect(() => {
    setActiveFile(stepFirstFile)
  }, [stepId, stepFirstFile])

  const cleared = useMemo(
    () => (session ? session.steps.filter(item => item.phase === 'passed').length : 0),
    [session],
  )
  const progress = session && session.steps.length ? Math.round((cleared / session.steps.length) * 100) : 0

  const exitDojo = useCallback(async () => {
    if (unsaved) {
      const ok = await globalConfirm({
        title: t('dojo.confirmExitTitle', lang),
        message: t('dojo.confirmExitDesc', lang),
        confirmText: t('dojo.exit', lang),
        cancelText: t('dojo.continueTraining', lang),
        variant: 'warning',
      })
      if (!ok) return
    }
    setMode('agent')
  }, [unsaved, lang, setMode])

  const startNewTraining = useCallback(async () => {
    const ok = await globalConfirm({
      title: t('dojo.confirmNewTrainingTitle', lang),
      message: t('dojo.confirmNewTrainingDesc', lang),
      confirmText: t('dojo.newTraining', lang),
      cancelText: t('dojo.continueTraining', lang),
      variant: 'warning',
    })
    if (!ok) return
    setDirtyCount(0)
    resetSession()
    setActiveFile('')
  }, [lang, resetSession])

  useEffect(() => () => { void disposeVerifyTerminal() }, [])

  return (
    <div ref={rootRef} className="flex h-full flex-col overflow-hidden bg-transparent text-text-primary">
      {/* 顶栏：项目面板开关 · 需求 · 训练进度 · AI 锁定状态 · 会话操作 */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            panelsPinned.current = true
            setPanelsOpen(value => !value)
          }}
          title={t(panelsOpen ? 'dojo.panelsCollapse' : 'dojo.panelsExpand', lang)}
          aria-pressed={panelsOpen}
          className={`shrink-0 rounded-lg p-1.5 transition-colors hover:bg-surface-hover hover:text-text-primary ${
            panelsOpen ? 'text-text-secondary' : 'text-text-muted'
          }`}
        >
          <LayoutPanelLeft size={15} />
        </button>
        <div className="flex shrink-0 items-center gap-2 text-accent">
          <GraduationCap size={18} />
          <span className="text-sm font-semibold">{t('dojo.title', lang)}</span>
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={session?.requirement}>
          {session ? session.requirement : t('dojo.tagline', lang)}
        </span>

        {session && (
          <div className="hidden shrink-0 items-center gap-2 md:flex" title={t('dojo.progress', lang)}>
            <div className="h-1 w-20 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="tabular-nums text-[10px] text-text-muted">
              {t('dojo.stepsDone', lang, { done: cleared, total: session.steps.length })}
            </span>
          </div>
        )}

        {/* 面板收起 / 切到别的步骤时，草稿也得有个看得见的提醒 */}
        {unsaved && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-400"
            title={t('dojo.draftKept', lang)}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            <span className="hidden sm:inline">{t('dojo.unsaved', lang)}</span>
            <span className="tabular-nums">{dirtyCount}</span>
          </span>
        )}

        <span
          className="hidden shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] text-amber-400 lg:flex"
          title={t('dojo.aiWriteLock', lang)}
        >
          <Lock size={10} />
          {t('dojo.aiWriteLock', lang)}
        </span>

        {session && (
          <button
            type="button"
            onClick={() => void startNewTraining()}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <Plus size={13} />
            {t('dojo.newTraining', lang)}
          </button>
        )}
        <button
          type="button"
          onClick={() => void exitDojo()}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <X size={14} />
          <span className="hidden sm:inline">{t('dojo.exit', lang)}</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {!session ? (
          <DecomposeFlow workspacePath={workspacePath} language={lang} />
        ) : !step ? (
          <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
            {t('dojo.emptySteps', lang)}
          </div>
        ) : (
          <>
            {/* 栏 1 / 2：项目全貌 + 拆解蓝图与阶梯（可整体收起，把宽度让给编辑器） */}
            {panelsOpen && (
              <>
                <aside className="flex w-[216px] shrink-0 flex-col border-r border-border/60">
                  <DojoFileTree
                    workspacePath={workspacePath}
                    stepFiles={step.files}
                    activeFile={activeFile}
                    onOpenFile={setActiveFile}
                    refreshTick={treeTick}
                    language={lang}
                  />
                  <div className="max-h-56 shrink-0 overflow-y-auto border-t border-border/60 px-3 py-2.5">
                    <h2 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {t('dojo.skillGraph', lang)}
                      {skills.length > 0 && (
                        <span className="rounded-full bg-surface-hover px-1.5 text-[9px] tabular-nums text-text-muted">
                          {skills.length}
                        </span>
                      )}
                    </h2>
                    {skills.length === 0 ? (
                      <p className="text-[11px] leading-relaxed text-text-muted">{t('dojo.skillEmpty', lang)}</p>
                    ) : (
                      <ul className="space-y-1">
                        {skills.map(skill => (
                          <li key={skill.id} className="flex items-center gap-2 text-[11px]">
                            <span
                              aria-hidden="true"
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                skill.mastery === 'mastered'
                                  ? 'bg-emerald-400'
                                  : skill.mastery === 'passed'
                                    ? 'bg-accent'
                                    : 'bg-text-muted/40'
                              }`}
                            />
                            <span className="min-w-0 flex-1 truncate text-text-secondary" title={skill.name}>
                              {skill.name}
                            </span>
                            <span
                              className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
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

                <aside className="flex w-[272px] shrink-0 flex-col border-r border-border/60">
                  <BlueprintCard blueprint={session.blueprint} language={lang} />
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
                    <h2 className="mb-2 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      <span>{t('dojo.ladder', lang)}</span>
                      <span className="shrink-0 text-[9px] font-normal normal-case tracking-normal">
                        {t('dojo.stepsTotal', lang, { total: session.steps.length })}
                      </span>
                    </h2>
                    <ol className="space-y-1">
                      {session.steps.map((item, index) => {
                        const isCurrent = index === session.currentStepIndex
                        const isPassed = item.phase === 'passed'
                        return (
                          <li
                            key={item.id}
                            className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                              isCurrent
                                ? 'border-accent/40 bg-accent/[0.07] text-text-primary'
                                : 'border-transparent text-text-secondary hover:bg-surface/40'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] tabular-nums ${
                                  isPassed
                                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
                                    : isCurrent
                                      ? 'border-accent/50 bg-accent/15 text-accent'
                                      : 'border-border/70 text-text-muted'
                                }`}
                              >
                                {isPassed ? <Check size={10} /> : index + 1}
                              </span>
                              <span className={`min-w-0 flex-1 truncate ${isCurrent ? 'font-medium' : ''}`} title={item.title}>
                                {item.title}
                              </span>
                              {isCurrent && (
                                <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">
                                  {tDynamic(PHASE_LABEL[item.phase], lang, PHASE_LABEL[item.phase])}
                                </span>
                              )}
                            </div>

                            {isCurrent && (
                              <div className="mt-1.5 space-y-1.5 pr-1">
                                {item.goal && (
                                  <div>
                                    <div className="text-[9px] uppercase tracking-wider text-text-muted">{t('dojo.stepGoal', lang)}</div>
                                    <p className="text-[10px] leading-relaxed text-text-secondary">{item.goal}</p>
                                  </div>
                                )}
                                {item.files.length > 0 && (
                                  <div>
                                    <div className="text-[9px] uppercase tracking-wider text-text-muted">{t('dojo.stepFiles', lang)}</div>
                                    <div className="mt-0.5 space-y-0.5">
                                      {item.files.map(file => (
                                        <button
                                          key={file}
                                          type="button"
                                          onClick={() => setActiveFile(file)}
                                          title={file}
                                          className={`block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[10px] transition-colors ${
                                            activeFile === file
                                              ? 'bg-accent/15 text-accent'
                                              : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                          }`}
                                        >
                                          {file}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {item.verifyCommand && (
                                  <div>
                                    <div className="text-[9px] uppercase tracking-wider text-text-muted">{t('dojo.stepVerify', lang)}</div>
                                    <div
                                      className="mt-0.5 truncate rounded border border-border/40 bg-surface/30 px-1.5 py-1 font-mono text-[9px] text-text-secondary"
                                      title={item.verifyCommand}
                                    >
                                      {item.verifyCommand}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                </aside>
              </>
            )}

            {/* 栏 3：学员编辑器 */}
            <LearnerEditor
              workspacePath={workspacePath}
              step={step}
              filePath={activeFile}
              onFilePathChange={setActiveFile}
              language={lang}
              onSaved={() => setTreeTick(tick => tick + 1)}
              onDirtyChange={setDirtyCount}
            />

            {/* 栏 4：导师面板 */}
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

/* ==================== 拆解蓝图 ==================== */

function BlueprintCard({ blueprint, language }: { blueprint?: string; language: string }) {
  const lang = asLanguage(language)
  const [open, setOpen] = useState(true)

  return (
    <div className="shrink-0 border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-surface/40"
      >
        <ChevronDown
          size={12}
          className={`shrink-0 text-text-muted transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {t('dojo.blueprint', lang)}
        </span>
      </button>
      {open ? (
        <div className="max-h-64 overflow-y-auto px-3 pb-3">
          {blueprint ? (
            <Markdown className="text-[11px] leading-relaxed text-text-secondary">{blueprint}</Markdown>
          ) : (
            <p className="text-[11px] text-text-muted">{t('dojo.noBlueprint', lang)}</p>
          )}
        </div>
      ) : blueprint ? (
        // 收起时保留两行摘要：蓝图是"为什么这样拆"的依据，不该完全消失
        <p className="line-clamp-2 px-3 pb-2 pl-6 text-[10px] leading-relaxed text-text-muted">
          {blueprint.replace(/[#*`>]/g, ' ').replace(/\s+/g, ' ').trim()}
        </p>
      ) : null}
    </div>
  )
}

/* ==================== 拆解流程（输入 → 勘察流 → 蓝图审阅） ==================== */

type DecomposeStage = 'input' | 'working' | 'review'

/** 起手示例：空白输入框最容易劝退，给三个真实但小的需求当台阶 */
const DOJO_EXAMPLES = ['dojo.example.1', 'dojo.example.2', 'dojo.example.3'] as const

function DecomposeFlow({ workspacePath, language }: { workspacePath: string; language: string }) {
  const lang = asLanguage(language)
  const startSession = useDojoStore(state => state.startSession)
  const recordSkill = useDojoStore(state => state.recordSkill)

  const [stage, setStage] = useState<DecomposeStage>('input')
  const [requirement, setRequirement] = useState('')
  const [mentorThreadId, setMentorThreadId] = useState<string | null>(null)
  const [blueprint, setBlueprint] = useState('')
  const [steps, setSteps] = useState<Array<DojoStep & { skill: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  /** 用户中途放弃后，仍在路上的导师回复不能再写回界面 */
  const seqRef = useRef(0)

  // 勘察计时：等待也需要"看得见的进展"，否则用户会怀疑卡死
  useEffect(() => {
    if (stage !== 'working') return
    const startedAt = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [stage])

  const runDecompose = useCallback(async () => {
    const trimmed = requirement.trim()
    if (!trimmed || !workspacePath) return
    const seq = ++seqRef.current
    setStage('working')
    setError(null)
    setBlueprint('')
    setSteps([])
    setMentorThreadId(null)
    try {
      // 订阅导师线程：勘察过程可见，而不是黑盒等待
      const result = await decomposeRequirement(trimmed, workspacePath, setMentorThreadId)
      if (seq !== seqRef.current) return
      setBlueprint(result.briefing)
      setSteps(result.steps)
      setStage('review')
    } catch (err) {
      if (seq !== seqRef.current) return
      setError(err instanceof Error ? err.message : String(err))
      setStage('input')
    }
  }, [requirement, workspacePath])

  const abandonRecon = useCallback(() => {
    seqRef.current += 1
    abortMentor(mentorThreadId)
    setStage('input')
  }, [mentorThreadId])

  const confirmStart = useCallback(() => {
    if (!steps.length) return
    startSession({
      id: crypto.randomUUID(),
      requirement: requirement.trim(),
      blueprint,
      steps: steps.map(({ skill: _skill, ...step }) => step),
      currentStepIndex: 0,
      createdAt: Date.now(),
    })
    // 技能先记为 learning，结业时按表现升级
    for (const item of steps) recordSkill(item.skill, 'learning')
  }, [steps, requirement, blueprint, startSession, recordSkill])

  const canStart = Boolean(requirement.trim() && workspacePath)
  const submit = () => {
    if (canStart) void runDecompose()
  }

  if (stage === 'working') {
    return (
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-6 py-6">
        <div className="flex items-center gap-2">
          <Loader2 size={15} className="animate-spin text-accent" />
          <span className="text-sm font-semibold">{t('dojo.reconTitle', lang)}</span>
          <span className="tabular-nums text-[10px] text-text-muted">
            {t('dojo.reconElapsed', lang, { seconds: elapsed })}
          </span>
          <button
            type="button"
            onClick={abandonRecon}
            className="ml-auto flex items-center gap-1 rounded-lg border border-border/60 bg-surface/30 px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <X size={12} />
            {t('dojo.cancelRecon', lang)}
          </button>
        </div>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-text-muted">{t('dojo.reconHint', lang)}</p>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-surface/20">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted">
            <Wrench size={11} />
            {t('dojo.mentorLive', lang)}
            <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal text-accent/80">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              {t('dojo.reconLocked', lang)}
            </span>
          </div>
          <MentorLiveFeed threadId={mentorThreadId} language={lang} />
        </div>
      </div>
    )
  }

  if (stage === 'review') {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
        <div className="shrink-0 px-6 pb-3 pt-6">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold">{t('dojo.blueprint', lang)}</h1>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
              {t('dojo.stepsTotal', lang, { total: steps.length })}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">{t('dojo.reviewBlueprint', lang)}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4">
          <section className="rounded-xl border border-accent/25 bg-accent/[0.04] p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              <Sparkles size={11} />
              {t('dojo.blueprintHint', lang)}
            </div>
            {blueprint ? (
              <Markdown className="text-xs leading-relaxed text-text-secondary">{blueprint}</Markdown>
            ) : (
              <p className="text-xs text-text-muted">{t('dojo.noBlueprint', lang)}</p>
            )}
          </section>

          <ol className="space-y-2">
            {steps.map((item, index) => (
              <li
                key={item.id}
                className="rounded-xl border border-border/60 bg-surface/25 p-3 transition-colors hover:border-border"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-[10px] tabular-nums text-accent">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.title}>
                    {item.title}
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] text-text-muted" title={item.skill}>
                    {item.skill}
                  </span>
                </div>
                {item.goal && (
                  <p className="mt-1 pl-7 text-[11px] leading-relaxed text-text-secondary">{item.goal}</p>
                )}
                {item.files.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-7">
                    {item.files.map(file => (
                      <span key={file} className="rounded bg-surface/60 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                        {file}
                      </span>
                    ))}
                  </div>
                )}
                {item.verifyCommand && (
                  <div
                    className="mt-1.5 ml-7 flex items-center gap-1.5 rounded-lg border border-border/40 bg-surface/40 px-2 py-1 font-mono text-[10px] text-text-muted"
                    title={item.verifyCommand}
                  >
                    <Terminal size={10} className="shrink-0" />
                    <span className="truncate">{item.verifyCommand}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="shrink-0 border-t border-border/60 bg-background/60 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[10px] text-text-muted">{t('dojo.railHint', lang)}</p>
            <button
              type="button"
              onClick={() => setStage('input')}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-surface/40 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <RotateCcw size={13} />
              {t('dojo.recompose', lang)}
            </button>
            <button
              type="button"
              onClick={confirmStart}
              disabled={!steps.length}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('dojo.confirmStart', lang)}
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <GraduationCap size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-6">{t('dojo.startTitle', lang)}</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{t('dojo.startDesc', lang)}</p>
          </div>
        </div>

        {/* 开练前先看懂机制：这条环就是产品本身 */}
        <div className="mt-5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {PHASE_RAIL.map((item, index) => (
            <span key={item.phase} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight size={11} className="text-text-muted/60" aria-hidden="true" />}
              <span className="rounded-full border border-border/60 bg-surface/30 px-2 py-0.5 text-[10px] text-text-secondary">
                <span className="mr-1 tabular-nums text-text-muted/70">{index + 1}</span>
                {t(item.label, lang)}
              </span>
            </span>
          ))}
          <span className="text-[10px] text-text-muted/80">{t('dojo.railHint', lang)}</span>
        </div>

        <div
          className={`mt-5 overflow-hidden rounded-2xl border bg-surface/25 transition-colors focus-within:border-accent/50 ${
            error ? 'border-red-400/40' : 'border-border/60'
          }`}
        >
          <textarea
            autoFocus
            value={requirement}
            onChange={event => setRequirement(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder={t('dojo.requirementPlaceholder', lang)}
            rows={5}
            className="w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed outline-none placeholder:text-text-muted"
          />
          <div className="flex items-center gap-1.5 border-t border-border/40 px-3 py-2">
            <span className="tabular-nums text-[10px] text-text-muted">
              {t('dojo.requirementMeta', lang, { count: requirement.trim().length })}
            </span>
            <span className="text-[10px] text-text-muted/50" aria-hidden="true">·</span>
            <span className="text-[10px] text-text-muted/80">{t('dojo.submitHint', lang)}</span>
            <button
              type="button"
              onClick={submit}
              disabled={!canStart}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('dojo.startTraining', lang)}
              <ChevronRight size={13} />
            </button>
          </div>
        </div>

        {!workspacePath && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {t('dojo.workspaceMissing', lang)}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-red-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
            <Sparkles size={11} />
            {t('dojo.examplesTitle', lang)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DOJO_EXAMPLES.map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setRequirement(t(key, lang))}
                className="rounded-lg border border-border/60 bg-surface/30 px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-surface/50 hover:text-text-primary"
              >
                {t(key, lang)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==================== 学员编辑器 ==================== */

function LearnerEditor({ workspacePath, step, filePath, onFilePathChange, language, onSaved, onDirtyChange }: {
  workspacePath: string
  step: DojoStep
  filePath: string
  onFilePathChange: (next: string) => void
  language: string
  onSaved?: () => void
  /** 草稿份数通知外层：退出/新训练前拦一下，顶栏也能显示还有几份没存 */
  onDirtyChange?: (dirtyCount: number) => void
}) {
  const lang = asLanguage(language)
  const [pathInput, setPathInput] = useState(filePath)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set())
  /** 草稿与磁盘基线分开放：切文件只换视图，编辑内容不落地丢失 */
  const buffersRef = useRef<Record<string, string>>({})
  const savedRef = useRef<Record<string, string>>({})
  const saveRef = useRef<() => void>(() => {})
  const dirty = filePath.trim() ? dirtyPaths.has(filePath.trim()) : false

  const load = useCallback(async (relative: string) => {
    const trimmed = relative.trim()
    setStatus(null)
    if (!trimmed || !workspacePath) {
      setContent('')
      return
    }
    // 草稿优先：来回切文件时，键盘敲下的内容不该被磁盘旧版覆盖
    const buffered = buffersRef.current[trimmed]
    if (buffered !== undefined) {
      setContent(buffered)
      return
    }
    setLoading(true)
    try {
      const text = await api.file.readFull(joinPath(workspacePath, trimmed))
      if (text === null || text === undefined) {
        setContent('')
        setStatus({ kind: 'info', text: t('dojo.fileNotFound', lang) })
        return
      }
      savedRef.current[trimmed] = text
      setContent(text)
    } catch {
      setContent('')
      setStatus({ kind: 'error', text: t('dojo.fileNotFound', lang) })
    } finally {
      setLoading(false)
    }
  }, [workspacePath, lang])

  // 目录树点击 / 阶梯文件点击 / 步骤切换都会改 filePath —— 统一在这里加载
  useEffect(() => {
    setPathInput(filePath)
    void load(filePath)
  }, [filePath, load])

  // 保存成功提示 2.4s 后自动消失：不留在标题栏里当噪音
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 2400)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    onDirtyChange?.(dirtyPaths.size)
  }, [dirtyPaths, onDirtyChange])

  // 卸载（退出 / 新训练）时把顶栏的草稿提示一起带走，别留在下一屏
  useEffect(() => () => onDirtyChange?.(0), [onDirtyChange])

  /**
   * 只负责"切文件"：路径没变时绝不能读盘。
   * 否则点击「保存」会先触发 input blur，把编辑中的内容覆盖成磁盘旧版。
   */
  const commitPath = useCallback(() => {
    const next = pathInput.trim()
    if (next === filePath) return
    onFilePathChange(next)
  }, [pathInput, filePath, onFilePathChange])

  const save = useCallback(async () => {
    const target = pathInput.trim()
    if (!target || !workspacePath) return
    const result = await api.file.writeDetailed(joinPath(workspacePath, target), content)
    const ok = Boolean(result?.success)
    setStatus({ kind: ok ? 'ok' : 'error', text: t(ok ? 'dojo.saved' : 'dojo.saveFailed', lang) })
    if (!ok) return
    savedRef.current[target] = content
    delete buffersRef.current[target]
    setDirtyPaths(prev => {
      if (!prev.has(target)) return prev
      const next = new Set(prev)
      next.delete(target)
      return next
    })
    onSaved?.()
    // 「另存为」：路径变了就交给上层统一切文件
    if (target !== filePath) onFilePathChange(target)
  }, [pathInput, workspacePath, content, lang, filePath, onSaved])

  useEffect(() => {
    saveRef.current = () => { void save() }
  }, [save])

  const handleChange = useCallback((value: string | undefined) => {
    const next = value ?? ''
    const path = filePath.trim()
    setContent(next)
    if (!path) return
    buffersRef.current[path] = next
    const baseline = savedRef.current[path]
    const isDirty = baseline === undefined ? next.length > 0 : next !== baseline
    setDirtyPaths(prev => {
      if (prev.has(path) === isDirty) return prev
      const updated = new Set(prev)
      if (isDirty) updated.add(path)
      else updated.delete(path)
      return updated
    })
  }, [filePath])

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* 路径与保存：键盘优先，⌘/Ctrl+S 与按钮等价 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <FileText size={13} className="shrink-0 text-text-muted" aria-hidden="true" />
        <input
          value={pathInput}
          onChange={event => setPathInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitPath()
            }
          }}
          onBlur={commitPath}
          placeholder={t('dojo.filePathPlaceholder', lang)}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 font-mono text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:bg-surface/40 focus:ring-1 focus:ring-accent/40"
        />
        {loading && <Loader2 size={12} className="shrink-0 animate-spin text-text-muted" aria-label={t('dojo.treeLoading', lang)} />}
        {status ? (
          <span
            className={`shrink-0 text-[10px] ${
              status.kind === 'ok'
                ? 'text-emerald-400'
                : status.kind === 'error'
                  ? 'text-red-400'
                  : 'text-text-muted'
            }`}
          >
            {status.text}
          </span>
        ) : dirty ? (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            {t('dojo.unsaved', lang)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty}
          title={t('dojo.saveShortcut', lang)}
          className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            dirty ? 'bg-accent text-white hover:opacity-90' : 'bg-surface/40 text-text-muted'
          }`}
        >
          <Save size={12} />
          {t('dojo.save', lang)}
        </button>
      </div>

      {/* 本步文件标签：全部可见（横向滚动），未保存的文件带黄点 */}
      {step.files.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {step.files.map(file => {
            const active = filePath === file
            const fileDirty = dirtyPaths.has(file)
            return (
              <button
                key={file}
                type="button"
                onClick={() => onFilePathChange(file)}
                title={file}
                className={`flex max-w-[16rem] shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors ${
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                }`}
              >
                <FileIcon filename={file.split('/').pop() ?? file} size={12} />
                <span className="truncate font-mono">{file}</span>
                {fileDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />}
              </button>
            )
          })}
          </div>
          {dirtyPaths.size > 1 && (
            <span className="shrink-0 pl-1 text-[9px] text-amber-400/80">{t('dojo.draftKept', lang)}</span>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <MonacoEditor
          height="100%"
          theme="adnify-dynamic"
          language={guessLanguage(pathInput)}
          value={content}
          onChange={handleChange}
          onMount={editor => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 10, bottom: 10 },
            smoothScrolling: true,
            renderLineHighlight: 'none',
            tabSize: 2,
          }}
        />
        {!filePath.trim() && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText size={22} className="text-text-muted/50" aria-hidden="true" />
            <p className="max-w-xs text-xs leading-relaxed text-text-muted">{t('dojo.openFileHint', lang)}</p>
          </div>
        )}
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

/** 训练环：把"现在走到哪、还剩几步"变成一眼可见的进度 */
function PhaseRail({ phase, language }: { phase: DojoStepPhase; language: string }) {
  const lang = asLanguage(language)
  const current = PHASE_ORDER[phase]

  return (
    <div className="mt-2 flex items-center gap-1" title={t('dojo.railHint', lang)}>
      {PHASE_RAIL.map((item, index) => {
        const done = index < current
        const active = index === current
        return (
          <div key={item.phase} className="flex min-w-0 flex-1 items-center gap-1 last:flex-none">
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[8px] tabular-nums transition-colors ${
                done
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
                  : active
                    ? 'border-accent bg-accent text-white'
                    : 'border-border/70 text-text-muted'
              }`}
            >
              {done ? <Check size={9} /> : index + 1}
            </span>
            <span
              className={`shrink-0 text-[9px] leading-none ${
                active ? 'text-accent' : done ? 'text-text-secondary' : 'text-text-muted'
              }`}
            >
              {t(item.label, lang)}
            </span>
            {index < PHASE_RAIL.length - 1 && (
              <span
                aria-hidden="true"
                className={`h-px min-w-1 flex-1 ${index < current ? 'bg-emerald-400/40' : 'bg-border/60'}`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 双门禁状态：哪个门已经过了，必须一眼可辨 */
function GateChip({ label, passed, language }: { label: string; passed: boolean; language: string }) {
  const lang = asLanguage(language)
  return (
    <span
      className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] ${
        passed
          ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
          : 'border-border/60 bg-surface/40 text-text-muted'
      }`}
    >
      {passed ? <Check size={9} /> : <Lock size={9} />}
      <span className="truncate">{label}</span>
      <span className="opacity-60" aria-hidden="true">·</span>
      <span>{t(passed ? 'dojo.gatePassed' : 'dojo.gatePending', lang)}</span>
    </span>
  )
}

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

  // 阶段切换时内容整块替换：滚动位置必须回到顶部，否则用户会落在半截内容里
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [step.id, step.phase])

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
    const graded = await gradeAnswer(step, step.quiz.question, answer.trim(), workspacePath)
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

  const phaseIndex = PHASE_ORDER[step.phase]
  const gate1Passed = phaseIndex >= 2
  const gate2Passed = phaseIndex >= 3
  const isLastStep = Boolean(session && session.currentStepIndex >= session.steps.length - 1)

  const primaryButton = 'flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
  const ghostButton = 'flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-surface/40 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40'
  const spinner = <Loader2 size={12} className="animate-spin" aria-hidden="true" />

  // 底部主行动：面板内容再长，下一步也始终在视线里
  const footer =
    step.phase === 'demo' && step.demo ? (
      <button type="button" onClick={handleBeginHandsOn} disabled={mentorBusy} className={`${primaryButton} w-full`}>
        <ChevronRight size={13} />
        {t('dojo.startHandsOn', lang)}
      </button>
    ) : step.phase === 'passed' && !isLastStep ? (
      <button type="button" onClick={handleAdvance} className={`${primaryButton} w-full`}>
        <ChevronRight size={13} />
        {t('dojo.nextStep', lang)}
      </button>
    ) : null

  return (
    <aside className="flex w-[368px] shrink-0 flex-col border-l border-border/60 bg-surface/[0.02]">
      {/* 步骤头：位置 · 环 · 双门禁 */}
      <div className="shrink-0 border-b border-border/60 px-4 pb-2.5 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            {t('dojo.stepN', lang, { index: (session?.currentStepIndex ?? 0) + 1, total: session?.steps.length ?? 0 })}
          </span>
          <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">
            {tDynamic(PHASE_LABEL[step.phase], lang, PHASE_LABEL[step.phase])}
          </span>
        </div>
        <h2 className="mt-0.5 text-sm font-semibold leading-5">{step.title}</h2>
        {step.goal && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-secondary" title={step.goal}>
            {step.goal}
          </p>
        )}
        <PhaseRail phase={step.phase} language={lang} />
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <GateChip label={t('dojo.gate1', lang)} passed={gate1Passed} language={lang} />
          <GateChip label={t('dojo.gate2', lang)} passed={gate2Passed} language={lang} />
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {error && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-400/40 bg-red-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-400">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}

        {/* —— 示范阶段 —— */}
        {step.phase === 'demo' && (
          <section className="space-y-2.5">
            {!step.demo ? (
              <>
                <p className="text-xs leading-relaxed text-text-secondary">{t('dojo.handsOnHint', lang)}</p>
                <button type="button" onClick={() => void handleDemo()} disabled={mentorBusy} className={`${primaryButton} w-full`}>
                  {mentorBusy ? spinner : <Play size={13} />}
                  {mentorBusy ? t('dojo.mentorThinking', lang) : t('dojo.requestDemo', lang)}
                </button>
              </>
            ) : (
              <>
                <Markdown className="rounded-xl border border-border/50 bg-surface/30 p-3 text-xs leading-relaxed">{step.demo}</Markdown>
                <button type="button" onClick={() => void handleDemo()} disabled={mentorBusy} className={`${ghostButton} w-full`}>
                  {mentorBusy ? spinner : <RotateCcw size={13} />}
                  {mentorBusy ? t('dojo.mentorThinking', lang) : t('dojo.redemo', lang)}
                </button>
              </>
            )}
          </section>
        )}

        {/* —— 动手阶段 —— */}
        {step.phase === 'handsOn' && (
          <section className="space-y-3">
            <p className="text-xs leading-relaxed text-text-secondary">{t('dojo.handsOnHint', lang)}</p>

            {step.hints.length > 0 && (
              <div className="space-y-1.5">
                {step.hints.slice(0, step.hintsRevealed).map((hint, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary"
                  >
                    <span className="mr-1 font-semibold text-amber-400">
                      {tDynamic(HINT_LABEL[index] ?? `L${index + 1}`, lang, `L${index + 1}:`)}
                    </span>
                    {hint}
                  </div>
                ))}
                {step.hintsRevealed < step.hints.length && (
                  <button type="button" onClick={() => revealHint(step.id)} className={`${ghostButton} w-full`}>
                    <Lightbulb size={13} />
                    {t('dojo.revealHint', lang, { level: step.hintsRevealed + 1, total: step.hints.length })}
                  </button>
                )}
              </div>
            )}

            {/* 第一门禁：命令 + 运行入口放在同一张卡里，因果不分家 */}
            <div className="rounded-xl border border-border/50 bg-surface/30 p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-muted">
                <Terminal size={11} />
                {t('dojo.verifyCommand', lang)}
              </div>
              <div className="mt-1 break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {step.verifyCommand || '—'}
              </div>
              {!step.verifyCommand && (
                <p className="mt-1 text-[10px] leading-relaxed text-amber-400">{t('dojo.noVerifyCommand', lang)}</p>
              )}
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={mentorBusy || !step.verifyCommand}
                className={`${primaryButton} mt-2 w-full`}
              >
                {mentorBusy ? spinner : <Terminal size={13} />}
                {mentorBusy ? t('dojo.verifying', lang) : t('dojo.runVerify', lang)}
              </button>
            </div>

            {verifyResult && !verifyResult.success && (
              <div className="space-y-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-400/40 bg-red-400/[0.06] p-2.5 font-mono text-[11px] leading-relaxed text-text-secondary">
                  {verifyResult.output || t('dojo.verifyFailedNoOutput', lang)}
                </pre>
                <button type="button" onClick={() => void handleDiagnose()} disabled={mentorBusy} className={`${ghostButton} w-full`}>
                  {mentorBusy ? spinner : <RotateCcw size={13} />}
                  {t('dojo.askDiagnosis', lang)}
                </button>
              </div>
            )}
          </section>
        )}

        {/* —— 抽问阶段（第二门禁） —— */}
        {step.phase === 'quiz' && (
          <section className="space-y-2.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/[0.08] px-2.5 py-2 text-[11px] text-emerald-400">
              <Check size={12} />
              {t('dojo.verifyPassed', lang)}
            </div>
            {!step.quiz ? (
              <button type="button" onClick={() => void handleQuiz()} disabled={mentorBusy} className={`${primaryButton} w-full`}>
                {mentorBusy ? spinner : <Lightbulb size={13} />}
                {mentorBusy ? t('dojo.mentorThinking', lang) : t('dojo.requestQuiz', lang)}
              </button>
            ) : (
              <>
                <div className="rounded-xl border border-accent/40 bg-accent/[0.06] px-3 py-2.5 text-xs leading-relaxed text-text-primary">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
                    {t('dojo.mentorQuiz', lang)}
                  </div>
                  {step.quiz.question}
                </div>
                <textarea
                  autoFocus
                  value={answer}
                  onChange={event => setAnswer(event.target.value)}
                  onKeyDown={event => {
                    // 与需求输入框同一套手感：⌘/Ctrl + Enter 直接交卷
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      if (!step.quiz?.passed && answer.trim() && !mentorBusy) void handleGrade()
                    }
                  }}
                  placeholder={t('dojo.answerPlaceholder', lang)}
                  rows={4}
                  disabled={step.quiz.passed}
                  className="w-full resize-none rounded-xl border border-border/50 bg-surface/30 px-3 py-2 text-xs leading-relaxed outline-none transition-colors placeholder:text-text-muted focus:border-accent/50 disabled:opacity-60"
                />
                {!step.quiz.passed && (
                  <button
                    type="button"
                    onClick={() => void handleGrade()}
                    disabled={mentorBusy || !answer.trim()}
                    className={`${primaryButton} w-full`}
                  >
                    {mentorBusy ? spinner : <Check size={13} />}
                    {mentorBusy ? t('dojo.grading', lang) : t('dojo.submitAnswer', lang)}
                  </button>
                )}
                {step.quiz.attempts > 0 && step.quiz.feedback && (
                  <div
                    className={`rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                      step.quiz.passed
                        ? 'border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-400'
                        : 'border-amber-400/40 bg-amber-400/[0.06] text-amber-400'
                    }`}
                  >
                    {step.quiz.feedback}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* —— 复盘阶段 —— */}
        {step.phase === 'review' && (
          <section className="space-y-2.5">
            <p className="text-xs leading-relaxed text-text-secondary">{t('dojo.railHint', lang)}</p>
            <button type="button" onClick={() => void handleReview()} disabled={mentorBusy} className={`${primaryButton} w-full`}>
              {mentorBusy ? spinner : <Sparkles size={13} />}
              {mentorBusy ? t('dojo.mentorThinking', lang) : t('dojo.requestReview', lang)}
            </button>
          </section>
        )}

        {/* —— 结业 —— */}
        {step.phase === 'passed' && step.review && (
          <section className="space-y-2.5">
            <Markdown className="rounded-xl border border-border/50 bg-surface/30 p-3 text-xs leading-relaxed">{step.review}</Markdown>
            {isLastStep && (
              <div className="flex items-start gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-400/[0.08] px-3 py-2.5 text-[11px] leading-relaxed text-emerald-400">
                <Check size={12} className="mt-0.5 shrink-0" />
                {t('dojo.trainingComplete', lang)}
              </div>
            )}
          </section>
        )}
      </div>

      {footer && (
        <div className="shrink-0 border-t border-border/60 bg-background/60 px-4 py-2.5 backdrop-blur">
          {footer}
        </div>
      )}
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
