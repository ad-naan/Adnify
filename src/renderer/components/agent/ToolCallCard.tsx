import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, FileCode, Image as ImageIcon, Search, Server, Terminal, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useStore } from '@store'
import { t, type Language } from '@shared/i18n'
import type { ToolCall } from '@renderer/agent/types'
import { useToolDisplayState } from '@renderer/agent/presentation/toolDisplay'
import { useToolCardExpansion } from '@renderer/hooks'
import { JsonHighlight } from '@utils/jsonHighlight'
import { toast } from '@components/common/ToastProvider'
import { RichContentRenderer } from './RichContentRenderer'
import InlineDiffPreview, { countContentLines } from './InlineDiffPreview'
import { getExtension, getFileName } from '@shared/utils/pathUtils'
import { TextWithFileLinks } from '../common/TextWithFileLinks'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { themeManager } from '../../config/themeConfig'
import { writeClipboardText } from '@/renderer/services/clipboardService'
import { resolveWriteFileStatusText } from '@renderer/agent/utils/fileWriteDisplay'
import { deriveTerminalCommandRule, validateTerminalCommandRuleProposal } from '@renderer/agent/utils/commandApproval'
import { formatTerminalCommandRule, terminalCommandRuleKey } from '@shared/security/commandApprovalRule'
import { ToolApprovalActions } from './ToolApprovalActions'
import { assessShellCommand } from '@shared/security/executionPolicy'
import { parseSymbolToolResult } from '@renderer/agent/presentation/symbolToolDisplay'

interface ToolCallCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onApproveForTask?: () => void
    onReject?: () => void
    onStop?: () => void
    defaultExpanded?: boolean
}

type ToolArgs = Record<string, unknown>

const TOOL_LABELS: Record<string, string> = {
    read_file: 'Read File',
    read_image: 'Read Image',
    read_multiple_files: 'Read Files',
    list_directory: 'List Directory',
    search_files: 'Search Files',
    codebase_search: 'Semantic Search',
    edit_file: 'Edit File',
    write_file: 'Write File',
    create_directory: 'Create Directory',
    create_file: 'Create File',
    delete_file_or_folder: 'Delete',
    run_command: 'Run Command',
    list_remote_directory: 'List Remote Directory',
    read_remote_file: 'Read Remote File',
    write_remote_file: 'Write Remote File',
    rename_remote_path: 'Rename Remote Path',
    delete_remote_path: 'Delete Remote Path',
    upload_to_remote: 'Upload To Remote',
    download_from_remote: 'Download From Remote',
    get_diagnostics: 'Diagnostics',
    find_symbol: 'Find Symbol',
    find_references: 'Find References',
    navigate_symbol: 'Navigate Symbol',
    get_hover_info: 'Hover Info',
    edit_symbol: 'Edit Symbol',
    rename_symbol: 'Rename Symbol',
    get_document_symbols: 'Document Symbols',
    web_search: 'Web Search',
    read_url: 'Read URL',
    ask_user: 'Ask User',
    remember: 'Remember Fact',
    uiux_search: 'UI/UX Search',
    uiux_recommend: 'UI/UX Recommend',
    apply_skill: 'Apply Skill',
    todo_write: 'Task List',
}

const guessLanguage = (filename: string) => {
    const ext = getExtension(filename)
    const map: Record<string, string> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        json: 'json',
        css: 'css',
        html: 'html',
        md: 'markdown',
        py: 'python',
        rs: 'rust',
        go: 'go',
        sh: 'bash',
        yml: 'yaml',
        yaml: 'yaml',
        xml: 'xml',
    }
    return map[ext] || 'typescript'
}

const asString = (value: unknown): string => typeof value === 'string' ? value : ''

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const getPathList = (value: unknown): string[] => {
    if (typeof value === 'string') return value ? [value] : []
    return asStringArray(value).filter(Boolean)
}

const getToolPathList = (args: ToolArgs): string[] => {
    const directPaths = getPathList(args.path)
    if (directPaths.length > 0) return directPaths

    const pluralPaths = getPathList(args.paths)
    if (pluralPaths.length > 0) return pluralPaths

    // The LSP family addresses files as relative_path. Without this the symbol and
    // diagnostics cards fall through to '<unknown path>'.
    return getPathList(args.relative_path)
}

const getPrimaryToolPath = (args: ToolArgs): string => getToolPathList(args)[0] || ''

const getPathDisplayName = (path: string): string => getFileName(path) || path

type RouteMeta = {
    executionTarget?: 'local' | 'remote'
    serverName?: string
    resolvedBy?: 'arg' | 'explicit_context' | 'last_active_server' | 'auto_routing' | 'local_default'
    routeError?: string
    hostTrustStatus?: 'known' | 'accepted_new' | 'mismatch_rejected'
    hostFingerprintSha256?: string
    knownHostFingerprintSha256?: string
}

function getRouteMeta(args: ToolArgs): RouteMeta | null {
    const meta = args._meta
    if (!meta || typeof meta !== 'object') return null
    return meta as RouteMeta
}

function getRouteSourceLabel(resolvedBy?: RouteMeta['resolvedBy']): string {
    switch (resolvedBy) {
        case 'arg':
            return 'server_name'
        case 'explicit_context':
            return '#server#'
        case 'last_active_server':
            return 'recent memory'
        case 'auto_routing':
            return 'auto routing'
        case 'local_default':
            return 'local default'
        default:
            return 'routing'
    }
}

const getPathSummary = (paths: string[], maxItems = 3): string => {
    if (paths.length === 0) return ''
    if (paths.length === 1) return getPathDisplayName(paths[0])

    const preview = paths
        .slice(0, maxItems)
        .map(path => `"${getPathDisplayName(path)}"`)
        .join(', ')

    return `${paths.length} files (${preview}${paths.length > maxItems ? ', ...' : ''})`
}

