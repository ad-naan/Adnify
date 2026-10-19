/**
 * Dojo 项目目录树 —— 轻量版
 *
 * 训练模式下学员需要"掌握项目全貌"：知道自己在哪个文件里干活。
 * 与 ExplorerView 的 VirtualFileTree 相比，这里刻意砍掉增删改/右键/拖拽
 * （那些是 Agent 模式的生产力工具），只保留：浏览、展开、点击打开、
 * 步骤文件高亮。复用 directoryCacheService 的目录缓存。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import type { FileItem } from '@shared/types'
import { t, asLanguage } from '@shared/i18n'
import { directoryCacheService } from '@/renderer/services/directoryCacheService'
import FileIcon from '@/renderer/components/common/FileIcon'

const IGNORED_NAMES = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.turbo',
  '.cache', 'coverage', '.venv', '__pycache__', '.DS_Store',
])

interface DojoFileTreeProps {
  workspacePath: string
  /** 当前步骤涉及的文件（相对路径），高亮为紫点 */
  stepFiles: string[]
  /** 当前打开的文件（相对路径） */
  activeFile: string
  onOpenFile: (relativePath: string) => void
  /** 外部信号：保存/验收后刷新目录（目录可能新建了文件） */
  refreshTick?: number
  /** UI 语言（i18n） */
  language: string
}

/** 把绝对路径转为相对工作区的正斜杠路径 */
function toRelative(workspacePath: string, absolutePath: string): string {
  const normalizedRoot = workspacePath.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const normalized = absolutePath.replace(/\\/g, '/')
  if (normalized.startsWith(`${normalizedRoot}/`)) return normalized.slice(normalizedRoot.length + 1)
  return normalized
}

function sortItems(items: FileItem[]): FileItem[] {
  return [...items]
    .filter(item => !IGNORED_NAMES.has(item.name))
    .sort((a, b) => (a.isDirectory === b.isDirectory)
      ? a.name.localeCompare(b.name)
      : (a.isDirectory ? -1 : 1))
}

export function DojoFileTree({ workspacePath, stepFiles, activeFile, onOpenFile, refreshTick = 0, language }: DojoFileTreeProps) {
  const lang = asLanguage(language)
  const [children, setChildren] = useState<Map<string, FileItem[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const stepFileSet = useMemo(() => new Set(stepFiles.map(file => file.replace(/\\/g, '/'))), [stepFiles])

  const loadDirectory = useCallback(async (dirPath: string, force = false) => {
    try {
      const items = await directoryCacheService.getDirectory(dirPath, force)
      setChildren(prev => {
        const next = new Map(prev)
        next.set(dirPath, sortItems(items))
        return next
      })
      setFailed(false)
    } catch {
      if (dirPath === workspacePath) setFailed(true)
    }
  }, [workspacePath])

  // 根目录加载 + 刷新信号
  useEffect(() => {
    if (!workspacePath) return
    setLoading(true)
    void loadDirectory(workspacePath, refreshTick > 0).finally(() => setLoading(false))
  }, [workspacePath, refreshTick, loadDirectory])

  // 「我在哪」：打开的文件若藏在折叠目录里，自动展开它的祖先目录
  useEffect(() => {
    if (!workspacePath || !activeFile) return
    const segments = activeFile.replace(/\\/g, '/').split('/').filter(Boolean)
    if (segments.length < 2) return

    const root = workspacePath.replace(/[\\/]+$/, '')
    const sep = workspacePath.includes('\\') ? '\\' : '/'
    const ancestors: string[] = []
    let cursor = root
    for (const segment of segments.slice(0, -1)) {
      cursor = `${cursor}${sep}${segment}`
      ancestors.push(cursor)
    }

    setExpanded(prev => {
      let changed = false
      const next = new Set(prev)
      for (const dir of ancestors) {
        if (!next.has(dir)) {
          next.add(dir)
          changed = true
        }
      }
      return changed ? next : prev
    })

    for (const dir of ancestors) {
      if (!children.has(dir)) void loadDirectory(dir)
    }
  }, [activeFile, workspacePath, children, loadDirectory])

  const toggleFolder = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else {
        next.add(path)
        if (!children.has(path)) void loadDirectory(path)
      }
      return next
    })
  }, [children, loadDirectory])

  const handleRefresh = useCallback(() => {
    if (!workspacePath) return
    setChildren(new Map())
    void loadDirectory(workspacePath, true)
    // 已展开的目录也强制刷新
    for (const path of expanded) void loadDirectory(path, true)
  }, [workspacePath, expanded, loadDirectory])

  const renderItems = (items: FileItem[], depth: number): ReactNode[] =>
    items.flatMap(item => {
      const relative = toRelative(workspacePath, item.path)
      const isExpanded = expanded.has(item.path)
      const inStep = stepFileSet.has(relative)
      const isActive = activeFile === relative

      const row = (
        <button
          key={item.path}
          type="button"
          onClick={() => {
            if (item.isDirectory) toggleFolder(item.path)
            else onOpenFile(relative)
          }}
          title={relative}
          style={{ paddingLeft: 8 + depth * 12 }}
          className={`flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs transition-colors ${
            isActive
              ? 'bg-accent/15 text-accent'
              : inStep
                ? 'text-text-primary hover:bg-surface-hover'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
          }`}
        >
          {item.isDirectory ? (
            <>
              <ChevronRight
                size={12}
                className={`shrink-0 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
              <FileIcon filename={item.name} isDirectory isOpen={isExpanded} size={13} />
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <FileIcon filename={item.name} size={13} />
            </>
          )}
          <span className="truncate">{item.name}</span>
          {inStep && !isActive && (
            <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          )}
        </button>
      )

      if (item.isDirectory && isExpanded) {
        const childItems = children.get(item.path)
        return [
          row,
          childItems === undefined
            ? <div key={`${item.path}:loading`} style={{ paddingLeft: 20 + depth * 12 }} className="py-0.5 text-[10px] text-text-muted">…</div>
            : renderItems(childItems, depth + 1),
        ]
      }
      return [row]
    })

  if (!workspacePath) {
    return <p className="px-3 py-2 text-[11px] text-text-muted">{t('dojo.treeEmpty', lang)}</p>
  }

  const rootItems = children.get(workspacePath)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {t('dojo.projectTree', lang)}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          title={t('dojo.treeRefresh', lang)}
          aria-label={t('dojo.treeRefresh', lang)}
          className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {failed
          ? <p className="px-2 py-2 text-[11px] text-red-400">{t('dojo.treeLoadFailed', lang)}</p>
          : rootItems === undefined
            ? <p className="px-2 py-2 text-[11px] text-text-muted">{t('dojo.treeLoading', lang)}</p>
            : renderItems(rootItems, 0)}
      </div>
    </div>
  )
}
