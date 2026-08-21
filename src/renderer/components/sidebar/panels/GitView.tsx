/**
 * Git 源代码管理面板
 * 功能: 状态查看、暂存/提交、分支管理、Stash、Rebase、Cherry-pick 等
 */
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import {
    GitBranch, GitCommit as GitCommitIcon, GitMerge, GitPullRequest,
    ChevronDown, ChevronRight, Plus, Minus, RefreshCw, Trash2,
    ArrowUp, ArrowDown, ArrowRight, Check, X, MoreHorizontal, FolderGit2, Upload,
    FolderOpen, Download, Undo2, RotateCcw, Copy, Archive, AlertTriangle,
    Play, SkipForward, Loader2, Sparkles, List, Maximize
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type TranslationKey } from '@renderer/i18n'
import { gitService, GitStatus, GitCommit, GitBranch as GitBranchType, GitStashEntry, type GitRepository, type GitFileChange } from '@renderer/services/gitService'
import { workspaceManager } from '@renderer/services/WorkspaceManager'
import { getEditorConfig } from '@renderer/settings'
import { DEFAULT_GIT_COMMIT_PROMPT } from '@shared/config/defaults'
import { toast } from '@components/common/ToastProvider'
import { globalConfirm } from '@components/common/ConfirmDialog'
import { keybindingService } from '@services/keybindingService'
import { Input, Button, Modal, Select, ContextMenu, useContextMenu, type ContextMenuItem } from '@components/ui'
import { getFileName, joinPath, normalizePath, toFullPath } from '@shared/utils/pathUtils'
import { ConflictResolver } from '@components/git/ConflictResolver'
import { useClickOutside } from '@renderer/hooks/usePerformance'
import { writeClipboardText } from '@/renderer/services/clipboardService'

// ==================== 类型定义 ====================
type GitTab = 'changes' | 'branches' | 'stash' | 'history'
type OperationState = 'normal' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'
type RepoChangesSections = { staged: boolean; changes: boolean }

interface RepoChangesSnapshot {
    status: GitStatus | null
    operationState: OperationState
    isRefreshing: boolean
    error: string | null
}

const GIT_TABS: GitTab[] = [
    'changes',
    'branches',
    'stash',
    'history',
]

const DEFAULT_REPO_CHANGES_SECTIONS: RepoChangesSections = {
    staged: true,
    changes: true,
}

// ==================== 子组件 ====================

// 文件状态图标
const FileStatusBadge = memo(function FileStatusBadge({ status }: { status: string }) {
    const config: Record<string, { color: string; label: string }> = {
        added: { color: 'text-green-400', label: 'A' },
        modified: { color: 'text-yellow-400', label: 'M' },
        deleted: { color: 'text-red-400', label: 'D' },
        renamed: { color: 'text-blue-400', label: 'R' },
        copied: { color: 'text-purple-400', label: 'C' },
        unmerged: { color: 'text-orange-400', label: 'U' },
        untracked: { color: 'text-green-400', label: 'U' },
    }
    const c = config[status] || { color: 'text-text-muted', label: '?' }
    return <span className={`text-[10px] font-mono ${c.color} w-4 text-center flex-shrink-0`}>{c.label}</span>
})

// 文件项组件
const FileItem = memo(function FileItem({
    path,
    status,
    staged,
    onStage,
    onUnstage,
    onDiscard,
    onClick,
}: {
    path: string
    status: string
    staged: boolean
    onStage?: () => void
    onUnstage?: () => void
    onDiscard?: () => void
    onClick: () => void
}) {
    const fileName = getFileName(path)
    const dirPath = path.replace(fileName, '').replace(/[/\\]$/, '')
    const language = useStore(s => s.language)
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])

    return (
        <div
            className="group flex items-center px-2 py-1.5 mx-2 my-0.5 rounded-md hover:bg-surface-hover cursor-pointer transition-colors border border-transparent hover:border-border-subtle"
            onClick={onClick}
        >
            <FileStatusBadge status={status} />
            <div className="flex-1 min-w-0 ml-2">
                <span className="text-xs text-text-primary truncate block">{fileName}</span>
                {dirPath && <span className="text-[10px] text-text-muted truncate block opacity-60">{dirPath}</span>}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {staged ? (
                    onUnstage && <button
                        onClick={(e) => { e.stopPropagation(); onUnstage() }}
                        className="p-1 hover:bg-surface-active rounded"
                        title={tt('git.unstage')}
                    >
                        <Minus className="w-3 h-3 text-text-muted" />
                    </button>
                ) : (
                    <>
                        {onDiscard && <button
                            onClick={(e) => { e.stopPropagation(); onDiscard() }}
                            className="p-1 hover:bg-surface-active rounded"
                            title={tt('git.discard')}
                        >
                            <Undo2 className="w-3 h-3 text-text-muted hover:text-red-400" />
                        </button>}
                        {onStage && <button
                            onClick={(e) => { e.stopPropagation(); onStage() }}
                            className="p-1 hover:bg-surface-active rounded"
                            title={tt('git.stage')}
                        >
                            <Plus className="w-3 h-3 text-text-muted" />
                        </button>}
                    </>
                )}
            </div>
        </div>
    )
})

// 从远程 URL 提取主机名（支持 https 与 git@host:path 两种形式）
const hostOfRemoteUrl = (url: string): string => {
    if (!url) return ''
    if (url.startsWith('http')) {
        try {
            return new URL(url).host
        } catch {
            return url
        }
    }
    const sshMatch = url.match(/^[\w.-]+@([\w.-]+):/)
    return sshMatch ? sshMatch[1] : url
}

// 分支项组件
const BranchItem = memo(function BranchItem({
    branch,
    onCheckout,
    onDelete,
    onMerge,
    onMergeInto,
    onPushTo,
    onRebase,
    onPull,
}: {
    branch: GitBranchType
    onCheckout: () => void
    onDelete: () => void
    onMerge: () => void
    onMergeInto?: () => void
    onPushTo?: () => void
    onRebase: () => void
    onPull?: () => void
}) {
    const language = useStore(s => s.language)
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])
    const { menu, show, hide } = useContextMenu<GitBranchType>()

    // 当前分支仅提供"合并到..."；其他分支提供完整菜单
    const menuItems: ContextMenuItem[] = branch.current
        ? (onMergeInto ? [{
            id: 'mergeInto',
            label: tt('git.mergeInto'),
            icon: ArrowRight,
            onClick: onMergeInto,
        }] : [])
        : [
            ...(branch.remote ? [{
                id: 'checkout',
                label: tt('git.checkout'),
                icon: GitBranch,
                onClick: onCheckout,
            }] : []),
            ...(onPull ? [{
                id: 'pull',
                label: tt('git.pullIntoCurrent'),
                icon: ArrowDown,
                onClick: onPull,
            }] : []),
            // "合并到当前分支"仅限本地分支；远程分支用"拉取到当前分支"
            ...(!branch.remote ? [{
                id: 'merge',
                label: tt('git.mergeIntoCurrent'),
                icon: GitMerge,
                onClick: onMerge,
            }] : []),
            ...(onMergeInto ? [{
                id: 'mergeInto',
                label: tt('git.mergeInto'),
                icon: ArrowRight,
                onClick: onMergeInto,
            }] : []),
            // "推送到..."仅限本地分支，支持多远程同步（如 GitHub + Gitee）
            ...(onPushTo ? [{
                id: 'pushTo',
                label: tt('git.pushTo'),
                icon: Upload,
                onClick: onPushTo,
            }] : []),
            { id: 'rebase', label: tt('git.rebase'), icon: RotateCcw, onClick: onRebase },
            { id: 'separator', label: '', separator: true },
            { id: 'delete', label: tt('delete'), icon: Trash2, danger: true, onClick: onDelete },
        ]

    return (
        <div
            className={`group flex items-center px-3 py-1.5 hover:bg-surface-hover cursor-pointer transition-colors ${branch.current ? 'bg-accent/10' : ''
                }`}
            onClick={() => !branch.current && !branch.remote && onCheckout()}
            onContextMenu={(e) => {
                // 当前分支仅在提供"合并到..."时弹菜单
                if (branch.current && !onMergeInto) return
                show(e, branch)
            }}
        >
            {branch.current ? (
                <Check className="w-3 h-3 text-accent mr-2 flex-shrink-0" />
            ) : (
                <div className="w-3 h-3 mr-2 flex-shrink-0" />
            )}
            <GitBranch className={`w-3 h-3 mr-2 flex-shrink-0 ${branch.remote ? 'text-purple-400' : 'text-accent'}`} />
            <span className={`text-xs flex-1 truncate ${branch.current ? 'text-accent font-medium' : 'text-text-secondary'}`}>
                {/* 远程分支在分组内展示，去掉远程前缀只显示分支名 */}
                {branch.remote ? branch.name.slice(branch.name.indexOf('/') + 1) : branch.name}
            </span>
            {(branch.ahead && branch.ahead > 0) || (branch.behind && branch.behind > 0) ? (
                <div className="flex items-center gap-1 mr-2">
                    {branch.ahead && branch.ahead > 0 ? (
                        <span className="text-[10px] text-green-400 flex items-center">
                            <ArrowUp className="w-2.5 h-2.5" />{branch.ahead}
                        </span>
                    ) : null}
                    {branch.behind && branch.behind > 0 ? (
                        <span className="text-[10px] text-orange-400 flex items-center">
                            <ArrowDown className="w-2.5 h-2.5" />{branch.behind}
                        </span>
                    ) : null}
                </div>
            ) : null}
            {(!branch.current || onMergeInto) && (
                <button
                    onClick={(e) => show(e, branch)}
                    className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <MoreHorizontal className="w-3 h-3 text-text-muted" />
                </button>
            )}
            {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={hide} />}
        </div>
    )
})