function getStatusText(name: string, args: ToolArgs, status: ToolCall['status'], isStreaming: boolean): string {
    const isRunning = status === 'running' || status === 'pending' || isStreaming
    const isSuccess = status === 'success'
    const isError = status === 'error'
    const paths = getToolPathList(args)
    const path = getPrimaryToolPath(args)
    const pathSummary = getPathSummary(paths)

    if (name === 'run_command') {
        const cmd = asString(args.command)
        if (!cmd) return isRunning ? 'Preparing cmd...' : ''
        if (isRunning) return `Executing ${cmd}`
        if (isSuccess) return `Executed ${cmd}`
        if (isError) return `Command failed: ${cmd}`
        return cmd
    }

    if (name === 'list_remote_directory') {
        const remotePath = asString(args.path) || '.'
        if (isRunning) return `Listing remote ${remotePath}...`
        if (isSuccess) return `Listed remote ${remotePath}`
        if (isError) return `Failed to list remote ${remotePath}`
        return `Listing remote ${remotePath}`
    }

    if (name === 'read_remote_file') {
        const remotePath = asString(args.path)
        if (!remotePath) return isRunning ? 'Reading remote file...' : ''
        if (isRunning) return `Reading remote ${remotePath}...`
        if (isSuccess) return `Read remote ${remotePath}`
        if (isError) return `Failed to read remote ${remotePath}`
        return `Reading remote ${remotePath}`
    }

    if (name === 'write_remote_file') {
        const remotePath = asString(args.path)
        if (!remotePath) return isRunning ? 'Writing remote file...' : ''
        if (isRunning) return `Writing remote ${remotePath}...`
        if (isSuccess) return `Wrote remote ${remotePath}`
        if (isError) return `Failed to write remote ${remotePath}`
        return `Writing remote ${remotePath}`
    }

    if (name === 'rename_remote_path') {
        const oldPath = asString(args.old_path)
        const newPath = asString(args.new_path)
        const summary = oldPath && newPath ? `${oldPath} -> ${newPath}` : 'remote path'
        if (isRunning) return `Renaming ${summary}...`
        if (isSuccess) return `Renamed ${summary}`
        if (isError) return `Failed to rename ${summary}`
        return `Renaming ${summary}`
    }

    if (name === 'delete_remote_path') {
        const remotePath = asString(args.path)
        if (!remotePath) return isRunning ? 'Deleting remote path...' : ''
        if (isRunning) return `Deleting remote ${remotePath}...`
        if (isSuccess) return `Deleted remote ${remotePath}`
        if (isError) return `Failed to delete remote ${remotePath}`
        return `Deleting remote ${remotePath}`
    }

    if (name === 'upload_to_remote') {
        const remotePath = asString(args.path) || '.'
        if (isRunning) return `Uploading to remote ${remotePath}...`
        if (isSuccess) return `Uploaded to remote ${remotePath}`
        if (isError) return `Failed to upload to remote ${remotePath}`
        return `Uploading to remote ${remotePath}`
    }

    if (name === 'download_from_remote') {
        const remotePath = asString(args.path)
        if (!remotePath) return isRunning ? 'Downloading remote file...' : ''
        if (isRunning) return `Downloading remote ${remotePath}...`
        if (isSuccess) return `Downloaded remote ${remotePath}`
        if (isError) return `Failed to download remote ${remotePath}`
        return `Downloading remote ${remotePath}`
    }

    if (name === 'read_multiple_files') {
        if (paths.length > 0) {
            if (isRunning) return `Reading ${pathSummary}...`
            if (isSuccess) return `Read ${pathSummary}`
            if (isError) return 'Failed to read files'
            return `Reading ${pathSummary}`
        }
        return 'Reading files'
    }

    if (name === 'read_image') {
        if (!path) return isRunning ? 'Analyzing image...' : ''
        if (isRunning) return `Analyzing ${path}...`
        if (isSuccess) return `Analyzed ${path}`
        if (isError) return `Failed to analyze ${path}`
        return `Analyzing ${path}`
    }

    if (['read_file', 'list_directory', 'read_remote_file', 'list_remote_directory'].includes(name)) {
        if (paths.length > 1) {
            if (isRunning) return `Reading ${pathSummary}...`
            if (isSuccess) return `Read ${pathSummary}`
            if (isError) return 'Failed to read files'
            return `Reading ${pathSummary}`
        }
        if (!path) return isRunning ? 'Reading...' : ''
        if (isRunning) return `Reading ${path}...`
        if (isSuccess) return `Read ${path}`
        if (isError) return `Failed to read ${path}`
        return `Reading ${path}`
    }

    if (name === 'write_file') {
        const meta = args._meta && typeof args._meta === 'object' ? args._meta as Record<string, unknown> : undefined
        const oldContent = typeof meta?.oldContent === 'string' ? meta.oldContent : ''
        const newContent = typeof meta?.newContent === 'string'
            ? meta.newContent
            : (typeof args.content === 'string' ? args.content : '')
        if (isRunning) return resolveWriteFileStatusText(meta, oldContent, newContent, 'running', path)
        if (isSuccess) return resolveWriteFileStatusText(meta, oldContent, newContent, 'success', path)
        if (isError) return resolveWriteFileStatusText(meta, oldContent, newContent, 'error', path)
        return resolveWriteFileStatusText(meta, oldContent, newContent, 'running', path)
    }

    if (name === 'create_directory' || name === 'create_file') {
        if (!path) return isRunning ? 'Creating...' : ''
        if (isRunning) return `Creating ${path}...`
        if (isSuccess) return `Created ${path}`
        if (isError) return `Failed to create ${path}`
        return `Creating ${path}`
    }

    if (name === 'edit_file') {
        if (!path) return isRunning ? 'Editing...' : ''
        if (isRunning) return `Editing ${path}...`
        if (isSuccess) return `Updated ${path}`
        if (isError) return `Failed to edit ${path}`
        return `Editing ${path}`
    }

    if (name === 'delete_file_or_folder') {
        if (!path) return isRunning ? 'Deleting...' : ''
        if (isRunning) return `Deleting ${path}...`
        if (isSuccess) return `Deleted ${path}`
        if (isError) return `Failed to delete ${path}`
        return `Deleting ${path}`
    }

    if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(name)) {
        const query = asString(args.pattern) || asString(args.query)
        const value = query ? `"${query}"` : ''
        if (!value) return isRunning ? 'Searching...' : ''
        if (isRunning) return `Searching ${value}...`
        if (isSuccess) return `Searched ${value}`
        if (isError) return 'Search failed'
        return `Searching ${value}`
    }

    if (name === 'read_url') {
        const url = asString(args.url)
        let hostname = ''
        if (url) {
            try {
                hostname = new URL(url).hostname
            } catch {
                hostname = url
            }
        }
        if (!hostname) return isRunning ? 'Reading URL...' : ''
        if (isRunning) return `Reading ${hostname}...`
        if (isSuccess) return `Read ${hostname}`
        if (isError) return `Failed to read ${hostname}`
        return `Reading ${hostname}`
    }

    if (name === 'find_symbol') {
        const symbol = asString(args.name_path)
        if (isRunning) return symbol ? `Finding ${symbol}...` : 'Finding symbol...'
        if (isSuccess) return symbol ? `Found ${symbol}` : 'Symbol search complete'
        if (isError) return symbol ? `Failed to find ${symbol}` : 'Symbol search failed'
    }

    if (['get_diagnostics', 'find_references', 'navigate_symbol', 'get_hover_info', 'get_document_symbols'].includes(name)) {
        if (!path) return isRunning ? 'Analyzing...' : ''
        if (isRunning) return `Analyzing ${path}...`
        if (isSuccess) return `Analyzed ${path}`
        if (isError) return 'Analysis failed'
        return `Analyzing ${path}`
    }

    if (name === 'apply_skill') {
        const skillName = asString(args.skill_name)
        if (!skillName) return isRunning ? 'Loading skill...' : ''
        if (isRunning) return `Applying ${skillName}...`
        if (isSuccess) return `Applied ${skillName}`
        if (isError) return `Failed to apply ${skillName}`
        return `Applying ${skillName}`
    }

    if (name === 'todo_write') {
        if (isRunning) return 'Updating tasks...'
        if (isSuccess) return 'Tasks updated'
        if (isError) return 'Failed to update tasks'
        return 'Updating tasks'
    }

    return isRunning ? 'Processing...' : ''
}

