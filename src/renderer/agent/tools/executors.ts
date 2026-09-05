/**
 * 工具执行器实现
 * 所有内置工具的执行逻辑
 */

import { api } from '@/renderer/services/electronAPI'
import { browserToolExecutors } from './executors/browser'
import { toAppError } from '@shared/utils/errorHandler'
import { resolveEditFileRequest } from '@/shared/utils/editFile'
import { resolveReadFileRequest } from '@/shared/utils/readFile'
import { logger } from '@utils/Logger'
import type { AgentSymbol, LspDocumentSymbol, LspSymbolInformation, LspTextEdit, LspWorkspaceEdit, ToolExecutionResult, ToolExecutionContext } from '@/shared/types'
import { validatePath, platform, getDirname, toFullPath, toRelativePath } from '@shared/utils/pathUtils'
import { lspUriToPath, pathToLspUri } from '@shared/utils/uriUtils'
import { compactAgentSymbols, extractLspRange, findAgentSymbols, findContainingAgentSymbol, limitAgentSymbolDepth, normalizeAgentNamePathPattern, toAgentSymbols } from '@shared/lsp/agentSymbols'
import { applyLspTextEdits, collectWorkspaceTextEdits } from '@shared/lsp/textEdits'
import { boundFileExcerpt, boundJsonOutput, clampOutputBudget, type JsonOutputStage } from '@shared/utils/toolOutput'
import { securityReasonsText } from '@shared/security/securityReasonText'
import { waitForDiagnostics, isLanguageSupported, getLanguageId, didOpenDocument } from '@/renderer/services/lspService'
import {
    calculateLineChanges,
} from '@/renderer/utils/searchReplace'
import { smartReplace, normalizeLineEndings, checkLineReplaceWarnings } from '@/renderer/utils/smartReplace'
import { getAgentConfig } from '../utils/AgentConfig'
import { laneNeedsRecovery } from '../orchestration/laneProjection'
import { fileCacheService } from '../services/fileCacheService'
import { memoryService, normalizeMemoryContentInput } from '../services/memoryService'
import { useStore } from '@/renderer/store'
import { PLAN_BOARD_PATH, isPlanBoardPath } from '@/shared/types/planBoard'
import { hasCompletePlanStageMap, normalizePlanStageMap, renderPlanStageMarkdown } from '../plan/planStageContent'
import type { PlanStageKey } from '../plan/types'
import { getConfiguredPlanProviders, resolvePlanProviderAssignment } from '../plan/planProviderCatalog'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { getMessageText } from '@/renderer/agent/types'
import { composerService } from '../services/composerService'
import { agentStorePlanBridge, agentStoreTodoBridge } from '../store/agentStoreBridge'
import { buildFileChangeDescriptor } from '../utils/fileChangeUtils'
import { isLongRunningCommand } from './commandRuntime'
import { runManagedCommand } from './managedCommand'
import { internalWriteTracker } from '@/renderer/services/internalWriteTracker'
import { toolRegistry } from './registry'
import { aiAttributionService } from '@/renderer/services/aiAttributionService'
import pLimit from 'p-limit'
import { skillService } from '../services/skillService'
import { guardWriteFile } from './fileWriteStrategy'
import { analyzeImageSource, getReadImageUnavailableMessage, getReadRichContentOptions } from '../services/imageReadService'
import {
    shellServerRoutingService,
    type RemoteShellLink,
    type ResolvedShellServerTarget,
} from '../services/shellServerRoutingService'
import type {
    RemoteHostTrustDecision,
    RemoteShellServer,
} from '@/renderer/types/electron'
import { detectTerminalShellFamily } from '@/renderer/services/terminalShell'
import { RICH_DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, getFileExtension } from './executors/constants'
import { getReplaceErrorMessage, translate } from './executors/i18n'
import { formatRecommendation, formatUiuxResults } from './executors/uiuxFormat'

// ===== 辅助函数 =====

async function getTerminalManager() {
    return (await import('@/renderer/services/TerminalManager')).terminalManager
}

/**
 * 文件写入后通知 LSP 并等待诊断
 *
 * 关键：必须先 didOpen/didChange 让 LSP 感知文件内容，
 * 否则 LSP 不会为未打开的文件推送诊断。
 */
async function notifyLspAfterWrite(filePath: string, newContent?: string): Promise<void> {
    const languageId = getLanguageId(filePath)
    if (!isLanguageSupported(languageId)) return

    try {
        // 1. 通知 LSP 文件内容变更（didOpen 内部处理了已打开→didChange 的切换）
        if (newContent !== undefined) {
            await didOpenDocument(filePath, newContent)
        }
        if (newContent !== undefined && shouldTreatAsLargeWrite(null, newContent)) {
            return
        }
        // 2. 等待 LSP 返回诊断信息（最多等待 3 秒）
        await waitForDiagnostics(filePath)
    } catch {
        // 忽略错误，不影响主流程
    }
}

/**
 * 文件变更后通知 composerService（行内预览集成）
 */
function notifyComposerChange(opts: {
    filePath: string
    workspacePath: string
    oldContent: string | null
    newContent: string | null
    changeType: 'create' | 'modify' | 'delete'
    linesAdded: number
    linesRemoved: number
    isLargeWrite?: boolean
    contentTruncated?: boolean
    oldContentLength?: number
    newContentLength?: number
    toolCallId?: string
}): void {
    composerService.ensureSession()
    composerService.addChange(buildFileChangeDescriptor({
        filePath: opts.filePath,
        workspacePath: opts.workspacePath,
        oldContent: opts.oldContent,
        newContent: opts.newContent,
        changeType: opts.changeType,
        linesAdded: opts.linesAdded,
        linesRemoved: opts.linesRemoved,
        isLargeWrite: opts.isLargeWrite,
        contentTruncated: opts.contentTruncated,
        oldContentLength: opts.oldContentLength,
        newContentLength: opts.newContentLength,
        toolCallId: opts.toolCallId,
    }))
    notifyWorkspaceTreeChange({
        workspacePath: opts.workspacePath,
        targetPath: opts.filePath,
        changeType: opts.changeType,
    })
}

function notifyWorkspaceTreeChange(opts: {
    workspacePath: string
    targetPath: string
    changeType: 'create' | 'modify' | 'delete'
    isDirectory?: boolean
}): void {
    if (typeof window === 'undefined' || !opts.targetPath) return

    const parentPath = getDirname(opts.targetPath)
    const affectedPaths = new Set<string>()

    if (parentPath) {
        affectedPaths.add(parentPath)
    }

    if (opts.isDirectory && opts.changeType === 'create') {
        affectedPaths.add(opts.targetPath)
    }

    if (opts.workspacePath && parentPath === opts.workspacePath) {
        affectedPaths.add(opts.workspacePath)
    }

    window.dispatchEvent(new CustomEvent('workspace:files-changed', {
        detail: {
            affectedPaths: Array.from(affectedPaths),
            deletedPaths: opts.changeType === 'delete' ? [opts.targetPath] : [],
            refreshRoot: Boolean(opts.workspacePath && parentPath === opts.workspacePath),
        },
    }))
}

interface DirTreeNode {
    name: string
    path: string
    isDirectory: boolean
    children?: DirTreeNode[]
}

async function buildDirTree(dirPath: string, maxDepth: number, currentDepth = 0): Promise<DirTreeNode[]> {
    if (currentDepth >= maxDepth) return []

    const items = await api.file.readDir(dirPath)
    if (!items) return []

    const ignoreDirs = getAgentConfig().ignoredDirectories

    const nodes: DirTreeNode[] = []
    for (const item of items) {
        if (item.name.startsWith('.') && item.name !== '.env') continue
        if (ignoreDirs.includes(item.name)) continue

        const node: DirTreeNode = { name: item.name, path: item.path, isDirectory: item.isDirectory }
        if (item.isDirectory && currentDepth < maxDepth - 1) {
            node.children = await buildDirTree(item.path, maxDepth, currentDepth + 1)
        }
        nodes.push(node)
    }

    return nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
    })
}

function formatDirTree(nodes: DirTreeNode[], prefix = ''): string {
    let result = ''
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const isLast = i === nodes.length - 1
        result += `${prefix}${isLast ? '└── ' : '├── '}${node.isDirectory ? '📁 ' : '📄 '}${node.name}\n`
        if (node.children?.length) {
            result += formatDirTree(node.children, prefix + (isLast ? '    ' : '│   '))
        }
    }
    return result
}

/**
 * Resolve a tool path with workspace security policy.
 * Outside-workspace and sensitive paths use an exact-target session grant.
 * Strict mode may be disabled for ordinary external paths, but never bypasses
 * approval for credential/system-sensitive targets.
 */
type ToolPathAccess = 'read' | 'write' | 'manage' | 'command'

async function resolvePath(
    p: unknown,
    workspacePath: string | null,
    access: ToolPathAccess = 'write',
    approval?: ToolExecutionContext['securityApproval'],
): Promise<string> {
    if (typeof p !== 'string') throw new Error('Invalid path: not a string')

    let validation = validatePath(p, workspacePath, {
        allowSensitive: false,
        allowOutsideWorkspace: false,
    })

    if (!validation.valid && access === 'command') {
        validation = validatePath(p, workspacePath, {
            allowSensitive: true,
            allowOutsideWorkspace: true,
        })
    } else if (!validation.valid && (
        validation.error === 'Path is outside workspace'
        || validation.error === 'Access to sensitive path denied'
    )) {
        const fullPath = toFullPath(p, workspacePath)
        const strictWorkspaceMode = useStore.getState().securitySettings?.strictWorkspaceMode !== false

        if (!strictWorkspaceMode && validation.error === 'Path is outside workspace') {
            validation = validatePath(p, workspacePath, {
                allowSensitive: false,
                allowOutsideWorkspace: true,
            })
        } else {
            const grantAccess = access === 'manage' ? 'manage' : access === 'write' ? 'write' : 'read'
            const decision = await api.security.requestExternalFileAccess(fullPath, grantAccess, approval)
            if (!decision.allowed) {
                throw new Error(
                    `Security: Path access rejected (${decision.reason}, ${fullPath}). ` +
                    'Approve the exact target, or disable Strict workspace mode for ordinary external paths.',
                )
            }
            validation = validatePath(p, workspacePath, {
                allowSensitive: true,
                allowOutsideWorkspace: true,
            })
        }
    }

    if (!validation.valid) throw new Error(`Security: ${validation.error}`)
    return validation.sanitizedPath!
}

function hashContent(content: string | null): string {
    const input = content ?? '__NULL__'
    let hash = 2166136261
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

const LARGE_WRITE_CHAR_THRESHOLD = 120_000
const LARGE_WRITE_TOTAL_CHAR_THRESHOLD = 200_000
const LARGE_META_PREVIEW_CHARS = 4_000

function countLinesFast(content: string | null | undefined): number {
    if (!content) return 0

    let count = 1
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) count++
    }
    return count
}

function getApproxLineChanges(oldContent: string, newContent: string): { added: number; removed: number } {
    const oldLines = countLinesFast(oldContent)
    const newLines = countLinesFast(newContent)
    return {
        added: Math.max(0, newLines - oldLines),
        removed: Math.max(0, oldLines - newLines),
    }
}

function shouldTreatAsLargeWrite(oldContent: string | null, newContent: string): boolean {
    const oldLength = oldContent?.length || 0
    const newLength = newContent.length
    return (
        oldLength >= LARGE_WRITE_CHAR_THRESHOLD ||
        newLength >= LARGE_WRITE_CHAR_THRESHOLD ||
        oldLength + newLength >= LARGE_WRITE_TOTAL_CHAR_THRESHOLD
    )
}

function buildMetaContent(content: string | null, isLargeWrite: boolean): string | null {
    if (content === null) return null
    if (!isLargeWrite || content.length <= LARGE_META_PREVIEW_CHARS) return content
    return `${content.slice(0, LARGE_META_PREVIEW_CHARS)}\n\n/* content truncated for preview */`
}

function buildWriteMeta(
    filePath: string,
    oldContent: string | null,
    newContent: string | null,
    lineChanges: { added: number; removed: number },
    hashes: { preHash: string; postHash: string },
    extra: Record<string, unknown> = {}
): Record<string, unknown> {
    const isLargeWrite = shouldTreatAsLargeWrite(oldContent, newContent || '')

    return {
        filePath,
        oldContent: buildMetaContent(oldContent, isLargeWrite),
        newContent: buildMetaContent(newContent, isLargeWrite),
        linesAdded: lineChanges.added,
        linesRemoved: lineChanges.removed,
        preHash: hashes.preHash,
        postHash: hashes.postHash,
        isLargeWrite,
        contentTruncated: isLargeWrite,
        oldContentLength: oldContent?.length || 0,
        newContentLength: newContent?.length || 0,
        ...extra,
    }
}

function getLineChangesForWrite(oldContent: string, newContent: string): { added: number; removed: number } {
    if (shouldTreatAsLargeWrite(oldContent, newContent)) {
        return getApproxLineChanges(oldContent, newContent)
    }
    return calculateLineChanges(oldContent, newContent)
}

function getWritePreviewFlags(oldContent: string | null, newContent: string | null): {
    isLargeWrite: boolean
    contentTruncated: boolean
    oldContentLength: number
    newContentLength: number
} {
    const isLargeWrite = shouldTreatAsLargeWrite(oldContent, newContent || '')
    return {
        isLargeWrite,
        contentTruncated: isLargeWrite,
        oldContentLength: oldContent?.length || 0,
        newContentLength: newContent?.length || 0,
    }
}

function escapeShellSingleQuotes(value: string): string {
    return value.replace(/'/g, `'\\''`)
}

function buildShellRouteMeta(target: ResolvedShellServerTarget): Record<string, unknown> {
    return {
        executionTarget: target.executionTarget,
        serverLinkId: target.server?.serverLinkId,
        serverName: target.server?.serverName,
        resolvedBy: target.resolvedBy,
    }
}

function getRemotePathArg(value: unknown, fallback = '.'): string {
    if (typeof value !== 'string') return fallback
    const trimmed = value.trim()
    return trimmed || fallback
}

function normalizeRemotePathForSafety(value: string): string {
    const normalizedSeparators = value.trim().replace(/\\/g, '/')
    return normalizedSeparators.replace(/\/+$/g, '') || '/'
}

function getRequiredRemotePathArg(
    value: unknown,
    argName: string,
    toolName: string,
    options: { rejectDangerousTarget?: boolean } = {}
): string | ToolExecutionResult {
    if (typeof value !== 'string' || value.trim().length === 0) {
        const error = `${toolName} requires a non-empty ${argName}.`
        return {
            success: false,
            result: `Error: ${error}`,
            error,
        }
    }

    const remotePath = value.trim()
    const safetyPath = normalizeRemotePathForSafety(remotePath)
    if (
        options.rejectDangerousTarget &&
        (safetyPath === '.' || safetyPath === '/' || safetyPath === '~')
    ) {
        const error = `${toolName} refuses unsafe remote ${argName}: "${remotePath}". Use an explicit file or subdirectory path.`
        return {
            success: false,
            result: `Error: ${error}`,
            error,
            meta: { path: remotePath },
        }
    }

    return remotePath
}

function isToolExecutionResult(value: string | ToolExecutionResult): value is ToolExecutionResult {
    return typeof value !== 'string'
}

function formatServerResolutionError(
    toolName: string,
    serverName: string,
    resolution: Awaited<ReturnType<typeof shellServerRoutingService.resolveServerName>>
): string {
    if (resolution.kind === 'not_found') {
        return `Remote server not found for ${toolName}: "${serverName}". Use an existing Shell Studio server name.`
    }
    if (resolution.kind === 'ambiguous') {
        const labels = resolution.matches?.map(match => match.serverName).join(', ') || serverName
        return `Remote server name is ambiguous for ${toolName}: "${serverName}" (${labels}).`
    }
    return `Failed to resolve remote server for ${toolName}: "${serverName}".`
}

async function resolveShellRoute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: Pick<ToolExecutionContext, 'threadId' | 'assistantId' | 'currentAssistantId'>,
    options: { requireRemote: boolean }
): Promise<
    | { ok: true; target: ResolvedShellServerTarget; routeMeta: Record<string, unknown>; remoteLink?: RemoteShellLink }
    | { ok: false; errorResult: ToolExecutionResult }
> {
    const explicitServerName = typeof args.server_name === 'string' ? args.server_name.trim() : ''
    if (explicitServerName) {
        const resolution = await shellServerRoutingService.resolveServerName(explicitServerName)
        if (resolution.kind !== 'resolved' || !resolution.server) {
            return {
                ok: false,
                errorResult: {
                    success: false,
                    result: `Error: ${formatServerResolutionError(toolName, explicitServerName, resolution)}`,
                    error: formatServerResolutionError(toolName, explicitServerName, resolution),
                    meta: {
                        executionTarget: 'remote',
                        resolvedBy: 'arg',
                    },
                },
            }
        }
    }

    const target = await shellServerRoutingService.resolveExecutionTarget(toolName, args, ctx)
    const routeMeta = buildShellRouteMeta(target)

    if (target.executionTarget !== 'remote') {
        if (options.requireRemote) {
            return {
                ok: false,
                errorResult: {
                    success: false,
                    result: `Error: No remote server resolved for ${toolName}. Use server_name or mention #server-name# in the user message.`,
                    error: `No remote server resolved for ${toolName}`,
                    meta: routeMeta,
                },
            }
        }

        return { ok: true, target, routeMeta }
    }

    if (!target.server) {
        return {
            ok: false,
            errorResult: {
                success: false,
                result: `Error: Remote routing for ${toolName} did not resolve a server configuration.`,
                error: `Remote routing for ${toolName} did not resolve a server configuration`,
                meta: routeMeta,
            },
        }
    }

    const remoteLinks = await shellServerRoutingService.getRemoteServerLinks()
    const remoteLink = remoteLinks.find(link => link.id === target.server?.serverLinkId)
    if (!remoteLink) {
        return {
            ok: false,
            errorResult: {
                success: false,
                result: `Error: Remote server "${target.server.serverName}" is no longer available in Shell Studio.`,
                error: `Remote server "${target.server.serverName}" is no longer available in Shell Studio`,
                meta: routeMeta,
            },
        }
    }

    return {
        ok: true,
        target,
        routeMeta,
        remoteLink,
    }
}