// Commit 项组件
const CommitItem = memo(function CommitItem({
    commit,
    onCherryPick,
    onRevert,
    onCopyHash,
    files,
    filesLoading,
    expanded,
    onToggle,
    onOpenFile,
}: {
    commit: GitCommit
    onCherryPick: () => void
    onRevert: () => void
    onCopyHash: () => void
    files: GitFileChange[] | null
    filesLoading: boolean
    expanded: boolean
    onToggle: () => void
    onOpenFile: (file: GitFileChange) => void
}) {
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const language = useStore(s => s.language)
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])
    const timeAgo = getTimeAgo(commit.date, language)

    useClickOutside(() => setShowMenu(false), showMenu, [menuRef, buttonRef])

    return (
        <div className="border-l-2 border-transparent hover:border-accent transition-colors">
            <div
                className="group px-3 py-2 hover:bg-surface-hover cursor-pointer"
                onClick={onToggle}
            >
                <div className="flex items-start gap-2">
                    {expanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />}
                    <GitCommitIcon className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <div className="text-xs text-text-primary truncate font-medium">{commit.message}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-accent font-mono">{commit.shortHash}</span>
                            <span className="text-[10px] text-text-muted">{commit.author}</span>
                            <span className="text-[10px] text-text-muted opacity-60">{timeAgo}</span>
                        </div>
                    </div>
                    <div className="relative" ref={menuRef}>
                        <button
                            ref={buttonRef}
                            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
                            className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <MoreHorizontal className="w-3 h-3 text-text-muted" />
                        </button>
                        {showMenu && (
                            <div className="absolute right-0 top-full mt-1 bg-surface border border-border-subtle rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onCopyHash(); setShowMenu(false) }}
                                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                                >
                                    <Copy className="w-3 h-3" /> {tt('git.copyHash')}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onCherryPick(); setShowMenu(false) }}
                                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                                >
                                    <GitPullRequest className="w-3 h-3" /> {tt('git.cherryPick')}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onRevert(); setShowMenu(false) }}
                                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                                >
                                    <Undo2 className="w-3 h-3" /> {tt('git.revert')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {expanded && (
                <div className="pb-2 pl-8 pr-3 space-y-0.5">
                    {filesLoading && (
                        <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-text-muted">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {tt('git.loadingDiff')}
                        </div>
                    )}
                    {!filesLoading && files && files.length === 0 && (
                        <div className="px-2 py-1 text-[10px] text-text-muted">{tt('git.noChangedFiles')}</div>
                    )}
                    {!filesLoading && files?.map((file) => (
                        <button
                            key={`${file.status}:${file.oldPath || ''}:${file.path}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenFile(file) }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-surface-hover text-[11px]"
                        >
                            <span className={`font-mono w-3 flex-shrink-0 ${
                                file.status === 'added' ? 'text-status-success'
                                    : file.status === 'deleted' ? 'text-status-error'
                                        : 'text-status-warning'
                            }`}>
                                {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
                            </span>
                            <span className="truncate text-text-secondary">{file.path}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
})

// Stash 项组件
const StashItem = memo(function StashItem({
    stash,
    onApply,
    onPop,
    onDrop,
    files,
    filesLoading,
    expanded,
    onToggle,
    onOpenFile,
}: {
    stash: GitStashEntry
    onApply: () => void
    onPop: () => void
    onDrop: () => void
    files: GitFileChange[] | null
    filesLoading: boolean
    expanded: boolean
    onToggle: () => void
    onOpenFile: (file: GitFileChange) => void
}) {
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const language = useStore(s => s.language)
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])

    useClickOutside(() => setShowMenu(false), showMenu, [menuRef, buttonRef])

    return (
        <div>
            <div className="group px-3 py-2 hover:bg-surface-hover cursor-pointer" onClick={onToggle}>
                <div className="flex items-start gap-2">
                    {expanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />}
                    <Archive className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <div className="text-xs text-text-primary truncate">{stash.message || 'WIP'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-accent font-mono">stash@{`{${stash.index}}`}</span>
                            <span className="text-[10px] text-text-muted">on {stash.branch}</span>
                        </div>
                    </div>
                    <div className="relative" ref={menuRef}>
                        <button
                            ref={buttonRef}
                            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
                            className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <MoreHorizontal className="w-3 h-3 text-text-muted" />
                        </button>
                        {showMenu && (
                            <div className="absolute right-0 top-full mt-1 bg-surface border border-border-subtle rounded-lg shadow-xl z-50 py-1 min-w-[120px]">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onApply(); setShowMenu(false) }}
                                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                                >
                                    <Play className="w-3 h-3" /> {tt('git.stashApply')}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onPop(); setShowMenu(false) }}
                                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                                >
                                    <ArrowUp className="w-3 h-3" /> {tt('git.stashPop')}
                                </button>
                                <div className="border-t border-border-subtle my-1" />
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDrop(); setShowMenu(false) }}
                                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover text-red-400 flex items-center gap-2"
                                >
                                    <Trash2 className="w-3 h-3" /> {tt('git.stashDrop')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {expanded && (
                <div className="pb-2 pl-8 pr-3 space-y-0.5">
                    {filesLoading && (
                        <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-text-muted">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {tt('git.loadingDiff')}
                        </div>
                    )}
                    {!filesLoading && files && files.length === 0 && (
                        <div className="px-2 py-1 text-[10px] text-text-muted">{tt('git.noChangedFiles')}</div>
                    )}
                    {!filesLoading && files?.map((file) => (
                        <button
                            key={`${file.status}:${file.oldPath || ''}:${file.path}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenFile(file) }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-surface-hover text-[11px]"
                        >
                            <span className={`font-mono w-3 flex-shrink-0 ${
                                file.status === 'added' ? 'text-status-success'
                                    : file.status === 'deleted' ? 'text-status-error'
                                        : 'text-status-warning'
                            }`}>
                                {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
                            </span>
                            <span className="truncate text-text-secondary">{file.path}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
})

// Repo 操作菜单组件
const RepoMenu = memo(function RepoMenu({
    repoRoot,
    onFetch,
    onPull,
    onPush,
    tt,
}: {
    repoRoot: string
    onFetch: (root: string) => void
    onPull: (root: string) => void
    onPush: (root: string) => void
    tt: (key: TranslationKey) => string
}) {
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    useClickOutside(() => setShowMenu(false), showMenu, [menuRef, buttonRef])

    return (
        <div className="relative flex" ref={menuRef}>
            <Button
                ref={buttonRef as any}
                variant="icon"
                size="icon"
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
                className="h-6 w-6 rounded-md"
            >
                <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
            {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-surface border border-border-subtle rounded-lg shadow-xl z-50 py-1 min-w-[120px]">
                    <button
                        onClick={(e) => { e.stopPropagation(); onFetch(repoRoot); setShowMenu(false) }}
                        className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                    >
                        <ArrowDown className="w-3 h-3" /> {tt('git.fetch')}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onPull(repoRoot); setShowMenu(false) }}
                        className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                    >
                        <ArrowDown className="w-3 h-3" /> {tt('git.pull')}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onPush(repoRoot); setShowMenu(false) }}
                        className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                    >
                        <ArrowUp className="w-3 h-3" /> {tt('git.push')}
                    </button>
                </div>
            )}
        </div>
    )
})

// 时间格式化 (带语言参数)
function getTimeAgo(date: Date, language: 'en' | 'zh'): string {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (minutes < 1) return t('justNow', language)
    if (minutes < 60) return t('minutesAgo', language, { count: String(minutes) })
    if (hours < 24) return t('hoursAgo', language, { count: String(hours) })
    if (days < 7) return t('daysAgo', language, { count: String(days) })
    return date.toLocaleDateString()
}

