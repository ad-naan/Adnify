/**
 * LSP 状态指示器
 * 显示在状态栏右下角，点击可安装 LSP 服务器 / 选择语言运行时环境
 */

import { useState, useEffect, useCallback } from 'react'
import { ZapOff, Download, Loader2, CheckCircle2, FolderOpen } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '@/renderer/services/electronAPI'
import { getLanguageId, isLanguageSupported } from '@/renderer/services/lspService'
import BottomBarPopover from '../ui/BottomBarPopover'
import { logger } from '@shared/utils/Logger'
import { toast } from '../common/ToastProvider'
import { t } from '@shared/i18n'

interface LspServerStatus {
  installed: boolean
  path?: string
}

// 语言到服务器类型的映射
const LANGUAGE_TO_SERVER: Record<string, string> = {
  typescript: 'typescript',
  typescriptreact: 'typescript',
  javascript: 'typescript',
  javascriptreact: 'typescript',
  html: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  jsonc: 'json',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'jdtls',
  c: 'clangd',
  cpp: 'clangd',
  vue: 'vue',
  php: 'php',
}

// 服务器显示名称
const SERVER_NAMES: Record<string, string> = {
  typescript: 'TypeScript Language Server',
  html: 'HTML Language Server',
  css: 'CSS Language Server',
  json: 'JSON Language Server',
  python: 'Pyright (Python)',
  go: 'gopls (Go)',
  rust: 'rust-analyzer',
  jdtls: 'Eclipse JDT LS (Java)',
  clangd: 'clangd (C/C++)',
  vue: 'Vue Language Server',
  php: 'Intelephense (PHP)',
}

// 安装说明
const INSTALL_HINTS: Record<string, { auto: boolean; hint: string; builtin?: boolean }> = {
  typescript: { auto: true, hint: '可自动安装' },
  html: { auto: true, hint: '可自动安装' },
  css: { auto: true, hint: '可自动安装' },
  json: { auto: true, hint: '可自动安装' },
  python: { auto: true, hint: '可自动安装 Pyright' },
  go: { auto: true, hint: '需要系统已安装 Go' },
  rust: { auto: false, hint: '请运行: rustup component add rust-analyzer' },
  jdtls: { auto: true, hint: '可自动安装，需要 JDK 21+' },
  clangd: { auto: false, hint: '请安装 LLVM/Clang' },
  vue: { auto: true, hint: '可自动安装' },
  php: { auto: true, hint: '可自动安装 Intelephense' },
}

// 需要运行时环境选择的语言（有解释器/SDK 路径概念的语言）
const LANGUAGES_WITH_RUNTIME = new Set([
  'python', 'go', 'rust', 'c', 'cpp', 'csharp', 'java', 'ruby', 'php',
])