function isRemoteHostMismatchError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes('Remote host fingerprint mismatch')
        || message.includes('REMOTE_HOST_FINGERPRINT_MISMATCH')
}

async function buildRemoteTrustMeta(
    server: RemoteShellServer,
    error?: unknown,
    options?: { preferKnownStatus?: boolean }
): Promise<Record<string, unknown>> {
    let statusSnapshot: { known: boolean; fingerprintSha256?: string } | null = null
    let decision: RemoteHostTrustDecision | null = null

    try {
        statusSnapshot = await api.remoteHostTrust.getStatus(server)
    } catch {
        statusSnapshot = null
    }

    try {
        decision = await api.remoteHostTrust.getLastDecision(server)
    } catch {
        decision = null
    }

    if (decision?.hostTrustStatus === 'mismatch_rejected') {
        if (error && !isRemoteHostMismatchError(error)) {
            return {}
        }
        return {
            hostTrustStatus: decision.hostTrustStatus,
            hostFingerprintSha256: decision.hostFingerprintSha256,
            knownHostFingerprintSha256: decision.knownHostFingerprintSha256,
        }
    }

    if (decision) {
        if (options?.preferKnownStatus && decision.hostTrustStatus === 'accepted_new' && statusSnapshot?.fingerprintSha256) {
            return {
                hostTrustStatus: 'known',
                hostFingerprintSha256: statusSnapshot.fingerprintSha256,
            }
        }
        return {
            hostTrustStatus: decision.hostTrustStatus,
            hostFingerprintSha256: decision.hostFingerprintSha256,
        }
    }

    if (statusSnapshot?.known && statusSnapshot.fingerprintSha256) {
        return {
            hostTrustStatus: 'known',
            hostFingerprintSha256: statusSnapshot.fingerprintSha256,
        }
    }

    return {}
}

async function guardedWriteFile(opts: {
    path: string
    nextContent: string
    originalContent: string | null
    staleMessage?: string
    skipStaleCheck?: boolean
}): Promise<
    | { success: true; meta: { preHash: string; postHash: string } }
    | { success: false; result: ToolExecutionResult }
> {
    const originalHash = hashContent(opts.originalContent)
    if (!opts.skipStaleCheck) {
        // 陈旧检查比对整文件哈希，必须读全文，否则超大文件的哈希只反映前导切片。
        const currentContent = await api.file.readFull(opts.path)
        const currentHash = hashContent(currentContent)

        if (currentHash !== originalHash) {
            return {
                success: false,
                result: {
                    success: false,
                    result: '',
                    error: opts.staleMessage || 'Write conflict detected: file changed since it was read',
                    outcome: { kind: 'conflict', code: 'STALE_WRITE', retryable: false },
                    envelope: { executionId: crypto.randomUUID(), startedAt: Date.now(), completedAt: Date.now(), errorCategory: 'conflict', retryable: false },
                    meta: {
                        filePath: opts.path,
                        preHash: originalHash,
                        currentHash,
                    }
                }
            }
        }
    }

    internalWriteTracker.mark(opts.path)
    const success = await api.file.write(opts.path, opts.nextContent)
    if (!success) {
        return {
            success: false,
            result: {
                success: false,
                result: '',
                error: 'Failed to write file',
            }
        }
    }

    return {
        success: true,
        meta: {
            preHash: originalHash,
            postHash: hashContent(opts.nextContent),
        }
    }
}

async function loadAgentSymbolsForFile(
    inputPath: string,
    ctx: ToolExecutionContext,
): Promise<{ fullPath: string; relativePath: string; symbols: AgentSymbol[] }> {
    const fullPath = await resolvePath(inputPath, ctx.workspacePath, 'read', ctx.securityApproval)
    const relativePath = toRelativePath(fullPath, ctx.workspacePath).replace(/\\/g, '/')
    const content = await api.file.readFull(fullPath)
    if (content === null || content === undefined) {
        throw new Error(`Source file not found or unreadable: ${relativePath}. If the exact file path is uncertain, use find_symbol without relative_path.`)
    }
    const opened = await didOpenDocument(fullPath, content)
    if (!opened) {
        throw new Error(`Language server is unavailable for ${relativePath}. Install or enable its LSP server, then retry.`)
    }
    const rawSymbols = await api.lsp.documentSymbol({
        uri: pathToLspUri(fullPath),
        workspacePath: ctx.workspacePath,
    }) as LspDocumentSymbol[] | null
    if (!Array.isArray(rawSymbols)) {
        throw new Error(`Language server failed to return document symbols for ${relativePath}`)
    }

    return {
        fullPath,
        relativePath,
        symbols: toAgentSymbols(rawSymbols ?? [], relativePath),
    }
}

function getSymbolSearchQuery(namePathPattern: string): string {
    const normalizedPattern = normalizeAgentNamePathPattern(namePathPattern)
    const lastSegment = normalizedPattern.replace(/^\//, '').split('/').at(-1) ?? normalizedPattern
    return lastSegment.replace(/\[\d+\]$/, '')
}

/**
 * 一次符号搜索最多打开的候选文件数。
 *
 * 每个候选都要 read 全文 + didOpen + documentSymbol，成本是线性的，所以必须有上限。
 * 但上限被触发这件事必须让模型知道 —— 否则「没找到」和「没找完」无法区分。
 */
const MAX_SYMBOL_CANDIDATE_FILES = 50

interface SymbolCandidateFiles {
    paths: string[]
    /** 索引/LSP 给出的候选总数。大于 paths.length 即表示搜索范围被截断。 */
    totalCandidates: number
}

async function findCandidateSymbolFiles(
    namePathPattern: string,
    workspacePath: string,
): Promise<SymbolCandidateFiles> {
    const query = getSymbolSearchQuery(namePathPattern)
    await api.index.initialize(workspacePath)
    const indexed = await api.index.searchSymbols(workspacePath, query, 100) as Array<{ relativePath: string }>
    const paths = new Set(indexed.map(symbol => symbol.relativePath).filter(Boolean))

    if (paths.size === 0) {
        const workspaceSymbols = await api.lsp.workspaceSymbol({ query, workspacePath }) as LspSymbolInformation[] | null
        for (const symbol of workspaceSymbols ?? []) {
            const filePath = lspUriToPath(symbol.location.uri)
            const relativePath = toRelativePath(filePath, workspacePath).replace(/\\/g, '/')
            if (relativePath && !relativePath.startsWith('..')) paths.add(relativePath)
        }
    }

    return {
        paths: [...paths].slice(0, MAX_SYMBOL_CANDIDATE_FILES),
        totalCandidates: paths.size,
    }
}

async function resolveSymbolCandidateFiles(
    namePathPattern: string,
    relativePath: string | undefined,
    ctx: ToolExecutionContext,
): Promise<SymbolCandidateFiles> {
    if (!ctx.workspacePath) throw new Error('No workspace open')
    const workspacePath = ctx.workspacePath
    if (!relativePath) return findCandidateSymbolFiles(namePathPattern, workspacePath)

    const fullPath = await resolvePath(relativePath, workspacePath, 'read', ctx.securityApproval)
    const stats = await api.file.stat(fullPath)
    if (!stats) throw new Error(`Symbol search scope does not exist: ${relativePath}`)
    if (stats.isFile) {
        const scoped = [toRelativePath(fullPath, workspacePath).replace(/\\/g, '/')]
        return { paths: scoped, totalCandidates: scoped.length }
    }
    if (!stats.isDirectory) throw new Error(`Symbol search scope is not a file or directory: ${relativePath}`)

    const directory = toRelativePath(fullPath, workspacePath).replace(/\\/g, '/').replace(/\/$/, '')
    const prefix = directory ? `${directory}/` : ''
    const candidates = await findCandidateSymbolFiles(namePathPattern, workspacePath)
    // 目录范围是在候选集之上再过滤，所以这里报告过滤后的数量：模型关心的是
    // 「这个目录里还有没有没看到的」，而不是全工作区的候选总数。
    const scoped = candidates.paths.filter(candidate => candidate.replace(/\\/g, '/').startsWith(prefix))
    return { paths: scoped, totalCandidates: scoped.length }
}

async function includeSymbolBodies(symbols: AgentSymbol[], ctx: ToolExecutionContext): Promise<AgentSymbol[]> {
    const contentByPath = new Map<string, string>()
    const results: AgentSymbol[] = []

    for (const symbol of symbols) {
        let content = contentByPath.get(symbol.relativePath)
        if (content === undefined) {
            const fullPath = await resolvePath(symbol.relativePath, ctx.workspacePath, 'read', ctx.securityApproval)
            content = await api.file.readFull(fullPath) ?? ''
            fileCacheService.markFileAsRead(fullPath, content)
            contentByPath.set(symbol.relativePath, content)
        }
        results.push({ ...symbol, body: extractLspRange(content, symbol.range) })
    }

    return results
}

async function resolveAgentSymbolPosition(
    relativePath: string,
    namePath: string,
    ctx: ToolExecutionContext,
): Promise<{ loaded: Awaited<ReturnType<typeof loadAgentSymbolsForFile>>; symbol: AgentSymbol }> {
    const loaded = await loadAgentSymbolsForFile(relativePath, ctx)
    const matches = findAgentSymbols(loaded.symbols, namePath)
    if (matches.length === 0) throw new Error(`Symbol not found: ${namePath}`)
    if (matches.length > 1) {
        throw new Error(`Symbol is ambiguous: ${namePath}. Matches: ${matches.map(symbol => symbol.namePath).join(', ')}`)
    }
    return { loaded, symbol: matches[0] }
}

/** 一个已解析到源码位置、并尽力标注了所属符号的引用点。 */
interface SymbolLocation {
    relativePath: string
    line: number
    column: number
    namePath?: string
    kind?: string
}

async function formatNavigationLocations(
    locations: unknown,
    ctx: ToolExecutionContext,
): Promise<string> {
    const values = Array.isArray(locations) ? locations : locations ? [locations] : []
    if (!values.length) return 'No locations found'

    const symbolTreesByPath = new Map<string, AgentSymbol[]>()
    const results: SymbolLocation[] = []
    for (const value of values as Array<{
        uri?: string
        targetUri?: string
        range?: { start: { line: number; character: number } }
        targetRange?: { start: { line: number; character: number } }
        targetSelectionRange?: { start: { line: number; character: number } }
    }>) {
        const uri = value.targetUri ?? value.uri
        const start = value.targetSelectionRange?.start ?? value.targetRange?.start ?? value.range?.start
        if (!uri || !start) continue

        const fullPath = lspUriToPath(uri)
        const relativePath = toRelativePath(fullPath, ctx.workspacePath).replace(/\\/g, '/')
        let symbols = symbolTreesByPath.get(relativePath)
        if (!symbols) {
            symbols = (await loadAgentSymbolsForFile(relativePath, ctx)).symbols
            symbolTreesByPath.set(relativePath, symbols)
        }
        const line = start.line + 1
        const column = start.character + 1
        const symbol = findContainingAgentSymbol(symbols, line, column)
        results.push({
            relativePath,
            line,
            column,
            ...(symbol ? { namePath: symbol.namePath, kind: symbol.kindName } : {}),
        })
    }

    if (!results.length) return 'No locations found'

    return boundJsonOutput([
        { build: () => ({ locationCount: results.length, locations: results }) },
        {
            build: () => ({
                locationCount: results.length,
                locations: results.map(({ relativePath, line, column }) => ({ relativePath, line, column })),
            }),
            hint: 'Containing symbols were omitted. Call get_document_symbols on a listed file to recover them.',
        },
        {
            build: () => ({ locationCount: results.length, files: countByFile(results) }),
            hint: 'Only per-file counts fit. Narrow the query to one file to see individual locations.',
        },
    ], toolOutputBudget())
}

function formatCallHierarchy(
    items: unknown,
    relation: 'incoming_calls' | 'outgoing_calls',
    ctx: ToolExecutionContext,
): string {
    const values = Array.isArray(items) ? items : []
    if (!values.length) return relation === 'incoming_calls' ? 'No callers found' : 'No callees found'

    const calls = values.flatMap((value: any) => {
        const target = relation === 'incoming_calls' ? value?.from : value?.to
        const start = target?.selectionRange?.start ?? target?.range?.start
        if (!target?.uri || !start) return []

        return [{
            name: String(target.name || '<anonymous>'),
            relativePath: toRelativePath(lspUriToPath(target.uri), ctx.workspacePath).replace(/\\/g, '/'),
            line: start.line + 1,
            column: start.character + 1,
            callSiteCount: Array.isArray(value.fromRanges) ? value.fromRanges.length : 1,
        }]
    })

    if (!calls.length) return relation === 'incoming_calls' ? 'No callers found' : 'No callees found'
    return boundJsonOutput([
        { build: () => ({ relation, count: calls.length, calls }) },
        {
            build: () => ({
                relation,
                count: calls.length,
                calls: calls.map(({ name, relativePath, line }) => ({ name, relativePath, line })),
            }),
            hint: 'Columns and call-site counts were omitted.',
        },
        {
            build: () => ({ relation, count: calls.length, files: countByFile(calls) }),
            hint: 'Only per-file counts fit. Navigate one listed symbol to inspect it.',
        },
    ], toolOutputBudget())
}

async function collectDiagnosticsForTarget(
    loaded: Awaited<ReturnType<typeof loadAgentSymbolsForFile>>,
    target: AgentSymbol | AgentSymbol[] | undefined,
    minSeverity: number,
): Promise<Record<string, any[]>> {
    const content = await api.file.readFull(loaded.fullPath) ?? ''
    await didOpenDocument(loaded.fullPath, content)
    await waitForDiagnostics(loaded.fullPath)

    const diagnostics = (await api.lsp.getDiagnostics(loaded.fullPath) ?? []) as any[]
    const grouped: Record<string, any[]> = {}
    const targets = Array.isArray(target) ? target : target ? [target] : []
    for (const diagnostic of diagnostics) {
        if (typeof diagnostic.severity === 'number' && diagnostic.severity > minSeverity) continue
        const line = Number(diagnostic.range?.start?.line ?? 0) + 1
        const column = Number(diagnostic.range?.start?.character ?? 0) + 1
        if (targets.length > 0 && !targets.some(item => findContainingAgentSymbol([item], line, column))) continue
        const owner = findContainingAgentSymbol(loaded.symbols, line, column)
        const ownerPath = owner?.namePath ?? '<file>'
        ;(grouped[ownerPath] ??= []).push({
            severity: diagnostic.severity,
            message: diagnostic.message,
            code: diagnostic.code,
            line,
            column,
        })
    }
    return grouped
}

/** 工具结果预算。与边界层同源，避免执行器和边界层各自算出不同的上限。 */
function toolOutputBudget(): number {
    return clampOutputBudget(getAgentConfig().maxToolResultChars)
}

/** 把位置列表折叠成 `{ 文件: 命中数 }`，用于阶梯最省的那一级。 */
function countByFile(entries: Array<{ relativePath: string }>): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const entry of entries) counts[entry.relativePath] = (counts[entry.relativePath] ?? 0) + 1
    return counts
}

/**
 * 搜索命中的条数上限。单文件放宽是因为同一文件内的命中通常就是模型要找的那一组，
 * 而跨目录的前 N 条只是入口，模型应当据此缩小范围而不是指望一次拿全。
 */
const MAX_SEARCH_MATCHES_PER_FILE = 100
const MAX_SEARCH_MATCHES_PER_DIRECTORY = 50

/** `\n--- File: ` + ` ---\n` + 结尾换行的固定开销，用于多文件读取的预算分配。 */
const MULTI_FILE_SEPARATOR_CHARS = 20

/**
 * 渲染搜索结果，并在触顶时明确说明总数。
 *
 * 「找到 3 条」和「找到 300 条只给你看 50 条」对模型是完全不同的信号：前者可以直接
 * 下结论，后者必须先缩小范围。静默 slice 会把后者伪装成前者。
 */
function formatSearchMatches(lines: string[], limit: number, scopeLabel: string): string {
    if (lines.length <= limit) return `Found ${lines.length} matches:\n${lines.join('\n')}`
    return [
        `Found ${lines.length} matches ${scopeLabel}, showing the first ${limit}.`,
        'Refine the pattern or narrow the path to see the rest.',
        '',
        lines.slice(0, limit).join('\n'),
    ].join('\n')
}

interface PreparedWorkspaceFile {
    path: string
    originalContent: string
    nextContent: string
    diagnosticsBefore: unknown[]
}

function diagnosticKey(diagnostic: any): string {
    return JSON.stringify({
        range: diagnostic?.range,
        severity: diagnostic?.severity,
        code: diagnostic?.code,
        message: diagnostic?.message,
    })
}

