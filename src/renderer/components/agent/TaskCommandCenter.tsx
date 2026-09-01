import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  GitBranch,
  ListTree,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Split,
  Trash2,
  X,
} from 'lucide-react'
import { useAgentStore, selectBranches } from '@/renderer/agent/store/AgentStore'
import { useAgentActions } from '@/renderer/hooks/useAgent'
import type { Branch } from '@/renderer/agent/store/slices/branchSlice'
import { getRelativeTime } from '@shared/utils'
import { useStore } from '@store'
import { useModeStore } from '@/renderer/modes/modeStore'
import { Button } from '../ui'
import { toast } from '../common/ToastProvider'
import { writeClipboardText } from '@/renderer/services/clipboardService'
import { agentSessionRepository } from '@/renderer/services/agentSessionRepository'
import { generateSummary } from '@/renderer/agent/domains/context/summaryService'
import { getThreadDisplayTitle, type ChatThread } from '@/renderer/agent/types'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import {
  createThreadLinkMarkdown,
  formatGeneratedThreadReference,
  formatStructuredThreadReference,
} from '@/renderer/agent/threads/threadReference'
import {
  flattenTaskNodes,
  isAgentTaskThread,
  projectTaskCenter,
  type TaskCenterGroup,
  type TaskCenterNode,
  type TaskCenterStatus,
} from './taskCenterProjection'
import { t, type Language, type TranslationKey } from '@shared/i18n'

type LegacyTab = 'history' | 'branches'
type CenterTab = 'focus' | 'all' | 'branches'
type ThreadReferenceAction = 'copy-reference' | 'reference-new'

interface TaskCommandCenterProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: LegacyTab
}

interface TaskSection {
  id: 'attention' | 'running' | 'current' | 'recent'
  title: string
  groups: TaskCenterGroup[]
}

const STATUS_LABEL_KEYS: Record<TaskCenterStatus, TranslationKey> = {
  running: 'common.running',
  waiting: 'activeTaskQuickSwitch.needsInput',
  handoff: 'activeTaskQuickSwitch.handingOff',
  failed: 'common.failed',
  completed: 'common.completed',
  aborted: 'planWorkspace.statusStopped',
  idle: 'taskCommandCenter.statusReady',
}

function StatusMark({ status, compact = false }: { status: TaskCenterStatus; compact?: boolean }) {
  const className = compact ? 'h-3 w-3' : 'h-3.5 w-3.5'
  if (status === 'running') return <LoaderCircle className={`${className} animate-spin text-accent motion-reduce:animate-none`} />
  if (status === 'waiting') return <ShieldAlert className={`${className} text-amber-400`} />
  if (status === 'handoff') return <Split className={`${className} text-sky-400`} />
  if (status === 'failed') return <AlertCircle className={`${className} text-red-400`} />
  if (status === 'completed') return <CheckCircle2 className={`${className} text-emerald-500`} />
  if (status === 'aborted') return <PauseCircle className={`${className} text-text-muted`} />
  return <Circle className={`${className} text-text-muted/50`} />
}

function relationLabel(node: TaskCenterNode, language: Language): string | null {
  if (node.relation === 'continuation') return t('taskCommandCenter.continuation', language)
  if (node.relation === 'subtask') return t('taskCommandCenter.subTask', language)
  if (node.relation === 'plan-task') return t('taskCommandCenter.planTask', language)
  return null
}