function getCloneFolderName(url: string): string {
    const trimmed = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/i, '')
    const lastSegment = trimmed.split(/[/\\:]/).filter(Boolean).pop()
    return lastSegment?.replace(/[<>:"|?*]/g, '-').trim() || 'repository'
}

// ==================== 主组件 ====================
export function GitView() {
    const { workspacePath, language, openFile, setActiveFile } = useStore(useShallow(s => ({ workspacePath: s.workspacePath, language: s.language, openFile: s.openFile, setActiveFile: s.setActiveFile })))
    const discoveryRunRef = useRef(0)
    const refreshRunRef = useRef(0)
    const selectedRepoRootRef = useRef<string | null>(null)

    // 状态
    const [activeTab, setActiveTab] = useState<GitTab>('changes')
    const [status, setStatus] = useState<GitStatus | null>(null)
    const [commits, setCommits] = useState<GitCommit[]>([])
    const [branches, setBranches] = useState<GitBranchType[]>([])
    const [stashList, setStashList] = useState<GitStashEntry[]>([])
    const [operationState, setOperationState] = useState<OperationState>('normal')
    const [isGitRepository, setIsGitRepository] = useState<boolean | null>(null)
    const [repoRoots, setRepoRoots] = useState<GitRepository[]>([])
    const [selectedRepoRoot, setSelectedRepoRoot] = useState<string | null>(null)
    const [isDiscoveringRepos, setIsDiscoveringRepos] = useState(false)
    const [hasResolvedRepositories, setHasResolvedRepositories] = useState(false)
    const [repoDisplayMode, setRepoDisplayMode] = useState<'select' | 'list'>('list')
    const [repoSnapshots, setRepoSnapshots] = useState<Record<string, RepoChangesSnapshot>>({})
    const [repoCommitMessages, setRepoCommitMessages] = useState<Record<string, string>>({})
    const [repoIsCommitting, setRepoIsCommitting] = useState<Record<string, boolean>>({})
    const [repoIsGeneratingMessages, setRepoIsGeneratingMessages] = useState<Record<string, boolean>>({})
    const [repoExpandedSections, setRepoExpandedSections] = useState<Record<string, RepoChangesSections>>({})

    // UI 状态
    const [commitMessage, setCommitMessage] = useState('')
    const [isCommitting, setIsCommitting] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [isPushing, setIsPushing] = useState(false)
    const [isPulling, setIsPulling] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isGeneratingMessage, setIsGeneratingMessage] = useState(false)
    const [showCloneInput, setShowCloneInput] = useState(false)
    const [cloneUrl, setCloneUrl] = useState('')
    const [isCloning, setIsCloning] = useState(false)

    // 展开状态
    const [expandedSections, setExpandedSections] = useState({
        staged: true,
        changes: true,
        stash: false,
        localBranches: true,
        remoteBranches: false,
    })

    // 新建分支
    const [showNewBranch, setShowNewBranch] = useState(false)
    const [newBranchName, setNewBranchName] = useState('')

    // Stash 消息
    const [showStashInput, setShowStashInput] = useState(false)
    const [stashMessage, setStashMessage] = useState('')

    // Commit / Stash 展开与按文件 diff
    const [expandedCommitHash, setExpandedCommitHash] = useState<string | null>(null)
    const [commitFilesByHash, setCommitFilesByHash] = useState<Record<string, GitFileChange[]>>({})
    const [commitFilesLoading, setCommitFilesLoading] = useState<string | null>(null)
    const [expandedStashIndex, setExpandedStashIndex] = useState<number | null>(null)
    const [stashFilesByIndex, setStashFilesByIndex] = useState<Record<number, GitFileChange[]>>({})
    const [stashFilesLoading, setStashFilesLoading] = useState<number | null>(null)

    // 冲突解决
    const [conflictFile, setConflictFile] = useState<string | null>(null)

    // 国际化辅助函数
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])
    const isMultiRepo = repoRoots.length > 1
    const isRepoListMode = isMultiRepo && activeTab === 'changes' && repoDisplayMode === 'list'

    const updateRepoCommitMessage = useCallback((root: string, value: string) => {
        setRepoCommitMessages(prev => ({ ...prev, [root]: value }))
    }, [])

    const getRepoExpandedSections = useCallback((root: string): RepoChangesSections => {
        return repoExpandedSections[root] || DEFAULT_REPO_CHANGES_SECTIONS
    }, [repoExpandedSections])

    const toggleRepoSection = useCallback((root: string, section: keyof RepoChangesSections) => {
        setRepoExpandedSections(prev => {
            const current = prev[root] || DEFAULT_REPO_CHANGES_SECTIONS
            return {
                ...prev,
                [root]: {
                    ...current,
                    [section]: !current[section],
                },
            }
        })
    }, [])

    const discoverRepositories = useCallback(async (forceRefresh: boolean = false): Promise<{ repositories: GitRepository[]; preferredRoot: string | null }> => {
        if (!workspacePath) {
            setRepoRoots([])
            setSelectedRepoRoot(null)
            setHasResolvedRepositories(true)
            return { repositories: [], preferredRoot: null }
        }

        const runId = ++discoveryRunRef.current
        setIsDiscoveringRepos(true)
        try {
            const repositories = await gitService.discoverRepositories(workspacePath, 1, forceRefresh)
            const currentSelectedRoot = selectedRepoRootRef.current
            const preferredRoot = currentSelectedRoot && repositories.some(repo => repo.root === currentSelectedRoot)
                ? currentSelectedRoot
                : repositories.find(repo => repo.isWorkspaceRoot)?.root || repositories[0]?.root || null

            if (runId !== discoveryRunRef.current) {
                return { repositories, preferredRoot }
            }

            setRepoRoots(repositories)
            setSelectedRepoRoot(preferredRoot)
            setHasResolvedRepositories(true)
            return { repositories, preferredRoot }
        } catch (e) {
            logger.ui.error('Failed to discover Git repositories:', e)
            if (runId === discoveryRunRef.current) {
                setRepoRoots([])
                setSelectedRepoRoot(null)
                setHasResolvedRepositories(true)
            }
            return { repositories: [], preferredRoot: null }
        } finally {
            if (runId === discoveryRunRef.current) {
                setIsDiscoveringRepos(false)
            }
        }
    }, [workspacePath])

    const refreshRepoSnapshot = useCallback(async (root: string) => {
        setRepoSnapshots(prev => ({
            ...prev,
            [root]: {
                status: prev[root]?.status || null,
                operationState: prev[root]?.operationState || 'normal',
                isRefreshing: true,
                error: null,
            },
        }))

        try {
            const [isRepo, repoStatus, repoOperationState] = await Promise.all([
                gitService.isGitRepo(root),
                gitService.getStatus(root),
                gitService.getOperationState(root),
            ])

            setRepoSnapshots(prev => ({
                ...prev,
                [root]: {
                    status: isRepo ? repoStatus : null,
                    operationState: isRepo ? repoOperationState : 'normal',
                    isRefreshing: false,
                    error: isRepo ? null : tt('git.noRepo'),
                },
            }))
        } catch (e) {
            logger.ui.error('Failed to refresh repository snapshot:', { root, error: e })
            setRepoSnapshots(prev => ({
                ...prev,
                [root]: {
                    status: prev[root]?.status || null,
                    operationState: prev[root]?.operationState || 'normal',
                    isRefreshing: false,
                    error: tt('error.unknown'),
                },
            }))
        }
    }, [tt])

    const refreshRepoSnapshots = useCallback(async (repositories: GitRepository[]) => {
        if (repositories.length === 0) {
            setRepoSnapshots({})
            return
        }

        const roots = repositories.map(repo => repo.root)
        setRepoSnapshots(prev => {
            const next: Record<string, RepoChangesSnapshot> = {}
            for (const root of roots) {
                next[root] = prev[root] || {
                    status: null,
                    operationState: 'normal',
                    isRefreshing: true,
                    error: null,
                }
            }
            return next
        })

        const snapshotEntries = await Promise.all(roots.map(async (root) => {
            try {
                const [isRepo, repoStatus, repoOperationState] = await Promise.all([
                    gitService.isGitRepo(root),
                    gitService.getStatus(root),
                    gitService.getOperationState(root),
                ])

                return [root, {
                    status: isRepo ? repoStatus : null,
                    operationState: isRepo ? repoOperationState : 'normal',
                    isRefreshing: false,
                    error: isRepo ? null : tt('git.noRepo'),
                } satisfies RepoChangesSnapshot] as const
            } catch (e) {
                logger.ui.error('Failed to refresh repository snapshot:', { root, error: e })
                return [root, {
                    status: null,
                    operationState: 'normal',
                    isRefreshing: false,
                    error: tt('error.unknown'),
                } satisfies RepoChangesSnapshot] as const
            }
        }))

        setRepoSnapshots(Object.fromEntries(snapshotEntries))
    }, [tt])

    // 刷新数据
    const refreshStatus = useCallback(async (repoRoot?: string | null) => {
        if (!workspacePath) {
            setStatus(null)
            setCommits([])
            setBranches([])
            setStashList([])
            setOperationState('normal')
            setIsGitRepository(null)
            return
        }

        const runId = ++refreshRunRef.current
        setIsRefreshing(true)
        setError(null)

        try {
            const targetRepoRoot = repoRoot || selectedRepoRoot || workspacePath
            gitService.setWorkspace(targetRepoRoot)
            const isRepo = await gitService.isGitRepo(targetRepoRoot)

            if (runId !== refreshRunRef.current) {
                return
            }

            setIsGitRepository(isRepo)

            if (!isRepo) {
                setStatus(null)
                setCommits([])
                setBranches([])
                setStashList([])
                setOperationState('normal')
                return
            }

            await gitService.reconcileAiAttribution(targetRepoRoot).catch(error => {
                logger.ui.warn('AI attribution reconcile failed during Git refresh:', { root: targetRepoRoot, error })
            })

            const [s, c, b, st, op, rm] = await Promise.all([
                gitService.getStatus(targetRepoRoot),
                gitService.getRecentCommits(30, targetRepoRoot),
                gitService.getBranches(targetRepoRoot),
                gitService.getStashList(targetRepoRoot),
                gitService.getOperationState(targetRepoRoot),
                gitService.getRemotes(targetRepoRoot),
            ])

            if (runId !== refreshRunRef.current) {
                return
            }

            setStatus(s)
            setCommits(c)
            setBranches(b)
            setStashList(st)
            setOperationState(op)
            // 仅保留 fetch 行，避免 fetch/push 两条重复
            setRemotes(rm.filter(r => r.type === 'fetch').map(r => ({ name: r.name, url: r.url })))
        } catch (e: unknown) {
            logger.ui.error('Git status error:', e)
            if (runId === refreshRunRef.current) {
                setError(tt('error.unknown'))
                setIsGitRepository(null)
            }
        } finally {
            if (runId === refreshRunRef.current) {
                setIsRefreshing(false)
            }
        }
    }, [selectedRepoRoot, workspacePath, tt])

    useEffect(() => {
        setHasResolvedRepositories(false)
        setIsGitRepository(null)
        void discoverRepositories()
    }, [workspacePath, discoverRepositories])

    useEffect(() => {
        selectedRepoRootRef.current = selectedRepoRoot
        gitService.setWorkspace(selectedRepoRoot || workspacePath || null)
    }, [selectedRepoRoot, workspacePath])

    // 初始化时刷新一次
    const repoRootsSignature = useMemo(() => repoRoots.map(repo => repo.root).join('|'), [repoRoots])
    useEffect(() => {
        if (!workspacePath || isDiscoveringRepos || !hasResolvedRepositories) return
        if (isRepoListMode) return
        const targetRepoRoot = selectedRepoRoot || repoRoots[0]?.root || null
        if (!targetRepoRoot && repoRoots.length > 0) return
        void refreshStatus(targetRepoRoot)
    }, [hasResolvedRepositories, isDiscoveringRepos, isRepoListMode, refreshStatus, repoRoots.length, repoRootsSignature, selectedRepoRoot, workspacePath])

    useEffect(() => {
        if (!workspacePath || isDiscoveringRepos || !hasResolvedRepositories || !isRepoListMode) return
        void refreshRepoSnapshots(repoRoots)
    }, [workspacePath, hasResolvedRepositories, isDiscoveringRepos, isRepoListMode, refreshRepoSnapshots, repoRoots, repoRootsSignature])

    // 监听 .git 目录变化，自动刷新（如果启用）
    useEffect(() => {
        if (!workspacePath) return

        const config = getEditorConfig()
        if (!config.git.autoRefresh) return

        let debounceTimer: ReturnType<typeof setTimeout> | null = null

        const unsubscribe = api.file.onChanged((event: { event: string; path: string }) => {
            if (event.path.includes('.git')) {
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                    if (isRepoListMode) {
                        void refreshRepoSnapshots(repoRoots)
                        return
                    }
                    void refreshStatus(selectedRepoRootRef.current || workspacePath)
                }, 500)
            }
        })

        return () => {
            unsubscribe()
            if (debounceTimer) clearTimeout(debounceTimer)
        }
    }, [discoverRepositories, isRepoListMode, refreshRepoSnapshots, refreshStatus, repoRoots, repoRootsSignature, workspacePath])

    const handleRefreshAll = useCallback(async () => {
        const { repositories, preferredRoot } = await discoverRepositories(true)
        if (repoDisplayMode === 'list' && activeTab === 'changes') {
            await refreshRepoSnapshots(repositories)
            return
        }
        await refreshStatus(preferredRoot)
    }, [activeTab, discoverRepositories, refreshRepoSnapshots, refreshStatus, repoDisplayMode])

    const refreshAfterRepoMutation = useCallback(async (rootPath?: string) => {
        const targetRoot = rootPath || selectedRepoRoot || workspacePath || undefined
        if (!targetRoot) return

        if (isRepoListMode) {
            await refreshRepoSnapshot(targetRoot)
        }

        if (!isRepoListMode || targetRoot === selectedRepoRoot || targetRoot === repoRoots[0]?.root) {
            await refreshStatus(targetRoot)
        }
    }, [isRepoListMode, repoRoots, refreshRepoSnapshot, refreshStatus, selectedRepoRoot, workspacePath])

    // 切换展开状态
    const toggleSection = (section: keyof typeof expandedSections) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
    }

    // AI 生成提交信息
    const handleGenerateCommitMessage = useCallback(async (rootPath?: string, repoStatus?: GitStatus | null) => {
        const targetRoot = rootPath || selectedRepoRoot || workspacePath || undefined
        const targetStatus = repoStatus || status
        if (!targetRoot || !targetStatus || (targetStatus.staged.length === 0 && targetStatus.unstaged.length === 0)) {
            toast.warning(tt('git.noChanges'))
            return
        }

        const { llmConfig, editorConfig } = useStore.getState()
        if (!llmConfig.apiKey) {
            toast.warning(tt('apiKeyWarning'))
            return
        }

        if (rootPath) {
            setRepoIsGeneratingMessages(prev => ({ ...prev, [rootPath]: true }))
        } else {
            setIsGeneratingMessage(true)
        }
        try {
            // 获取所有变更文件的 diff
            const allChanges = [...targetStatus.staged, ...targetStatus.unstaged]
            const diffs: string[] = []

            for (const file of allChanges.slice(0, 10)) { // 限制最多10个文件
                const diff = await gitService.getFileDiff(file.path, targetStatus.staged.includes(file), targetRoot)
                if (diff) {
                    diffs.push(`File: ${file.path}\nStatus: ${file.status}\n${diff.slice(0, 1000)}`) // 限制每个diff长度
                }
            }

            if (diffs.length === 0) {
                toast.warning(tt('git.noChanges'))
                return
            }

            // 构建提示：优先使用用户配置的提示词，为空或空白时回退至系统默认提示词
            const customPrompt = editorConfig.git?.commitPrompt?.trim()
            const basePrompt = customPrompt || DEFAULT_GIT_COMMIT_PROMPT
            const formattedDiffs = diffs.join('\n\n---\n\n')

            let prompt: string
            if (basePrompt.includes('{diff}')) {
                prompt = basePrompt.replaceAll('{diff}', formattedDiffs)
            } else if (basePrompt.includes('${diff}')) {
                prompt = basePrompt.replaceAll('${diff}', formattedDiffs)
            } else {
                prompt = `${basePrompt}

Changes:
${formattedDiffs}

Commit message:`
            }

            // 调用 LLM API (使用 compactContext 进行同步调用)
            const response = await api.llm.compactContext({
                config: llmConfig,
                messages: [{ role: 'user', content: prompt }],
            })

            if (response?.content) {
                // 清理生成的消息
                let message = response.content.trim()
                // 移除可能的引号
                message = message.replace(/^["']|["']$/g, '')
                // 移除可能的 "Commit message:" 前缀
                message = message.replace(/^commit message:\s*/i, '')
                if (rootPath) {
                    updateRepoCommitMessage(rootPath, message)
                } else {
                    setCommitMessage(message)
                }
            } else {
                toast.error(tt('git.generateFailed'), response?.error)
            }
        } catch (e) {
            logger.ui.error('Failed to generate commit message:', e)
            toast.error(tt('git.generateFailed'))
        } finally {
            if (rootPath) {
                setRepoIsGeneratingMessages(prev => ({ ...prev, [rootPath]: false }))
            } else {
                setIsGeneratingMessage(false)
            }
        }
    }, [selectedRepoRoot, status, tt, updateRepoCommitMessage, workspacePath])

    // ==================== 操作处理 ====================

    const handleInit = async () => {
        if (!workspacePath) return
        const success = await gitService.init()
        if (success) {
            await refreshStatus()
            toast.success(tt('git.repoInitialized'))
        } else {
            toast.error(tt('git.initFailed'))
        }
    }

    const handleOpenFolder = async () => {
        const selectedPath = await api.file.openFolder()
        if (!selectedPath) return

        try {
            await workspaceManager.openFolder(selectedPath)
        } catch (e) {
            logger.ui.error('Failed to open folder from Git view:', e)
            toast.error(tt('workspace.openFolderFailed'))
        }
    }

    const handleClone = async () => {
        const trimmedUrl = cloneUrl.trim()
        if (!trimmedUrl) {
            toast.warning(tt('git.cloneUrlRequired'))
            return
        }

        const parentPath = await api.file.selectFolder()
        if (!parentPath) return

        const folderName = getCloneFolderName(trimmedUrl)
        const targetPath = joinPath(parentPath, folderName)

        setIsCloning(true)
        setError(null)
        try {
            const result = await gitService.clone(trimmedUrl, targetPath, parentPath)
            if (!result.success) {
                const message = result.error || tt('git.cloneFailed')
                setError(message)
                toast.error(tt('git.cloneFailed'), message)
                return
            }

            setCloneUrl('')
            setShowCloneInput(false)
            toast.success(tt('git.cloneSuccess'))
            await workspaceManager.openFolder(targetPath)
        } catch (e) {
            logger.ui.error('Failed to clone repository:', e)
            toast.error(tt('git.cloneFailed'))
        } finally {
            setIsCloning(false)
        }
    }

    const handleStage = async (path: string, rootPath?: string) => {
        const success = await gitService.stageFile(path, rootPath)
        if (!success) toast.error(tt('git.stageFailed'))
        await refreshAfterRepoMutation(rootPath)
    }

    const handleStageAll = async (rootPath?: string) => {
        const success = await gitService.stageAll(rootPath)
        if (!success) toast.error(tt('git.stageAllFailed'))
        await refreshAfterRepoMutation(rootPath)
    }

    const handleUnstage = async (path: string, rootPath?: string) => {
        const success = await gitService.unstageFile(path, rootPath)
        if (!success) toast.error(tt('git.unstageFailed'))
        await refreshAfterRepoMutation(rootPath)
    }

    const handleUnstageAll = async (rootPath?: string) => {
        const success = await gitService.unstageAll(rootPath)
        if (!success) toast.error(tt('git.unstageAllFailed'))
        await refreshAfterRepoMutation(rootPath)
    }

    const handleDiscard = async (path: string, rootPath?: string) => {
        const confirmed = await globalConfirm({
            title: tt('git.discard'),
            message: t('git.discardConfirm', language, { name: getFileName(path) }),
            confirmText: tt('git.discard'),
            variant: 'danger',
        })
        if (confirmed) {
            await gitService.discardChanges(path, rootPath)
            await refreshAfterRepoMutation(rootPath)
            toast.success(tt('git.discarded'))
        }
    }

    const handleCommit = async (rootPath?: string) => {
        const message = (rootPath ? repoCommitMessages[rootPath] : commitMessage)?.trim()
        if (!message) return

        if (rootPath) {
            setRepoIsCommitting(prev => ({ ...prev, [rootPath]: true }))
        } else {
            setIsCommitting(true)
        }

        const result = await gitService.commit(message, rootPath)

        if (rootPath) {
            setRepoIsCommitting(prev => ({ ...prev, [rootPath]: false }))
        } else {
            setIsCommitting(false)
        }

        if (result.success) {
            if (rootPath) {
                updateRepoCommitMessage(rootPath, '')
            } else {
                setCommitMessage('')
            }
            await refreshAfterRepoMutation(rootPath)
            toast.success(tt('git.commitSuccess'))
        } else {
            toast.error(tt('git.commitFailed'), result.error)
        }
    }

    const handlePush = async (rootPath?: string) => {
        setIsPushing(true)
        const result = await gitService.push(rootPath)
        setIsPushing(false)
        if (result.success) {
            await refreshAfterRepoMutation(rootPath)
            toast.success(tt('git.pushSuccess'))
        } else {
            toast.error(tt('git.pushFailed'), result.error)
        }
    }

    const handlePull = async (rootPath?: string) => {
        setIsPulling(true)
        const result = await gitService.pull(rootPath)
        setIsPulling(false)
        if (result.success) {
            await refreshAfterRepoMutation(rootPath)
            toast.success(tt('git.pullSuccess'))
        } else {
            toast.error(tt('git.pullFailed'), result.error)
        }
    }

    const handleFetch = async (rootPath?: string) => {
        const result = await gitService.fetch(rootPath)
        if (result.success) {
            await refreshAfterRepoMutation(rootPath)
            toast.success(tt('git.fetchSuccess'))
        } else {
            toast.error(tt('git.fetchFailed'), result.error)
        }
    }

    // 分支操作
    const handleCheckoutBranch = async (name: string) => {
        const result = await gitService.checkoutBranch(name)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.branchSwitched'), name)
        } else {
            toast.error(tt('git.mergeFailed'), result.error)
        }
    }

    // 检出远程分支：落到本地分支，避免 detached HEAD
    const handleCheckoutRemoteBranch = async (name: string) => {
        const result = await gitService.checkoutRemoteBranch(name)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.branchSwitched'), result.branch || name)
        } else {
            toast.error(tt('git.mergeFailed'), result.error)
        }
    }

    // 合并到指定分支对话框
    const [mergeIntoSource, setMergeIntoSource] = useState<string | null>(null)
    const [mergeIntoTarget, setMergeIntoTarget] = useState('')
    const [isMergingInto, setIsMergingInto] = useState(false)

    // 远程仓库管理（多远程同步，如 GitHub + Gitee）
    const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([])
    const [showAddRemote, setShowAddRemote] = useState(false)
    const [newRemoteName, setNewRemoteName] = useState('')
    const [newRemoteUrl, setNewRemoteUrl] = useState('')
    const [isAddingRemote, setIsAddingRemote] = useState(false)

    // 推送到指定远程
    const [pushBranch, setPushBranch] = useState<string | null>(null)
    const [pushTargetRemote, setPushTargetRemote] = useState('')
    const [isPushingTo, setIsPushingTo] = useState(false)

    const openMergeIntoDialog = (source: string) => {
        setMergeIntoSource(source)
        setMergeIntoTarget(localBranches.find(b => b.name !== source)?.name || '')
    }

    // 把源分支合并到目标分支：切到目标分支 → 合并 → 切回原分支
    const handleMergeIntoTarget = async () => {
        if (!mergeIntoSource || !mergeIntoTarget || isMergingInto) return
        const source = mergeIntoSource
        const target = mergeIntoTarget
        const originalBranch = localBranches.find(b => b.current)?.name || ''
        setIsMergingInto(true)
        const checkoutResult = await gitService.checkoutBranch(target)
        if (!checkoutResult.success) {
            setIsMergingInto(false)
            toast.error(tt('git.mergeFailed'), checkoutResult.error)
            return
        }
        const mergeResult = await gitService.mergeBranch(source)
        if (mergeResult.success) {
            // 合并成功后切回原分支
            if (originalBranch && originalBranch !== target) {
                await gitService.checkoutBranch(originalBranch)
            }
            setIsMergingInto(false)
            setMergeIntoSource(null)
            refreshStatus()
            toast.success(tt('git.mergeSuccess'), `${source} → ${target}`)
        } else if (mergeResult.conflicts) {
            // 有冲突：停留在目标分支，由用户解决
            setIsMergingInto(false)
            setMergeIntoSource(null)
            refreshStatus()
            toast.warning(tt('git.mergeConflicts'), `${mergeResult.conflicts.length} files`)
        } else {
            // 无冲突的失败：中止合并并切回原分支
            await gitService.abortMerge()
            if (originalBranch && originalBranch !== target) {
                await gitService.checkoutBranch(originalBranch)
            }
            setIsMergingInto(false)
            setMergeIntoSource(null)
            refreshStatus()
            toast.error(tt('git.mergeFailed'), mergeResult.error)
        }
    }

    // 添加远程仓库，成功后拉取该远程以刷新远程分支列表
    const handleAddRemote = async () => {
        if (!newRemoteName.trim() || !newRemoteUrl.trim() || isAddingRemote) return
        const name = newRemoteName.trim()
        setIsAddingRemote(true)
        const result = await gitService.addRemote(name, newRemoteUrl.trim())
        if (result.success) {
            await gitService.fetch(undefined, name).catch(() => undefined)
            setIsAddingRemote(false)
            setShowAddRemote(false)
            setNewRemoteName('')
            setNewRemoteUrl('')
            refreshStatus()
            toast.success(tt('git.addRemoteSuccess'), name)
        } else {
            setIsAddingRemote(false)
            toast.error(tt('git.addRemoteFailed'), result.error)
        }
    }

    // 推送分支到指定远程（'*' 表示所有远程逐一推送）
    const handlePushToRemote = async () => {
        if (!pushBranch || !pushTargetRemote || isPushingTo) return
        const branch = pushBranch
        const targets = pushTargetRemote === '*' ? remotes.map(r => r.name) : [pushTargetRemote]
        setIsPushingTo(true)
        const failed: string[] = []
        for (const remote of targets) {
            const result = await gitService.pushTo(remote, branch)
            if (!result.success) failed.push(`${remote}: ${result.error || ''}`)
        }
        setIsPushingTo(false)
        setPushBranch(null)
        refreshStatus()
        if (failed.length === 0) {
            toast.success(tt('git.pushSuccess'), targets.join(', '))
        } else {
            toast.error(tt('git.pushFailed'), failed.join('\n'))
        }
    }

    const handleCreateBranch = async () => {
        if (!newBranchName.trim()) return
        const result = await gitService.createBranch(newBranchName)
        if (result.success) {
            setNewBranchName('')
            setShowNewBranch(false)
            refreshStatus()
            toast.success(tt('git.branchCreated'), newBranchName)
        } else {
            toast.error(tt('git.mergeFailed'), result.error)
        }
    }

    const handleDeleteBranch = async (name: string) => {
        const confirmed = await globalConfirm({
            title: tt('git.deleteBranch'),
            message: t('git.deleteBranchConfirm', language, { name }),
            confirmText: tt('delete'),
            variant: 'danger',
        })
        if (confirmed) {
            const result = await gitService.deleteBranch(name)
            if (result.success) {
                refreshStatus()
                toast.success(tt('git.branchDeleted'), name)
            } else {
                toast.error(tt('git.mergeFailed'), result.error)
            }
        }
    }

    // 从远程分支拉取到当前分支（右键远程分支）
    const handlePullRemoteBranch = async (name: string) => {
        const slashIndex = name.indexOf('/')
        if (slashIndex === -1) return
        const remote = name.slice(0, slashIndex)
        const branchName = name.slice(slashIndex + 1)
        setIsPulling(true)
        const result = await gitService.pullFrom(remote, branchName)
        setIsPulling(false)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.pullSuccess'), name)
        } else {
            toast.error(tt('git.pullFailed'), result.error)
        }
    }

    const handleDeleteRemoteBranch = async (name: string) => {
        const confirmed = await globalConfirm({
            title: tt('git.deleteBranch'),
            message: t('git.deleteBranchConfirm', language, { name }),
            confirmText: tt('delete'),
            variant: 'danger',
        })
        if (confirmed) {
            const result = await gitService.deleteRemoteBranch(name)
            if (result.success) {
                refreshStatus()
                toast.success(tt('git.branchDeleted'), name)
            } else {
                toast.error(tt('git.mergeFailed'), result.error)
            }
        }
    }

    const handleMergeBranch = async (name: string) => {
        const result = await gitService.mergeBranch(name)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.mergeSuccess'))
        } else if (result.conflicts) {
            refreshStatus()
            toast.warning(tt('git.mergeConflicts'), `${result.conflicts.length} files`)
        } else {
            toast.error(tt('git.mergeFailed'), result.error)
        }
    }

    const handleRebaseBranch = async (name: string) => {
        const result = await gitService.rebase(name)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.rebaseSuccess'))
        } else {
            refreshStatus()
            toast.error(tt('git.rebaseFailed'), result.error)
        }
    }

    // Stash 操作
    const handleStash = async () => {
        const result = await gitService.stash(stashMessage || undefined, true)
        if (result.success) {
            setStashMessage('')
            setShowStashInput(false)
            refreshStatus()
            toast.success(tt('git.stashed'))
        } else {
            toast.error(tt('git.stashFailed'), result.error)
        }
    }

    const handleStashApply = async (index: number) => {
        const result = await gitService.stashApply(index)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.stashApplied'))
        } else {
            toast.error(tt('git.stashFailed'), result.error)
        }
    }

    const handleStashPop = async (index: number) => {
        const result = await gitService.stashPop(index)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.stashPopped'))
        } else {
            toast.error(tt('git.stashFailed'), result.error)
        }
    }

    const handleStashDrop = async (index: number) => {
        const confirmed = await globalConfirm({
            title: tt('git.stashDrop'),
            message: t('git.stashDropConfirm', language, { index: String(index) }),
            confirmText: tt('git.stashDrop'),
            variant: 'danger',
        })
        if (confirmed) {
            const result = await gitService.stashDrop(index)
            if (result.success) {
                refreshStatus()
                toast.success(tt('git.stashDropped'))
            } else {
                toast.error(tt('git.stashFailed'), result.error)
            }
        }
    }

    // Commit 操作
    const handleCherryPick = async (hash: string) => {
        const result = await gitService.cherryPick(hash)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.cherryPickSuccess'))
        } else {
            refreshStatus()
            toast.error(tt('git.cherryPickFailed'), result.error)
        }
    }

    const handleRevertCommit = async (hash: string) => {
        const result = await gitService.revertCommit(hash)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.revertSuccess'))
        } else {
            toast.error(tt('git.revertFailed'), result.error)
        }
    }

    // 操作状态处理
    const handleContinueOperation = async () => {
        let result
        switch (operationState) {
            case 'rebase':
                result = await gitService.rebaseContinue()
                break
            case 'cherry-pick':
                result = await gitService.cherryPickContinue()
                break
            default:
                return
        }
        if (result?.success) {
            refreshStatus()
            toast.success(tt('git.operationContinued'))
        } else {
            if (result?.error?.includes('No rebase in progress') || result?.error?.includes('No cherry-pick or revert in progress')) {
                await refreshStatus()
            }
            toast.error(tt('git.mergeFailed'), result?.error)
        }
    }

    const handleAbortOperation = async () => {
        let result
        switch (operationState) {
            case 'merge':
                result = await gitService.abortMerge()
                break
            case 'rebase':
                result = await gitService.rebaseAbort()
                break
            case 'cherry-pick':
                result = await gitService.cherryPickAbort()
                break
            default:
                return
        }
        if (result?.success) {
            refreshStatus()
            toast.success(tt('git.operationAborted'))
        } else {
            if (result?.error?.includes('No rebase in progress') || result?.error?.includes('There is no merge to abort') || result?.error?.includes('no cherry-pick or revert in progress')) {
                await refreshStatus()
            }
            toast.error(tt('git.mergeFailed'), result?.error)
        }
    }

    const handleSkipOperation = async () => {
        if (operationState === 'rebase') {
            const result = await gitService.rebaseSkip()
            if (result.success) {
                refreshStatus()
                toast.success(tt('git.commitSkipped'))
            } else {
                if (result.error?.includes('No rebase in progress')) {
                    await refreshStatus()
                }
                toast.error(tt('git.mergeFailed'), result.error)
            }
        }
    }

    // 文件点击处理 - 打开 diff
    const handleFileClick = async (path: string, fileStatus: string, _staged: boolean, rootPath?: string) => {
        logger.ui.info(`[Git] handleFileClick: ${path}, status: ${fileStatus}, staged: ${_staged}`)
        try {
            const targetRoot = rootPath || selectedRepoRoot || workspacePath
            const fullPath = toFullPath(path, targetRoot)
            const content = await api.file.read(fullPath)

            // 如果读取失败，只有在文件被删除的情况下才允许继续（因为删除了就读不到内容了）
            if (content === null && fileStatus !== 'deleted') {
                logger.ui.warn(`[Git] Failed to read file: ${fullPath}, but status is ${fileStatus}`)
                return
            }

            // 根据文件状态决定是否显示 diff
            if (fileStatus === 'modified' || fileStatus === 'renamed') {
                if (_staged) {
                    const original = await gitService.getHeadFileContent(fullPath, targetRoot ?? undefined)
                    const modified = await gitService.getIndexFileContent(fullPath, targetRoot ?? undefined)
                    if (original !== null && modified !== null) {
                        logger.ui.info(`[Git] Opening staged modified file diff: ${fullPath}`)
                        openFile(`git-diff://${fullPath}`, modified, original)
                        setActiveFile(`git-diff://${fullPath}`)
                        return
                    }
                } else {
                    const original = await gitService.getIndexFileContent(fullPath, targetRoot ?? undefined)
                    if (original !== null) {
                        logger.ui.info(`[Git] Opening unstaged modified file diff: ${fullPath}`)
                        openFile(`git-diff://${fullPath}`, content || '', original)
                        setActiveFile(`git-diff://${fullPath}`)
                        return
                    }
                }
            } else if (fileStatus === 'added' || fileStatus === 'untracked') {
                if (_staged) {
                    const modified = await gitService.getIndexFileContent(fullPath, targetRoot ?? undefined)
                    logger.ui.info(`[Git] Opening staged added file: ${fullPath}`)
                    openFile(`git-diff://${fullPath}`, modified || '', '')
                    setActiveFile(`git-diff://${fullPath}`)
                } else {
                    logger.ui.info(`[Git] Opening untracked file: ${fullPath}`)
                    openFile(`git-diff://${fullPath}`, content || '', '')
                    setActiveFile(`git-diff://${fullPath}`)
                }
                return
            } else if (fileStatus === 'deleted') {
                if (_staged) {
                    const original = await gitService.getHeadFileContent(fullPath, targetRoot ?? undefined)
                    if (original !== null) {
                        logger.ui.info(`[Git] Opening staged deleted file diff: ${fullPath}`)
                        openFile(`git-diff://${fullPath}`, '', original)
                        setActiveFile(`git-diff://${fullPath}`)
                        return
                    }
                } else {
                    const original = await gitService.getIndexFileContent(fullPath, targetRoot ?? undefined)
                    if (original !== null) {
                        logger.ui.info(`[Git] Opening unstaged deleted file diff: ${fullPath}`)
                        openFile(`git-diff://${fullPath}`, '', original)
                        setActiveFile(`git-diff://${fullPath}`)
                        return
                    }
                }
            }

            // 其他情况，直接打开文件
            logger.ui.info(`[Git] Default opening file: ${fullPath}`)
            openFile(fullPath, content || '')
            setActiveFile(fullPath)
        } catch (e) {
            logger.ui.error('Failed to open file:', e)
            toast.error(tt('git.openFileFailed'))
        }
    }

    const openRevisionFileDiff = useCallback(async (
        uri: string,
        sides: { original: string; modified: string } | null,
    ) => {
        if (!sides) {
            toast.error(tt('git.openDiffFailed'))
            return
        }
        openFile(uri, sides.modified, sides.original)
        setActiveFile(uri)
    }, [openFile, setActiveFile, tt])

    const toggleCommitExpanded = useCallback(async (commit: GitCommit) => {
        if (expandedCommitHash === commit.hash) {
            setExpandedCommitHash(null)
            return
        }
        setExpandedCommitHash(commit.hash)
        if (commitFilesByHash[commit.hash]) return

        const root = selectedRepoRoot || workspacePath || undefined
        setCommitFilesLoading(commit.hash)
        try {
            const files = await gitService.getCommitChangedFiles(commit.hash, root)
            setCommitFilesByHash(prev => ({ ...prev, [commit.hash]: files }))
            if (files.length === 1) {
                const file = files[0]
                const sides = await gitService.getCommitFileSides(commit.hash, file.path, {
                    oldPath: file.oldPath,
                    status: file.status,
                    rootPath: root,
                })
                await openRevisionFileDiff(
                    `git-diff://commit/${commit.shortHash}/${file.path}`,
                    sides,
                )
            }
        } catch (e) {
            logger.ui.error('Failed to load commit files:', e)
            toast.error(tt('git.openDiffFailed'))
        } finally {
            setCommitFilesLoading(null)
        }
    }, [commitFilesByHash, expandedCommitHash, openRevisionFileDiff, selectedRepoRoot, tt, workspacePath])

    const openCommitFile = useCallback(async (commit: GitCommit, file: GitFileChange) => {
        const root = selectedRepoRoot || workspacePath || undefined
        const sides = await gitService.getCommitFileSides(commit.hash, file.path, {
            oldPath: file.oldPath,
            status: file.status,
            rootPath: root,
        })
        await openRevisionFileDiff(`git-diff://commit/${commit.shortHash}/${file.path}`, sides)
    }, [openRevisionFileDiff, selectedRepoRoot, workspacePath])

    const toggleStashExpanded = useCallback(async (stash: GitStashEntry) => {
        if (expandedStashIndex === stash.index) {
            setExpandedStashIndex(null)
            return
        }
        setExpandedStashIndex(stash.index)
        if (stashFilesByIndex[stash.index]) return

        setStashFilesLoading(stash.index)
        try {
            const root = selectedRepoRoot || workspacePath || undefined
            const files = await gitService.getStashChangedFiles(stash.index, root)
            setStashFilesByIndex(prev => ({ ...prev, [stash.index]: files }))
            if (files.length === 1) {
                const file = files[0]
                const sides = await gitService.getStashFileSides(stash.index, file.path, {
                    oldPath: file.oldPath,
                    status: file.status,
                    rootPath: root,
                })
                await openRevisionFileDiff(`git-diff://stash@{${stash.index}}/${file.path}`, sides)
            }
        } catch (e) {
            logger.ui.error('Failed to load stash files:', e)
            toast.error(tt('git.openDiffFailed'))
        } finally {
            setStashFilesLoading(null)
        }
    }, [expandedStashIndex, openRevisionFileDiff, selectedRepoRoot, stashFilesByIndex, tt, workspacePath])

    const openStashFile = useCallback(async (stash: GitStashEntry, file: GitFileChange) => {
        const root = selectedRepoRoot || workspacePath || undefined
        const sides = await gitService.getStashFileSides(stash.index, file.path, {
            oldPath: file.oldPath,
            status: file.status,
            rootPath: root,
        })
        await openRevisionFileDiff(`git-diff://stash@{${stash.index}}/${file.path}`, sides)
    }, [openRevisionFileDiff, selectedRepoRoot, workspacePath])

    // 计算统计
    const stats = useMemo(() => {
        if (!status) return { staged: 0, unstaged: 0, untracked: 0, total: 0 }
        return {
            staged: status.staged.length,
            unstaged: status.unstaged.length,
            untracked: status.untracked.length,
            total: status.staged.length + status.unstaged.length + status.untracked.length,
        }
    }, [status])

    const localBranches = useMemo(() => branches.filter(b => !b.remote), [branches])
    const remoteBranches = useMemo(() => branches.filter(b => b.remote), [branches])

    // 远程分支按远程名分组（过滤 "*/HEAD" 符号引用），组内只展示纯分支名
    const remoteBranchGroups = useMemo(() => {
        const byRemote = new Map<string, GitBranchType[]>()
        for (const b of remoteBranches) {
            if (b.name.endsWith('/HEAD')) continue
            const remote = b.name.slice(0, b.name.indexOf('/'))
            if (!byRemote.has(remote)) byRemote.set(remote, [])
            byRemote.get(remote)!.push(b)
        }
        // 以 remotes 声明顺序为主，未知远程排后
        const order = [
            ...remotes.map(r => r.name),
            ...[...byRemote.keys()].filter(n => !remotes.some(r => r.name === n)),
        ]
        const groups: { remote: string; host: string; branches: GitBranchType[] }[] = []
        for (const remote of order) {
            const list = byRemote.get(remote)
            if (!list?.length) continue
            groups.push({
                remote,
                host: hostOfRemoteUrl(remotes.find(r => r.name === remote)?.url || ''),
                branches: list,
            })
        }
        return groups
    }, [remoteBranches, remotes])

    // 远程分组的展开/收起（默认展开）
    const [collapsedRemoteGroups, setCollapsedRemoteGroups] = useState<Record<string, boolean>>({})
    const toggleRemoteGroup = (remote: string) => {
        setCollapsedRemoteGroups(prev => ({ ...prev, [remote]: !prev[remote] }))
    }

    const tabLabels = useMemo(() => ({
        changes: tt('git.changes'),
        branches: tt('git.branches'),
        stash: tt('git.stash'),
        history: tt('git.history'),
    }), [tt])
    const repoSelectOptions = useMemo(() => repoRoots.map(repo => ({
        value: repo.root,
        label: repo.isWorkspaceRoot
            ? `${repo.name} (${language === 'zh' ? '当前仓库' : 'Current Repository'})`
            : repo.relativePath === '.'
                ? repo.name
                : repo.relativePath,
    })), [language, repoRoots])
    const currentRepoRoot = selectedRepoRoot || workspacePath || ''
    const showRepoSelector = !isRepoListMode && (repoRoots.length > 1 || (!!selectedRepoRoot && normalizePath(selectedRepoRoot) !== normalizePath(workspacePath)))
    const showRepoModeSwitch = repoRoots.length > 1
    const repoCards = useMemo(() => repoRoots.map(repo => ({
        repo,
        snapshot: repoSnapshots[repo.root] || {
            status: null,
            operationState: 'normal' as OperationState,
            isRefreshing: true,
            error: null,
        },
    })), [repoRoots, repoSnapshots])

    const renderRepoChangesCard = useCallback((repo: GitRepository, snapshot: RepoChangesSnapshot) => {
        const repoStatus = snapshot.status
        const repoStats = repoStatus ? {
            staged: repoStatus.staged.length,
            unstaged: repoStatus.unstaged.length,
            untracked: repoStatus.untracked.length,
            total: repoStatus.staged.length + repoStatus.unstaged.length + repoStatus.untracked.length,
        } : { staged: 0, unstaged: 0, untracked: 0, total: 0 }
        const expanded = getRepoExpandedSections(repo.root)
        const commitValue = repoCommitMessages[repo.root] || ''
        const isRepoGenerating = !!repoIsGeneratingMessages[repo.root]
        const isRepoCommitting = !!repoIsCommitting[repo.root]
        const isSelectedRepo = selectedRepoRoot === repo.root

        return (
            <div
                key={repo.root}
                className={`mx-2 my-2 overflow-hidden rounded-xl border ${isSelectedRepo ? 'border-accent/40 bg-accent/5' : 'border-border-subtle bg-surface/20'}`}
            >
                <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
                    <button
                        onClick={() => setSelectedRepoRoot(repo.root)}
                        className="min-w-0 flex-1 text-left"
                    >
                        <div className="flex items-center gap-2 overflow-hidden w-full pr-1">
                            <span className="text-sm font-semibold text-text-primary flex-shrink min-w-[40px] truncate max-w-[180px]">{repo.name}</span>
                            {!repo.isWorkspaceRoot && (
                                <span className="truncate text-[10px] text-text-muted flex-shrink hidden sm:inline-block min-w-[20px]">{repo.relativePath}</span>
                            )}
                            {repoStatus?.branch && (
                                <span className="text-[10px] font-mono text-accent flex-shrink px-1.5 py-0.5 bg-accent/10 rounded-md min-w-[30px] truncate border border-accent/20">{repoStatus.branch}</span>
                            )}
                        </div>
                    </button>
                    {repoStats.total > 0 && (
                        <span className="rounded-full bg-surface-active px-1.5 py-0.5 text-[10px] text-text-secondary">
                            {repoStats.total}
                        </span>
                    )}
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="icon" size="icon" onClick={() => refreshRepoSnapshot(repo.root)} title={tt('refresh')} className="h-6 w-6 rounded-md">
                            <RefreshCw className={`w-3 h-3 ${snapshot.isRefreshing ? 'animate-spin' : ''}`} />
                        </Button>
                        <RepoMenu
                            repoRoot={repo.root}
                            onFetch={handleFetch}
                            onPull={handlePull}
                            onPush={handlePush}
                            tt={tt}
                        />
                    </div>
                </div>

                {snapshot.error && !repoStatus ? (
                    <div className="px-3 py-3 text-xs text-status-error">{snapshot.error}</div>
                ) : (
                    <>
                        <div className="px-3 py-3 bg-surface/30 border-b border-border-subtle">
                            <div className="bg-surface border border-border-subtle rounded-xl flex flex-col focus-within:border-accent/40 focus-within:shadow-[0_0_0_2px_rgba(var(--color-accent),0.1)] transition-all">
                                <textarea
                                    value={commitValue}
                                    onChange={(e) => updateRepoCommitMessage(repo.root, e.target.value)}
                                    placeholder={tt('git.commitMessage')}
                                    className="w-full bg-transparent border-none p-2.5 text-xs text-text-primary outline-none resize-none min-h-[56px] placeholder:text-text-muted/50"
                                />
                                <div className="flex items-center justify-between px-2 pb-2">
                                    <button
                                        onClick={() => handleGenerateCommitMessage(repo.root, repoStatus)}
                                        disabled={isRepoGenerating || repoStats.total === 0}
                                        className="p-1 text-text-muted hover:text-accent rounded-md hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        title={tt('git.generateMessage')}
                                    >
                                        {isRepoGenerating ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                                        ) : (
                                            <Sparkles className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleCommit(repo.root)}
                                        disabled={isRepoCommitting || repoStats.staged === 0}
                                        className="h-6 px-3 bg-accent text-white text-[10px] font-medium rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:bg-surface-hover disabled:text-text-muted flex items-center shadow-sm disabled:shadow-none"
                                    >
                                        {isRepoCommitting ? (
                                            <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                        ) : (
                                            <Check className="w-3 h-3 mr-1.5" />
                                        )}
                                        {isRepoCommitting ? tt('git.committing') : tt('git.commit')}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {repoStatus?.hasConflicts && repoStatus.conflictFiles.length > 0 && (
                            <div className="border-b border-border-subtle">
                                <div className="px-3 py-1.5 text-[10px] text-orange-400 font-semibold bg-orange-500/10 flex items-center gap-2">
                                    <AlertTriangle className="w-3 h-3" />
                                    {tt('git.conflicts')} ({repoStatus.conflictFiles.length})
                                </div>
                                {repoStatus.conflictFiles.map(path => (
                                    <FileItem
                                        key={`${repo.root}:${path}`}
                                        path={path}
                                        status="unmerged"
                                        staged={false}
                                        onStage={() => handleStage(path, repo.root)}
                                        onDiscard={() => handleDiscard(path, repo.root)}
                                        onClick={() => setConflictFile(normalizePath(`${repo.root}/${path}`))}
                                    />
                                ))}
                            </div>
                        )}

                        {repoStats.staged > 0 && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleRepoSection(repo.root, 'staged')}
                                >
                                    {expanded.staged ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.stagedChanges')}</span>
                                    <span className="bg-green-500/20 text-green-400 px-1.5 rounded-full text-[10px]">{repoStats.staged}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); void handleUnstageAll(repo.root) }}
                                        className="p-0.5 hover:bg-surface-active rounded"
                                        title={tt('git.unstageAll')}
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                </div>
                                {expanded.staged && repoStatus?.staged.map(file => (
                                    <FileItem
                                        key={`${repo.root}:staged:${file.path}`}
                                        path={file.path}
                                        status={file.status}
                                        staged={true}
                                        onUnstage={() => handleUnstage(file.path, repo.root)}
                                        onClick={() => handleFileClick(file.path, file.status, true, repo.root)}
                                    />
                                ))}
                            </div>
                        )}

                        {(repoStats.unstaged > 0 || repoStats.untracked > 0) && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleRepoSection(repo.root, 'changes')}
                                >
                                    {expanded.changes ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.unstaged')}</span>
                                    <span className="bg-yellow-500/20 text-yellow-400 px-1.5 rounded-full text-[10px]">{repoStats.unstaged + repoStats.untracked}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); void handleStageAll(repo.root) }}
                                        className="p-0.5 hover:bg-surface-active rounded"
                                        title={tt('git.stageAll')}
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                                {expanded.changes && (
                                    <>
                                        {repoStatus?.unstaged.map(file => (
                                            <FileItem
                                                key={`${repo.root}:unstaged:${file.path}`}
                                                path={file.path}
                                                status={file.status}
                                                staged={false}
                                                onStage={() => handleStage(file.path, repo.root)}
                                                onDiscard={() => handleDiscard(file.path, repo.root)}
                                                onClick={() => handleFileClick(file.path, file.status, false, repo.root)}
                                            />
                                        ))}
                                        {repoStatus?.untracked.map(path => (
                                            <FileItem
                                                key={`${repo.root}:untracked:${path}`}
                                                path={path}
                                                status="untracked"
                                                staged={false}
                                                onStage={() => handleStage(path, repo.root)}
                                                onDiscard={() => handleDiscard(path, repo.root)}
                                                onClick={() => handleFileClick(path, 'added', false, repo.root)}
                                            />
                                        ))}
                                    </>
                                )}
                            </div>
                        )}

                        {repoStats.total === 0 && !repoStatus?.hasConflicts && (
                            <div className="p-4 text-center">
                                <Check className="w-6 h-6 text-green-400 mx-auto mb-2 opacity-50" />
                                <p className="text-xs text-text-muted">{tt('git.noChanges')}</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        )
    }, [getRepoExpandedSections, handleCommit, handleDiscard, handleFetch, handleFileClick, handleGenerateCommitMessage, handlePull, handlePush, handleStage, handleStageAll, handleUnstage, handleUnstageAll, refreshRepoSnapshot, repoCommitMessages, repoIsCommitting, repoIsGeneratingMessages, selectedRepoRoot, tt, toggleRepoSection, updateRepoCommitMessage])

    // ==================== 渲染 ====================

    if (!workspacePath) {
        return (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center select-none animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-surface/40 border border-border/50 flex items-center justify-center mb-4 text-text-muted relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/20 to-accent-subtle/10 rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-500" />
                    <FolderOpen className="w-6 h-6 text-text-muted relative opacity-70" />
                </div>
                <p className="text-xs font-semibold text-text-primary mb-1 tracking-wide">{tt('noFolderOpened')}</p>
                <p className="text-[10px] text-text-muted leading-relaxed max-w-[190px] mx-auto mb-6 opacity-70">
                    {tt('git.noWorkspaceDesc')}
                </p>
                <Button
                    onClick={handleOpenFolder}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl shadow-lg shadow-accent/15 bg-accent text-white hover:bg-accent/90 transition-all font-semibold text-xs active:scale-95"
                >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {tt('openFolder')}
                </Button>
            </div>
        )
    }

    // 非 Git 仓库
    if (hasResolvedRepositories && repoRoots.length === 0 && isGitRepository === false && !isRefreshing && !isDiscoveringRepos) {
        return (
            <div className="flex flex-col items-center justify-center h-full px-6 py-10 overflow-y-auto text-center select-none animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-surface/40 border border-border/50 flex items-center justify-center mb-4 text-text-muted relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/20 to-accent-subtle/10 rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-500" />
                    <FolderGit2 className="w-6 h-6 text-text-muted relative opacity-70" />
                </div>
                <p className="text-xs font-semibold text-text-primary mb-1 tracking-wide">{tt('git.noRepo')}</p>
                <p className="text-[10px] text-text-muted leading-relaxed max-w-[210px] mx-auto mb-4 opacity-70">
                    {tt('git.noRepoDesc')}
                </p>
                <div className="mb-6 max-w-full rounded-lg border border-border-subtle bg-surface/30 px-3 py-1.5 text-[9px] text-text-muted font-mono break-all max-w-[220px]">
                    <span className="text-text-secondary font-sans mr-1">{tt('git.currentFolder')}</span>
                    {workspacePath}
                </div>

                <div className="flex w-full max-w-[200px] flex-col gap-2">
                    <Button onClick={handleInit} className="w-full h-8 flex items-center justify-center gap-1.5 text-xs font-semibold">
                        <Plus className="w-3.5 h-3.5" />
                        {tt('git.initRepo')}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => setShowCloneInput(prev => !prev)}
                        className="w-full h-8 flex items-center justify-center gap-1.5 text-xs font-semibold"
                    >
                        <Download className="w-3.5 h-3.5" />
                        {tt('git.cloneRepo')}
                    </Button>
                    {showCloneInput && (
                        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface/20 p-2 animate-slide-down">
                            <Input
                                value={cloneUrl}
                                onChange={(e) => setCloneUrl(e.target.value)}
                                placeholder={tt('git.cloneUrlPlaceholder')}
                                className="h-8 text-xs bg-surface border-border-subtle"
                                disabled={isCloning}
                            />
                            <Button onClick={handleClone} isLoading={isCloning} className="w-full h-7 text-[10px] font-semibold">
                                {isCloning ? tt('git.cloning') : tt('git.clone')}
                            </Button>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 mt-1">
                        <Button variant="outline" className="h-7 text-[10px] font-medium" onClick={handleOpenFolder}>
                            {tt('openFolder')}
                        </Button>
                        <Button variant="ghost" className="h-7 text-[10px] font-medium" onClick={handleRefreshAll}>
                            {tt('git.retry')}
                        </Button>
                    </div>
                </div>
                {error && <p className="mt-3 max-w-[200px] break-words text-[9px] text-status-error">{error}</p>}
            </div>
        )
    }

    if (!isRepoListMode && !status && (isRefreshing || isGitRepository === null || error)) {
        return (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center select-none animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-surface/40 border border-border/50 flex items-center justify-center mb-4 text-text-muted relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/20 to-accent-subtle/10 rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-500" />
                    {isRefreshing ? (
                        <Loader2 className="w-6 h-6 animate-spin text-accent relative" />
                    ) : (
                        <AlertTriangle className="w-6 h-6 text-status-warning relative" />
                    )}
                </div>
                <p className="text-xs font-semibold text-text-primary mb-1 tracking-wide">
                    {isRefreshing ? tt('git.loadingStatus') : tt('git.statusUnavailable')}
                </p>
                <p className="text-[10px] text-text-muted leading-relaxed max-w-[190px] mx-auto mb-6 opacity-70">
                    {error || tt('git.statusUnavailableDesc')}
                </p>
                <Button variant="outline" onClick={handleRefreshAll} disabled={isRefreshing || isDiscoveringRepos} className="h-8 text-xs font-semibold active:scale-95">
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {tt('git.retry')}
                </Button>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-transparent text-sm">
            {/* Unified Sticky Header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-md border-b border-border-subtle flex flex-col shadow-sm">
                {/* Title & Actions */}
                <div className="h-11 px-4 flex items-center justify-between border-b border-border/10">
                    <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[10px] font-black text-text-primary/45 uppercase tracking-[0.2em] font-sans pl-1">
                        {tt('git.title')}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {showRepoModeSwitch && (
                            <div className="flex items-center bg-surface-hover/80 rounded-md p-0.5 mr-1 ring-1 ring-border-subtle/50">
                                <button
                                    onClick={() => setRepoDisplayMode('list')}
                                    title={language === 'zh' ? '列表模式' : 'List Mode'}
                                    className={`p-1 rounded-[4px] transition-all ${repoDisplayMode === 'list' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                                >
                                    <List className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setRepoDisplayMode('select')}
                                    title={language === 'zh' ? '单仓库模式' : 'Single Repo Mode'}
                                    className={`p-1 rounded-[4px] transition-all ${repoDisplayMode === 'select' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                                >
                                    <Maximize className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                        {!isRepoListMode && (
                            <>
                                <Button variant="icon" size="icon" onClick={() => handleFetch()} title={tt('git.fetch')} className="w-7 h-7 rounded-lg">
                                    <ArrowDown className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="icon" size="icon" onClick={() => handlePull()} disabled={isPulling} title={tt('git.pull')} className="w-7 h-7 rounded-lg">
                                    <ArrowDown className={`w-3.5 h-3.5 ${isPulling ? 'animate-bounce' : ''}`} />
                                </Button>
                                <Button variant="icon" size="icon" onClick={() => handlePush()} disabled={isPushing} title={tt('git.push')} className="w-7 h-7 rounded-lg">
                                    <ArrowUp className={`w-3.5 h-3.5 ${isPushing ? 'animate-bounce' : ''}`} />
                                </Button>
                            </>
                        )}
                        <Button variant="icon" size="icon" onClick={handleRefreshAll} title={tt('refresh')} className="w-7 h-7 rounded-lg text-text-muted hover:text-text-primary">
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>

                {/* Repo Selector (Single Mode) */}
                {showRepoSelector && (
                    <div className="px-3 pb-2 pt-1 flex items-center gap-2">
                        {isDiscoveringRepos && <Loader2 className="w-3 h-3 animate-spin text-text-muted flex-shrink-0" />}
                        <Select
                            value={currentRepoRoot}
                            onChange={setSelectedRepoRoot}
                            options={repoSelectOptions}
                            className="w-full flex-1"
                        />
                    </div>
                )}

                {/* Operation State Banner */}
                {operationState !== 'normal' && (
                    <div className="mx-2 mb-2 flex flex-col rounded-lg border border-orange-500/20 bg-orange-500/5">
                        <div className="px-2.5 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
                                </span>
                                <span className="text-[10px] font-medium text-text-primary">
                                    {t('git.operationInProgress', language, { operation: operationState })}
                                </span>
                            </div>
                            {status?.branch && (
                                <span className="text-[9px] text-text-muted font-mono px-1 py-0.5 rounded bg-surface">
                                    {status.branch}
                                </span>
                            )}
                        </div>
                        <div className="px-1.5 pb-1.5 flex items-center gap-1">
                            <button
                                onClick={handleContinueOperation}
                                className="flex-1 px-1.5 py-1 text-[9px] font-medium rounded text-text-secondary hover:text-orange-400 hover:bg-orange-500/10 transition-colors flex items-center justify-center gap-1"
                            >
                                <Play className="w-2.5 h-2.5" /> {tt('git.continue')}
                            </button>
                            {operationState === 'rebase' && (
                                <button
                                    onClick={handleSkipOperation}
                                    className="flex-1 px-1.5 py-1 text-[9px] font-medium rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors flex items-center justify-center gap-1"
                                >
                                    <SkipForward className="w-2.5 h-2.5" /> {tt('git.skip')}
                                </button>
                            )}
                            <button
                                onClick={handleAbortOperation}
                                className="flex-1 px-1.5 py-1 text-[9px] font-medium rounded text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center gap-1"
                            >
                                <X className="w-2.5 h-2.5" /> {tt('git.abort')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                <div className="px-4 pt-1 flex gap-5 overflow-x-auto no-scrollbar">
                    {GIT_TABS.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`text-[11px] font-medium pb-2 border-b-2 transition-colors flex-shrink-0 whitespace-nowrap tracking-wide ${activeTab === tab
                                ? 'border-accent text-accent'
                                : 'border-transparent text-text-muted hover:text-text-primary hover:border-border-subtle'
                                }`}
                            title={
                                tab === 'changes' ? `${tabLabels.changes}${stats.total > 0 ? ` (${stats.total})` : ''}` :
                                    tab === 'branches' ? tabLabels.branches :
                                        tab === 'stash' ? `${tabLabels.stash}${stashList.length > 0 ? ` (${stashList.length})` : ''}` :
                                            tabLabels.history
                            }
                        >
                            {tab === 'changes' && `${tabLabels.changes}${stats.total > 0 ? ` (${stats.total})` : ''}`}
                            {tab === 'branches' && tabLabels.branches}
                            {tab === 'stash' && `${tabLabels.stash}${stashList.length > 0 ? ` (${stashList.length})` : ''}`}
                            {tab === 'history' && tabLabels.history}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Changes Tab */}
                {activeTab === 'changes' && isRepoListMode && (
                    <div className="py-2">
                        {repoCards.map(({ repo, snapshot }) => renderRepoChangesCard(repo, snapshot))}
                    </div>
                )}

                {activeTab === 'changes' && !isRepoListMode && status && (
                    <div className="flex flex-col">
                        {/* Branch Info */}
                        <div className="px-3 py-2 border-b border-border-subtle bg-surface/30 flex items-center gap-2">
                            <GitBranch className="w-3.5 h-3.5 text-accent" />
                            <span className="text-xs font-medium text-text-primary">{status.branch}</span>
                            {(status.ahead > 0 || status.behind > 0) && (
                                <div className="flex items-center gap-1 ml-auto">
                                    {status.ahead > 0 && (
                                        <span className="text-[10px] text-green-400 flex items-center">
                                            <ArrowUp className="w-2.5 h-2.5" />{status.ahead}
                                        </span>
                                    )}
                                    {status.behind > 0 && (
                                        <span className="text-[10px] text-orange-400 flex items-center">
                                            <ArrowDown className="w-2.5 h-2.5" />{status.behind}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Commit Input */}
                        <div className="px-3 py-3 bg-surface/30 border-b border-border-subtle">
                            <div className="bg-surface border border-border-subtle rounded-xl flex flex-col focus-within:border-accent/40 focus-within:shadow-[0_0_0_2px_rgba(var(--color-accent),0.1)] transition-all">
                                <textarea
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    placeholder={tt('git.commitMessage')}
                                    className="w-full bg-transparent border-none p-2.5 text-xs text-text-primary outline-none resize-none min-h-[56px] placeholder:text-text-muted/50"
                                    onKeyDown={(e) => {
                                        if (keybindingService.matches(e, 'git.commit')) handleCommit()
                                    }}
                                />
                                <div className="flex items-center justify-between px-2 pb-2">
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => {
                                                void handleGenerateCommitMessage()
                                            }}
                                            disabled={isGeneratingMessage || stats.total === 0}
                                            className="p-1 text-text-muted hover:text-accent rounded-md hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            title={tt('git.generateMessage')}
                                        >
                                            {isGeneratingMessage ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                                            ) : (
                                                <Sparkles className="w-3.5 h-3.5" />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setShowStashInput(!showStashInput)}
                                            title={tt('git.stashChanges')}
                                            className="p-1 text-text-muted hover:text-text-primary rounded-md hover:bg-surface-hover transition-colors"
                                        >
                                            <Archive className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => {
                                            void handleCommit()
                                        }}
                                        disabled={isCommitting || stats.staged === 0}
                                        className="h-6 px-3 bg-accent text-white text-[10px] font-medium rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:bg-surface-hover disabled:text-text-muted flex items-center shadow-sm disabled:shadow-none"
                                    >
                                        {isCommitting ? (
                                            <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                        ) : (
                                            <Check className="w-3 h-3 mr-1.5" />
                                        )}
                                        {isCommitting ? tt('git.committing') : tt('git.commit')}
                                    </button>
                                </div>
                            </div>

                            {/* Stash Input */}
                            {showStashInput && (
                                <div className="mt-2 flex items-center gap-2 animate-slide-in">
                                    <Input
                                        value={stashMessage}
                                        onChange={(e) => setStashMessage(e.target.value)}
                                        placeholder={tt('git.stashMessage')}
                                        className="flex-1 h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleStash()
                                            if (e.key === 'Escape') setShowStashInput(false)
                                        }}
                                    />
                                    <Button size="sm" onClick={handleStash} className="h-8">
                                        <Archive className="w-3 h-3 mr-1" /> {tt('git.stash')}
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Conflict Files */}
                        {status.hasConflicts && status.conflictFiles.length > 0 && (
                            <div className="border-b border-border-subtle">
                                <div className="px-3 py-1.5 text-[10px] text-orange-400 font-semibold bg-orange-500/10 flex items-center gap-2">
                                    <AlertTriangle className="w-3 h-3" />
                                    {tt('git.conflicts')} ({status.conflictFiles.length})
                                </div>
                                {status.conflictFiles.map(path => (
                                    <FileItem
                                        key={path}
                                        path={path}
                                        status="unmerged"
                                        staged={false}
                                        onStage={() => handleStage(path)}
                                        onDiscard={() => handleDiscard(path)}
                                        onClick={() => setConflictFile(normalizePath(`${workspacePath}/${path}`))}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Staged Changes */}
                        {stats.staged > 0 && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleSection('staged')}
                                >
                                    {expandedSections.staged ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.stagedChanges')}</span>
                                    <span className="bg-green-500/20 text-green-400 px-1.5 rounded-full text-[10px]">{stats.staged}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleUnstageAll() }}
                                        className="p-0.5 hover:bg-surface-active rounded"
                                        title={tt('git.unstageAll')}
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                </div>
                                {expandedSections.staged && status.staged.map(file => (
                                    <FileItem
                                        key={file.path}
                                        path={file.path}
                                        status={file.status}
                                        staged={true}
                                        onUnstage={() => handleUnstage(file.path)}
                                        onClick={() => handleFileClick(file.path, file.status, true)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Unstaged Changes */}
                        {(stats.unstaged > 0 || stats.untracked > 0) && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleSection('changes')}
                                >
                                    {expandedSections.changes ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.unstaged')}</span>
                                    <span className="bg-yellow-500/20 text-yellow-400 px-1.5 rounded-full text-[10px]">{stats.unstaged + stats.untracked}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleStageAll() }}
                                        className="p-0.5 hover:bg-surface-active rounded"
                                        title={tt('git.stageAll')}
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                                {expandedSections.changes && (
                                    <>
                                        {status.unstaged.map(file => (
                                            <FileItem
                                                key={file.path}
                                                path={file.path}
                                                status={file.status}
                                                staged={false}
                                                onStage={() => handleStage(file.path)}
                                                onDiscard={() => handleDiscard(file.path)}
                                                onClick={() => handleFileClick(file.path, file.status, false)}
                                            />
                                        ))}
                                        {status.untracked.map(path => (
                                            <FileItem
                                                key={path}
                                                path={path}
                                                status="untracked"
                                                staged={false}
                                                onStage={() => handleStage(path)}
                                                onDiscard={() => handleDiscard(path)}
                                                onClick={() => handleFileClick(path, 'added', false)}
                                            />
                                        ))}
                                    </>
                                )}
                            </div>
                        )}

                        {/* No Changes */}
                        {stats.total === 0 && !status.hasConflicts && (
                            <div className="p-6 text-center">
                                <Check className="w-8 h-8 text-green-400 mx-auto mb-2 opacity-50" />
                                <p className="text-xs text-text-muted">{tt('git.noChanges')}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Branches Tab */}
                {activeTab === 'branches' && (
                    <div className="flex flex-col">
                        {/* New Branch */}
                        <div className="p-3 border-b border-border-subtle">
                            {showNewBranch ? (
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={newBranchName}
                                        onChange={(e) => setNewBranchName(e.target.value)}
                                        placeholder={tt('git.newBranchName')}
                                        className="flex-1 h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateBranch()
                                            if (e.key === 'Escape') setShowNewBranch(false)
                                        }}
                                        autoFocus
                                    />
                                    <Button size="sm" onClick={handleCreateBranch} className="h-8">
                                        <Check className="w-3 h-3" />
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => setShowNewBranch(false)} className="h-8">
                                        <X className="w-3 h-3" />
                                    </Button>
                                </div>
                            ) : (
                                <Button variant="secondary" onClick={() => setShowNewBranch(true)} className="w-full">
                                    <Plus className="w-3.5 h-3.5 mr-2" />
                                    {tt('git.newBranch')}
                                </Button>
                            )}
                        </div>

                        {/* Local Branches */}
                        <div>
                            <div
                                className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-b border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                onClick={() => toggleSection('localBranches')}
                            >
                                {expandedSections.localBranches ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                <span className="flex-1">{tt('git.local')}</span>
                                <span className="text-[10px] text-text-muted">{localBranches.length}</span>
                            </div>
                            {expandedSections.localBranches && localBranches.map(branch => (
                                <BranchItem
                                    key={branch.name}
                                    branch={branch}
                                    onCheckout={() => handleCheckoutBranch(branch.name)}
                                    onDelete={() => handleDeleteBranch(branch.name)}
                                    onMerge={() => handleMergeBranch(branch.name)}
                                    onMergeInto={() => openMergeIntoDialog(branch.name)}
                                    onPushTo={() => { setPushBranch(branch.name); setPushTargetRemote(remotes[0]?.name || '') }}
                                    onRebase={() => handleRebaseBranch(branch.name)}
                                />
                            ))}
                        </div>

                        {/* Remote Branches */}
                        {remoteBranches.length > 0 && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleSection('remoteBranches')}
                                >
                                    {expandedSections.remoteBranches ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.remote')}</span>
                                    <span className="text-[10px] text-text-muted">{remoteBranchGroups.reduce((n, g) => n + g.branches.length, 0)}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowAddRemote(true) }}
                                        className="p-0.5 rounded hover:bg-surface-hover"
                                        title={tt('git.addRemoteTitle')}
                                    >
                                        <Plus className="w-3 h-3 text-text-muted" />
                                    </button>
                                </div>
                                {expandedSections.remoteBranches && remoteBranchGroups.map(group => (
                                    <div key={group.remote}>
                                        {/* 远程分组头：远程名 + 仓库主机，一眼区分 GitHub / Gitee */}
                                        <div
                                            className="px-3 py-1 pl-5 text-[10px] text-text-muted flex items-center gap-1.5 cursor-pointer hover:bg-surface-hover border-t border-border-subtle/50"
                                            onClick={() => toggleRemoteGroup(group.remote)}
                                        >
                                            {collapsedRemoteGroups[group.remote]
                                                ? <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" />
                                                : <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" />}
                                            <span className="font-semibold text-text-secondary">{group.remote}</span>
                                            <span className="flex-1 truncate opacity-70">{group.host}</span>
                                            <span>{group.branches.length}</span>
                                        </div>
                                        {!collapsedRemoteGroups[group.remote] && group.branches.map(branch => (
                                            <BranchItem
                                                key={branch.name}
                                                branch={branch}
                                                onCheckout={() => handleCheckoutRemoteBranch(branch.name)}
                                                onDelete={() => handleDeleteRemoteBranch(branch.name)}
                                                onMerge={() => handleMergeBranch(branch.name)}
                                                onRebase={() => handleRebaseBranch(branch.name)}
                                                onPull={() => handlePullRemoteBranch(branch.name)}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Stash Tab */}
                {activeTab === 'stash' && (
                    <div className="flex flex-col">
                        {/* Stash Actions */}
                        <div className="p-3 border-b border-border-subtle">
                            {showStashInput ? (
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={stashMessage}
                                        onChange={(e) => setStashMessage(e.target.value)}
                                        placeholder={tt('git.stashMessage')}
                                        className="flex-1 h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleStash()
                                            if (e.key === 'Escape') setShowStashInput(false)
                                        }}
                                        autoFocus
                                    />
                                    <Button size="sm" onClick={handleStash} className="h-8">
                                        <Archive className="w-3 h-3 mr-1" /> {tt('git.stash')}
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="secondary"
                                    onClick={() => setShowStashInput(true)}
                                    disabled={stats.total === 0}
                                    className="w-full"
                                >
                                    <Archive className="w-3.5 h-3.5 mr-2" />
                                    {tt('git.stashChanges')}
                                </Button>
                            )}
                        </div>

                        {/* Stash List */}
                        {stashList.length === 0 ? (
                            <div className="p-6 text-center">
                                <Archive className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-30" />
                                <p className="text-xs text-text-muted">{tt('git.noStash')}</p>
                            </div>
                        ) : (
                            <div>
                                {stashList.map(stash => (
                                    <StashItem
                                        key={stash.index}
                                        stash={stash}
                                        onApply={() => handleStashApply(stash.index)}
                                        onPop={() => handleStashPop(stash.index)}
                                        onDrop={() => handleStashDrop(stash.index)}
                                        files={stashFilesByIndex[stash.index] ?? null}
                                        filesLoading={stashFilesLoading === stash.index}
                                        expanded={expandedStashIndex === stash.index}
                                        onToggle={() => { void toggleStashExpanded(stash) }}
                                        onOpenFile={(file) => { void openStashFile(stash, file) }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* History Tab */}
                {activeTab === 'history' && (
                    <div className="flex flex-col">
                        {commits.length === 0 ? (
                            <div className="p-6 text-center">
                                <GitCommitIcon className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-30" />
                                <p className="text-xs text-text-muted">{tt('git.noCommits')}</p>
                            </div>
                        ) : (
                            <div>
                                {commits.map(commit => (
                                    <CommitItem
                                        key={commit.hash}
                                        commit={commit}
                                        onCherryPick={() => handleCherryPick(commit.hash)}
                                        onRevert={() => handleRevertCommit(commit.hash)}
                                        onCopyHash={async () => {
                                            const success = await writeClipboardText(commit.hash)
                                            if (!success) return
                                            toast.success(tt('git.hashCopied'))
                                        }}
                                        files={commitFilesByHash[commit.hash] ?? null}
                                        filesLoading={commitFilesLoading === commit.hash}
                                        expanded={expandedCommitHash === commit.hash}
                                        onToggle={() => { void toggleCommitExpanded(commit) }}
                                        onOpenFile={(file) => { void openCommitFile(commit, file) }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Merge Into Branch Modal */}
            {mergeIntoSource && (
                <Modal
                    isOpen={true}
                    onClose={() => { if (!isMergingInto) setMergeIntoSource(null) }}
                    title={tt('git.mergeIntoTitle')}
                    size="sm"
                >
                    <div className="flex flex-col gap-4">
                        <p className="text-xs text-text-secondary">
                            {t('git.mergeIntoSelectTarget', language, { source: mergeIntoSource })}
                        </p>
                        <Select
                            value={mergeIntoTarget}
                            onChange={setMergeIntoTarget}
                            options={localBranches
                                .filter(b => b.name !== mergeIntoSource)
                                .map(b => ({ value: b.name, label: b.name }))}
                            disabled={isMergingInto}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setMergeIntoSource(null)} disabled={isMergingInto}>
                                {tt('cancel')}
                            </Button>
                            <Button
                                onClick={() => void handleMergeIntoTarget()}
                                disabled={!mergeIntoTarget || isMergingInto}
                                isLoading={isMergingInto}
                                leftIcon={<GitMerge className="w-3 h-3" />}
                            >
                                {tt('git.merge')}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Add Remote Modal */}
            <Modal
                isOpen={showAddRemote}
                onClose={() => { if (!isAddingRemote) setShowAddRemote(false) }}
                title={tt('git.addRemoteTitle')}
                size="sm"
            >
                <div className="flex flex-col gap-4">
                    <p className="text-xs text-text-secondary">{tt('git.addRemoteHint')}</p>
                    <div className="flex flex-col gap-2">
                        <Input
                            value={newRemoteName}
                            onChange={(e) => setNewRemoteName(e.target.value)}
                            placeholder={`${tt('git.remoteName')} (gitee)`}
                            disabled={isAddingRemote}
                        />
                        <Input
                            value={newRemoteUrl}
                            onChange={(e) => setNewRemoteUrl(e.target.value)}
                            placeholder={`${tt('git.remoteUrl')} (https://gitee.com/user/repo.git)`}
                            disabled={isAddingRemote}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setShowAddRemote(false)} disabled={isAddingRemote}>
                            {tt('cancel')}
                        </Button>
                        <Button
                            onClick={() => void handleAddRemote()}
                            disabled={!newRemoteName.trim() || !newRemoteUrl.trim() || isAddingRemote}
                            isLoading={isAddingRemote}
                        >
                            {tt('git.add')}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Push to Remote Modal */}
            {pushBranch && (
                <Modal
                    isOpen={true}
                    onClose={() => { if (!isPushingTo) setPushBranch(null) }}
                    title={tt('git.pushToTitle')}
                    size="sm"
                >
                    <div className="flex flex-col gap-4">
                        <p className="text-xs text-text-secondary">
                            {t('git.pushToSelect', language, { branch: pushBranch })}
                        </p>
                        <Select
                            value={pushTargetRemote}
                            onChange={setPushTargetRemote}
                            options={[
                                ...remotes.map(r => ({ value: r.name, label: r.name })),
                                ...(remotes.length > 1 ? [{ value: '*', label: tt('git.allRemotes') }] : []),
                            ]}
                            disabled={isPushingTo}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setPushBranch(null)} disabled={isPushingTo}>
                                {tt('cancel')}
                            </Button>
                            <Button
                                onClick={() => void handlePushToRemote()}
                                disabled={!pushTargetRemote || isPushingTo}
                                isLoading={isPushingTo}
                                leftIcon={<Upload className="w-3 h-3" />}
                            >
                                {tt('git.push')}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Conflict Resolver Modal */}
            {conflictFile && (
                <Modal isOpen={true} onClose={() => setConflictFile(null)} title="" size="5xl" noPadding>
                    <ConflictResolver
                        filePath={conflictFile}
                        onResolved={() => {
                            setConflictFile(null)
                            refreshStatus()
                        }}
                        onCancel={() => setConflictFile(null)}
                    />
                </Modal>
            )}
        </div>
    )
}