async function applyWorkspaceEditAtomically(
    workspaceEdit: LspWorkspaceEdit,
    ctx: ToolExecutionContext,
    toolName: string,
): Promise<ToolExecutionResult> {
    const editsByUri = collectWorkspaceTextEdits(workspaceEdit)
    if (editsByUri.size === 0) return { success: false, result: '', error: 'Language server returned no text edits' }

    const prepared: PreparedWorkspaceFile[] = []
    for (const [uri, edits] of editsByUri) {
        const path = await resolvePath(lspUriToPath(uri), ctx.workspacePath, 'write', ctx.securityApproval)
        const originalContent = await api.file.readFull(path)
        if (originalContent === null || originalContent === undefined) {
            return { success: false, result: '', error: `Cannot edit missing file: ${path}` }
        }
        prepared.push({
            path,
            originalContent,
            nextContent: applyLspTextEdits(originalContent, edits),
            diagnosticsBefore: await api.lsp.getDiagnostics(path) ?? [],
        })
    }

    if (ctx.checkpointId) {
        const agentStore = useAgentStore.getState()
        for (const file of prepared) {
            agentStore.addSnapshotToCheckpoint(ctx.checkpointId, file.path, file.originalContent)
        }
    }

    const written: PreparedWorkspaceFile[] = []
    const rollback = async (): Promise<string[]> => {
        const conflicts: string[] = []
        for (const committed of [...written].reverse()) {
            const current = await api.file.readFull(committed.path)
            if (hashContent(current) !== hashContent(committed.nextContent)) {
                conflicts.push(committed.path)
                continue
            }
            internalWriteTracker.mark(committed.path)
            const restored = await api.file.write(committed.path, committed.originalContent)
            if (!restored) {
                conflicts.push(committed.path)
                continue
            }
            fileCacheService.markFileAsRead(committed.path, committed.originalContent)
            await notifyLspAfterWrite(committed.path, committed.originalContent)
        }
        return conflicts
    }

    try {
        for (const file of prepared) {
            const write = await guardedWriteFile({
                path: file.path,
                originalContent: file.originalContent,
                nextContent: file.nextContent,
                staleMessage: `Atomic symbol edit conflict: ${file.path} changed before commit`,
            })
            if (write.success) {
                written.push(file)
                continue
            }
            const rollbackConflicts = await rollback()
            return {
                success: false,
                result: '',
                error: rollbackConflicts.length
                    ? `${write.result.error ?? 'Atomic edit failed'}; rollback conflict in: ${rollbackConflicts.join(', ')}`
                    : write.result.error ?? 'Atomic edit failed',
            }
        }
    } catch (error) {
        const rollbackConflicts = await rollback()
        const message = toAppError(error).message
        return {
            success: false,
            result: '',
            error: rollbackConflicts.length
                ? `${message}; rollback conflict in: ${rollbackConflicts.join(', ')}`
                : message,
        }
    }

    let newDiagnostics = 0
    const postCommitLimit = pLimit(4)
    const fileChanges = prepared.map(file => {
        const lineChanges = getLineChangesForWrite(file.originalContent, file.nextContent)
        return {
            filePath: file.path,
            oldContent: file.originalContent,
            newContent: file.nextContent,
            linesAdded: lineChanges.added,
            linesRemoved: lineChanges.removed,
            preHash: hashContent(file.originalContent),
            postHash: hashContent(file.nextContent),
        }
    })

    await Promise.all(prepared.map((file, idx) => postCommitLimit(async () => {
        fileCacheService.markFileAsRead(file.path, file.nextContent)
        const lineChanges = fileChanges[idx]
        notifyComposerChange({
            filePath: file.path,
            workspacePath: ctx.workspacePath || '',
            oldContent: file.originalContent,
            newContent: file.nextContent,
            changeType: 'modify',
            linesAdded: lineChanges.linesAdded,
            linesRemoved: lineChanges.linesRemoved,
            ...getWritePreviewFlags(file.originalContent, file.nextContent),
            toolCallId: ctx.toolCallId,
        })
        await notifyLspAfterWrite(file.path, file.nextContent)
        const beforeKeys = new Set(file.diagnosticsBefore.map(diagnosticKey))
        const after = await api.lsp.getDiagnostics(file.path) ?? []
        newDiagnostics += after.filter((diagnostic: unknown) => !beforeKeys.has(diagnosticKey(diagnostic))).length
        await aiAttributionService.recordWriteEvent({
            workspacePath: ctx.workspacePath || null,
            filePath: file.path,
            toolName,
            toolCallId: ctx.toolCallId,
            threadId: ctx.threadId,
            assistantId: ctx.currentAssistantId ?? ctx.assistantId,
            requestId: ctx.requestId,
            oldContent: file.originalContent,
            newContent: file.nextContent,
            preHash: hashContent(file.originalContent),
            postHash: hashContent(file.nextContent),
            linesAdded: lineChanges.linesAdded,
            linesRemoved: lineChanges.linesRemoved,
        })
    })))

    const primaryFile = fileChanges[0]
    const totalLinesAdded = fileChanges.reduce((sum, f) => sum + f.linesAdded, 0)
    const totalLinesRemoved = fileChanges.reduce((sum, f) => sum + f.linesRemoved, 0)

    return {
        success: true,
        result: `Updated ${prepared.length} file(s) atomically; new diagnostics: ${newDiagnostics}`,
        meta: {
            filePath: primaryFile?.filePath,
            oldContent: primaryFile?.oldContent,
            newContent: primaryFile?.newContent,
            linesAdded: totalLinesAdded,
            linesRemoved: totalLinesRemoved,
            filesChanged: prepared.map(file => file.path),
            fileChanges,
            newDiagnostics,
        },
    }
}

function symbolRangeEdit(symbol: AgentSymbol, newText: string): LspTextEdit {
    return {
        range: {
            start: { line: symbol.range.start.line - 1, character: symbol.range.start.column - 1 },
            end: { line: symbol.range.end.line - 1, character: symbol.range.end.column - 1 },
        },
        newText,
    }
}

function isPositionInsideSymbol(symbol: AgentSymbol, line: number, column: number): boolean {
    const afterStart = line > symbol.range.start.line
        || (line === symbol.range.start.line && column >= symbol.range.start.column)
    const beforeEnd = line < symbol.range.end.line
        || (line === symbol.range.end.line && column <= symbol.range.end.column)
    return afterStart && beforeEnd
}