function ThreadActionStrip({
  language,
  onAction,
  onRename,
  onDelete,
  deleteLabel,
}: {
  language: Language
  onAction: (action: ThreadReferenceAction) => void
  onRename: () => void
  onDelete?: () => void
  deleteLabel?: string
}) {
  const actions: Array<{ id: ThreadReferenceAction; label: string; icon: typeof Copy }> = [
    { id: 'copy-reference', label: t('taskCommandCenter.copyThreadReference', language), icon: Copy },
    { id: 'reference-new', label: t('taskCommandCenter.referenceInNewChat', language), icon: MessageSquarePlus },
  ]

  return <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface/45 p-0.5">
    <button type="button" onClick={onRename} title={t('rename', language)} aria-label={t('rename', language)} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45"><Pencil className="h-3.5 w-3.5" /></button>
    {actions.map(action => <button key={action.id} type="button" onClick={() => onAction(action.id)} title={action.label} aria-label={action.label} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45"><action.icon className="h-3.5 w-3.5" /></button>)}
    {onDelete && <button type="button" onClick={onDelete} title={deleteLabel || (t('delete', language))} aria-label={deleteLabel || (t('delete', language))} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-400/45"><Trash2 className="h-3.5 w-3.5" /></button>}
  </div>
}

function RenameOverlay({
  value,
  language,
  onChange,
  onSave,
  onCancel,
}: {
  value: string
  language: Language
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return <form
    onSubmit={event => { event.preventDefault(); onSave() }}
    className="absolute inset-x-1 inset-y-1 z-10 flex items-center gap-1 rounded-md bg-background/95 px-2 shadow-sm backdrop-blur-md"
  >
    <input
      autoFocus
      value={value}
      maxLength={120}
      onChange={event => onChange(event.target.value)}
      onFocus={event => event.currentTarget.select()}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }}
      aria-label={t('common.taskName', language)}
      className="h-7 min-w-0 flex-1 rounded-md bg-surface/55 px-2 text-[11px] font-medium text-text-primary outline-none placeholder:text-text-muted/45 focus:ring-2 focus:ring-accent/30"
    />
    <button type="submit" disabled={!value.trim()} title={t('saveSession', language)} aria-label={t('saveSession', language)} className="flex h-7 w-7 items-center justify-center rounded-md text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-35"><Check className="h-3.5 w-3.5" /></button>
    <button type="button" onClick={onCancel} title={t('cancel', language)} aria-label={t('cancel', language)} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45"><X className="h-3.5 w-3.5" /></button>
  </form>
}

function TaskNodeRow({
  node,
  currentThreadId,
  language,
  onOpen,
  onReference,
  onRename,
  onDelete,
}: {
  node: TaskCenterNode
  currentThreadId: string | null
  language: Language
  onOpen: (threadId: string) => void
  onReference: (threadId: string, action: ThreadReferenceAction) => void
  onRename: (threadId: string, title: string) => void
  onDelete: (node: TaskCenterNode) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.title)
  const hasChildren = node.children.length > 0
  const relation = relationLabel(node, language)
  const active = node.threadId === currentThreadId

  return <div>
    <div className="group relative" style={{ paddingLeft: `${node.depth * 17}px` }}>
      {renaming && node.threadId && <RenameOverlay value={renameValue} language={language} onChange={setRenameValue} onSave={() => { if (renameValue.trim()) onRename(node.threadId!, renameValue.trim()); setRenaming(false) }} onCancel={() => setRenaming(false)} />}
      <button
        type="button"
        disabled={!node.threadId}
        onClick={() => node.threadId && onOpen(node.threadId)}
        className={`group relative flex min-h-11 w-full items-start gap-2 rounded-md py-1.5 pl-2 text-left transition-[background-color,padding] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45 ${actionsOpen ? 'pr-32' : 'pr-9'} ${active ? 'bg-accent/[0.065]' : 'hover:bg-surface/40'} disabled:cursor-default`}
      >
        {hasChildren ? <span
          role="button"
          tabIndex={0}
          aria-label={expanded ? t('taskCommandCenter.collapse', language) : t('taskCommandCenter.expand', language)}
          onClick={event => { event.stopPropagation(); setExpanded(value => !value) }}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setExpanded(value => !value) } }}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
        ><ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} /></span> : <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"><StatusMark status={node.status} /></span>}

        {hasChildren && <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center"><StatusMark status={node.status} compact /></span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[11px] font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>{node.title}</span>
            {relation && <span className="shrink-0 rounded bg-surface-active/45 px-1.5 py-0.5 text-[7px] font-medium text-text-muted">{relation}</span>}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[8px] text-text-muted">
            <span className="truncate">{node.detail || t(STATUS_LABEL_KEYS[node.status], language)}</span>
            {node.branchCount > 0 && <span className="flex shrink-0 items-center gap-0.5"><GitBranch className="h-2.5 w-2.5" />{node.branchCount}</span>}
            {node.messageCount > 0 && <span className="shrink-0 tabular-nums">{t('messagesCount', language, { count: node.messageCount })}</span>}
          </span>
        </span>
        {node.status === 'waiting' && !actionsOpen && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400 motion-reduce:animate-none" />}
      </button>
      {node.threadId && <div className="absolute right-1 top-2 flex items-center gap-0.5">
        {actionsOpen && <ThreadActionStrip language={language} onRename={() => { setActionsOpen(false); setRenameValue(node.title); setRenaming(true) }} onAction={action => { setActionsOpen(false); onReference(node.threadId!, action) }} onDelete={() => { setActionsOpen(false); onDelete(node) }} deleteLabel={t('taskCommandCenter.deleteSubThread', language)} />}
        <button type="button" aria-label={t('taskCommandCenter.threadActions', language)} onClick={() => setActionsOpen(value => !value)} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted/55 transition-all hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45 ${actionsOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}><MoreHorizontal className="h-3.5 w-3.5" /></button>
      </div>}
    </div>
    {expanded && node.children.map(child => <TaskNodeRow key={child.id} node={child} currentThreadId={currentThreadId} language={language} onOpen={onOpen} onReference={onReference} onRename={onRename} onDelete={onDelete} />)}
  </div>
}

function TaskGroupCard({
  group,
  currentThreadId,
  language,
  onOpen,
  onReference,
  onRename,
  onDelete,
  onDeleteNode,
}: {
  group: TaskCenterGroup
  currentThreadId: string | null
  language: Language
  onOpen: (threadId: string) => void
  onReference: (threadId: string, action: ThreadReferenceAction) => void
  onRename: (threadId: string, title: string) => void
  onDelete?: () => void
  onDeleteNode: (node: TaskCenterNode) => void
}) {
  const flatNodes = flattenTaskNodes(group.nodes)
  const rootNode = group.nodes[0]
  const containsCurrent = flatNodes.some(node => node.threadId === currentThreadId)
  const isSimpleTask = group.kind === 'task' && flatNodes.length === 1
  const visibleNodes = group.kind === 'task' ? (rootNode?.children || []) : group.nodes
  const [expanded, setExpanded] = useState(containsCurrent || group.status === 'running' || group.status === 'waiting')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(group.title)
  const copy = t(STATUS_LABEL_KEYS[group.status], language)
  const openRoot = () => {
    if (rootNode?.threadId) onOpen(rootNode.threadId)
    else setExpanded(value => !value)
  }

  return <section className={`relative overflow-hidden rounded-lg transition-colors ${containsCurrent ? 'bg-accent/[0.09]' : group.status === 'waiting' ? 'bg-amber-400/[0.055]' : 'hover:bg-surface/[0.22]'}`}>
    <div className="group relative flex min-h-12 items-center gap-2.5 py-2 pl-3 pr-2">
      {renaming && rootNode?.threadId && <RenameOverlay value={renameValue} language={language} onChange={setRenameValue} onSave={() => { if (renameValue.trim()) onRename(rootNode.threadId!, renameValue.trim()); setRenaming(false) }} onCancel={() => setRenaming(false)} />}
      {!isSimpleTask && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/50">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} />
      </button>}
      <span className={isSimpleTask ? 'ml-0.5' : ''}><StatusMark status={group.status} /></span>
      <button type="button" onClick={openRoot} className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-accent/50">
        <span className="flex items-center gap-2">
          <span className={`truncate text-[11px] font-semibold ${containsCurrent ? 'text-accent' : 'text-text-primary'}`}>{group.title}</span>
          {!isSimpleTask && <span className="shrink-0 rounded bg-surface-active/45 px-1.5 py-0.5 text-[7px] font-medium text-text-muted">{group.kind === 'plan' ? 'PLAN' : (t('taskCommandCenter.runs', language, { length: flatNodes.length }))}</span>}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[8px] text-text-muted">
          <span className="truncate">{rootNode?.detail || copy}</span>
          <span>·</span>
          <span>{getRelativeTime(group.updatedAt, language)}</span>
          {rootNode?.branchCount ? <span className="flex shrink-0 items-center gap-0.5"><GitBranch className="h-2.5 w-2.5" />{rootNode.branchCount}</span> : null}
          {isSimpleTask && rootNode?.messageCount ? <span className="shrink-0 tabular-nums">{t('messagesCount', language, { count: rootNode.messageCount })}</span> : null}
          {group.progress && <span className="tabular-nums">{group.progress.completed}/{group.progress.total}</span>}
        </span>
      </button>
      {actionsOpen && rootNode?.threadId && <ThreadActionStrip language={language} onRename={() => { setActionsOpen(false); setRenameValue(group.title); setRenaming(true) }} onAction={action => { setActionsOpen(false); onReference(rootNode.threadId!, action) }} onDelete={() => { setActionsOpen(false); onDelete?.() }} deleteLabel={t('taskCommandCenter.deleteTask', language)} />}
      {rootNode?.threadId && <button type="button" onClick={() => setActionsOpen(value => !value)} aria-label={t('taskCommandCenter.threadActions', language)} className={`rounded-md p-1.5 text-text-muted/45 transition-all hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45 ${actionsOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}><MoreHorizontal className="h-3.5 w-3.5" /></button>}
    </div>
    <AnimatePresence initial={false}>
      {!isSimpleTask && expanded && visibleNodes.length > 0 && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
        <div className="space-y-0.5 bg-surface/[0.08] py-1 pl-2 pr-1.5">
          {visibleNodes.map(node => <TaskNodeRow key={node.id} node={node} currentThreadId={currentThreadId} language={language} onOpen={onOpen} onReference={onReference} onRename={onRename} onDelete={onDeleteNode} />)}
        </div>
      </motion.div>}
    </AnimatePresence>
  </section>
}

function BranchPanel({ language, onClose }: { language: Language; onClose: () => void }) {
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  // 必须用 selectBranches：内联写 `state.branches[id] || []` 每次都会返回新数组，
  // zustand v5 走 useSyncExternalStore 的严格引用比较，会判定快照一直在变 →
  // "getSnapshot should be cached" → 无限重渲染。selectBranches 带缓存且已过滤主线。
  const visible = useAgentStore(selectBranches)
  const activeBranchId = useAgentStore(state => currentThreadId ? state.activeBranchId[currentThreadId] : null)
  const switchBranch = useAgentStore(state => state.switchBranch)
  const switchToMainline = useAgentStore(state => state.switchToMainline)

  const openBranch = (branch?: Branch) => {
    if (branch) switchBranch(branch.id)
    else switchToMainline()
    onClose()
  }

  return <div className="space-y-1 px-1.5">
    <button type="button" onClick={() => openBranch()} className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${!activeBranchId ? 'bg-accent/[0.09]' : 'hover:bg-surface/35'}`}>
      <GitBranch className="h-4 w-4 text-accent" /><span className="min-w-0 flex-1"><strong className="block text-[11px] font-medium text-text-primary">{t('taskCommandCenter.mainline', language)}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{t('taskCommandCenter.originalExecutionPathFor', language)}</span></span>{!activeBranchId && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>
    {visible.map(branch => <button key={branch.id} type="button" onClick={() => openBranch(branch)} className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${activeBranchId === branch.id ? 'bg-accent/[0.09]' : 'hover:bg-surface/35'}`}>
      <Split className="h-4 w-4 text-text-muted" /><span className="min-w-0 flex-1"><strong className="block truncate text-[11px] font-medium text-text-primary">{branch.name}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{t('messagesCount', language, { count: branch.messages.length })} · {getRelativeTime(branch.createdAt, language)}</span></span>{activeBranchId === branch.id && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>)}
    {visible.length === 0 && <div className="flex flex-col items-center px-8 py-14 text-center"><OtterAsset asset="waveStand" className="h-14 w-14 object-contain opacity-80" /><p className="mt-3 text-[11px] font-medium text-text-secondary">{t('taskCommandCenter.noConversationBranchesYet', language)}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{t('taskCommandCenter.alternativePathsAppearHere', language)}</p></div>}
  </div>
}

export default function TaskCommandCenter({ isOpen, onClose, initialTab = 'history' }: TaskCommandCenterProps) {
  const language = useStore(state => state.language)
  const currentMode = useModeStore(state => state.currentMode)
  const threads = useAgentStore(state => state.threads)
  const branches = useAgentStore(state => state.branches)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const setInputPrompt = useAgentStore(state => state.setInputPrompt)
  const { switchThread, deleteThread, createThread, renameThread } = useAgentActions()
  const [tab, setTab] = useState<CenterTab>(initialTab === 'branches' ? 'branches' : 'focus')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setTab(initialTab === 'branches' ? 'branches' : 'focus')
    setQuery('')
  }, [initialTab, isOpen])

  const groups = useMemo(() => {
    const agentThreads = Object.fromEntries(Object.entries(threads).filter(([, thread]) => isAgentTaskThread(thread)))
    return projectTaskCenter(agentThreads, [], branches)
  }, [branches, threads])
  const counts = useMemo(() => {
    const nodes = groups.flatMap(group => flattenTaskNodes(group.nodes))
    return {
      running: nodes.filter(node => node.status === 'running' || node.status === 'handoff').length,
      waiting: nodes.filter(node => node.status === 'waiting').length,
      failed: nodes.filter(node => node.status === 'failed').length,
    }
  }, [groups])
  const taskSections = useMemo<TaskSection[]>(() => {
    const normalized = query.trim().toLowerCase()
    const matched = groups.filter(group => {
      const nodes = flattenTaskNodes(group.nodes)
      if (!normalized) return true
      return group.title.toLowerCase().includes(normalized) || nodes.some(node => `${node.title} ${node.detail || ''}`.toLowerCase().includes(normalized))
    })
    const attention = matched.filter(group => group.status === 'waiting' || group.status === 'failed')
    const running = matched.filter(group => group.status === 'running' || group.status === 'handoff')
    const claimed = new Set([...attention, ...running].map(group => group.id))
    const current = matched.filter(group => !claimed.has(group.id) && flattenTaskNodes(group.nodes).some(node => node.threadId === currentThreadId))
    current.forEach(group => claimed.add(group.id))
    const recent = matched.filter(group => !claimed.has(group.id))

    const sections: TaskSection[] = []
    if (attention.length > 0) sections.push({ id: 'attention', title: t('taskCommandCenter.needsAction', language), groups: attention })
    if (running.length > 0) sections.push({ id: 'running', title: t('common.running', language), groups: running })
    if (current.length > 0) sections.push({ id: 'current', title: t('taskCommandCenter.currentTask', language), groups: current })
    if (recent.length > 0) sections.push({ id: 'recent', title: t('taskCommandCenter.recent', language), groups: tab === 'focus' ? recent.slice(0, 5) : recent })
    return sections
  }, [currentThreadId, groups, language, query, tab])

  const focusCount = groups.filter(group => (
    group.status === 'waiting' || group.status === 'failed' || group.status === 'running' || group.status === 'handoff'
  )).length
  const currentBranchCount = currentThreadId
    ? (branches[currentThreadId] || []).filter(branch => branch.id !== '__mainline__').length
    : 0
  const activitySummary = counts.running
    ? t('taskCommandCenter.countRunning', language, { count: counts.running })
    : counts.waiting || counts.failed
      ? t('taskCommandCenter.countNeedAction', language, { count: counts.waiting + counts.failed })
      : t('taskCommandCenter.noBackgroundWork', language)

  const openThread = (threadId: string) => { switchThread(threadId); onClose() }

  const buildThreadReference = useCallback(async (thread: ChatThread): Promise<string> => {
    const title = getThreadDisplayTitle(thread)
    const structuredSummary = thread.contextSummary || thread.handoff.document?.summary
    if (structuredSummary) {
      return formatStructuredThreadReference(thread.id, title, structuredSummary, language)
    }

    const messages = thread.messagesHydrated === false
      ? await agentSessionRepository.loadThreadMessages(thread.id)
      : thread.messages
    if (messages.length === 0) return `> ${createThreadLinkMarkdown(thread.id, title, language)}`

    const generated = await generateSummary(messages, {
      type: 'detailed',
      maxTokens: 700,
      todos: thread.todos,
    })
    return formatGeneratedThreadReference(thread.id, title, generated, language)
  }, [language])

  const handleThreadReference = useCallback(async (threadId: string, action: ThreadReferenceAction) => {
    const thread = threads[threadId]
    if (!thread) return

    try {
      toast.info(t('taskCommandCenter.preparingThreadSummary', language))
      const reference = await buildThreadReference(thread)
      if (action === 'copy-reference') {
        const copied = await writeClipboardText(reference)
        if (!copied) throw new Error('clipboard unavailable')
        toast.success(t('taskCommandCenter.threadReferenceCopied', language))
        return
      }

      createThread({ mode: 'agent', origin: 'user' })
      setInputPrompt(`${t('taskCommandCenter.continueFromTheFollowing', language)}\n\n${reference}`)
      onClose()
    } catch {
      toast.error(t('taskCommandCenter.couldNotPrepareThread', language))
    }
  }, [buildThreadReference, createThread, language, onClose, setInputPrompt, threads])

  const deleteTaskNodes = useCallback((nodes: TaskCenterNode[]) => {
    flattenTaskNodes(nodes).reverse().forEach(node => {
      if (node.threadId) deleteThread(node.threadId)
    })
  }, [deleteThread])

  if (currentMode === 'plan') return null

  return <AnimatePresence>
    {isOpen && <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="absolute inset-0 z-40 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} aria-label={t('common.agentTasks', language)} className="absolute bottom-0 right-0 top-0 z-50 flex w-[min(400px,92vw)] flex-col bg-background backdrop-blur-2xl">
        <header className="shrink-0 px-3 pb-2.5 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2"><ListTree className="h-4 w-4 shrink-0 text-accent" /><div className="min-w-0"><h2 className="truncate text-[12px] font-semibold text-text-primary">{t('common.agentTasks', language)}</h2><p className="mt-0.5 text-[8px] text-text-muted">{t('taskCommandCenter.taskCountSummary', language, { count: groups.length, detail: activitySummary })}</p></div></div>
            <div className="flex shrink-0 items-center gap-0.5"><Button variant="ghost" size="icon" onClick={() => { createThread({ mode: 'agent', origin: 'user' }); onClose() }} title={t('common.newAgentTask', language)} className="h-7 w-7 rounded-md text-text-muted hover:bg-surface-hover hover:text-accent"><Plus className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-4 w-4" /></Button></div>
          </div>
        </header>

        <div className="shrink-0">
          <div className="grid h-10 grid-cols-3 gap-1 px-2 py-1 text-[9px] font-medium">
            {(['focus', 'all', 'branches'] as CenterTab[]).map(item => <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-lg px-2 transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${tab === item ? 'bg-accent/[0.1] text-accent' : 'text-text-muted hover:bg-surface/30 hover:text-text-secondary'}`}>{item === 'focus' ? `${t('taskCommandCenter.focus', language)}${focusCount ? ` ${focusCount}` : ''}` : item === 'all' ? `${t('taskCommandCenter.allTasks', language)} ${groups.length}` : `${t('taskCommandCenter.branches', language)}${currentBranchCount ? ` ${currentBranchCount}` : ''}`}</button>)}
          </div>
          {tab === 'all' && <label className="relative mx-3 mb-2 block"><span className="sr-only">{t('taskCommandCenter.searchAgentTasks', language)}</span><Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('taskCommandCenter.searchTasks', language)} className="h-7 w-full rounded-md bg-surface/35 pl-8 pr-7 text-[9px] text-text-primary placeholder:text-text-muted/55 focus:outline-none focus:ring-2 focus:ring-accent/20" />{query && <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-3 w-3" /></button>}</label>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {tab === 'branches' ? <div className="pt-2"><BranchPanel language={language} onClose={onClose} /></div> : <div>
            {taskSections.map(section => <section key={section.id}>
              <div className="flex h-8 items-center justify-between bg-surface/[0.14] px-3 text-[9px] font-semibold text-text-secondary"><span>{section.title}</span><span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-active/55 px-1 text-[8px] tabular-nums text-text-muted">{section.groups.length}</span></div>
              <div className="space-y-0.5 px-1 pb-1 pt-0.5">{section.groups.map(group => <TaskGroupCard key={group.id} group={group} currentThreadId={currentThreadId} language={language} onOpen={openThread} onReference={handleThreadReference} onRename={renameThread} onDelete={() => deleteTaskNodes(group.nodes)} onDeleteNode={node => deleteTaskNodes([node])} />)}</div>
            </section>)}
            {taskSections.length === 0 && <div className="flex flex-col items-center px-10 py-14 text-center"><OtterAsset asset="sitFront" className="h-14 w-14 object-contain opacity-80" /><p className="mt-3 text-[10px] font-medium text-text-secondary">{tab === 'focus' ? (t('taskCommandCenter.noTaskActivityYet', language)) : (t('taskCommandCenter.noMatchingTasks', language))}</p><p className="mt-1 max-w-52 text-[8px] leading-4 text-text-muted">{t('taskCommandCenter.executionAndSubTask', language)}</p><button type="button" onClick={() => { createThread({ mode: 'agent', origin: 'user' }); onClose() }} className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md bg-surface/45 px-2.5 text-[9px] text-text-secondary hover:bg-surface-hover hover:text-accent"><Plus className="h-3 w-3" />{t('taskCommandCenter.newTask', language)}</button></div>}
          </div>}
        </div>
      </motion.aside>
    </>}
  </AnimatePresence>
}