const getHeightPx = (heightClass: string): number => {
    const bracketMatch = heightClass.match(/\[(\d+)px\]/)
    if (bracketMatch) return Number(bracketMatch[1])

    const remMatch = heightClass.match(/max-h-(\d+)/)
    if (remMatch) return Number(remMatch[1]) * 4

    return 200
}

function PendingPreviewSkeleton() {
    return (
        <div className="p-2 space-y-1.5 opacity-70" aria-hidden="true">
            <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[72%]" />
            <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[48%]" />
        </div>
    )
}

function ExecutionTargetBadge({ args }: { args: ToolArgs }) {
    const routeMeta = getRouteMeta(args)
    if (!routeMeta?.executionTarget) return null

    const isRemote = routeMeta.executionTarget === 'remote'

    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                    isRemote
                        ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                        : 'bg-surface-elevated text-text-muted border-border/60'
                }`}>
                    {isRemote ? <Server className="w-3 h-3" /> : <Terminal className="w-3 h-3" />}
                    {isRemote ? 'Remote' : 'Local'}
                </span>
                {routeMeta.serverName && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-surface-elevated text-text-secondary border border-border/60">
                        {routeMeta.serverName}
                    </span>
                )}
                {routeMeta.resolvedBy && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-surface-elevated text-text-muted border border-border/60">
                        via {getRouteSourceLabel(routeMeta.resolvedBy)}
                    </span>
                )}
            </div>
            {routeMeta.routeError && (
                <div className="text-[10px] text-amber-400 break-all">
                    {routeMeta.routeError}
                </div>
            )}
            {isRemote && routeMeta.hostTrustStatus === 'accepted_new' && (
                <div className="text-[10px] text-emerald-300 break-all">
                    Trusted this host fingerprint automatically for future remote sessions.
                    {routeMeta.hostFingerprintSha256 ? ` ${routeMeta.hostFingerprintSha256}` : ''}
                </div>
            )}
            {isRemote && routeMeta.hostTrustStatus === 'mismatch_rejected' && (
                <div className="text-[10px] text-red-300 break-all">
                    Host fingerprint mismatch blocked the remote connection.
                    {routeMeta.knownHostFingerprintSha256 ? ` Known: ${routeMeta.knownHostFingerprintSha256}.` : ''}
                    {routeMeta.hostFingerprintSha256 ? ` Received: ${routeMeta.hostFingerprintSha256}.` : ''}
                </div>
            )}
        </div>
    )
}

export function ExpandablePreviewContainer({
    children,
    maxHeight = 'max-h-[200px]',
    expandedHeight = 'max-h-[350px]',
    language,
}: {
    children: React.ReactNode
    maxHeight?: string
    expandedHeight?: string
    language: Language
}) {
    const [expanded, setExpanded] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [measuredHeight, setMeasuredHeight] = useState(0);

    const collapsedMaxHeight = useMemo(() => getHeightPx(maxHeight), [maxHeight])
    const expandedMaxHeight = useMemo(() => getHeightPx(expandedHeight), [expandedHeight])
    const activeMaxHeight = expanded ? expandedMaxHeight : collapsedMaxHeight

    useLayoutEffect(() => {
        const content = contentRef.current
        const inner = innerRef.current
        if (!content || !inner) return

        const measure = () => {
            const contentHeight = inner.scrollHeight
            const totalHeight = contentHeight
            const nextHeight = Math.max(1, Math.min(totalHeight, activeMaxHeight))
            const nextOverflowing = totalHeight > activeMaxHeight + 10

            setIsOverflowing(nextOverflowing)
            setMeasuredHeight(nextHeight)
        }

        measure()
        const resizeObserver = new ResizeObserver(measure)
        resizeObserver.observe(content)
        resizeObserver.observe(inner)
        return () => resizeObserver.disconnect()
    }, [children, expanded, activeMaxHeight]);

    const heightValue = useMemo(() => {
        const match = expandedHeight.match(/\[(.*?)\]/);
        return match ? match[1] : expandedHeight.replace('max-h-', '');
    }, [expandedHeight]);

    return (
        <div className="mt-1 relative overflow-hidden">
            <div
                ref={contentRef}
                className="overflow-y-auto custom-scrollbar transition-[height,background-color] duration-300 ease-out relative"
                style={{ height: measuredHeight || undefined, maxHeight: activeMaxHeight }}
            >
                <div ref={innerRef}>
                    {children}
                </div>
            </div>
            {isOverflowing && !expanded && (
                <div
                    onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                    className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface/80 via-surface/40 to-transparent flex items-end justify-center pb-2 cursor-pointer transition-all opacity-90 hover:opacity-100"
                >
                    <div className="flex items-center gap-1 font-medium pb-0.5 pointer-events-none bg-surface-elevated text-text-muted hover:text-accent px-3 py-1 rounded-full shadow-sm border border-border/40 text-[10px] transition-colors">
                        <ChevronDown className="w-3 h-3" />
                        {t('toolExpand', language, { height: heightValue })}
                    </div>
                </div>
            )}
            {isOverflowing && expanded && (
                <div
                    onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                    className="w-full text-center py-2 mt-1 cursor-pointer flex items-center justify-center"
                >
                    <div className="flex items-center gap-1 font-medium pointer-events-none bg-surface-elevated text-text-muted hover:text-accent px-4 py-1 rounded-full shadow-sm border border-border/40 text-[10px] transition-colors">
                        <ChevronDown className="w-3 h-3 rotate-180 pointer-events-none" />
                        {t('toolCollapse', language)}
                    </div>
                </div>
            )}
        </div>
    )
}

function ToolPreview({
    toolCall,
    args,
    effectiveName,
    isRunning,
    isStreaming,
    language,
    currentTheme,
    onCopyResult,
    setTerminalVisible,
}: {
    toolCall: ToolCall
    args: ToolArgs
    effectiveName: string
    isRunning: boolean
    isStreaming: boolean
    language: Language
    currentTheme: string
    onCopyResult: () => void
    setTerminalVisible: (visible: boolean) => void
}) {
    const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''
    const pendingPreview = (label = 'Waiting for output...') => (
        <ExpandablePreviewContainer language={language}>
            <div className="p-2 text-[11px] text-text-muted italic">
                {label}
            </div>
            <PendingPreviewSkeleton />
        </ExpandablePreviewContainer>
    )

    if (effectiveName === 'run_command') {
        const cmd = asString(args.command)
        const meta = (args as { _meta?: { terminalId?: string; executionMode?: string } })._meta
        const terminalId = meta?.terminalId
        const hasLiveTerminal = !!terminalId
        const wasDirectExecution = !!meta?.executionMode && meta.executionMode !== 'terminal'

        return (
            <div className="font-mono text-[11px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-text-muted min-w-0">
                        <span className="text-accent/60 select-none flex-shrink-0">$</span>
                        <span className="text-text-primary break-all">{cmd}</span>
                    </div>
                    <button
                        onClick={async event => {
                            event.stopPropagation()
                            if (!terminalId) {
                                toast.info(
                                    wasDirectExecution
                                        ? t('tool.directExecutionNoTerminal', language)
                                        : t('tool.noTerminalSession', language)
                                )
                                return
                            }

                            const { terminalManager } = await import('@/renderer/services/TerminalManager')
                            if (!terminalManager.hasTerminal(terminalId)) {
                                toast.info('Terminal has been closed')
                                return
                            }
                            setTerminalVisible(true)
                            terminalManager.setActiveTerminal(terminalId)
                            window.setTimeout(() => terminalManager.setActiveTerminal(terminalId), 0)
                        }}
                        className={`flex items-center gap-1 flex-shrink-0 ml-2 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                            isRunning
                                ? 'text-accent bg-accent/10'
                                : hasLiveTerminal
                                    ? 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                                    : 'text-text-muted/60 bg-surface-elevated/60 cursor-not-allowed'
                        }`}
                        title={t('tool.viewInTerminal', language)}
                    >
                        <Terminal className={`w-3 h-3 ${isRunning ? 'animate-pulse' : ''}`} />
                        <span>
                            {isRunning
                                ? t('tool.running', language)
                                : hasLiveTerminal
                                    ? t('tool.terminal', language)
                                    : t('tool.direct', language)}
                        </span>
                    </button>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="text-text-muted/80 whitespace-pre-wrap break-all p-2 font-mono text-[11px]">
                            {stringResult.slice(0, 5000)}
                            {stringResult.length > 5000 && <span className="opacity-50 inline-block ml-1">... (truncated)</span>}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Waiting for terminal output...')
                )}
            </div>
        )
    }

    if (effectiveName === 'send_terminal_input') {
        const input = asString(args.input)
        const display = args.is_ctrl ? `Ctrl+${input.toUpperCase()}` : input.replace(/\n|\r/g, '\\n')
        const badgeClass = args.is_ctrl ? 'bg-orange-500/10 text-orange-400' : 'bg-surface-elevated text-text-secondary'

        return (
            <div className="font-mono text-[11px] space-y-1">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-text-muted">Sent input:</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeClass}`}>{display}</span>
                    <span className="text-text-muted/50 text-[10px] ml-1">to {asString(args.terminal_id)}</span>
                </div>
            </div>
        )
    }

    if (effectiveName === 'stop_terminal') {
        return (
            <div className="font-mono text-[11px] space-y-1 text-red-400">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 opacity-80" />
                    <span className="font-medium">Force terminated process</span>
                    <span className="opacity-50 text-[10px]">{asString(args.terminal_id)}</span>
                </div>
            </div>
        )
    }

    if (effectiveName === 'read_terminal_output') {
        return (
            <div className="font-mono text-[11px] space-y-1">
                <div className="flex items-center gap-2 text-text-muted">
                    <Terminal className="w-3.5 h-3.5 text-accent/70" />
                    <span>Read terminal logs</span>
                    <span className="opacity-50 text-[10px]">{asString(args.terminal_id)}</span>
                </div>
                {stringResult.length > 0 ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="text-text-muted/80 whitespace-pre-wrap break-all p-2 bg-surface/50">
                            {stringResult}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Waiting for terminal output...')
                )}
            </div>
        )
    }

    if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(effectiveName)) {
        const query = asString(args.pattern) || asString(args.query)
        const searchType = effectiveName === 'codebase_search' ? 'Semantic' : effectiveName === 'web_search' ? 'Web' : effectiveName === 'uiux_search' ? 'UI/UX' : 'Files'

        return (
            <div className="space-y-1 text-[11px]">
                <div className="flex items-center gap-1.5 text-text-muted">
                    <Search className="w-3 h-3" />
                    <span>{searchType}:</span>
                    <span className="text-text-primary font-medium truncate">"{query}"</span>
                </div>
                {toolCall.result ? (
                    <ExpandablePreviewContainer language={language}>
                        <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Searching...')
                )}
            </div>
        )
    }

    if (['list_directory', 'list_remote_directory'].includes(effectiveName)) {
        const paths = getToolPathList(args)
        const path = paths[0] || asString(args.path) || ''
        const displayName = paths.length > 1 ? getPathSummary(paths) : getPathDisplayName(path) || '.'

        return (
            <div className="space-y-1 text-[11px]">
                <div className="flex items-center gap-1.5 text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="text-text-primary font-medium" title={path || undefined}>{displayName}</span>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="p-2 font-mono text-text-secondary whitespace-pre">
                            {stringResult.slice(0, 5000)}
                            {stringResult.length > 5000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview(effectiveName === 'list_remote_directory' ? 'Reading remote directory...' : 'Reading directory...')
                )}
            </div>
        )
    }

    if (['edit_file', 'write_file'].includes(effectiveName)) {
        const filePath = getPrimaryToolPath(args)
        const oldString = asString(args.old_string)
        const nextContent = asString(args.content) || asString(args.new_string)
        const oldContent = oldString.slice(0, 5000)
        const newContent = nextContent.slice(0, 5000)
        const meta = args._meta as Record<string, unknown> | undefined
        const isLargeWrite = meta?.isLargeWrite === true || meta?.contentTruncated === true
        const isTruncated = isLargeWrite || nextContent.length > 5000 || oldString.length > 5000

        // While streaming, a content payload over this threshold triggers a
        // lightweight summary instead of a live diff render. The full diff is
        // still computed once streaming settles.
        const STREAMING_DIFF_BYPASS_THRESHOLD = 64 * 1024
        const bypassStreamingDiff = isStreaming && nextContent.length > STREAMING_DIFF_BYPASS_THRESHOLD
        const streamedLineCount = bypassStreamingDiff ? countContentLines(nextContent) : 0

        if (newContent || isStreaming) {
            return (
                <div className="space-y-1">
                    <div className="flex items-center flex-wrap gap-2 text-[11px] text-text-muted">
                        <FileCode className="w-3 h-3 flex-shrink-0" />
                        {filePath ? (
                            <span className="font-medium text-text-primary transition-colors break-all" title={filePath}>
                                <TextWithFileLinks text={getFileName(filePath)} />
                            </span>
                        ) : (isStreaming || isRunning) ? (
                            <span className="font-medium tool-text-shimmer italic">editing...</span>
                        ) : (
                            <span className="font-medium text-text-primary opacity-50">&lt;empty path&gt;</span>
                        )}
                        {isStreaming && (
                            <span className="text-accent flex items-center gap-1">
                                <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
                                Writing...
                                {bypassStreamingDiff && (
                                    <span className="opacity-70">
                                        {(nextContent.length / 1024).toFixed(1)} KB · {streamedLineCount} lines
                                    </span>
                                )}
                            </span>
                        )}
                        {isTruncated && !isStreaming && <span className="text-amber-500">(truncated)</span>}
                    </div>
                    {isLargeWrite && !isStreaming ? (
                        <div className="ml-1 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-2 text-[11px] text-text-muted">
                            Large file preview deferred. Open the file to inspect the full content safely.
                        </div>
                    ) : bypassStreamingDiff ? (
                        <div className="ml-1 rounded-md border border-accent/20 bg-accent/5 px-2 py-2 text-[11px] text-text-muted">
                            Large file streaming · diff will render after completion.
                        </div>
                    ) : (
                        <div className="max-h-64 overflow-auto custom-scrollbar pl-2 ml-1">
                            <InlineDiffPreview
                                oldContent={oldContent}
                                newContent={newContent}
                                filePath={filePath}
                                isStreaming={isStreaming}
                                maxLines={30}
                            />
                        </div>
                    )}
                    {stringResult && !isStreaming && (
                        <ExpandablePreviewContainer language={language} maxHeight="max-h-[100px]">
                            <div className="p-2 text-[11px] text-text-muted">
                                {stringResult.slice(0, 1000)}
                            </div>
                        </ExpandablePreviewContainer>
                    )}
                </div>
            )
        }
    }

    if (effectiveName === 'create_directory' || effectiveName === 'delete_file_or_folder') {
        const paths = getToolPathList(args)
        const path = paths[0] || ''
        const isDelete = effectiveName === 'delete_file_or_folder'
        const isFolder = effectiveName === 'create_directory' || path.endsWith('/')
        const displayName = paths.length > 1 ? getPathSummary(paths) : (path ? getPathDisplayName(path) : '<no path>')

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px]">
                    <FileCode className={`w-3 h-3 ${isDelete ? 'text-status-error' : 'text-status-success'}`} />
                    <span className={`font-medium ${isDelete ? 'text-status-error' : 'text-status-success'}`}>
                        {isDelete ? 'Delete' : 'Create'} {isFolder ? 'folder' : 'file'}:
                    </span>
                    <span className="text-text-primary break-all" title={path || undefined}>{displayName}</span>
                </div>
                {stringResult && (
                    <ExpandablePreviewContainer language={language} maxHeight="max-h-[100px]">
                        <div className="p-2 text-[11px] text-text-muted">
                            <TextWithFileLinks text={stringResult.slice(0, 1000)} />
                        </div>
                    </ExpandablePreviewContainer>
                )}
            </div>
        )
    }

    if (['read_file', 'read_multiple_files', 'read_remote_file'].includes(effectiveName)) {
        const paths = getToolPathList(args)
        const filePath = paths[0] || asString(args.path) || ''
        const readMeta = args._meta && typeof args._meta === 'object' ? args._meta as Record<string, unknown> : undefined
        const contentKind = typeof readMeta?.contentKind === 'string' ? readMeta.contentKind : undefined
        const isDocumentRead = contentKind === 'document'
        const hasResolvedReadTarget = paths.length > 0
        if (!hasResolvedReadTarget && !toolCall.result && !toolCall.richContent?.length && !isRunning && !isStreaming) {
            return null
        }
        const displayName = paths.length > 1 ? getPathSummary(paths) : (filePath ? getPathDisplayName(filePath) : '<no path>')
        const theme = themeManager.getThemeById(currentTheme)
        const syntaxStyle = theme?.type === 'light' ? vs : vscDarkPlus

        return (
            <div className="space-y-1 mt-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={paths.join('\n') || undefined}>
                        <TextWithFileLinks text={displayName} />
                    </span>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        {isDocumentRead ? (
                            <div className="p-2 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">
                                <TextWithFileLinks text={stringResult.slice(0, 5000)} />
                                {stringResult.length > 5000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                            </div>
                        ) : (
                            <SyntaxHighlighter
                                style={syntaxStyle}
                                language={filePath ? guessLanguage(filePath) : 'typescript'}
                                PreTag="div"
                                className="!bg-transparent !p-2 !m-0 !text-[11px] leading-relaxed font-mono"
                                customStyle={{ background: 'transparent', margin: 0, padding: 0, border: 'none', boxShadow: 'none', fontFamily: 'inherit' }}
                                wrapLines
                                wrapLongLines
                            >
                                {stringResult.slice(0, 5000)}
                            </SyntaxHighlighter>
                        )}
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview(effectiveName === 'read_remote_file' ? 'Reading remote file...' : 'Reading file...')
                )}
            </div>
        )
    }

    if (effectiveName === 'read_image') {
        const path = getPrimaryToolPath(args)

        return (
            <div className="space-y-1 mt-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <ImageIcon className="w-3 h-3" />
                    <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={path || undefined}>
                        <TextWithFileLinks text={getPathDisplayName(path) || '<no path>'} />
                    </span>
                </div>
                {toolCall.richContent && toolCall.richContent.length > 0 ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="p-2">
                            <RichContentRenderer content={toolCall.richContent} maxHeight="max-h-full" />
                        </div>
                    </ExpandablePreviewContainer>
                ) : stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="p-2 text-[11px] text-text-secondary whitespace-pre-wrap break-words">
                            {stringResult.slice(0, 5000)}
                            {stringResult.length > 5000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Analyzing image...')
                )}
            </div>
        )
    }

    if (effectiveName === 'read_url') {
        const url = asString(args.url)
        let hostname = '<no url>'
        if (url) {
            try {
                hostname = new URL(url).hostname
            } catch {
                hostname = url
            }
        }

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <Search className="w-3 h-3" />
                    <a href={url} target="_blank" rel="noreferrer" className="text-text-primary font-medium hover:underline truncate hover:text-accent transition-colors">
                        {hostname}
                    </a>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="p-2 text-[11px] text-text-secondary whitespace-pre-wrap break-all">
                            {stringResult.slice(0, 5000)}
                            {stringResult.length > 5000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Reading URL...')
                )}
            </div>
        )
    }

    if (effectiveName === 'find_symbol' || effectiveName === 'get_document_symbols') {
        const symbols = parseSymbolToolResult(stringResult)
        const argumentPath = getPrimaryToolPath(args)
        const resultPaths = [...new Set(symbols.map(symbol => symbol.relativePath).filter(Boolean))]
        const scopeLabel = argumentPath || (resultPaths.length === 1 ? resultPaths[0] : resultPaths.length > 1 ? `${resultPaths.length} files` : '')

        return (
            <div className="space-y-1.5 text-[11px]">
                <div className="flex min-w-0 items-center gap-1.5 text-text-muted">
                    <FileCode className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">
                        {scopeLabel ? <TextWithFileLinks text={scopeLabel} /> : (t('toolCallCard.workspaceSymbols', language))}
                    </span>
                    {symbols.length > 0 && <span className="shrink-0 text-text-muted/60">· {symbols.length}</span>}
                </div>
                {symbols.length > 0 ? (
                    <ExpandablePreviewContainer language={language} maxHeight="max-h-[220px]" expandedHeight="max-h-[440px]">
                        <div className="space-y-1">
                            {symbols.map((symbol, index) => (
                                <div key={`${symbol.relativePath}-${symbol.namePath}-${index}`} className="rounded-md bg-text-primary/[0.025] px-2 py-1.5">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <code className="min-w-0 flex-1 truncate font-mono text-text-primary">{symbol.namePath}</code>
                                        {symbol.kindName && <span className="shrink-0 text-[9px] text-text-muted/60">{symbol.kindName}</span>}
                                    </div>
                                    {symbol.relativePath && <div className="mt-0.5 truncate text-[10px] text-text-muted">
                                        <TextWithFileLinks text={`${symbol.relativePath}${symbol.line ? `:${symbol.line}` : ''}`} />
                                    </div>}
                                    {symbol.body && <ExpandablePreviewContainer language={language} maxHeight="max-h-[180px]">
                                        <pre className="overflow-auto whitespace-pre p-2 font-mono text-[10px] leading-4 text-text-secondary custom-scrollbar">{symbol.body}</pre>
                                    </ExpandablePreviewContainer>}
                                </div>
                            ))}
                        </div>
                    </ExpandablePreviewContainer>
                ) : toolCall.result ? (
                    <div className="rounded-md bg-text-primary/[0.025] px-2 py-1.5 text-text-muted">{toolCall.result}</div>
                ) : (isRunning || isStreaming) && pendingPreview('Analyzing...')}
            </div>
        )
    }

    if (['get_diagnostics', 'find_references', 'navigate_symbol', 'get_hover_info'].includes(effectiveName)) {
        const path = getPrimaryToolPath(args)
        const line = typeof args.line === 'number' ? args.line : undefined

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={path || undefined}>
                        <TextWithFileLinks text={getFileName(path) || '<unknown path>'} />
                    </span>
                    {line && <span className="text-text-muted/60">:{line}</span>}
                </div>
                {toolCall.result ? (
                    <ExpandablePreviewContainer language={language}>
                        <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Analyzing...')
                )}
            </div>
        )
    }

    const hasArgs = Object.keys(args).some(key => !key.startsWith('_'))
    const filteredArgs = Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith('_')))

    return (
        <div className="space-y-1 mt-1 text-[11px]">
            {hasArgs && (
                <>
                    <div className="flex items-center gap-1.5 text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span>Arguments:</span>
                    </div>
                    <ExpandablePreviewContainer language={language} maxHeight="max-h-[150px]">
                        <JsonHighlight data={filteredArgs} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={1500} />
                    </ExpandablePreviewContainer>
                </>
            )}
            {toolCall.richContent && toolCall.richContent.length > 0 && (
                <ExpandablePreviewContainer language={language}>
                    <div className="p-2">
                        <RichContentRenderer content={toolCall.richContent} maxHeight="max-h-full" />
                    </div>
                </ExpandablePreviewContainer>
            )}
            {toolCall.result && (!toolCall.richContent || toolCall.richContent.length === 0) && (
                <>
                    <div className="flex items-center justify-between gap-1.5 text-text-muted mt-2 group/title">
                        <div className="flex items-center gap-1.5">
                            <Terminal className="w-3 h-3" />
                            <span>Result:</span>
                        </div>
                        <button
                            onClick={event => {
                                event.stopPropagation()
                                onCopyResult()
                            }}
                            className="opacity-0 group-hover/title:opacity-100 transition-opacity p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
                            title="Copy Result"
                        >
                            <Copy className="w-3 h-3" />
                        </button>
                    </div>
                    <ExpandablePreviewContainer language={language}>
                        <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
                    </ExpandablePreviewContainer>
                </>
            )}
            {!toolCall.result && (!toolCall.richContent || toolCall.richContent.length === 0) && (isRunning || isStreaming) && pendingPreview()}
        </div>
    )
}