export default function LspStatusIndicator() {
  const { activeFilePath, language, workspacePath } = useStore(useShallow(s => ({ activeFilePath: s.activeFilePath, language: s.language, workspacePath: s.workspacePath })))
  const [serverStatus, setServerStatus] = useState<Record<string, LspServerStatus>>({})
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [currentLanguageId, setCurrentLanguageId] = useState<string | null>(null)
  const [runtimePath, setRuntimePath] = useState<string | null>(null)

  // 获取当前文件的语言 ID
  useEffect(() => {
    if (activeFilePath) {
      const langId = getLanguageId(activeFilePath)
      setCurrentLanguageId(langId)
    } else {
      setCurrentLanguageId(null)
    }
  }, [activeFilePath])

  // 获取服务器状态
  useEffect(() => {
    api.lsp.getServerStatus().then(setServerStatus).catch((e) => logger.lsp.warn('Failed to get LSP server status:', e))
  }, [])

  // 获取当前语言的运行时路径
  useEffect(() => {
    if (workspacePath && currentLanguageId) {
      api.lsp.resolveRuntimePath(workspacePath, currentLanguageId)
        .then(setRuntimePath)
        .catch(() => setRuntimePath(null))
    } else {
      setRuntimePath(null)
    }
  }, [workspacePath, currentLanguageId])

  // 安装服务器
  const handleInstall = useCallback(async (serverType: string) => {
    setInstalling(prev => { const next = new Set(prev); next.add(serverType); return next })
    try {
      const result = await api.lsp.installServer(serverType)
      if (result.success) {
        // 局部更新当前服务器状态，避免全量重载导致状态闪烁
        const sharedIds = ['html', 'css', 'json']
        const idsToUpdate = sharedIds.includes(serverType) ? sharedIds : [serverType]
        setServerStatus(prev => {
          const next = { ...prev }
          for (const id of idsToUpdate) {
            next[id] = { installed: true, path: result.path }
          }
          return next
        })
      } else {
        logger.lsp.error('Install failed:', result.error)
        const message = result.error || 'Installation failed'
        toast.error(t('common.languageServerInstallationFailed', language), message)
      }
    } catch (error) {
      logger.lsp.error('Install error:', error)
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('common.languageServerInstallationFailed', language), message)
    } finally {
      setInstalling(prev => { const next = new Set(prev); next.delete(serverType); return next })
    }
  }, [language])

  // 选择运行时路径
  const handleSelectRuntime = useCallback(async () => {
    if (!workspacePath || !currentLanguageId) return
    const selected = await api.file.selectFolder()
    if (!selected) return

    await api.lsp.setLanguageEnv(workspacePath, currentLanguageId, selected)
    setRuntimePath(selected)
  }, [workspacePath, currentLanguageId])

  // 清除手动配置（恢复自动检测）
  const handleResetRuntime = useCallback(async () => {
    if (!workspacePath || !currentLanguageId) return
    await api.lsp.removeLanguageEnv(workspacePath, currentLanguageId)
    // 重新获取自动检测的路径
    const resolved = await api.lsp.resolveRuntimePath(workspacePath, currentLanguageId)
    setRuntimePath(resolved)
  }, [workspacePath, currentLanguageId])

  // 当前语言对应的服务器类型
  const currentServerType = currentLanguageId ? LANGUAGE_TO_SERVER[currentLanguageId] : null
  const isSupported = currentLanguageId ? isLanguageSupported(currentLanguageId) : false
  const currentStatus = currentServerType ? serverStatus[currentServerType] : null
  const isInstalled = currentStatus?.installed ?? false
  const installInfo = currentServerType ? INSTALL_HINTS[currentServerType] : null

  // 如果没有打开文件，完全不显示
  if (!activeFilePath) {
    return null
  }

  const fileExtension = activeFilePath.split('.').pop()?.toUpperCase() || 'TXT'

  const getDisplayName = (id: string | null, ext: string) => {
    switch (id) {
      case 'typescriptreact': return 'TSX'
      case 'javascriptreact': return 'JSX'
      case 'typescript': return 'TypeScript'
      case 'javascript': return 'JavaScript'
      case 'python': return 'Python'
      case 'rust': return 'Rust'
      case 'go': return 'Go'
      case 'java': return 'Java'
      case 'vue': return 'Vue'
      case 'cpp': return 'C++'
      case 'c': return 'C'
      case 'json': return 'JSON'
      case 'html': return 'HTML'
      case 'css': return 'CSS'
      default: return ext
    }
  }

  const displayName = getDisplayName(currentLanguageId, fileExtension)

  // 如果语言不支持 LSP，只显示带透明圆点的文件后缀
  if (!isSupported || !currentServerType) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 h-6 rounded-md transition-colors cursor-default hidden sm:flex opacity-60">
        <div className="flex items-center justify-center w-4 h-4 text-text-muted font-mono text-[10px] font-bold">
          {'{}'}
        </div>
        <span className="text-[10px] uppercase font-medium tracking-widest text-text-muted transition-colors">
          {displayName}
        </span>
      </div>
    )
  }

  return (
    <BottomBarPopover
      icon={
        <div className="flex items-center gap-1.5 px-2 py-1 h-6 rounded-md hover:bg-white/5 transition-colors cursor-pointer group hidden sm:flex">
          <div className="relative flex items-center justify-center w-4 h-4 transition-colors">
            <span className="text-text-muted group-hover:text-text-primary font-mono text-[10px] font-bold transition-colors">
              {'{}'}
            </span>
            {isInstalled ? (
              <span className="absolute -top-[1px] -right-[2px] w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            ) : (
              <span className="absolute -top-[1px] -right-[2px] w-1.5 h-1.5 bg-amber-400 rounded-full shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
            )}
          </div>
          <span className="text-[10px] uppercase font-medium tracking-widest text-text-muted group-hover:text-text-primary transition-colors">
            {displayName}
          </span>
        </div>
      }
      tooltip={
        isInstalled
          ? (t('lspStatusIndicator.lspEnabled', language))
          : (t('lspStatusIndicator.lspNotInstalledClick', language))
      }
      title={t('lspStatusIndicator.lspLanguageServer', language)}
      width={320}
      height={200}
    >
      <div className="p-3 space-y-3">
        {/* 当前语言服务器状态 */}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text-primary">
              {SERVER_NAMES[currentServerType] || currentServerType}
            </div>
            <div className="mt-0.5 truncate text-xs text-text-muted">
              {t('lspStatusIndicator.currentFileLanguage', language)}: {currentLanguageId}
            </div>
          </div>
          <div className={`flex shrink-0 items-center gap-1.5 ${isInstalled ? 'text-green-400' : 'text-yellow-400'}`}>
            {isInstalled ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="text-xs">{t('common.installed', language)}</span>
              </>
            ) : (
              <>
                <ZapOff className="h-4 w-4 shrink-0" />
                <span className="text-xs">{t('lspStatusIndicator.notInstalled', language)}</span>
              </>
            )}
          </div>
        </div>

        {/* 安装按钮或提示 */}
        {!isInstalled && installInfo && (
          <div className="space-y-2">
            <div className="text-xs text-text-muted">
              {installInfo.hint}
            </div>
            {installInfo.auto ? (
              <button
                onClick={() => handleInstall(currentServerType)}
                disabled={installing.has(currentServerType)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-md transition-colors disabled:opacity-50"
              >
                {installing.has(currentServerType) ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('lspStatusIndicator.installing', language)}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>{t('lspStatusIndicator.installLanguageServer', language)}</span>
                  </>
                )}
              </button>
            ) : (
              <div className="text-xs text-orange-400 bg-orange-400/10 px-3 py-2 rounded-md">
                {t('lspStatusIndicator.manualInstallationRequired', language)}
              </div>
            )}
          </div>
        )}

        {/* 已安装时显示路径 + 运行时环境 */}
        {isInstalled && (
          <div className="space-y-2">
            {installInfo?.builtin && (
              <div className="text-xs text-blue-400">
                {t('lspStatusIndicator.builtInLanguageServer', language)}
              </div>
            )}
            {currentStatus?.path && (
              <div className="truncate rounded bg-background-tertiary px-2 py-1.5 font-mono text-xs text-text-muted" title={currentStatus.path}>
                {currentStatus.path}
              </div>
            )}

            {/* 运行时环境选择 */}
            {LANGUAGES_WITH_RUNTIME.has(currentLanguageId || '') && (
              <div className="pt-2 border-t border-border/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">
                    {t('lspStatusIndicator.runtime', language)}
                  </span>
                  <button
                    onClick={handleResetRuntime}
                    className="text-[10px] text-text-muted hover:text-text-primary transition-colors"
                  >
                    {t('lspStatusIndicator.autoDetect', language)}
                  </button>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="min-w-0 flex-1 truncate rounded bg-background-tertiary px-2 py-1.5 font-mono text-xs text-text-primary" title={runtimePath || ''}>
                    {runtimePath || (t('lspStatusIndicator.notDetected', language))}
                  </div>
                  <button
                    onClick={handleSelectRuntime}
                    className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors shrink-0"
                    title={t('lspStatusIndicator.browse', language)}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </BottomBarPopover>
  )
}
