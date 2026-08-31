import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Copy,
  GitBranch,
  ListTree,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  PauseCircle,
  Plus,
  Search,
  ShieldAlert,
  Split,
  Trash2,
  X,
} from 'lucide-react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
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

const statusCopy: Record<TaskCenterStatus, { zh: string; en: string }> = {
  running: { zh: '执行中', en: 'Running' },
  waiting: { zh: '需要处理', en: 'Needs input' },
  handoff: { zh: '交接中', en: 'Handing off' },
  failed: { zh: '失败', en: 'Failed' },
  completed: { zh: '已完成', en: 'Completed' },
  aborted: { zh: '已停止', en: 'Stopped' },
  idle: { zh: '可继续', en: 'Ready' },
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

function relationLabel(node: TaskCenterNode, language: string): string | null {
  if (node.relation === 'continuation') return language === 'zh' ? '续跑' : 'Continuation'
  if (node.relation === 'subtask') return language === 'zh' ? '子任务' : 'Sub-task'
  if (node.relation === 'plan-task') return language === 'zh' ? '计划任务' : 'Plan task'
  return null
}

function ThreadActionStrip({
  language,
  onAction,
  onDelete,
  deleteLabel,
}: {
  language: string
  onAction: (action: ThreadReferenceAction) => void
  onDelete?: () => void
  deleteLabel?: string
}) {
  const actions: Array<{ id: ThreadReferenceAction; label: string; icon: typeof Copy }> = [
    { id: 'copy-reference', label: language === 'zh' ? '复制会话引用' : 'Copy thread reference', icon: Copy },
    { id: 'reference-new', label: language === 'zh' ? '新对话引用' : 'Reference in new chat', icon: MessageSquarePlus },
  ]

  return <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface/45 p-0.5">
    {actions.map(action => <button key={action.id} type="button" onClick={() => onAction(action.id)} title={action.label} aria-label={action.label} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45"><action.icon className="h-3.5 w-3.5" /></button>)}
    {onDelete && <button type="button" onClick={onDelete} title={deleteLabel || (language === 'zh' ? '删除' : 'Delete')} aria-label={deleteLabel || (language === 'zh' ? '删除' : 'Delete')} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-400/45"><Trash2 className="h-3.5 w-3.5" /></button>}
  </div>
}

function TaskNodeRow({
  node,
  currentThreadId,
  language,
  onOpen,
  onReference,
  onDelete,
}: {
  node: TaskCenterNode
  currentThreadId: string | null
  language: string
  onOpen: (threadId: string) => void
  onReference: (threadId: string, action: ThreadReferenceAction) => void
  onDelete: (node: TaskCenterNode) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [actionsOpen, setActionsOpen] = useState(false)
  const hasChildren = node.children.length > 0
  const relation = relationLabel(node, language)
  const active = node.threadId === currentThreadId

  return <div>
    <div className="group relative" style={{ paddingLeft: `${node.depth * 17}px` }}>
      <button
        type="button"
        disabled={!node.threadId}
        onClick={() => node.threadId && onOpen(node.threadId)}
        className={`group relative flex min-h-11 w-full items-start gap-2 rounded-md py-1.5 pl-2 text-left transition-[background-color,padding] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45 ${actionsOpen ? 'pr-32' : 'pr-9'} ${active ? 'bg-accent/[0.065]' : 'hover:bg-surface/40'} disabled:cursor-default`}
      >
        {hasChildren ? <span
          role="button"
          tabIndex={0}
          aria-label={expanded ? 'Collapse' : 'Expand'}
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
            <span className="truncate">{node.detail || statusCopy[node.status][language === 'zh' ? 'zh' : 'en']}</span>
            {node.branchCount > 0 && <span className="flex shrink-0 items-center gap-0.5"><GitBranch className="h-2.5 w-2.5" />{node.branchCount}</span>}
            {node.messageCount > 0 && <span className="shrink-0 tabular-nums">{node.messageCount} msg</span>}
          </span>
        </span>
        {node.status === 'waiting' && !actionsOpen && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400 motion-reduce:animate-none" />}
      </button>
      {node.threadId && <div className="absolute right-1 top-2 flex items-center gap-0.5">
        {actionsOpen && <ThreadActionStrip language={language} onAction={action => { setActionsOpen(false); onReference(node.threadId!, action) }} onDelete={() => { setActionsOpen(false); onDelete(node) }} deleteLabel={language === 'zh' ? '删除子会话' : 'Delete sub-thread'} />}
        <button type="button" aria-label={language === 'zh' ? '会话操作' : 'Thread actions'} onClick={() => setActionsOpen(value => !value)} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted/55 transition-all hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45 ${actionsOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}><MoreHorizontal className="h-3.5 w-3.5" /></button>
      </div>}
    </div>
    {expanded && node.children.map(child => <TaskNodeRow key={child.id} node={child} currentThreadId={currentThreadId} language={language} onOpen={onOpen} onReference={onReference} onDelete={onDelete} />)}
  </div>
}

function TaskGroupCard({
  group,
  currentThreadId,
  language,
  onOpen,
  onReference,
  onDelete,
  onDeleteNode,
}: {
  group: TaskCenterGroup
  currentThreadId: string | null
  language: string
  onOpen: (threadId: string) => void
  onReference: (threadId: string, action: ThreadReferenceAction) => void
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
  const copy = statusCopy[group.status][language === 'zh' ? 'zh' : 'en']
  const openRoot = () => {
    if (rootNode?.threadId) onOpen(rootNode.threadId)
    else setExpanded(value => !value)
  }

  return <section className={`relative overflow-hidden rounded-lg transition-colors ${containsCurrent ? 'bg-accent/[0.09]' : group.status === 'waiting' ? 'bg-amber-400/[0.055]' : 'hover:bg-surface/[0.22]'}`}>
    <div className="group flex min-h-12 items-center gap-2.5 py-2 pl-3 pr-2">
      {!isSimpleTask && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/50">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} />
      </button>}
      <span className={isSimpleTask ? 'ml-0.5' : ''}><StatusMark status={group.status} /></span>
      <button type="button" onClick={openRoot} className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-accent/50">
        <span className="flex items-center gap-2">
          <span className={`truncate text-[11px] font-semibold ${containsCurrent ? 'text-accent' : 'text-text-primary'}`}>{group.title}</span>
          {!isSimpleTask && <span className="shrink-0 rounded bg-surface-active/45 px-1.5 py-0.5 text-[7px] font-medium text-text-muted">{group.kind === 'plan' ? 'PLAN' : (language === 'zh' ? `${flatNodes.length} 个执行节点` : `${flatNodes.length} runs`)}</span>}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[8px] text-text-muted">
          <span className="truncate">{rootNode?.detail || copy}</span>
          <span>·</span>
          <span>{getRelativeTime(group.updatedAt, language)}</span>
          {rootNode?.branchCount ? <span className="flex shrink-0 items-center gap-0.5"><GitBranch className="h-2.5 w-2.5" />{rootNode.branchCount}</span> : null}
          {isSimpleTask && rootNode?.messageCount ? <span className="shrink-0 tabular-nums">{rootNode.messageCount} msg</span> : null}
          {group.progress && <span className="tabular-nums">{group.progress.completed}/{group.progress.total}</span>}
        </span>
      </button>
      {actionsOpen && rootNode?.threadId && <ThreadActionStrip language={language} onAction={action => { setActionsOpen(false); onReference(rootNode.threadId!, action) }} onDelete={() => { setActionsOpen(false); onDelete?.() }} deleteLabel={language === 'zh' ? '删除任务' : 'Delete task'} />}
      {rootNode?.threadId && <button type="button" onClick={() => setActionsOpen(value => !value)} aria-label={language === 'zh' ? '会话操作' : 'Thread actions'} className={`rounded-md p-1.5 text-text-muted/45 transition-all hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/45 ${actionsOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}><MoreHorizontal className="h-3.5 w-3.5" /></button>}
    </div>
    <AnimatePresence initial={false}>
      {!isSimpleTask && expanded && visibleNodes.length > 0 && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
        <div className="space-y-0.5 bg-surface/[0.08] py-1 pl-2 pr-1.5">
          {visibleNodes.map(node => <TaskNodeRow key={node.id} node={node} currentThreadId={currentThreadId} language={language} onOpen={onOpen} onReference={onReference} onDelete={onDeleteNode} />)}
        </div>
      </motion.div>}
    </AnimatePresence>
  </section>
}

function BranchPanel({ language, onClose }: { language: string; onClose: () => void }) {
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const branches = useAgentStore(state => currentThreadId ? state.branches[currentThreadId] || [] : [])
  const activeBranchId = useAgentStore(state => currentThreadId ? state.activeBranchId[currentThreadId] : null)
  const switchBranch = useAgentStore(state => state.switchBranch)
  const switchToMainline = useAgentStore(state => state.switchToMainline)
  const visible = branches.filter(branch => branch.id !== '__mainline__')

  const openBranch = (branch?: Branch) => {
    if (branch) switchBranch(branch.id)
    else switchToMainline()
    onClose()
  }

  return <div className="space-y-1 px-1.5">
    <button type="button" onClick={() => openBranch()} className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${!activeBranchId ? 'bg-accent/[0.09]' : 'hover:bg-surface/35'}`}>
      <GitBranch className="h-4 w-4 text-accent" /><span className="min-w-0 flex-1"><strong className="block text-[11px] font-medium text-text-primary">{language === 'zh' ? '主线对话' : 'Mainline'}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{language === 'zh' ? '当前任务的原始执行路径' : 'Original execution path for this task'}</span></span>{!activeBranchId && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>
    {visible.map(branch => <button key={branch.id} type="button" onClick={() => openBranch(branch)} className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${activeBranchId === branch.id ? 'bg-accent/[0.09]' : 'hover:bg-surface/35'}`}>
      <Split className="h-4 w-4 text-text-muted" /><span className="min-w-0 flex-1"><strong className="block truncate text-[11px] font-medium text-text-primary">{branch.name}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{branch.messages.length} msg · {getRelativeTime(branch.createdAt, language)}</span></span>{activeBranchId === branch.id && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>)}
    {visible.length === 0 && <div className="flex flex-col items-center px-8 py-14 text-center"><GitBranch className="h-7 w-7 text-text-muted/30" /><p className="mt-3 text-[11px] font-medium text-text-secondary">{language === 'zh' ? '当前任务还没有对话分支' : 'No conversation branches yet'}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{language === 'zh' ? '从某条消息重新生成时，备选路径会出现在这里。' : 'Alternative paths appear here after regenerating from a message.'}</p></div>}
  </div>
}

export default function TaskCommandCenter({ isOpen, onClose, initialTab = 'history' }: TaskCommandCenterProps) {
  const language = useStore(state => state.language)
  const currentMode = useModeStore(state => state.currentMode)
  const threads = useAgentStore(state => state.threads)
  const branches = useAgentStore(state => state.branches)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const setInputPrompt = useAgentStore(state => state.setInputPrompt)
  const { switchThread, deleteThread, createThread } = useAgentActions()
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
    if (attention.length > 0) sections.push({ id: 'attention', title: language === 'zh' ? '需要处理' : 'Needs action', groups: attention })
    if (running.length > 0) sections.push({ id: 'running', title: language === 'zh' ? '执行中' : 'Running', groups: running })
    if (current.length > 0) sections.push({ id: 'current', title: language === 'zh' ? '当前任务' : 'Current task', groups: current })
    if (recent.length > 0) sections.push({ id: 'recent', title: language === 'zh' ? '最近' : 'Recent', groups: tab === 'focus' ? recent.slice(0, 5) : recent })
    return sections
  }, [currentThreadId, groups, language, query, tab])

  const focusCount = groups.filter(group => (
    group.status === 'waiting' || group.status === 'failed' || group.status === 'running' || group.status === 'handoff'
  )).length
  const currentBranchCount = currentThreadId
    ? (branches[currentThreadId] || []).filter(branch => branch.id !== '__mainline__').length
    : 0

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
      toast.info(language === 'zh' ? '正在整理会话摘要…' : 'Preparing thread summary…')
      const reference = await buildThreadReference(thread)
      if (action === 'copy-reference') {
        const copied = await writeClipboardText(reference)
        if (!copied) throw new Error('clipboard unavailable')
        toast.success(language === 'zh' ? '已复制会话引用' : 'Thread reference copied')
        return
      }

      createThread({ mode: 'agent', origin: 'user' })
      setInputPrompt(`${language === 'zh' ? '请基于以下会话上下文继续：' : 'Continue from the following thread context:'}\n\n${reference}`)
      onClose()
    } catch {
      toast.error(language === 'zh' ? '处理会话引用失败' : 'Could not prepare thread reference')
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
      <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} aria-label={language === 'zh' ? 'Agent 任务' : 'Agent tasks'} className="absolute bottom-0 right-0 top-0 z-50 flex w-[min(400px,92vw)] flex-col bg-background backdrop-blur-2xl">
        <header className="shrink-0 px-3 pb-2.5 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2"><ListTree className="h-4 w-4 shrink-0 text-accent" /><div className="min-w-0"><h2 className="truncate text-[12px] font-semibold text-text-primary">{language === 'zh' ? 'Agent 任务' : 'Agent tasks'}</h2><p className="mt-0.5 text-[8px] text-text-muted">{language === 'zh' ? `${groups.length} 个任务 · ${counts.running ? `${counts.running} 个正在执行` : counts.waiting || counts.failed ? `${counts.waiting + counts.failed} 个需要处理` : '当前无后台执行'}` : `${groups.length} tasks · ${counts.running ? `${counts.running} running` : counts.waiting || counts.failed ? `${counts.waiting + counts.failed} need action` : 'no background work'}`}</p></div></div>
            <div className="flex shrink-0 items-center gap-0.5"><Button variant="ghost" size="icon" onClick={() => { createThread({ mode: 'agent', origin: 'user' }); onClose() }} title={language === 'zh' ? '新建 Agent 任务' : 'New Agent task'} className="h-7 w-7 rounded-md text-text-muted hover:bg-surface-hover hover:text-accent"><Plus className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-4 w-4" /></Button></div>
          </div>
        </header>

        <div className="shrink-0">
          <div className="grid h-10 grid-cols-3 gap-1 px-2 py-1 text-[9px] font-medium">
            {(['focus', 'all', 'branches'] as CenterTab[]).map(item => <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-lg px-2 transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${tab === item ? 'bg-accent/[0.1] text-accent' : 'text-text-muted hover:bg-surface/30 hover:text-text-secondary'}`}>{item === 'focus' ? `${language === 'zh' ? '关注' : 'Focus'}${focusCount ? ` ${focusCount}` : ''}` : item === 'all' ? `${language === 'zh' ? '全部任务' : 'All tasks'} ${groups.length}` : `${language === 'zh' ? '当前分支' : 'Branches'}${currentBranchCount ? ` ${currentBranchCount}` : ''}`}</button>)}
          </div>
          {tab === 'all' && <label className="relative mx-3 mb-2 block"><span className="sr-only">{language === 'zh' ? '搜索 Agent 任务' : 'Search Agent tasks'}</span><Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={language === 'zh' ? '搜索任务…' : 'Search tasks…'} className="h-7 w-full rounded-md bg-surface/35 pl-8 pr-7 text-[9px] text-text-primary placeholder:text-text-muted/55 focus:outline-none focus:ring-2 focus:ring-accent/20" />{query && <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-3 w-3" /></button>}</label>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {tab === 'branches' ? <div className="pt-2"><BranchPanel language={language} onClose={onClose} /></div> : <div>
            {taskSections.map(section => <section key={section.id}>
              <div className="flex h-8 items-center justify-between bg-surface/[0.14] px-3 text-[9px] font-semibold text-text-secondary"><span>{section.title}</span><span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-active/55 px-1 text-[8px] tabular-nums text-text-muted">{section.groups.length}</span></div>
              <div className="space-y-0.5 px-1 pb-1 pt-0.5">{section.groups.map(group => <TaskGroupCard key={group.id} group={group} currentThreadId={currentThreadId} language={language} onOpen={openThread} onReference={handleThreadReference} onDelete={() => deleteTaskNodes(group.nodes)} onDeleteNode={node => deleteTaskNodes([node])} />)}</div>
            </section>)}
            {taskSections.length === 0 && <div className="flex flex-col items-center px-10 py-14 text-center"><Clock3 className="h-6 w-6 text-text-muted/30" /><p className="mt-3 text-[10px] font-medium text-text-secondary">{tab === 'focus' ? (language === 'zh' ? '当前没有任务记录' : 'No task activity yet') : (language === 'zh' ? '没有匹配的任务' : 'No matching tasks')}</p><p className="mt-1 max-w-52 text-[8px] leading-4 text-text-muted">{language === 'zh' ? '新建任务后，执行状态和子任务关系会显示在这里。' : 'Execution and sub-task lineage appears here after creating a task.'}</p><button type="button" onClick={() => { createThread({ mode: 'agent', origin: 'user' }); onClose() }} className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md bg-surface/45 px-2.5 text-[9px] text-text-secondary hover:bg-surface-hover hover:text-accent"><Plus className="h-3 w-3" />{language === 'zh' ? '新建任务' : 'New task'}</button></div>}
          </div>}
        </div>
      </motion.aside>
    </>}
  </AnimatePresence>
}