const ToolCallCard = memo(function ToolCallCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onApproveForTask,
    onReject,
    onStop,
    defaultExpanded,
}: ToolCallCardProps) {
    const { language, setTerminalVisible, currentTheme, expandAgentBlocksByDefault } = useStore(useShallow(state => ({
        language: state.language,
        setTerminalVisible: state.setTerminalVisible,
        currentTheme: state.currentTheme,
        expandAgentBlocksByDefault: state.agentConfig.expandAgentBlocksByDefault ?? false,
    })))
    const { args, effectiveName, isSuccess, isError, isRejected, isRunning, isStreaming } = useToolDisplayState(toolCall)
    const isActive = isRunning || isStreaming || Boolean(isAwaitingApproval)
    const commandText = typeof toolCall.arguments.command === 'string' ? toolCall.arguments.command : ''
    const shellDecision = effectiveName === 'run_command' ? assessShellCommand(commandText, []) : null
    const canConfigureCommandRule = shellDecision?.kind !== 'deny' && shellDecision?.risk !== 'dangerous'
    const approvalRule = effectiveName === 'run_command' && !toolCall.arguments.server_name
        ? validateTerminalCommandRuleProposal(commandText, toolCall.arguments.approval_scope)
            || deriveTerminalCommandRule(commandText)
        : null
    const [showApproveRule, setShowApproveRule] = useState(false)
    const handleApproveAlways = async () => {
        if (!approvalRule) return
        const store = useStore.getState()
        const current = store.autoApprove.terminalCommandRules || []
        const ruleKey = terminalCommandRuleKey(approvalRule)
        if (!current.some(rule => terminalCommandRuleKey(rule) === ruleKey)) {
            store.set('autoApprove', {
                ...store.autoApprove,
                terminalCommandRules: [...current, approvalRule],
            })
            await useStore.getState().save()
        }
        toast.success(
            t('toolCallCard.similarCommandsAllowed', language),
            formatTerminalCommandRule(approvalRule),
        )
        onApprove?.()
    }
    const { isExpanded, animateContent, handleToggleExpanded } = useToolCardExpansion({
        defaultExpanded: defaultExpanded ?? (Boolean(isAwaitingApproval) || expandAgentBlocksByDefault),
        isActive,
    })

    const statusText = useMemo(
        () => getStatusText(effectiveName, args, toolCall.status, isStreaming),
        [effectiveName, args, toolCall.status, isStreaming]
    )

    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border border-yellow-500/20 bg-yellow-500/5 rounded-lg shadow-sm shadow-yellow-500/5 overflow-hidden'
        if (isError) return 'bg-red-500/5 rounded-lg overflow-hidden'
        if (isStreaming || isRunning) return 'bg-accent/5 rounded-lg overflow-hidden'
        return 'hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    const contentBody = (
        <div className="pl-[26px] pr-3 pb-3 pt-0 relative border-t-0">
            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

            <div className="relative z-10 space-y-2 mt-1">
                <ToolPreview
                    toolCall={toolCall}
                    args={args}
                    effectiveName={effectiveName}
                    isRunning={isRunning}
                    isStreaming={isStreaming}
                    language={language}
                    currentTheme={currentTheme}
                    onCopyResult={() => {
                        if (toolCall.result) {
                            writeClipboardText(toolCall.result)
                        }
                    }}
                    setTerminalVisible={setTerminalVisible}
                />
                <ExecutionTargetBadge args={args} />
                {toolCall.error && (
                    <div className="px-3 py-2 bg-red-500/10 rounded-md">
                        <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                            <AlertTriangle className="w-3 h-3" />
                            Error
                        </div>
                        <p className="text-[11px] text-red-300 font-mono break-all">{toolCall.error}</p>
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <div className={`group my-0.5 relative ${cardStyle}`}>
            {(isStreaming || isRunning) && (
                <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
                    <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent tool-card-sweep" />
                </div>
            )}

            <div className="flex min-h-[32px] items-center gap-2 py-1.5 cursor-pointer select-none" onClick={handleToggleExpanded}>
                <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/40 hover:text-text-muted">
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {isStreaming || isRunning ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        </div>
                    ) : isSuccess ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-green-500" />
                        </div>
                    ) : isError ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-red-500/10 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-red-500" />
                        </div>
                    ) : isRejected ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500/10 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-yellow-500" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30" />
                    )}
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${isStreaming || isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
                        {statusText || (
                            <span className="opacity-50 inline-flex items-center gap-1.5">
                                <span>{TOOL_LABELS[effectiveName] || effectiveName}</span>
                            </span>
                        )}
                    </span>
                </div>
            </div>

            {isExpanded && (
                animateContent ? (
                    <AnimatePresence initial={false}>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.16, ease: 'easeOut' }}
                        >
                            {contentBody}
                        </motion.div>
                    </AnimatePresence>
                ) : (
                    contentBody
                )
            )}

            {isAwaitingApproval && (
                <div className="border-t border-yellow-500/10 bg-yellow-500/5 px-3 py-2">
                    {showApproveRule && approvalRule && (
                        <div className="mb-2.5 rounded-lg border border-accent/25 bg-background/75 p-2.5">
                            <div className="mb-1 text-[11px] font-medium text-text-primary">
                                {t('common.alwaysAllowSimilarCommands', language)}
                            </div>
                            <div className="flex items-center gap-2 rounded-md border border-border/70 bg-surface/60 p-2">
                                <div className="min-w-0 flex-1">
                                    <code className="block truncate text-[11px] text-text-primary">{formatTerminalCommandRule(approvalRule)} <span className="text-text-muted">…</span></code>
                                    {approvalRule.description && <p className="mt-1 text-[10px] leading-4 text-text-muted">{approvalRule.description}</p>}
                                </div>
                                <button onClick={() => void handleApproveAlways()} className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover">
                                    {t('toolCallCard.saveRun', language)}
                                </button>
                            </div>
                            <p className="mt-1.5 text-[10px] leading-4 text-text-muted">
                                {t('toolCallCard.onlyTheExecutableAnd', language)}
                            </p>
                        </div>
                    )}
                    <ToolApprovalActions
                        language={language}
                        onApprove={onApprove}
                        onApproveForTask={onApproveForTask}
                        onApproveAlways={effectiveName === 'run_command' && canConfigureCommandRule && approvalRule ? () => setShowApproveRule(true) : undefined}
                        onReject={onReject}
                        onStop={onStop}
                    />
                </div>
            )}
        </div>
    )
})

export default ToolCallCard