const rawToolExecutors: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>> = {
    ...browserToolExecutors,
    async report_plan_activity(args) {
        const stage = args.stage as string
        const title = String(args.title || '').trim()
        const detail = String(args.detail || '').trim()
        const progressValue = typeof args.progress === 'number'
            ? Math.max(0, Math.min(100, Math.round(args.progress)))
            : undefined

        if (!title) {
            return { success: false, result: 'Activity title is required.' }
        }

        return {
            success: true,
            result: `Plan activity published: [${stage}] ${title}${detail ? ` — ${detail}` : ''}`,
            meta: { presentationOnly: true, progress: progressValue },
        }
    },

    async read_file(args, ctx) {
        const resolution = resolveReadFileRequest(args)
        if (!resolution.ok) {
            return {
                success: false,
                result: '',
                error: `Validation failed: ${resolution.error}${args.edits ? ' Example: when using edits[], do not also send top-level content/start_line/end_line/old_string/new_string.' : ''}`
            }
        }

        const paths = resolution.mode === 'multi' ? resolution.args.paths : [resolution.args.path]

        // 每个文件分到的预算。多文件读取必须先分预算再拼接：否则 N 个文件各自按
        // 全预算截断、拼成 N 倍长度，再被边界层从整体头尾切一刀 —— 结果是第一个
        // 文件基本完整、后面的只剩碎片，而提示词却在鼓励模型批量读。
        //
        // 分母里要扣掉 `--- File: x ---` 这类分隔符，否则各文件之和恰好等于预算、
        // 加上分隔符就溢出，又被边界层从尾部切掉最后一个文件。
        const separatorOverhead = paths.length > 1
            ? paths.reduce((sum, path) => sum + MULTI_FILE_SEPARATOR_CHARS + path.length, 0)
            : 0
        const perFileBudget = Math.floor((toolOutputBudget() - separatorOverhead) / paths.length)

        const readOnePath = async (
            inputPath: string,
            allowLineRange: boolean,
        ): Promise<{
            success: boolean
            result: string
            richContent?: ToolExecutionResult['richContent']
            meta?: Record<string, unknown>
            error?: string
        }> => {
            const validPath = await resolvePath(inputPath, ctx.workspacePath, 'read', ctx.securityApproval)
            const extension = getFileExtension(validPath)

            if (IMAGE_EXTENSIONS.has(extension)) {
                const imageResult = await analyzeImageSource({ path: validPath })
                if (imageResult.success) {
                    return {
                        success: true,
                        result: imageResult.content,
                        richContent: imageResult.richContent,
                        meta: {
                            ...imageResult.meta,
                            filePath: validPath,
                            routedFrom: 'read_file',
                        },
                    }
                }

                return {
                    success: false,
                    result: '',
                    error: imageResult.error || getReadImageUnavailableMessage(),
                    meta: {
                        filePath: validPath,
                        contentKind: 'image',
                        sourceFormat: extension || 'image',
                    },
                }
            }

            if (RICH_DOCUMENT_EXTENSIONS.has(extension)) {
                const richResult = await api.file.readRichContent(validPath, getReadRichContentOptions())
                if (!richResult.success || !richResult.content) {
                    return {
                        success: false,
                        result: '',
                        error: richResult.error || `Failed to read rich document: ${validPath}`,
                        meta: {
                            filePath: validPath,
                            contentKind: richResult.contentKind,
                            sourceFormat: richResult.sourceFormat,
                        },
                    }
                }

                fileCacheService.markFileAsRead(validPath, richResult.content)
                return {
                    success: true,
                    result: richResult.content,
                    meta: {
                        filePath: validPath,
                        contentKind: richResult.contentKind,
                        sourceFormat: richResult.sourceFormat,
                        usedFallback: richResult.usedFallback,
                        embeddedImageCount: richResult.embeddedImageCount || 0,
                        embeddedImagesAnalyzed: richResult.embeddedImagesAnalyzed || 0,
                        imageAnalysisSkippedReason: richResult.imageAnalysisSkippedReason,
                    },
                }
            }

            const content = await api.file.readFull(validPath)
            if (content === null) {
                return {
                    success: false,
                    result: '',
                    error: `File not found: ${validPath}`,
                }
            }

            fileCacheService.markFileAsRead(validPath, content)

            let graphContent = ''
            try {
                const nodes = await api.index.parseCallGraph(validPath, content)
                if (nodes && nodes.length > 0) {
                    graphContent = '\n\n--- AST Call Graph Summary ---\n'
                    const defs = nodes.filter(n => n.type === 'definition')
                    const calls = nodes.filter(n => n.type === 'call')
                    for (const def of defs) {
                        const relatedCalls = calls.filter(c => c.callerName === def.name).map(c => c.name)
                        const callStr = relatedCalls.length > 0 ? ` (calls: ${Array.from(new Set(relatedCalls)).join(', ')})` : ''
                        graphContent += `- func ${def.name}() [Line ${def.startLine}-${def.endLine}]${callStr}\n`
                    }
                }
            } catch {
                // ignore AST helper failures for non-code or unsupported files
            }

            const lines = content.split('\n')
            const startLine = allowLineRange && resolution.mode === 'single' && typeof resolution.args.start_line === 'number'
                ? Math.max(1, resolution.args.start_line)
                : 1
            const endLine = allowLineRange && resolution.mode === 'single' && typeof resolution.args.end_line === 'number'
                ? Math.min(lines.length, resolution.args.end_line)
                : lines.length
            const numberedContent = lines.slice(startLine - 1, endLine).map((line, i) => `${startLine + i}: ${line}`).join('\n')

            const bounded = boundFileExcerpt(numberedContent, perFileBudget, retained => {
                const shownLines = numberedContent.slice(0, retained).split('\n').length
                return [
                    `⚠️ TRUNCATED: showing lines ${startLine}-${startLine + shownLines - 1} of ${lines.length}.`,
                    `To continue, call read_file with start_line=${startLine + shownLines}, or use search_files to jump straight to the target.`,
                ].join('\n')
            })

            return {
                success: true,
                result: bounded + graphContent,
                meta: {
                    filePath: validPath,
                    contentKind: 'code',
                    sourceFormat: extension || 'text',
                },
            }
        }

        if (paths.length > 1) {
            const limit = pLimit(5)
            const results = await Promise.all(
                paths.map(p => limit(async () => {
                    try {
                        const fileResult = await readOnePath(p, false)
                        if (!fileResult.success) {
                            return {
                                text: `\n--- File: ${p} ---\n[Error: ${fileResult.error || 'File not found'}]\n`,
                                richContent: undefined,
                            }
                        }
                        return {
                            text: `\n--- File: ${p} ---\n${fileResult.result}\n`,
                            richContent: fileResult.richContent,
                        }
                    } catch (e: unknown) {
                        return {
                            text: `\n--- File: ${p} ---\n[Error: ${(e as Error).message}]\n`,
                            richContent: undefined,
                        }
                    }
                }))
            )

            const richContent = results.flatMap(item => item.richContent ?? [])

            return {
                success: true,
                result: results.map(item => item.text).join(''),
                richContent: richContent.length > 0 ? richContent : undefined,
            }
        }

        const singleResult = await readOnePath(paths[0], true)
        if (!singleResult.success) {
            return {
                success: false,
                result: '',
                error: singleResult.error || 'Failed to read file',
            }
        }

        return {
            success: true,
            result: singleResult.result,
            richContent: singleResult.richContent,
            meta: singleResult.meta,
        }
    },

    async read_image(args, ctx) {
        const pathArg = typeof args.path === 'string' ? args.path : ''
        if (!pathArg.trim()) {
            return {
                success: false,
                result: '',
                error: 'path is required',
            }
        }

        const validPath = await resolvePath(pathArg, ctx.workspacePath, 'read', ctx.securityApproval)
        const prompt = typeof args.prompt === 'string' ? args.prompt : undefined
        const result = await analyzeImageSource({
            path: validPath,
            prompt,
        })

        if (!result.success) {
            return {
                success: false,
                result: '',
                error: result.error || getReadImageUnavailableMessage(),
            }
        }

        return {
            success: true,
            result: result.content,
            richContent: result.richContent,
            meta: result.meta,
        }
    },

    async list_directory(args, ctx) {
        const path = await resolvePath(args.path, ctx.workspacePath, 'read', ctx.securityApproval)
        const recursive = args.recursive as boolean | undefined
        const maxDepth = (args.max_depth as number) || 3

        if (recursive) {
            // 递归模式（原 get_dir_tree）
            const tree = await buildDirTree(path, maxDepth)
            const result = formatDirTree(tree)
            logger.agent.info(`[list_directory] Recursive: Path: ${path}, Tree nodes: ${tree.length}, Result length: ${result.length}`)
            return { success: true, result: result || 'Empty directory tree' }
        } else {
            // 非递归模式（原 list_directory）
            const items = await api.file.readDir(path)
            if (!items) return { success: false, result: '', error: `Directory not found: ${path}` }
            const result = items.map(item => `${item.isDirectory ? '📁' : '📄'} ${item.name}`).join('\n')
            logger.agent.info(`[list_directory] Non-recursive: Path: ${path}, Items: ${items.length}, Result length: ${result.length}`)
            return { success: true, result: result || 'Empty directory' }
        }
    },

    async search_files(args, ctx) {
        const pathArg = args.path as string
        const resolvedPath = await resolvePath(pathArg, ctx.workspacePath, 'read', ctx.securityApproval)
        const pattern = args.pattern as string
        // 自动启用 regex 模式（如果包含 | 符号）
        const isRegex = !!args.is_regex || pattern.includes('|')

        // 判断是文件还是目录：尝试读取目录内容，如果失败则认为是文件
        const dirItems = await api.file.readDir(resolvedPath)
        const isDirectory = dirItems !== null

        if (!isDirectory) {
            // 单文件搜索模式（替代原 search_in_file）
            const content = await api.file.readFull(resolvedPath)
            if (content === null) return { success: false, result: '', error: `File not found: ${resolvedPath}` }

            // 验证正则表达式
            if (isRegex) {
                try {
                    new RegExp(pattern)
                } catch (e) {
                    return { success: false, result: '', error: `Invalid regular expression: ${(e as Error).message}` }
                }
            }

            const matches: string[] = []
            const searchRegex = isRegex ? new RegExp(pattern, 'gi') : null

            content.split('\n').forEach((line, index) => {
                let matched: boolean
                if (searchRegex) {
                    searchRegex.lastIndex = 0
                    matched = searchRegex.test(line)
                } else {
                    matched = line.toLowerCase().includes(pattern.toLowerCase())
                }
                if (matched) matches.push(`${pathArg}:${index + 1}: ${line.trim()}`)
            })

            if (!matches.length) return { success: true, result: `No matches found for "${pattern}"` }

            return {
                success: true,
                result: formatSearchMatches(matches, MAX_SEARCH_MATCHES_PER_FILE, 'in this file'),
                meta: { matchCount: matches.length },
            }
        }

        // 目录搜索模式
        const results = await api.file.search(pattern, resolvedPath, {
            isRegex,
            include: args.file_pattern as string | undefined,
            isCaseSensitive: false
        })
        if (!results) return { success: false, result: '', error: 'Search failed' }
        if (!results.length) return { success: true, result: 'No matches found' }

        const lines = results.map(r => `${r.path}:${r.line}: ${r.text.trim()}`)
        return {
            success: true,
            result: formatSearchMatches(lines, MAX_SEARCH_MATCHES_PER_DIRECTORY, 'across the searched files'),
            meta: { matchCount: results.length },
        }
    },

    async edit_file(args, ctx) {
        const path = await resolvePath(args.path, ctx.workspacePath, 'write', ctx.securityApproval)
        // 编辑会把结果整体写回，读取截断等于把文件尾部删掉。
        const originalContent = await api.file.readFull(path)
        if (originalContent === null) return { success: false, result: '', error: `File not found: ${path}. Use write_file to create new files.` }

        const resolution = resolveEditFileRequest(args)

        // 判断使用哪种模式：content 单独存在时不触发 line mode（保持与 validate 逻辑一致）
        if (!resolution.ok) {
            return {
                success: false,
                result: '',
                error: `Validation failed: ${resolution.error}${args.edits ? ' Example: when using edits[], do not also send top-level content/start_line/end_line/old_string/new_string.' : ''}`
            }
        }

        const hasBatchMode = resolution.mode === 'batch'
        const hasLineMode = resolution.mode === 'line'

        // 🎯 Fast-Edit 精华：批量编辑模式
        if (hasBatchMode) {
            const { edits } = resolution.args

            // 验证缓存
            if (!fileCacheService.hasValidCache(path)) {
                logger.agent.warn(`[edit_file] File ${path} not in cache, line numbers may be inaccurate`)
            }

            let lines = originalContent.split('\n')

            // 🎯 关键优化：从后往前排序，避免行号偏移
            const sortedEdits = [...edits].sort((a, b) => {
                const aLine = a.start_line || a.after_line || 0
                const bLine = b.start_line || b.after_line || 0
                return bLine - aLine
            })

            // 🎯 检测重叠编辑
            const getEditRange = (edit: typeof edits[0]): [number, number] => {
                if (edit.action === 'replace' || edit.action === 'delete') {
                    return [edit.start_line!, edit.end_line!]
                } else if (edit.action === 'insert') {
                    return [edit.after_line!, edit.after_line!]
                }
                return [0, 0]
            }

            const ranges: Array<[number, number, number, string]> = []
            sortedEdits.forEach((edit, idx) => {
                const [start, end] = getEditRange(edit)
                if (start > 0) {
                    ranges.push([start, end, idx, edit.action])
                }
            })

            ranges.sort((a, b) => a[0] - b[0])

            for (let i = 0; i < ranges.length - 1; i++) {
                const [s1, e1, , act1] = ranges[i]
                const [s2, e2, , act2] = ranges[i + 1]

                if (act1 === 'insert' && act2 === 'insert') continue

                if (s2 <= e1) {
                    return {
                        success: false,
                        result: '',
                        error: `Overlapping edits detected: ${act1} [${s1}-${e1}] overlaps with ${act2} [${s2}-${e2}]. Split into separate calls or adjust line ranges.`
                    }
                }
            }

            const allWarnings: import('../../utils/smartReplace').EditWarning[] = []
            let linesAdded = 0
            let linesRemoved = 0

            // 应用所有编辑
            for (const edit of sortedEdits) {
                if (edit.action === 'replace') {
                    const { start_line, end_line, content } = edit

                    if (start_line! < 1 || end_line! > lines.length || start_line! > end_line!) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid line range: ${start_line}-${end_line}. File has ${lines.length} lines.`
                        }
                    }

                    const oldLines = lines.slice(start_line! - 1, end_line)
                    const newLines = content!.split('\n')

                    lines = [
                        ...lines.slice(0, start_line! - 1),
                        ...newLines,
                        ...lines.slice(end_line)
                    ]

                    linesRemoved += oldLines.length
                    linesAdded += newLines.length

                    // 检测警告
                    const warnings = checkLineReplaceWarnings(oldLines, newLines, lines, start_line!, end_line!)
                    allWarnings.push(...warnings)

                } else if (edit.action === 'insert') {
                    const { after_line, content } = edit

                    if (after_line! < 0 || after_line! > lines.length) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid after_line: ${after_line}. File has ${lines.length} lines.`
                        }
                    }

                    const newLines = content!.split('\n')
                    lines = [
                        ...lines.slice(0, after_line),
                        ...newLines,
                        ...lines.slice(after_line)
                    ]

                    linesAdded += newLines.length

                } else if (edit.action === 'delete') {
                    const { start_line, end_line } = edit

                    if (start_line! < 1 || end_line! > lines.length || start_line! > end_line!) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid line range: ${start_line}-${end_line}. File has ${lines.length} lines.`
                        }
                    }

                    const removed = end_line! - start_line! + 1
                    lines = [
                        ...lines.slice(0, start_line! - 1),
                        ...lines.slice(end_line)
                    ]

                    linesRemoved += removed
                }
            }

            const newContent = lines.join('\n')
            const guardedWrite = await guardedWriteFile({
                path,
                nextContent: newContent,
                originalContent,
                staleMessage: 'Batch edit conflict detected: file changed since it was read',
            })
            if (!guardedWrite.success) return guardedWrite.result

            fileCacheService.markFileAsRead(path, newContent)

            notifyComposerChange({
                filePath: path,
                workspacePath: ctx.workspacePath || '',
                oldContent: originalContent,
                newContent,
                changeType: 'modify',
                linesAdded,
                linesRemoved,
                ...getWritePreviewFlags(originalContent, newContent),
                toolCallId: ctx.toolCallId
            })

            await aiAttributionService.recordWriteEvent({
                workspacePath: ctx.workspacePath || null,
                filePath: path,
                toolName: 'edit_file',
                toolCallId: ctx.toolCallId,
                threadId: ctx.threadId,
                assistantId: ctx.currentAssistantId ?? ctx.assistantId,
                requestId: ctx.requestId,
                oldContent: originalContent,
                newContent,
                preHash: guardedWrite.meta.preHash,
                postHash: guardedWrite.meta.postHash,
                linesAdded,
                linesRemoved,
            })

            await notifyLspAfterWrite(path, newContent)

            if (allWarnings.length > 0) {
                logger.agent.warn(`[edit_file] ${path}: Detected ${allWarnings.length} potential issues in batch`, allWarnings)
            }

            const warningsSuffix = allWarnings.length > 0 ? ` (${allWarnings.length} warning${allWarnings.length > 1 ? 's' : ''} detected)` : ''
            const meta = buildWriteMeta(
                path,
                originalContent,
                newContent,
                { added: linesAdded, removed: linesRemoved },
                guardedWrite.meta,
                {
                    totalLines: lines.length,
                    editsApplied: edits.length,
                    ...(allWarnings.length > 0 && { warnings: allWarnings }),
                }
            )
            return {
                success: true,
                result: `File updated successfully (batch mode: ${edits.length} edits applied)${warningsSuffix}`,
                meta
            }
        }

        if (hasLineMode) {
            // 行模式
            const { start_line: startLine, end_line: endLine, content } = resolution.args

            // 验证缓存
            if (!fileCacheService.hasValidCache(path)) {
                logger.agent.warn(`[edit_file] File ${path} not in cache, line numbers may be inaccurate`)
            }

            if (originalContent === '') {
                const guardedWrite = await guardedWriteFile({
                    path,
                    nextContent: content,
                    originalContent,
                    staleMessage: 'Line edit conflict detected: file changed before empty-file write completed',
                })
                if (guardedWrite.success) fileCacheService.markFileAsRead(path, content)
                return guardedWrite.success
                    ? {
                        success: true,
                        result: 'File written (was empty)',
                        meta: buildWriteMeta(
                            path,
                            '',
                            content,
                            { added: countLinesFast(content), removed: 0 },
                            guardedWrite.meta
                        )
                    }
                    : guardedWrite.result
            }

            const lines = originalContent.split('\n')

            // 验证行号范围
            if (startLine < 1 || endLine > lines.length || startLine > endLine) {
                return {
                    success: false,
                    result: '',
                    error: `Invalid line range: ${startLine}-${endLine}. File has ${lines.length} lines. Use read_file to verify line numbers.`
                }
            }

            // 提取被替换的行（用于警告检测）
            const oldLines = lines.slice(startLine - 1, endLine)
            const newLines = content.split('\n')

            // 执行替换
            lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)
            const newContent = lines.join('\n')

            // Fast-Edit 精华：智能警告检测
            const warnings = checkLineReplaceWarnings(oldLines, newLines, lines, startLine, endLine)

            if (warnings.length > 0) {
                logger.agent.warn(`[edit_file] ${path}: Detected ${warnings.length} potential issues`, warnings)
            }

            const guardedWrite = await guardedWriteFile({
                path,
                nextContent: newContent,
                originalContent,
                staleMessage: 'Line edit conflict detected: file changed since it was read',
            })
            if (!guardedWrite.success) return guardedWrite.result

            fileCacheService.markFileAsRead(path, newContent)

            const lineChanges = getLineChangesForWrite(originalContent, newContent)
            notifyComposerChange({
                filePath: path,
                workspacePath: ctx.workspacePath || '',
                oldContent: originalContent,
                newContent,
                changeType: 'modify',
                linesAdded: lineChanges.added,
                linesRemoved: lineChanges.removed,
                ...getWritePreviewFlags(originalContent, newContent),
                toolCallId: ctx.toolCallId
            })

            await aiAttributionService.recordWriteEvent({
                workspacePath: ctx.workspacePath || null,
                filePath: path,
                toolName: 'edit_file',
                toolCallId: ctx.toolCallId,
                threadId: ctx.threadId,
                assistantId: ctx.currentAssistantId ?? ctx.assistantId,
                requestId: ctx.requestId,
                oldContent: originalContent,
                newContent,
                preHash: guardedWrite.meta.preHash,
                postHash: guardedWrite.meta.postHash,
                linesAdded: lineChanges.added,
                linesRemoved: lineChanges.removed,
            })

            await notifyLspAfterWrite(path, newContent)

            const warningsSuffix = warnings.length > 0 ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''} detected)` : ''
            const meta = buildWriteMeta(
                path,
                originalContent,
                newContent,
                lineChanges,
                guardedWrite.meta,
                {
                    ...(warnings.length > 0 && { warnings }),
                }
            )
            return {
                success: true,
                result: `File updated successfully (line mode)${warningsSuffix}`,
                meta
            }
        } else {
            // 字符串模式（原 edit_file）
            const { old_string: oldString, new_string: newString, replace_all: replaceAll } = resolution.args

            const normalizedContent = normalizeLineEndings(originalContent)
            const normalizedOld = normalizeLineEndings(oldString)
            const normalizedNew = normalizeLineEndings(newString)

            const result = smartReplace(normalizedContent, normalizedOld, normalizedNew, replaceAll)

            if (!result.success) {
                const { findSimilarContent, analyzeEditError, generateFixSuggestion } = await import('../utils/EditRetryStrategy')

                const errorType = analyzeEditError(result.error, result.errorCode)
                const hasCache = fileCacheService.hasValidCache(path)

                const similar = findSimilarContent(normalizedContent, normalizedOld)

                const suggestion = generateFixSuggestion(errorType, {
                    path,
                    oldString: normalizedOld,
                    similarContent: similar.similarText,
                    lineNumber: similar.lineNumber,
                })

                let errorMsg = getReplaceErrorMessage(result.errorCode)

                if (similar.found) {
                    errorMsg += `\n\n${translate('agent.tool.edit.similarContentFound', {
                        line: similar.lineNumber || 0,
                        similarity: Math.round((similar.similarity || 0) * 100),
                    })}`
                }

                if (!hasCache) {
                    errorMsg += `\n\n${translate('agent.tool.edit.readBeforeEdit')}`
                }

                errorMsg += `\n\n${translate('agent.tool.edit.suggestionPrefix')} ${suggestion}`

                return { success: false, result: '', error: errorMsg }
            }

            const newContent = result.newContent!
            const guardedWrite = await guardedWriteFile({
                path,
                nextContent: newContent,
                originalContent,
                staleMessage: 'String edit conflict detected: file changed since it was read',
            })
            if (!guardedWrite.success) return guardedWrite.result

            fileCacheService.markFileAsRead(path, newContent)

            const lineChanges = getLineChangesForWrite(originalContent, newContent)
            notifyComposerChange({
                filePath: path,
                workspacePath: ctx.workspacePath || '',
                oldContent: originalContent,
                newContent,
                changeType: 'modify',
                linesAdded: lineChanges.added,
                linesRemoved: lineChanges.removed,
                ...getWritePreviewFlags(originalContent, newContent),
                toolCallId: ctx.toolCallId
            })

            await notifyLspAfterWrite(path, newContent)

            const strategyInfo = result.strategy !== 'exact' ? ` (matched via ${result.strategy} strategy)` : ''

            const meta = buildWriteMeta(
                path,
                originalContent,
                newContent,
                lineChanges,
                guardedWrite.meta,
                {
                    matchStrategy: result.strategy,
                }
            )
            return {
                success: true,
                result: `File updated successfully${strategyInfo}`,
                meta
            }
        }
    },

    async write_file(args, ctx) {
        // write_file 的职责被严格限定为“新建文件 / 整文件重写”。
        // 因此在真正落盘前，先经过统一策略守卫，避免把局部修改误用成整文件覆盖。
        const path = await resolvePath(args.path, ctx.workspacePath, 'write', ctx.securityApproval)
        const content = args.content as string
        const originalContent = await api.file.readFull(path) || ''
        const writeDecision = guardWriteFile({
            path,
            originalContent,
            nextContent: content,
            hasRecentRead: fileCacheService.hasValidCache(path),
        })
        if (!writeDecision.allow) {
            return {
                success: false,
                result: '',
                // 把拒绝原因直接返回给模型，促使它切换到 edit_file 的合适模式。
                error: writeDecision.reason || 'write_file rejected by write strategy',
            }
        }
        const guardedWrite = await guardedWriteFile({
            path,
            nextContent: content,
            originalContent,
            staleMessage: 'Write conflict detected: file changed before overwrite completed',
            skipStaleCheck: true,
        })
        if (!guardedWrite.success) return guardedWrite.result
        // 写入成功后立即刷新缓存，保证后续 edit/read 判定看到的是最新内容。
        fileCacheService.markFileAsRead(path, content)

        // 通知 LSP 并等待诊断
        await notifyLspAfterWrite(path, content)

        const lineChanges = getLineChangesForWrite(originalContent, content)

        notifyComposerChange({
            filePath: path,
            workspacePath: ctx.workspacePath || '',
            oldContent: originalContent,
            newContent: content,
            changeType: originalContent ? 'modify' : 'create',
            linesAdded: lineChanges.added,
            linesRemoved: lineChanges.removed,
            ...getWritePreviewFlags(originalContent, content),
            toolCallId: ctx.toolCallId
        })
        await aiAttributionService.recordWriteEvent({
            workspacePath: ctx.workspacePath || null,
            filePath: path,
            toolName: 'write_file',
            toolCallId: ctx.toolCallId,
            threadId: ctx.threadId,
            assistantId: ctx.currentAssistantId ?? ctx.assistantId,
            requestId: ctx.requestId,
            oldContent: originalContent,
            newContent: content,
            preHash: guardedWrite.meta.preHash,
            postHash: guardedWrite.meta.postHash,
            linesAdded: lineChanges.added,
            linesRemoved: lineChanges.removed,
        })
        return {
            success: true,
            result: 'File written successfully',
            meta: buildWriteMeta(path, originalContent, content, lineChanges, guardedWrite.meta, {
                writeIntent: writeDecision.intent,
                writeAnalysis: writeDecision.analysis,
            })
        }
    },

    async create_directory(args, ctx) {
        const path = await resolvePath(args.path, ctx.workspacePath, 'manage', ctx.securityApproval)
        const normalizedPath = path.endsWith('/') || path.endsWith('\\')
            ? path.slice(0, -1)
            : path
        const success = await api.file.mkdir(normalizedPath)
        if (success) {
            notifyWorkspaceTreeChange({
                workspacePath: ctx.workspacePath || '',
                targetPath: normalizedPath,
                changeType: 'create',
                isDirectory: true,
            })
        }
        return { success, result: success ? 'Directory created' : 'Failed to create directory' }
    },

    async delete_file_or_folder(args, ctx) {
        const path = await resolvePath(args.path, ctx.workspacePath, 'manage', ctx.securityApproval)
        const success = await api.file.delete(path, ctx.securityApproval)
        if (success) {
            notifyComposerChange({ filePath: path, workspacePath: ctx.workspacePath || '', oldContent: null, newContent: null, changeType: 'delete', linesAdded: 0, linesRemoved: 0 })
        }
        return { success, result: success ? 'Deleted successfully' : 'Failed to delete' }
    },

    async run_command(args, ctx) {
        const command = args.command as string
        const isBackground = args.is_background as boolean
        const config = getAgentConfig()
        const timeout = args.timeout
            ? (args.timeout as number) * 1000
            : config.toolTimeoutMs
        let routeMeta: Record<string, unknown> = {
            executionTarget: 'local',
            resolvedBy: 'local_default',
        }
        let remoteServerForTrust: RemoteShellServer | null = null

        const isLongRunningProcess = isLongRunningCommand(command, isBackground)

        try {
            const routeResolution = await resolveShellRoute('run_command', args, ctx, { requireRemote: false })
            if (!routeResolution.ok) {
                return routeResolution.errorResult
            }

            const { target, routeMeta: resolvedRouteMeta, remoteLink } = routeResolution
            routeMeta = resolvedRouteMeta
            remoteServerForTrust = remoteLink?.remote || null
            const resolvedCwd = remoteLink
                ? null
                : (args.cwd ? await resolvePath(args.cwd, ctx.workspacePath, 'command', ctx.securityApproval) : null)
            let commandAuthorizationId: string | undefined

            if (!remoteLink) {
                const authorization = await api.security.authorizeCommand({
                    command,
                    cwd: resolvedCwd || ctx.workspacePath || undefined,
                    approval: ctx.securityApproval,
                })
                if (!authorization.allowed) {
                    // 工具结果是给模型读的，固定英文：模型不需要跟着界面语言切换，
                    // 而且这段文字会连同英文的 shell 报错一起回到对话里。
                    const reason = securityReasonsText(authorization.reasons ?? [], 'en') || 'Command was not approved'
                    return {
                        success: false,
                        result: `Security approval required: ${reason}`,
                        error: reason,
                        meta: { ...routeMeta, command, cwd: resolvedCwd || ctx.workspacePath || undefined, securityRisk: authorization.risk },
                    }
                }
                commandAuthorizationId = authorization.authorizationId
            }

            if (!remoteLink && !args.interactive && !isLongRunningProcess) {
                useStore.getState().setTerminalVisible(true)
                const result = await runManagedCommand({ command, cwd: resolvedCwd || ctx.workspacePath || undefined,
                    mode: 'command', timeoutMs: timeout, authorizationId: commandAuthorizationId }, ctx)
                result.meta = { ...result.meta, ...routeMeta }
                return result
            }
            if (!remoteLink && !args.interactive) {
                useStore.getState().setTerminalVisible(true)
                const result = await runManagedCommand({ command, cwd: resolvedCwd || ctx.workspacePath || undefined,
                    mode: 'background', authorizationId: commandAuthorizationId,
                    serviceKey: typeof args.service_key === 'string' ? args.service_key : undefined }, ctx)
                result.meta = { ...result.meta, ...routeMeta }
                return result
            }

            // 先唤出面板，再创建/获取终端，避免竞态：
            // 若先创建终端，notify() 触发时面板还不可见 → useEffect 销毁刚创建的终端
            useStore.getState().setTerminalVisible(true)

            // 获取或复用 Agent 专属终端（初始 cwd 用工作区根目录，避免反复改变终端目录）
            const terminalManager = await getTerminalManager()
            const terminalAnchorCwd = ctx.workspacePath || await api.settings.getUserDataPath()
            const { terminalId: termId, reused } = await terminalManager.getOrCreateAgentTerminalLease(
                terminalAnchorCwd,
                remoteLink ? {
                    background: isLongRunningProcess,
                    timeoutMs: timeout,
                    remote: remoteLink.remote,
                    agentTerminalKey: `${ctx.threadId || 'default'}:${target.server?.serverLinkId}`,
                    name: `Agent · ${target.server?.serverName || remoteLink.name}`,
                } : { agentTerminalKey: ctx.threadId || 'default', background: isLongRunningProcess, timeoutMs: timeout },
            )
            const trustMeta = remoteLink
                ? await buildRemoteTrustMeta(remoteLink.remote, undefined, { preferKnownStatus: reused })
                : {}
            const terminalShell = terminalManager.getState().terminals.find((terminal) => terminal.id === termId)?.shell
            const terminalShellFamily = detectTerminalShellFamily(terminalShell)

            // 激活 Agent 终端 tab，让用户看到执行过程
            terminalManager.setActiveTerminal(termId)

            const remoteCwd = remoteLink
                ? getRemotePathArg(args.cwd, remoteLink.remote.remotePath || '.')
                : undefined
            const remoteCommand = remoteLink && remoteCwd
                ? `cd '${escapeShellSingleQuotes(remoteCwd)}' && ${command}`
                : command

            // === 长进程：直接写入并立即返回，让用户在终端里跟踪 ===
            if (isLongRunningProcess) {
                // 长进程也需要处理 cwd
                const bgCmd = remoteLink
                    ? remoteCommand
                    : resolvedCwd
                    ? (terminalShellFamily === 'posix'
                        ? `(cd "${resolvedCwd}" && ${command})`
                        : `Push-Location "${resolvedCwd}"; ${command}; Pop-Location`)
                    : command
                terminalManager.executeDetachedCommand(
                    termId,
                    remoteLink ? bgCmd : command,
                    remoteLink ? undefined : (resolvedCwd || undefined),
                )

                const detachedSession = terminalManager.recordDetachedCommand(
                    termId,
                    command,
                    remoteLink ? remoteCwd : resolvedCwd || undefined,
                    'agent',
                )

                // 长进程占用了当前终端的 shell，释放 agentTerminalId
                // 使下一次 run_command 自动创建新终端，避免命令被 stdin 吞掉
                terminalManager.releaseAgentTerminal(termId)

                return {
                    success: true,
                    result: `[Background Process Started]\nCommand: ${command}\nTerminal ID: ${termId}\nSession ID: ${detachedSession.commandSessionId}\n\nThe process is running in the Agent terminal panel. Use 'read_terminal_output' with terminal_id="${termId}" to check logs. Use 'send_terminal_input' to send input or Ctrl+C (is_ctrl=true). Use 'stop_terminal' to kill it.`,
                    meta: {
                        ...routeMeta,
                        ...trustMeta,
                        command,
                        cwd: remoteLink ? remoteCwd : resolvedCwd,
                        terminalId: termId,
                        commandSessionId: detachedSession.commandSessionId,
                        finalStatus: detachedSession.status,
                        terminationReason: detachedSession.terminationReason,
                        isBackground: true,
                    }
                }
            }

            const commandResult = await terminalManager.executeCommandWithOutput(
                termId,
                remoteLink ? remoteCommand : command,
                timeout,
                remoteLink ? undefined : (resolvedCwd || undefined),
                ctx.abortSignal,
            )
            await terminalManager.releaseUnsubmittedLease(termId)

            // A command that was submitted must never be replayed after losing its result.
            const displayOutput = (commandResult.output || commandResult.partialOutput || '').trim()
            let resultText = displayOutput

            if (!resultText) {
                if (commandResult.finalStatus === 'timed_out') {
                    resultText = `Command timed out after ${timeout / 1000}s`
                } else if (commandResult.exitCode === 0 && commandResult.finalStatus === 'completed') {
                    resultText = 'Command executed successfully (no output)'
                } else {
                    resultText = `Command finished with status ${commandResult.finalStatus}${commandResult.exitCode !== null ? ` (exit code ${commandResult.exitCode})` : ''} (no output)`
                }
            }

            if (commandResult.finalStatus === 'timed_out' && displayOutput) {
                resultText = `[Timed out after ${timeout / 1000}s]\n${displayOutput}`
            }

            if (commandResult.finalStatus === 'interrupted' && !commandResult.sentinelMatched) {
                resultText = displayOutput
                    ? `[Partial output captured before prompt recovery]\n${displayOutput}`
                    : 'Command ended without a sentinel. Partial output may have been recovered from the terminal prompt.'
            }

            if (commandResult.finalStatus === 'shell_exited' && displayOutput) {
                resultText = `[Shell exited while command was running]\n${displayOutput}`
            }

            return {
                success: commandResult.success,
                result: resultText,
                meta: {
                    ...routeMeta,
                    ...trustMeta,
                    command,
                    cwd: remoteLink ? remoteCwd : resolvedCwd,
                    terminalId: termId,
                    commandSessionId: commandResult.commandSessionId,
                    exitCode: commandResult.exitCode,
                    timedOut: commandResult.timedOut,
                    finalStatus: commandResult.finalStatus,
                    durationMs: commandResult.durationMs,
                    terminationReason: commandResult.terminationReason,
                    sentinelMatched: commandResult.sentinelMatched,
                },
                error: commandResult.success ? undefined : resultText
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            logger.agent.error('[run_command] Execution failed:', errorMsg)
            const trustMeta = remoteServerForTrust
                ? await buildRemoteTrustMeta(remoteServerForTrust, error)
                : {}
            return {
                success: false,
                result: `Error: Failed to execute command: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeMeta,
                    ...trustMeta,
                },
            }
        }
    },

    async read_terminal_output(args) {
        const terminalId = args.terminal_id as string
        const linesCount = (args.lines as number) || 100

        try {
            const terminalManager = await getTerminalManager()
            const job = terminalManager.getManagedJob(terminalId)
            if (job) {
                const response = await api.execution.wait(terminalId, 0, 0)
                if (!response.success) throw new Error(response.error)
                terminalManager.applyExecutionSnapshot(response.job)
                return { success: true, result: `Job/Terminal ID: ${terminalId}\nStatus: ${response.job.status}${response.job.reason ? ` (${response.job.reason})` : ''}\nExit code: ${response.job.exitCode ?? 'unknown'}\n${response.job.truncated ? '[Earlier output truncated]\n' : ''}${response.job.output.split('\n').slice(-linesCount).join('\n')}`,
                    meta: { terminalId, jobId: terminalId, finalStatus: response.job.status, exitCode: response.job.exitCode } }
            }
            const lines = terminalManager.getOutputBuffer(terminalId)

            if (!lines || lines.length === 0) {
                return {
                    success: true,
                    result: '[Empty buffer. Either the terminal was closed, invalid, or it has not produced output yet]'
                }
            }

            // 返回清理掉 ANSI 色彩字符的内容以便 AI 解析
            const rawOutput = lines.slice(-linesCount).join('')
            const cleanOutput = rawOutput
                // eslint-disable-next-line no-control-regex -- Intentionally match protocol/control bytes for terminal handling or input sanitization.
                .replace(/\x1b\[[0-9;]*[mGK]/g, '')
                .replace(/\r\n/g, '\n')
                .trim()

            return {
                success: true,
                result: cleanOutput || '[Terminal produced no printable output]',
                meta: { terminalId }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to read terminal output: ${errorMsg}`, error: errorMsg }
        }
    },

    async send_terminal_input(args) {
        const terminalId = args.terminal_id as string
        const input = args.input as string
        const isCtrl = args.is_ctrl as boolean

        try {
            const terminalManager = await getTerminalManager()

            let dataToSend = input
            if (isCtrl) {
                // 将诸如 'c' 转换为 \x03 (Ctrl+C)
                const charCode = input.toLowerCase().charCodeAt(0)
                if (charCode >= 97 && charCode <= 122) { // 'a' - 'z'
                    dataToSend = String.fromCharCode(charCode - 96)
                }
            }

            if (terminalManager.getManagedJob(terminalId)) {
                const response = await api.execution.input(terminalId, dataToSend)
                if (!response.success) throw new Error(response.error)
            } else await api.terminal.write(terminalId, dataToSend)

            return {
                success: true,
                result: `Successfully sent ${isCtrl ? 'Ctrl+' + input.toUpperCase() : 'input'} to terminal ${terminalId}`,
                meta: { terminalId, sentCtrl: isCtrl }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to send terminal input: ${errorMsg}`, error: errorMsg }
        }
    },

    async stop_terminal(args) {
        const terminalId = args.terminal_id as string

        try {
            const terminalManager = await getTerminalManager()
            if (terminalManager.getManagedJob(terminalId)) {
                const response = await api.execution.cancel(terminalId)
                if (!response.success) throw new Error(response.error)
                terminalManager.applyExecutionSnapshot(response.job)
                return { success: true, result: `Job ${terminalId}: ${response.job.status}. ${response.job.status === 'stopping' ? 'Stop requested; exit is not yet confirmed. Check its status with read_terminal_output.' : ''}`,
                    meta: { terminalId, finalStatus: response.job.status } }
            }
            const remote = terminalManager.getState().terminals.find(terminal => terminal.id === terminalId)?.remoteHost
            await terminalManager.closeTerminal(terminalId)
            return {
                success: true,
                result: remote ? `SSH terminal ${terminalId} closed. Remote process termination is not confirmed; do not assume its command was stopped.` : `Terminal ${terminalId} stopped and closed successfully.`,
                meta: { terminalId }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to stop terminal: ${errorMsg}`, error: errorMsg }
        }
    },

    async list_remote_directory(args, ctx) {
        const routeResolution = await resolveShellRoute('list_remote_directory', args, ctx, { requireRemote: true })
        if (!routeResolution.ok) return routeResolution.errorResult

        const remotePath = getRemotePathArg(args.path, routeResolution.remoteLink?.remote.remotePath || '.')
        const trustMetaBase = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)

        try {
            const entries = await api.remoteShell.list(routeResolution.remoteLink!.remote, remotePath)
            const trustMeta = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)
            const lines = entries.map((entry) => {
                const kind = entry.isDirectory ? 'dir' : 'file'
                const size = entry.isDirectory ? '' : ` (${entry.size} B)`
                return `[${kind}] ${entry.path}${size}`
            })

            return {
                success: true,
                result: lines.length > 0 ? lines.join('\n') : '[Empty directory]',
                meta: {
                    ...routeResolution.routeMeta,
                    ...trustMeta,
                    path: remotePath,
                    entryCount: entries.length,
                },
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
                success: false,
                result: `Error: Failed to list remote directory: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeResolution.routeMeta,
                    ...(isRemoteHostMismatchError(error)
                        ? await buildRemoteTrustMeta(routeResolution.remoteLink!.remote, error)
                        : trustMetaBase),
                    path: remotePath,
                },
            }
        }
    },

    async read_remote_file(args, ctx) {
        const routeResolution = await resolveShellRoute('read_remote_file', args, ctx, { requireRemote: true })
        if (!routeResolution.ok) return routeResolution.errorResult

        const remotePath = getRequiredRemotePathArg(args.path, 'path', 'read_remote_file')
        if (isToolExecutionResult(remotePath)) return remotePath
        const trustMetaBase = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)

        try {
            const content = await api.remoteShell.readText(routeResolution.remoteLink!.remote, remotePath)
            const trustMeta = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)
            return {
                success: true,
                result: content ?? '',
                meta: {
                    ...routeResolution.routeMeta,
                    ...trustMeta,
                    path: remotePath,
                },
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
                success: false,
                result: `Error: Failed to read remote file: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeResolution.routeMeta,
                    ...(isRemoteHostMismatchError(error)
                        ? await buildRemoteTrustMeta(routeResolution.remoteLink!.remote, error)
                        : trustMetaBase),
                    path: remotePath,
                },
            }
        }
    },

    async write_remote_file(args, ctx) {
        const routeResolution = await resolveShellRoute('write_remote_file', args, ctx, { requireRemote: true })
        if (!routeResolution.ok) return routeResolution.errorResult

        const remotePath = getRequiredRemotePathArg(args.path, 'path', 'write_remote_file', { rejectDangerousTarget: true })
        if (isToolExecutionResult(remotePath)) return remotePath
        const content = typeof args.content === 'string' ? args.content : ''
        const trustMetaBase = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)

        try {
            await api.remoteShell.writeText(routeResolution.remoteLink!.remote, remotePath, content)
            const trustMeta = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)
            return {
                success: true,
                result: 'Remote file written successfully',
                meta: {
                    ...routeResolution.routeMeta,
                    ...trustMeta,
                    path: remotePath,
                    contentLength: content.length,
                },
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
                success: false,
                result: `Error: Failed to write remote file: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeResolution.routeMeta,
                    ...(isRemoteHostMismatchError(error)
                        ? await buildRemoteTrustMeta(routeResolution.remoteLink!.remote, error)
                        : trustMetaBase),
                    path: remotePath,
                    contentLength: content.length,
                },
            }
        }
    },

    async rename_remote_path(args, ctx) {
        const routeResolution = await resolveShellRoute('rename_remote_path', args, ctx, { requireRemote: true })
        if (!routeResolution.ok) return routeResolution.errorResult

        const oldPath = getRequiredRemotePathArg(args.old_path, 'old_path', 'rename_remote_path', { rejectDangerousTarget: true })
        if (isToolExecutionResult(oldPath)) return oldPath
        const newPath = getRequiredRemotePathArg(args.new_path, 'new_path', 'rename_remote_path', { rejectDangerousTarget: true })
        if (isToolExecutionResult(newPath)) return newPath
        const trustMetaBase = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)

        try {
            await api.remoteShell.rename(routeResolution.remoteLink!.remote, oldPath, newPath)
            const trustMeta = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)
            return {
                success: true,
                result: 'Remote path renamed successfully',
                meta: {
                    ...routeResolution.routeMeta,
                    ...trustMeta,
                    oldPath,
                    newPath,
                },
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
                success: false,
                result: `Error: Failed to rename remote path: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeResolution.routeMeta,
                    ...(isRemoteHostMismatchError(error)
                        ? await buildRemoteTrustMeta(routeResolution.remoteLink!.remote, error)
                        : trustMetaBase),
                    oldPath,
                    newPath,
                },
            }
        }
    },

    async delete_remote_path(args, ctx) {
        const routeResolution = await resolveShellRoute('delete_remote_path', args, ctx, { requireRemote: true })
        if (!routeResolution.ok) return routeResolution.errorResult

        const remotePath = getRequiredRemotePathArg(args.path, 'path', 'delete_remote_path', { rejectDangerousTarget: true })
        if (isToolExecutionResult(remotePath)) return remotePath
        const trustMetaBase = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)

        try {
            await api.remoteShell.delete(routeResolution.remoteLink!.remote, remotePath)
            const trustMeta = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)
            return {
                success: true,
                result: 'Remote path deleted successfully',
                meta: {
                    ...routeResolution.routeMeta,
                    ...trustMeta,
                    path: remotePath,
                },
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
                success: false,
                result: `Error: Failed to delete remote path: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeResolution.routeMeta,
                    ...(isRemoteHostMismatchError(error)
                        ? await buildRemoteTrustMeta(routeResolution.remoteLink!.remote, error)
                        : trustMetaBase),
                    path: remotePath,
                },
            }
        }
    },

    async upload_to_remote(args, ctx) {
        const routeResolution = await resolveShellRoute('upload_to_remote', args, ctx, { requireRemote: true })
        if (!routeResolution.ok) return routeResolution.errorResult

        const remotePath = getRemotePathArg(args.path, routeResolution.remoteLink?.remote.remotePath || '.')
        const trustMetaBase = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)

        try {
            const mode = args.mode === 'directory' ? 'directory' : 'files'
            const uploadResult = await api.remoteShell.upload(routeResolution.remoteLink!.remote, remotePath, mode)
            const trustMeta = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)
            const count = uploadResult.uploadedCount ?? uploadResult.uploaded.length
            const successMessage = uploadResult.canceled
                ? 'Remote upload canceled by user'
                : uploadResult.isDirectory
                    ? `Remote directory uploaded to ${uploadResult.uploaded[0] || remotePath} (${count} file(s)${uploadResult.skippedSymlinks ? `, ${uploadResult.skippedSymlinks} symlink(s) skipped` : ''})`
                    : uploadResult.uploaded.length > 0
                        ? uploadResult.uploaded.join('\n')
                        : 'No files were uploaded'
            return {
                success: true,
                result: successMessage,
                meta: {
                    ...routeResolution.routeMeta,
                    ...trustMeta,
                    path: remotePath,
                    canceled: uploadResult.canceled,
                    uploaded: uploadResult.uploaded,
                    uploadedCount: count,
                    isDirectory: uploadResult.isDirectory,
                    skippedSymlinks: uploadResult.skippedSymlinks,
                    mode,
                },
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
                success: false,
                result: `Error: Failed to upload to remote: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeResolution.routeMeta,
                    ...(isRemoteHostMismatchError(error)
                        ? await buildRemoteTrustMeta(routeResolution.remoteLink!.remote, error)
                        : trustMetaBase),
                    path: remotePath,
                },
            }
        }
    },

    async download_from_remote(args, ctx) {
        const routeResolution = await resolveShellRoute('download_from_remote', args, ctx, { requireRemote: true })
        if (!routeResolution.ok) return routeResolution.errorResult

        const remotePath = getRequiredRemotePathArg(args.path, 'path', 'download_from_remote', { rejectDangerousTarget: true })
        if (isToolExecutionResult(remotePath)) return remotePath
        const trustMetaBase = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)

        try {
            const downloadResult = await api.remoteShell.download(routeResolution.remoteLink!.remote, remotePath)
            const trustMeta = await buildRemoteTrustMeta(routeResolution.remoteLink!.remote)
            const successMessage = downloadResult.canceled
                ? 'Remote download canceled by user'
                : downloadResult.isDirectory
                    ? `Remote directory downloaded to ${downloadResult.localPath || 'local folder'} (${downloadResult.downloadedCount ?? 0} file(s)${downloadResult.skippedSymlinks ? `, ${downloadResult.skippedSymlinks} symlink(s) skipped` : ''})`
                    : downloadResult.localPath || 'Remote file downloaded successfully'
            return {
                success: true,
                result: successMessage,
                meta: {
                    ...routeResolution.routeMeta,
                    ...trustMeta,
                    path: remotePath,
                    canceled: downloadResult.canceled,
                    localPath: downloadResult.localPath,
                    isDirectory: downloadResult.isDirectory,
                    downloadedCount: downloadResult.downloadedCount,
                    skippedSymlinks: downloadResult.skippedSymlinks,
                },
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
                success: false,
                result: `Error: Failed to download from remote: ${errorMsg}`,
                error: errorMsg,
                meta: {
                    ...routeResolution.routeMeta,
                    ...(isRemoteHostMismatchError(error)
                        ? await buildRemoteTrustMeta(routeResolution.remoteLink!.remote, error)
                        : trustMetaBase),
                    path: remotePath,
                },
            }
        }
    },

    async get_diagnostics(args, ctx) {
        const loaded = await loadAgentSymbolsForFile(args.relative_path as string, ctx)
        const minSeverity = Math.max(1, Math.min(4, Number(args.min_severity ?? 4)))
        const targetNamePath = typeof args.name_path === 'string' ? args.name_path : undefined
        const includeReferences = args.include_references === true
        if (includeReferences && !targetNamePath) {
            return { success: false, result: '', error: 'include_references requires name_path' }
        }

        let target: AgentSymbol | undefined
        if (targetNamePath) {
            const matches = findAgentSymbols(loaded.symbols, targetNamePath)
            if (matches.length !== 1) {
                return {
                    success: false,
                    result: '',
                    error: matches.length ? `Symbol is ambiguous: ${targetNamePath}` : `Symbol not found: ${targetNamePath}`,
                }
            }
            target = matches[0]
        }

        const grouped = await collectDiagnosticsForTarget(loaded, target, minSeverity)

        if (includeReferences && target) {
            const locations = await api.lsp.references({
                uri: pathToLspUri(loaded.fullPath),
                line: target.selectionRange.start.line - 1,
                character: target.selectionRange.start.column - 1,
                workspacePath: ctx.workspacePath,
            })
            if (locations === null || locations === undefined) {
                return { success: false, result: '', error: 'Unable to retrieve symbol references for diagnostic impact analysis' }
            }

            const maxReferenceSymbols = Math.max(1, Number(args.max_reference_symbols ?? 20))
            const positions = (locations as Array<{
                uri: string
                range: { start: { line: number; character: number } }
            }>).flatMap(location => {
                const relativePath = toRelativePath(lspUriToPath(location.uri), ctx.workspacePath).replace(/\\/g, '/')
                const line = location.range.start.line + 1
                const column = location.range.start.character + 1
                const isInsideSource = relativePath === loaded.relativePath && isPositionInsideSymbol(target, line, column)
                return isInsideSource ? [] : [{ relativePath, line, column }]
            })

            const positionsByFile = new Map<string, Array<{ line: number; column: number }>>()
            for (const position of positions) {
                const entries = positionsByFile.get(position.relativePath) ?? []
                entries.push({ line: position.line, column: position.column })
                positionsByFile.set(position.relativePath, entries)
            }

            const loadLimit = pLimit(4)
            const referencingTargets = (await Promise.all([...positionsByFile].map(([relativePath, filePositions]) => loadLimit(async () => {
                const referenceFile = await loadAgentSymbolsForFile(relativePath, ctx)
                const symbols = new Map<string, AgentSymbol>()
                for (const position of filePositions) {
                    const owner = findContainingAgentSymbol(referenceFile.symbols, position.line, position.column)
                    if (owner) symbols.set(owner.namePath, owner)
                }
                return [...symbols.values()].map(symbol => ({ loaded: referenceFile, symbol }))
            })))).flat()

            const visibleTargets = referencingTargets.slice(0, maxReferenceSymbols)
            const visibleByFile = new Map<string, {
                loaded: Awaited<ReturnType<typeof loadAgentSymbolsForFile>>
                symbols: AgentSymbol[]
            }>()
            for (const item of visibleTargets) {
                const entry = visibleByFile.get(item.loaded.relativePath) ?? { loaded: item.loaded, symbols: [] }
                entry.symbols.push(item.symbol)
                visibleByFile.set(item.loaded.relativePath, entry)
            }
            const referenceDiagnostics = await Promise.all([...visibleByFile.values()].map(item => loadLimit(async () => ({
                relativePath: item.loaded.relativePath,
                grouped: await collectDiagnosticsForTarget(item.loaded, item.symbols, minSeverity),
            }))))

            const files: Record<string, Record<string, any[]>> = { [loaded.relativePath]: grouped }
            for (const item of referenceDiagnostics) {
                const fileDiagnostics = files[item.relativePath] ?? {}
                for (const [owner, diagnostics] of Object.entries(item.grouped)) {
                    fileDiagnostics[owner] = diagnostics
                }
                files[item.relativePath] = fileDiagnostics
            }

            const count = Object.values(files).reduce(
                (fileSum, file) => fileSum + Object.values(file).reduce((sum, items) => sum + items.length, 0),
                0,
            )
            if (!count) {
                return {
                    success: true,
                    result: 'No diagnostics found in the symbol or inspected referencing symbols',
                    meta: {
                        diagnosticCount: 0,
                        referenceSymbolCount: referencingTargets.length,
                        inspectedReferenceSymbolCount: visibleTargets.length,
                    },
                }
            }

            return {
                success: true,
                result: boundJsonOutput([
                    {
                        build: () => ({
                            diagnosticCount: count,
                            referenceSymbolCount: referencingTargets.length,
                            inspectedReferenceSymbolCount: visibleTargets.length,
                            truncated: visibleTargets.length < referencingTargets.length,
                            files,
                        }),
                    },
                    {
                        build: () => ({
                            diagnosticCount: count,
                            diagnosticsPerFile: Object.fromEntries(
                                Object.entries(files).map(([relativePath, file]) => [
                                    relativePath,
                                    Object.values(file).reduce((sum, items) => sum + items.length, 0),
                                ]),
                            ),
                        }),
                        hint: 'Only per-file diagnostic counts fit. Inspect one listed file or symbol for details.',
                    },
                ], toolOutputBudget()),
                meta: {
                    diagnosticCount: count,
                    referenceSymbolCount: referencingTargets.length,
                    inspectedReferenceSymbolCount: visibleTargets.length,
                },
            }
        }

        const count = Object.values(grouped).reduce((sum, items) => sum + items.length, 0)
        if (!count) return { success: true, result: 'No diagnostics found', meta: { diagnosticCount: 0 } }

        return {
            success: true,
            result: boundJsonOutput([
                { build: () => ({ relativePath: loaded.relativePath, count, diagnostics: grouped }) },
                {
                    // 诊断的价值全在 message 上，位置可以由 name_path 重查，所以先丢位置。
                    build: () => ({
                        relativePath: loaded.relativePath,
                        count,
                        diagnostics: Object.fromEntries(
                            Object.entries(grouped).map(([owner, items]) => [
                                owner,
                                items.map((item: any) => ({ severity: item.severity, message: item.message })),
                            ]),
                        ),
                    }),
                    hint: 'Positions and codes were omitted. Pass name_path to inspect one symbol in full.',
                },
                {
                    build: () => ({
                        relativePath: loaded.relativePath,
                        count,
                        diagnosticsPerSymbol: Object.fromEntries(
                            Object.entries(grouped).map(([owner, items]) => [owner, items.length]),
                        ),
                    }),
                    hint: 'Only per-symbol counts fit. Pass name_path to read one symbol\'s diagnostics, or raise min_severity to 1 for errors only.',
                },
            ], toolOutputBudget()),
            meta: { diagnosticCount: count },
        }
    },

    async codebase_search(args, ctx) {
        if (!ctx.workspacePath) return { success: false, result: '', error: 'No workspace open' }
        try {
            const results = await api.index.hybridSearch(ctx.workspacePath, args.query as string, (args.top_k as number) || 10)
            if (!results?.length) return { success: true, result: 'No results found' }
            return { success: true, result: results.map((r: { relativePath: string; startLine: number; content: string }) => `${r.relativePath}:${r.startLine}: ${r.content.trim()}`).join('\n') }
        } catch (e) {
            return { success: false, result: '', error: e instanceof Error ? e.message : 'Search failed' }
        }
    },

    async find_references(args, ctx) {
        const loaded = await loadAgentSymbolsForFile(args.relative_path as string, ctx)
        const sourceSymbols = findAgentSymbols(loaded.symbols, args.name_path as string)
        if (sourceSymbols.length !== 1) {
            return {
                success: false,
                result: '',
                error: sourceSymbols.length === 0
                    ? `Symbol not found: ${args.name_path}`
                    : `Symbol is ambiguous: ${args.name_path}. Matches: ${sourceSymbols.map(symbol => symbol.namePath).join(', ')}`,
            }
        }

        const source = sourceSymbols[0]
        const locations = await api.lsp.references({
            uri: pathToLspUri(loaded.fullPath),
            line: source.selectionRange.start.line - 1,
            character: source.selectionRange.start.column - 1,
            workspacePath: ctx.workspacePath,
        })
        if (!locations?.length) return { success: true, result: 'No references found' }

        const rawLocations = locations as Array<{ uri: string; range: { start: { line: number; character: number } } }>
        const maxReferences = Math.max(1, Number(args.max_references ?? 50))
        const positions = rawLocations.map(location => {
            const fullPath = lspUriToPath(location.uri)
            return {
                relativePath: toRelativePath(fullPath, ctx.workspacePath).replace(/\\/g, '/'),
                line: location.range.start.line + 1,
                column: location.range.start.character + 1,
            }
        })

        // 只为要返回的那部分解析所属符号。每个引用文件都要 read 全文 + documentSymbol，
        // 对一个被广泛使用的符号来说，为不会出现在结果里的引用付这份钱是纯浪费。
        const visible = positions.slice(0, maxReferences)
        const symbolTreesByPath = new Map<string, AgentSymbol[]>()
        const referenceFiles = [...new Set(visible.map(position => position.relativePath))]
        const symbolLoadLimit = pLimit(4)
        await Promise.all(referenceFiles.map(relativePath => symbolLoadLimit(async () => {
            const symbols = (await loadAgentSymbolsForFile(relativePath, ctx)).symbols
            symbolTreesByPath.set(relativePath, symbols)
        })))

        const references: Array<{
            relativePath: string
            line: number
            column: number
            containingSymbol?: string
            containingKind?: string
        }> = []
        for (const position of visible) {
            const symbolTrees = symbolTreesByPath.get(position.relativePath) ?? []
            const container = findContainingAgentSymbol(symbolTrees, position.line, position.column)
            references.push({
                ...position,
                ...(container ? { containingSymbol: container.namePath, containingKind: container.kindName } : {}),
            })
        }

        const total = positions.length
        const stages: JsonOutputStage[] = [
            { build: () => ({ symbol: source.namePath, referenceCount: total, references }) },
        ]
        if (references.length < total) {
            stages[0] = {
                build: () => ({ symbol: source.namePath, referenceCount: total, returnedCount: references.length, references }),
                hint: `Showing ${references.length} of ${total} references. Raise max_references or narrow the scope to see the rest.`,
            }
        }
        stages.push(
            {
                build: () => ({ symbol: source.namePath, referenceCount: total, references: visible }),
                hint: 'Containing symbols were omitted. Call get_document_symbols on a listed file to recover them.',
            },
            {
                build: () => ({ symbol: source.namePath, referenceCount: total, files: countByFile(positions) }),
                hint: 'Only per-file counts fit. Restrict the search to one of these files to see individual references.',
            },
        )

        return {
            success: true,
            result: boundJsonOutput(stages, toolOutputBudget()),
            meta: { referenceCount: total, returnedCount: references.length },
        }
    },

    async navigate_symbol(args, ctx) {
        const { loaded, symbol } = await resolveAgentSymbolPosition(
            args.relative_path as string,
            args.name_path as string,
            ctx,
        )
        const relation = args.relation as 'definition' | 'type_definition' | 'implementation' | 'incoming_calls' | 'outgoing_calls'
        const position = {
            uri: pathToLspUri(loaded.fullPath),
            line: symbol.selectionRange.start.line - 1,
            character: symbol.selectionRange.start.column - 1,
            workspacePath: ctx.workspacePath,
        }

        if (relation === 'incoming_calls' || relation === 'outgoing_calls') {
            const calls = relation === 'incoming_calls'
                ? await api.lsp.incomingCalls(position)
                : await api.lsp.outgoingCalls(position)
            return { success: true, result: formatCallHierarchy(calls, relation, ctx) }
        }

        const request = relation === 'implementation'
            ? api.lsp.implementation
            : relation === 'type_definition'
                ? api.lsp.typeDefinition
                : api.lsp.definition
        const locations = await request(position)
        return { success: true, result: await formatNavigationLocations(locations, ctx) }
    },

    async get_hover_info(args, ctx) {
        const { loaded, symbol } = await resolveAgentSymbolPosition(
            args.relative_path as string,
            args.name_path as string,
            ctx,
        )
        const hover = await api.lsp.hover({
            uri: pathToLspUri(loaded.fullPath),
            line: symbol.selectionRange.start.line - 1,
            character: symbol.selectionRange.start.column - 1,
            workspacePath: ctx.workspacePath,
        })
        if (!hover?.contents) return { success: true, result: 'No hover info' }
        const contents = Array.isArray(hover.contents) ? hover.contents.join('\n') : (typeof hover.contents === 'string' ? hover.contents : hover.contents.value)
        return { success: true, result: contents }
    },

    async edit_symbol(args, ctx) {
        const { loaded, symbol } = await resolveAgentSymbolPosition(
            args.relative_path as string,
            args.name_path as string,
            ctx,
        )
        const action = args.action as 'replace' | 'insert_before' | 'insert_after' | 'delete'
        if (action === 'replace' && !fileCacheService.hasValidCache(loaded.fullPath)) {
            return { success: false, result: '', error: 'Retrieve the symbol with find_symbol(include_body=true) before replacing it' }
        }
        if (action === 'delete') {
            const locations = await api.lsp.references({
                uri: pathToLspUri(loaded.fullPath),
                line: symbol.selectionRange.start.line - 1,
                character: symbol.selectionRange.start.column - 1,
                workspacePath: ctx.workspacePath,
            })
            if (locations === null || locations === undefined) {
                return { success: false, result: '', error: 'Unable to verify symbol references; deletion was not performed' }
            }

            const externalReferences = (locations as Array<{
                uri: string
                range: { start: { line: number; character: number } }
            }>).flatMap(location => {
                const relativePath = toRelativePath(lspUriToPath(location.uri), ctx.workspacePath).replace(/\\/g, '/')
                const line = location.range.start.line + 1
                const column = location.range.start.character + 1
                const isInsideDeletedSymbol = relativePath === loaded.relativePath
                    && isPositionInsideSymbol(symbol, line, column)
                return isInsideDeletedSymbol ? [] : [{ relativePath, line, column }]
            })

            if (externalReferences.length > 0) {
                const visible = externalReferences.slice(0, 50)
                return {
                    success: false,
                    result: '',
                    error: boundJsonOutput([
                        {
                            build: () => ({
                                message: 'Symbol deletion blocked because external references remain',
                                referenceCount: externalReferences.length,
                                references: visible,
                            }),
                            ...(visible.length < externalReferences.length
                                ? { hint: `Showing ${visible.length} of ${externalReferences.length} references.` }
                                : {}),
                        },
                        {
                            build: () => ({
                                message: 'Symbol deletion blocked because external references remain',
                                referenceCount: externalReferences.length,
                                files: countByFile(externalReferences),
                            }),
                        },
                    ], toolOutputBudget()),
                }
            }

            return applyWorkspaceEditAtomically(
                { changes: { [pathToLspUri(loaded.fullPath)]: [symbolRangeEdit(symbol, '')] } },
                ctx,
                'edit_symbol',
            )
        }

        let edit = symbolRangeEdit(symbol, args.body as string)
        if (action !== 'replace') {
            const original = await api.file.readFull(loaded.fullPath) ?? ''
            const eol = original.includes('\r\n') ? '\r\n' : '\n'
            if (action === 'insert_before') {
                edit = symbolRangeEdit(symbol, `${args.body as string}${eol}`)
                edit.range.end = { ...edit.range.start }
            } else {
                edit = symbolRangeEdit(symbol, `${eol}${args.body as string}`)
                edit.range.start = { ...edit.range.end }
            }
        }
        return applyWorkspaceEditAtomically(
            { changes: { [pathToLspUri(loaded.fullPath)]: [edit] } },
            ctx,
            'edit_symbol',
        )
    },

    async rename_symbol(args, ctx) {
        const { loaded, symbol } = await resolveAgentSymbolPosition(
            args.relative_path as string,
            args.name_path as string,
            ctx,
        )
        const position = {
            uri: pathToLspUri(loaded.fullPath),
            line: symbol.selectionRange.start.line - 1,
            character: symbol.selectionRange.start.column - 1,
            workspacePath: ctx.workspacePath,
        }
        const prepared = await api.lsp.prepareRename(position)
        if (!prepared) return { success: false, result: '', error: 'Language server rejected rename at this symbol' }
        const workspaceEdit = await api.lsp.rename({ ...position, newName: args.new_name as string }) as LspWorkspaceEdit | null
        if (!workspaceEdit) return { success: false, result: '', error: 'Language server returned no rename edits' }
        return applyWorkspaceEditAtomically(workspaceEdit, ctx, 'rename_symbol')
    },

    async get_document_symbols(args, ctx) {
        const loaded = await loadAgentSymbolsForFile(args.relative_path as string, ctx)
        if (!loaded.symbols.length) return { success: true, result: 'No symbols found' }

        const depth = typeof args.depth === 'number' ? args.depth : 0
        const maxSymbols = Math.max(1, Number(args.max_symbols ?? 200))
        const total = loaded.symbols.length
        const visible = loaded.symbols.slice(0, maxSymbols)

        const stages: JsonOutputStage[] = [
            {
                build: () => ({
                    relativePath: loaded.relativePath,
                    symbolCount: total,
                    ...(visible.length < total ? { returnedCount: visible.length } : {}),
                    symbols: compactAgentSymbols(limitAgentSymbolDepth(visible, depth)),
                }),
                ...(visible.length < total
                    ? { hint: `Showing ${visible.length} of ${total} top-level symbols. Raise max_symbols or use find_symbol to target one symbol.` }
                    : {}),
            },
        ]
        // 后续每一级都把 depth 再收一层，直到只剩顶层。子节点是体积的主要来源，
        // 而顶层结构才是这个工具存在的理由，所以先丢深度、再丢名字。
        for (let reduced = depth - 1; reduced >= 0; reduced--) {
            stages.push({
                build: () => ({
                    relativePath: loaded.relativePath,
                    symbolCount: total,
                    symbols: compactAgentSymbols(limitAgentSymbolDepth(visible, reduced)),
                }),
                hint: `Descendants beyond depth ${reduced} were omitted. Call find_symbol on a listed name path to expand one subtree.`,
            })
        }
        stages.push({
            build: () => ({
                relativePath: loaded.relativePath,
                symbolCount: total,
                namePaths: visible.map(symbol => symbol.namePath),
            }),
            hint: 'Only name paths fit. Call find_symbol with one of these to get its kind, range, and body.',
        })

        return {
            success: true,
            result: boundJsonOutput(stages, toolOutputBudget()),
            meta: { relativePath: loaded.relativePath, symbolCount: total, returnedCount: visible.length },
        }
    },

    async find_symbol(args, ctx) {
        if (!ctx.workspacePath) return { success: false, result: '', error: 'No workspace open' }

        const namePathPattern = normalizeAgentNamePathPattern(String(args.name_path || ''))
        const includeBody = args.include_body === true
        const depth = includeBody ? 0 : Math.max(0, Number(args.depth ?? 0))
        const maxMatches = Math.max(1, Number(args.max_matches ?? 20))
        const candidates = await resolveSymbolCandidateFiles(
            namePathPattern,
            typeof args.relative_path === 'string' ? args.relative_path : undefined,
            ctx,
        )

        const matches: AgentSymbol[] = []
        let loadedCandidateCount = 0
        let firstLoadError: unknown
        for (const candidatePath of candidates.paths) {
            try {
                const loaded = await loadAgentSymbolsForFile(candidatePath, ctx)
                loadedCandidateCount++
                matches.push(...findAgentSymbols(loaded.symbols, namePathPattern, {
                    depth,
                    substringMatching: args.substring_matching === true,
                }))
            } catch (error) {
                firstLoadError ??= error
                if (candidates.paths.length === 1) throw error
            }
        }

        if (candidates.paths.length > 0 && loadedCandidateCount === 0 && firstLoadError) throw firstLoadError

        const searchedFileCount = candidates.paths.length
        const skippedFileCount = candidates.totalCandidates - searchedFileCount

        if (!matches.length) {
            // 「没有匹配」和「搜索范围被裁剪所以可能漏了」是两件事，必须区分：
            // 模型据此决定是换名字重搜，还是缩小 relative_path 再搜同一个名字。
            return {
                success: true,
                result: skippedFileCount > 0
                    ? `No matching symbols found in the ${searchedFileCount} highest-ranked candidate files, but ${skippedFileCount} further candidates were not searched. Narrow the search with relative_path, or use search_files for an exact text match.`
                    : 'No matching symbols found',
                meta: { matchedCount: 0, searchedFileCount, skippedFileCount },
            }
        }

        const visibleMatches = matches.slice(0, maxMatches)
        const symbols = includeBody ? await includeSymbolBodies(visibleMatches, ctx) : visibleMatches
        const base = {
            matchedCount: matches.length,
            ...(skippedFileCount > 0 ? { searchedFileCount, skippedFileCount } : {}),
        }
        const overflowHints = [
            ...(matches.length > maxMatches
                ? [`Showing ${visibleMatches.length} of ${matches.length} matches; raise max_matches or narrow with relative_path.`]
                : []),
            ...(skippedFileCount > 0
                ? [`${skippedFileCount} candidate files were not searched; narrow with relative_path to cover them.`]
                : []),
        ]

        const stages: JsonOutputStage[] = [
            {
                build: () => ({ ...base, symbols: compactAgentSymbols(symbols, { includeLocation: true }) }),
                ...(overflowHints.length ? { hint: overflowHints.join(' ') } : {}),
            },
        ]
        if (includeBody) {
            // body 是这里唯一的重量级字段，先只丢它，位置信息足以让模型逐个重取。
            stages.push({
                build: () => ({
                    ...base,
                    symbols: compactAgentSymbols(visibleMatches, { includeLocation: true }),
                }),
                hint: 'Symbol bodies were omitted. Call find_symbol with include_body=true on a single name path to read one body.',
            })
        }
        stages.push({
            build: () => ({ ...base, locations: symbols.map(symbol => `${symbol.relativePath}:${symbol.namePath}`) }),
            hint: 'Only name paths and files fit. Call find_symbol with relative_path set to one of these files.',
        })

        return {
            success: true,
            result: boundJsonOutput(stages, toolOutputBudget()),
            meta: { matchedCount: matches.length, returnedCount: symbols.length, searchedFileCount, skippedFileCount },
        }
    },

    async web_search(args) {
        const timeout = (args.timeout as number) || 30
        const result = await api.http.webSearch(args.query as string, args.max_results as number, timeout * 1000)
        if (!result.success || !result.results) return { success: false, result: '', error: result.error || 'Search failed' }
        return { success: true, result: result.results.map((r: { title: string; url: string; snippet: string }) => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n') }
    },

    async read_url(args) {
        // timeout 参数单位是秒，转换为毫秒，最小 30 秒，默认 60 秒
        const timeoutSec = Math.max((args.timeout as number) || 60, 30)
        const result = await api.http.readUrl(args.url as string, timeoutSec * 1000)
        if (!result.success || !result.content) return { success: false, result: '', error: result.error || 'Failed to read URL' }
        return { success: true, result: `Title: ${result.title}\n\n${result.content}` }
    },

    async ask_user(args, _ctx) {
        const question = args.question as string
        const rawOptions = args.options as Array<{ id?: string; value?: string; label: string; description?: string }>
        const multiSelect = (args.multi_select as boolean) || false

        // 兼容处理：支持 id 或 value 作为选项标识符
        const options = rawOptions.map((opt, idx) => ({
            id: opt.id || opt.value || `option-${idx}`,
            label: opt.label,
            description: opt.description,
        }))

        // 返回 interactive 数据，由 loop.ts 负责设置到 store
        return {
            success: true,
            result: `Waiting for user to select from options. Question: "${question}"`,
            meta: {
                waitingForUser: true,
                interactive: { type: 'interactive' as const, question, options, multiSelect },
            },
        }
    },

    async create_task_plan(args, ctx) {
        const name = args.name as string
        const requirementsDoc = args.requirementsDoc as string
        const tasks = args.tasks as Array<{
            title: string
            description: string
            suggestedProvider: string
            suggestedModel: string
            suggestedRole: string
            dependencies?: string[]
            acceptanceCriteria?: string[]
            producesFiles?: string[]
            consumesFiles?: string[]
            executionClass?: import('@/renderer/agent/plan/types').TaskExecutionClass
        }>
        const executionMode = (args.executionMode as 'sequential' | 'parallel') || 'sequential'
        const stageContent = normalizePlanStageMap(args.stageContent)

        if (!ctx.workspacePath) {
            return { success: false, result: 'No workspace path available' }
        }

        if (!hasCompletePlanStageMap(stageContent)) {
            return {
                success: false,
                result: 'stageContent must contain complete requirements, plan, execution, and validation content. Each stage needs a title, summary, and sections array.',
            }
        }

        if (getConfiguredPlanProviders().length === 0) {
            return { success: false, result: 'No usable Plan task provider is configured. Add an API key, endpoint, and at least one model before creating a plan.' }
        }

        const currentAssistantId = ctx.currentAssistantId ?? ctx.assistantId
        const threadMessages = ctx.threadId
            ? useAgentStore.getState().threads[ctx.threadId]?.messages || []
            : []
        const messagesBeforeCurrentCall = currentAssistantId
            ? threadMessages.filter(message => message.id !== currentAssistantId)
            : threadMessages
        const requestMessage = [...messagesBeforeCurrentCall].reverse().find(message => message.role === 'user')

        try {
            // 生成唯一 ID
            const timestamp = Date.now()
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
            const planId = `${slug}-${timestamp}`

            // 创建 .adnify/plan 目录
            const planDir = `${ctx.workspacePath}/.adnify/plan`
            await api.file.mkdir(planDir)

            // 保存需求文档 (markdown)
            const stageDocs = Object.fromEntries((Object.keys(stageContent) as PlanStageKey[]).map(stage => [stage, `${planId}.${stage}.md`])) as Record<PlanStageKey, string>
            for (const stage of Object.keys(stageContent) as PlanStageKey[]) {
                const stagePath = `${planDir}/${stageDocs[stage]}`
                internalWriteTracker.mark(stagePath)
                await api.file.write(stagePath, renderPlanStageMarkdown(stageContent[stage]))
            }
            const mdPath = `${planDir}/${stageDocs.requirements}`

            // 构建任务对象
            // 处理 "default" 值，转换为真实的默认配置
            const resolveDefault = (value: string | undefined, fallback: string) => {
                if (!value || value === 'default' || value === 'Default') return fallback
                return value
            }

            let reassignedCount = 0
            const planTasks = tasks.map((t, idx) => {
                const assignment = resolvePlanProviderAssignment(t.suggestedProvider, t.suggestedModel)!
                if (assignment.reassigned) reassignedCount += 1
                return {
                    id: `task-${idx + 1}`,
                    title: t.title,
                    description: t.description,
                    provider: assignment.provider,
                    model: assignment.model,
                    role: resolveDefault(t.suggestedRole, 'coder'),
                    dependencies: t.dependencies || [],
                    acceptanceCriteria: (t.acceptanceCriteria || []).map((text: string, criterionIndex: number) => ({
                        id: `task-${idx + 1}-criterion-${criterionIndex + 1}`,
                        text: text.trim(),
                        status: 'pending' as const,
                        evidenceIds: [],
                    })).filter(item => item.text),
                    evidence: [],
                    modelSelection: 'auto' as const,
                    producesFiles: t.producesFiles || [],
                    consumesFiles: t.consumesFiles || [],
                    executionClass: t.executionClass,
                    status: 'pending' as const,
                }
            })

            // 构建规划对象
            const plan = {
                id: planId,
                name,
                createdAt: timestamp,
                updatedAt: timestamp,
                requirementsDoc: stageDocs.requirements,
                requirementsContent: requirementsDoc,
                stageContent,
                stageDocs,
                contentSchemaVersion: 1 as const,
                executionMode,
                status: 'draft' as const,
                tasks: planTasks,
                originThreadId: ctx.threadId || undefined,
                userRequest: requestMessage?.role === 'user' ? getMessageText(requestMessage.content).trim() : undefined,
            }

            // Task Plan state is transactional; Markdown stage documents remain
            // workspace artifacts for review and version control.
            await api.session.upsertPlan(plan)

            // 添加到 store。PlanWorkspace 订阅 activePlanId，会立即展示新计划。
            agentStorePlanBridge.addPlan(plan)
            const editorStore = useStore.getState()
            if (editorStore.openFiles.some(file => isPlanBoardPath(file.path))) {
                editorStore.setActiveFile(PLAN_BOARD_PATH)
            } else {
                editorStore.openFile(PLAN_BOARD_PATH, '', undefined, { pinned: true })
            }

            return {
                success: true,
                result: translate('agent.tool.plan.created', {
                    name,
                    count: tasks.length,
                    path: mdPath,
                    reassigned: reassignedCount
                        ? translate('agent.tool.plan.createdReassigned', { count: reassignedCount })
                        : '',
                }),
                meta: { planId, storage: 'sqlite', stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async update_task_plan(args, ctx) {
        try {
            const planId = args.planId as string
            const updateRequirements = args.updateRequirements as string | undefined
            const addTasks = args.addTasks as Array<{
                title: string
                description: string
                suggestedProvider?: string
                suggestedModel?: string
                suggestedRole?: string
                acceptanceCriteria?: string[]
                insertAfter?: string
            }> | undefined
            const removeTasks = args.removeTasks as string[] | undefined
            const updateTasks = args.updateTasks as Array<{
                taskId: string
                title?: string
                description?: string
                provider?: string
                model?: string
                role?: string
                acceptanceCriteria?: string[]
            }> | undefined
            const executionMode = args.executionMode as 'sequential' | 'parallel' | undefined
            const stageContentPatch = normalizePlanStageMap(args.stageContent)

            const store = agentStorePlanBridge
            const plan = store.getPlanById(planId)

            if (!plan) {
                return { success: false, result: `Plan not found: ${planId}` }
            }

            const changes: string[] = []
            let nextTasks = [...plan.tasks]
            let nextRequirementsContent = plan.requirementsContent

            // 更新需求文档
            if (updateRequirements) {
                const mdPath = `${ctx.workspacePath}/.adnify/plan/${plan.requirementsDoc}`
                const existingContent = await api.file.readFull(mdPath)
                const newContent = `${existingContent}\n\n---\n## Updates\n${updateRequirements}`
                internalWriteTracker.mark(mdPath)
                await api.file.write(mdPath, newContent)
                nextRequirementsContent = newContent
                changes.push('Updated requirements document')
            }

            // Remove tasks and clean every dependency edge that pointed at them.
            if (removeTasks?.length) {
                const removed = new Set(removeTasks)
                const before = nextTasks.length
                nextTasks = nextTasks
                    .filter(task => !removed.has(task.id))
                    .map(task => ({ ...task, dependencies: task.dependencies.filter(id => !removed.has(id)) }))
                changes.push(`Removed ${before - nextTasks.length} tasks`)
            }

            // Add tasks at the requested graph position instead of always appending.
            if (addTasks?.length) {
                const timestamp = Date.now()
                const newTasks = addTasks.map((t, i) => {
                    const assignment = resolvePlanProviderAssignment(t.suggestedProvider, t.suggestedModel)
                    if (!assignment) throw new Error('No usable Plan task provider is configured.')
                    return {
                        id: `task-${timestamp}-${i}`,
                        title: t.title,
                        description: t.description,
                        provider: assignment.provider,
                        model: assignment.model,
                        role: t.suggestedRole || 'coder',
                        status: 'pending' as const,
                        dependencies: [],
                        acceptanceCriteria: (t.acceptanceCriteria || []).map((text, criterionIndex) => ({
                            id: `task-${timestamp}-${i}-criterion-${criterionIndex + 1}`,
                            text: text.trim(),
                            status: 'pending' as const,
                            evidenceIds: [],
                        })).filter(item => item.text),
                        evidence: [],
                        modelSelection: 'auto' as const,
                    }
                })

                for (let index = 0; index < newTasks.length; index++) {
                    const definition = addTasks[index]
                    const task = newTasks[index]
                    const insertAt = definition.insertAfter
                        ? nextTasks.findIndex(item => item.id === definition.insertAfter) + 1
                        : nextTasks.length
                    if (definition.insertAfter && insertAt === 0) {
                        nextTasks.push(task)
                    } else {
                        nextTasks.splice(insertAt, 0, task)
                    }
                }
                changes.push(`Added ${addTasks.length} tasks`)
            }

            // Preserve unspecified fields. A changed completed task becomes pending
            // again so validation revisions actually execute the new definition.
            if (updateTasks?.length) {
                for (const update of updateTasks) {
                    const taskIndex = nextTasks.findIndex(task => task.id === update.taskId)
                    if (taskIndex < 0) continue
                    const currentTask = nextTasks[taskIndex]
                    const assignment = (update.provider !== undefined || update.model !== undefined)
                        ? resolvePlanProviderAssignment(update.provider || currentTask.provider, update.model || currentTask.model)
                        : null
                    if ((update.provider !== undefined || update.model !== undefined) && !assignment) throw new Error('No usable Plan task provider is configured.')
                    const definedUpdates = Object.fromEntries(
                        Object.entries({
                            title: update.title,
                            description: update.description,
                            provider: assignment?.provider,
                            model: assignment?.model,
                            role: update.role,
                            modelSelection: (update.provider !== undefined || update.model !== undefined) ? 'manual' : undefined,
                            acceptanceCriteria: update.acceptanceCriteria?.map((text, criterionIndex) => ({
                                id: `${currentTask.id}-criterion-${criterionIndex + 1}`,
                                text: text.trim(),
                                status: 'pending' as const,
                                evidenceIds: [],
                            })).filter(item => item.text),
                        }).filter(([, value]) => value !== undefined),
                    )
                    nextTasks[taskIndex] = {
                        ...nextTasks[taskIndex],
                        ...definedUpdates,
                        status: 'pending',
                        output: undefined,
                        error: undefined,
                        startedAt: undefined,
                        completedAt: undefined,
                        threadId: undefined,
                        assistantId: undefined,
                        requestId: undefined,
                    }
                }
                changes.push(`Updated ${updateTasks.length} tasks`)
            }

            // Apply the revision atomically so persistence cannot capture a
            // half-updated task graph between several debounced store writes.
            if (executionMode) {
                changes.push(`Changed execution mode to ${executionMode}`)
            }

            const nextStageContent = { ...(plan.stageContent || {}), ...stageContentPatch }
            const nextStageDocs = { ...(plan.stageDocs || {}) }
            if (Object.keys(stageContentPatch).length > 0) {
                const planDir = `${ctx.workspacePath}/.adnify/plan`
                for (const stage of Object.keys(stageContentPatch) as PlanStageKey[]) {
                    const fileName = nextStageDocs[stage] || `${planId}.${stage}.md`
                    nextStageDocs[stage] = fileName
                    const filePath = `${planDir}/${fileName}`
                    internalWriteTracker.mark(filePath)
                    await api.file.write(filePath, renderPlanStageMarkdown(stageContentPatch[stage]!))
                }
                changes.push(`Updated ${Object.keys(stageContentPatch).join(', ')} stage content`)
            }

            if (changes.length === 0) {
                return { success: false, result: 'No plan changes were provided.' }
            }

            store.updatePlan(planId, {
                tasks: nextTasks,
                requirementsContent: nextRequirementsContent,
                stageContent: nextStageContent,
                stageDocs: nextStageDocs,
                contentSchemaVersion: Object.keys(nextStageContent).length > 0 ? 1 : plan.contentSchemaVersion,
                executionMode: executionMode || plan.executionMode,
                status: 'draft',
                validation: undefined,
            })

            return {
                success: true,
                result: translate('agent.tool.plan.updated', {
                    changes: changes.map(c => `- ${c}`).join('\n'),
                }),
                meta: { stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async start_task_execution(args) {
        try {
            const planId = args.planId as string | undefined

            // 验证计划存在且可执行
            const store = agentStorePlanBridge

            const plan = planId
                ? store.getPlanById(planId)
                : store.getActivePlan()

            if (!plan) {
                return {
                    success: false,
                    result: translate('agent.tool.plan.notFound')
                }
            }

            if (plan.tasks.length === 0) {
                return {
                    success: false,
                    result: translate('agent.tool.plan.noTasks')
                }
            }

            if (plan.status === 'executing') {
                return {
                    success: false,
                    result: translate('agent.tool.plan.alreadyExecuting')
                }
            }

            const { startPlanExecution } = await import('../plan/planExecutor')

            // 异步启动执行（不等待完成）
            const result = await startPlanExecution(plan.id)

            if (!result.success) {
                return { success: false, result: result.message }
            }

            return {
                success: true,
                result: translate('agent.tool.plan.started', {
                    name: plan.name,
                    count: plan.tasks.length,
                }),
                meta: { stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async uiux_search(args) {
        const { uiuxDatabase } = await import('./uiux')

        const query = args.query as string
        const domain = args.domain as string | undefined
        const stack = args.stack as string | undefined
        const maxResults = (args.max_results as number) || 3

        try {
            await uiuxDatabase.initialize()

            // 如果指定了 stack，搜索技术栈指南
            if (stack) {
                // 验证 stack 类型
                const validStacks = ['html-tailwind', 'react', 'nextjs', 'vue', 'svelte', 'swiftui', 'react-native', 'flutter'] as const
                const techStack = (validStacks as readonly string[]).includes(stack) ? stack as import('./uiux').TechStack : 'react'

                const result = await uiuxDatabase.searchStack(query, techStack, maxResults)
                if (result.count === 0) {
                    return {
                        success: true,
                        result: `No ${stack} guidelines found for "${query}". Try different keywords.`
                    }
                }
                return {
                    success: true,
                    result: formatUiuxResults(result),
                    richContent: [{
                        type: 'json' as const,
                        text: JSON.stringify(result, null, 2),
                        title: `${stack} Guidelines: ${query}`,
                    }],
                }
            }

            // 否则搜索域数据
            // 验证 domain 类型
            const validDomains = ['style', 'color', 'typography', 'chart', 'landing', 'product', 'ux', 'prompt'] as const
            const uiuxDomain = domain && (validDomains as readonly string[]).includes(domain) ? domain as import('./uiux').UiuxDomain : undefined

            const result = await uiuxDatabase.search(query, uiuxDomain, maxResults)
            if (result.count === 0) {
                return {
                    success: true,
                    result: `No ${result.domain} results found for "${query}". Try different keywords or specify a different domain.`
                }
            }

            return {
                success: true,
                result: formatUiuxResults(result),
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(result, null, 2),
                    title: `UI/UX ${result.domain}: ${query}`,
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `UI/UX search failed: ${toAppError(err).message}`,
            }
        }
    },

    async uiux_recommend(args) {
        const { uiuxDatabase } = await import('./uiux')

        const productType = args.product_type as string

        try {
            await uiuxDatabase.initialize()
            const recommendation = await uiuxDatabase.getRecommendation(productType)

            if (!recommendation.product) {
                return {
                    success: true,
                    result: `No product type found matching "${productType}". Try: saas, e-commerce, fintech, healthcare, gaming, portfolio, etc.`,
                }
            }

            const result = formatRecommendation(productType, recommendation)

            return {
                success: true,
                result,
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(recommendation, null, 2),
                    title: `Design Recommendation: ${productType}`,
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `UI/UX recommendation failed: ${toAppError(err).message}`,
            }
        }
    },

    async remember(args, _ctx) {
        const content = normalizeMemoryContentInput(args.content)
        if (!content) return { success: false, result: '', error: 'Missing content' }

        try {
            await memoryService.addMemory(content)
            return {
                success: true,
                result: `Successfully remembered: ${content}`,
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Failed to remember: ${toAppError(err).message}`,
            }
        }
    },

    async apply_skill(args, _ctx) {
        const skillName = args.skill_name as string
        if (!skillName) return { success: false, result: '', error: 'Missing skill_name' }

        try {
            const skill = await skillService.getSkillByName(skillName)
            if (!skill) {
                return {
                    success: false,
                    result: '',
                    error: `Skill "${skillName}" not found. Check available skills in the system prompt.`,
                }
            }

            // skill 安装目录
            const installPath = skill.filePath.replace(/[/\\]SKILL\.md$/i, '')
            const isWin = platform.isWindows
            const normalizedPath = isWin ? installPath.replace(/\//g, '\\') : installPath

            // 扫描 skill 目录下的所有文件，让 AI 知道有哪些脚本可用
            let fileTree = ''
            try {
                const items = await api.file.readDir(installPath)
                if (items && items.length > 0) {
                    const listFiles = async (dir: string, prefix: string): Promise<string[]> => {
                        const entries = await api.file.readDir(dir)
                        if (!entries) return []
                        const lines: string[] = []
                        for (const entry of entries) {
                            if (entry.name === 'SKILL.md' || entry.name.startsWith('.') || entry.name === 'node_modules') continue
                            const entryPath = `${dir}${isWin ? '\\' : '/'}${entry.name}`
                            if (entry.isDirectory) {
                                lines.push(`${prefix}${entry.name}/`)
                                lines.push(...await listFiles(entryPath, prefix + '  '))
                            } else {
                                lines.push(`${prefix}${entry.name}`)
                            }
                        }
                        return lines
                    }
                    const tree = await listFiles(installPath, '  ')
                    if (tree.length > 0) {
                        fileTree = `\n\n## Skill Directory Contents\n\`\`\`\n${normalizedPath}/\n${tree.join('\n')}\n\`\`\``
                    }
                }
            } catch {
                // 扫描失败不影响主流程
            }

            const scriptHint = isWin
                ? `On Windows: use \`node\` for .js, \`python\` for .py, \`cmd /c\` for .bat/.cmd`
                : `Use \`bash\` for .sh, \`node\` for .js, \`python\` for .py`

            const result = [
                `<skill name="${skill.name}" path="${normalizedPath}">`,
                skill.content,
                `</skill>`,
                fileTree,
                ``,
                `## Execution Guidelines`,
                `- **Working Directory (CRITICAL)**: Set \`cwd\` to \`${normalizedPath}\` for ALL shell commands from this skill`,
                `- **Scripts**: If the skill references scripts or commands, execute them from the skill directory. ${scriptHint}`,
                `- **Relative Paths**: All relative paths in the skill instructions are relative to \`${normalizedPath}\``,
            ].join('\n')

            return { success: true, result }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Failed to load skill: ${toAppError(err).message}`,
            }
        }
    },

    async todo_write(args) {
        const todos = args.todos as Array<{ content: string; status: string; activeForm: string }>
        if (!Array.isArray(todos)) {
            return { success: false, result: '', error: 'todos must be an array' }
        }

        const store = agentStoreTodoBridge

        // 空数组 = 归档清空
        if (todos.length === 0) {
            store.setTodos([])
            return { success: true, result: 'Task list cleared' }
        }

        // 验证格式
        for (const todo of todos) {
            if (!todo.content || !todo.status || !todo.activeForm) {
                return { success: false, result: '', error: 'Each todo must have content, status, and activeForm' }
            }
            if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
                return { success: false, result: '', error: `Invalid status: ${todo.status}` }
            }
        }

        // 存储到当前线程状态
        store.setTodos(
            todos.map(t => ({
                content: t.content,
                status: t.status as 'pending' | 'in_progress' | 'completed',
                activeForm: t.activeForm,
            }))
        )

        // 返回摘要
        const completed = todos.filter(t => t.status === 'completed').length
        const inProgress = todos.find(t => t.status === 'in_progress')
        const allCompleted = todos.every(t => t.status === 'completed')
        const summary = allCompleted
            ? `All ${todos.length} tasks completed. Call todo_write with empty array [] to clear the list.`
            : `Task list updated (${completed}/${todos.length} completed)` +
              (inProgress ? `. Currently: ${inProgress.activeForm}` : '')
        return { success: true, result: summary }
    },

    async task(args, ctx) {
        const { SubAgentManager } = await import('@/renderer/agent/orchestration')
        const llmConfig = useStore.getState().llmConfig
        if (!llmConfig) {
            return { success: false, result: '', error: 'No LLM config available to spawn sub-agent' }
        }
        const parentAssistantId = ctx.currentAssistantId ?? ctx.assistantId
        const bindSubAgent = (info: { subAgentId: string; threadId: string; requestId: string; startedAt: number }) => {
            if (!parentAssistantId || !ctx.toolCallId || !ctx.threadId) return
            const currentMeta = args._meta && typeof args._meta === 'object'
                ? args._meta as Record<string, unknown>
                : {}
            useAgentStore.getState().updateToolCall(parentAssistantId, ctx.toolCallId, {
                arguments: {
                    ...args,
                    _meta: {
                        ...currentMeta,
                        subAgentId: info.subAgentId,
                        subAgentThreadId: info.threadId,
                        subAgentRequestId: info.requestId,
                        subAgentStartedAt: info.startedAt,
                    },
                },
            }, ctx.threadId)
        }

        const result = await SubAgentManager.spawn(
            {
                description: args.description as string,
                context: args.prompt as string,
                constraints: args.enable_write_tools
                    ? undefined
                    : ['Read-only mode: do NOT modify any files or run commands that change state.'],
                writeCapable: Boolean(args.enable_write_tools),
                concurrent: Boolean(args.parallel),
            },
            llmConfig,
            ctx.workspacePath,
            ctx.chatMode,
            ctx.threadId,
            { onStarted: bindSubAgent },
        )
        // 车道保留下来时任务本身是成功的（success=true），但改动还在分支上没合并。
        // 这件事必须写进 result 文本里：meta 模型读不到，不说它就会以为文件已经落地。
        const pendingLane = result.success && result.worktree && laneNeedsRecovery(result.worktree)
            ? `\n\nNote: these changes were made on branch ${result.worktree.branch} and could NOT be merged automatically${
                result.worktree.conflicts?.length ? ` (conflicting files: ${result.worktree.conflicts.join(', ')})` : ''
            }. They are not present in the working tree; the user has to retry the merge or discard the branch from the lane panel on this task card.`
            : ''
        return {
            success: result.success,
            result: (result.success
                ? result.output ?? 'Sub-agent completed with no output.'
                : result.error ?? 'Sub-agent failed.') + pendingLane,
            meta: {
                subAgentId: result.subAgentId,
                subAgentThreadId: result.threadId,
                subAgentStatus: result.success ? 'completed' : 'failed',
                subAgentDurationMs: result.durationMs,
                worktree: result.worktree,
            },
        }
    },
}


export const toolExecutors = Object.fromEntries(
    Object.entries(rawToolExecutors).map(([name, executor]) => [
        name,
        async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
            const timeoutMs = getAgentConfig().toolTimeoutMs
            let timer: ReturnType<typeof setTimeout>

            try {
                // SubAgentManager owns task cancellation and its five-minute lifecycle timeout.
                // Applying the generic tool timeout here would terminate healthy sub-agents early.
                if (name === 'task' || name === 'run_command') return await executor(args, ctx)
                return await Promise.race([
                    executor(args, ctx),
                    new Promise<ToolExecutionResult>((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`Tool [${name}] execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
                    })
                ]).finally(() => clearTimeout(timer))
            } catch (err) {
                logger.agent.error(`[ToolExecutor] Error executing ${name}:`, err)
                return {
                    success: false,
                    result: '',
                    error: `Tool execution error: ${toAppError(err).message}`
                }
            }
        }
    ])
) as Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>>

/**
 * 初始化工具注册表
 * 注意：每次调用都会更新 globalExecutors，支持热重载
 */
export async function initializeTools(): Promise<void> {
    // 每次都调用 registerAll 以更新 globalExecutors（支持热重载）
    // registerAll 内部会更新 globalExecutors 引用
    toolRegistry.registerAll(toolExecutors)
}
