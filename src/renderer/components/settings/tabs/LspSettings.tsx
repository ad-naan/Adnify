/**
 * LSP 设置面板
 * 管理语言服务器的安装、配置和状态
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FolderOpen,
  Download,
  Check,
  X,
  RefreshCw,
  Loader2,
  HardDrive,
  Server,
  AlertCircle,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import { Language } from '@renderer/i18n'
import { api } from '@/renderer/services/electronAPI'
import { Button, Input } from '@components/ui'
import { LSP_SERVER_DEFINITIONS } from '@shared/languages'
import { toast } from '@components/common/ToastProvider'

interface LspSettingsProps {
  language: Language
}

interface ServerStatus {
  installed: boolean
  path?: string
}

export function LspSettings({ language }: LspSettingsProps) {
  const [serverStatus, setServerStatus] = useState<Record<string, ServerStatus>>({})
  const [binDir, setBinDir] = useState('')
  const [defaultBinDir, setDefaultBinDir] = useState('')
  const [customBinDir, setCustomBinDir] = useState('')
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const hasLoadedOnce = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const tt = useCallback(
    (key: string) => {
      const translations: Record<string, Record<string, string>> = {
        lspServers: { en: 'Language Servers', zh: '语言服务器' },
        installPath: { en: 'Installation Path', zh: '安装路径' },
        currentPath: { en: 'Current Path', zh: '当前路径' },
        defaultPath: { en: 'Default Path', zh: '默认路径' },
        customPath: { en: 'Custom Path', zh: '自定义路径' },
        browse: { en: 'Browse', zh: '浏览' },
        apply: { en: 'Apply', zh: '应用' },
        reset: { en: 'Reset to Default', zh: '恢复默认' },
        installed: { en: 'Installed', zh: '已安装' },
        notInstalled: { en: 'Not Installed', zh: '未安装' },
        install: { en: 'Install', zh: '安装' },
        installing: { en: 'Installing...', zh: '安装中...' },
        installAll: { en: 'Install All Basic', zh: '安装基础服务' },
        refresh: { en: 'Refresh', zh: '刷新' },
        supportedLanguages: { en: 'Supported Languages', zh: '支持的语言' },
        pathNote: {
          en: 'Change the installation path to avoid filling up your system drive. Existing servers will not be moved automatically.',
          zh: '更改安装路径可避免占用系统盘空间。已安装的服务器不会自动迁移。',
        },
        installNote: {
          en: 'Language servers provide code intelligence features like auto-completion, go to definition, and diagnostics.',
          zh: '语言服务器提供代码智能功能，如自动补全、跳转定义和诊断。',
        },
        requiresGo: { en: 'Requires Go installed', zh: '需要已安装 Go' },
      }
      return translations[key]?.[language] || key
    },
    [language]
  )

  // 加载状态
  const loadStatus = useCallback(async () => {
    // 首次加载显示 loading spinner，后续刷新静默更新避免闪烁
    if (!hasLoadedOnce.current) {
      setLoading(true)
    }
    setError(null)
    try {
      const [status, currentDir, defaultDir] = await Promise.all([
        api.lsp.getServerStatus(),
        api.lsp.getBinDir(),
        api.lsp.getDefaultBinDir(),
      ])
      setServerStatus(status)
      setBinDir(currentDir)
      setDefaultBinDir(defaultDir)
      // 如果当前路径不是默认路径，说明有自定义路径
      if (currentDir !== defaultDir) {
        setCustomBinDir(currentDir)
      }
      hasLoadedOnce.current = true
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // 安装服务器
  const handleInstall = async (serverId: string) => {
    setInstalling(prev => { const next = new Set(prev); next.add(serverId); return next })
    try {
      const result = await api.lsp.installServer(serverId)
      if (result.success) {
        // 局部更新状态，避免全量重载导致的闪烁和状态丢失
        // html/css/json 共享 vscode-langservers-extracted 包，一个安装成功意味着全部可用
        const sharedIds = ['html', 'css', 'json']
        const idsToUpdate = sharedIds.includes(serverId) ? sharedIds : [serverId]
        setServerStatus(prev => {
          const next = { ...prev }
          for (const id of idsToUpdate) {
            next[id] = { installed: true, path: result.path }
          }
          return next
        })
        const serverName = LSP_SERVER_DEFINITIONS.find(server => server.id === serverId)?.name || serverId
        toast.success(language === 'zh' ? '语言服务器安装成功' : 'Language server installed', serverName)
      } else {
        const message = result.error || 'Installation failed'
        setError(message)
        toast.error(language === 'zh' ? '语言服务器安装失败' : 'Language server installation failed', message)
      }
    } catch (err: any) {
      const message = err?.message || String(err)
      setError(message)
      toast.error(language === 'zh' ? '语言服务器安装失败' : 'Language server installation failed', message)
    } finally {
      setInstalling(prev => { const next = new Set(prev); next.delete(serverId); return next })
    }
  }

  // 安装所有基础服务器
  const handleInstallAll = async () => {
    setInstalling(prev => { const next = new Set(prev); next.add('all'); return next })
    try {
      const result = await api.lsp.installBasicServers()
      if (result.success) {
        // 基础服务器包含 typescript + html/css/json，局部更新它们的状态
        const freshStatus = await api.lsp.getServerStatus()
        setServerStatus(freshStatus)
        toast.success(language === 'zh' ? '基础语言服务器安装成功' : 'Basic language servers installed')
      } else {
        const message = result.error || 'Installation failed'
        setError(message)
        toast.error(language === 'zh' ? '基础语言服务器安装失败' : 'Basic language server installation failed', message)
      }
    } catch (err: any) {
      const message = err?.message || String(err)
      setError(message)
      toast.error(language === 'zh' ? '基础语言服务器安装失败' : 'Basic language server installation failed', message)
    } finally {
      setInstalling(prev => { const next = new Set(prev); next.delete('all'); return next })
    }
  }

  // 选择自定义路径
  const handleBrowse = async () => {
    try {
      const result = await api.file.selectFolder()
      if (result && typeof result === 'string') {
        setCustomBinDir(result)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  // 应用自定义路径
  const handleApplyCustomPath = async () => {
    if (!customBinDir) return
    try {
      const result = await api.lsp.setCustomBinDir(customBinDir)
      if (!result.success) {
        const message = result.error || 'Failed to set language server path'
        setError(message)
        return
      }
      await loadStatus()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // 恢复默认路径
  const handleResetPath = async () => {
    try {
      const result = await api.lsp.setCustomBinDir(null)
      if (!result.success) {
        setError(result.error || 'Failed to reset language server path')
        return
      }
      setCustomBinDir('')
      await loadStatus()
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 安装路径配置 */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">{tt('installPath')}</h3>
        </div>

        <p className="text-xs leading-5 text-text-muted">{tt('pathNote')}</p>

        <div className="space-y-3 rounded-lg border border-border/60 bg-background/25 p-4">
          {/* 当前路径 */}
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wider">{tt('currentPath')}</label>
            <div className="flex items-center gap-2 p-2 bg-background/50 border border-border/50 rounded text-sm text-text-secondary font-mono">
              <FolderOpen className="w-4 h-4 text-accent flex-shrink-0" />
              <span className="truncate">{binDir}</span>
            </div>
          </div>

          {/* 自定义路径输入 */}
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wider">{tt('customPath')}</label>
            <div className="flex gap-2">
              <Input
                value={customBinDir}
                onChange={(e) => setCustomBinDir(e.target.value)}
                placeholder={defaultBinDir}
                className="flex-1 font-mono text-sm bg-background/50 border-border/50 rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
              />
              <Button variant="secondary" size="sm" onClick={handleBrowse}>
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleApplyCustomPath}
              disabled={!customBinDir || customBinDir === binDir}
            >
              {tt('apply')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetPath}
              disabled={binDir === defaultBinDir}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {tt('reset')}
            </Button>
          </div>
        </div>
      </section>

      {/* 语言服务器列表 */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">{tt('lspServers')}</h3>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={loadStatus} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              {tt('refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleInstallAll}
              disabled={installing.size > 0}
            >
              {installing.has('all') ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              {tt('installAll')}
            </Button>
          </div>
        </div>

        <p className="text-xs leading-5 text-text-muted">{tt('installNote')}</p>

        <div className="space-y-2">
          {LSP_SERVER_DEFINITIONS.map((server) => {
            const status = serverStatus[server.id]
            const isInstalled = status?.installed
            const isInstalling = installing.has(server.id)
            const isBuiltin = server.builtin
            const canInstall = server.installable

            return (
              <div
                key={server.id}
                className="flex items-center justify-between p-4 bg-surface/30 rounded-lg border border-border hover:border-border transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{server.name}</span>
                    {isBuiltin && (
                      <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
                        {language === 'zh' ? '内置' : 'Built-in'}
                      </span>
                    )}
                    {isInstalled ? (
                      <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3" />
                        {tt('installed')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-text-muted bg-white/5 px-2 py-0.5 rounded-full">
                        <X className="w-3 h-3" />
                        {tt('notInstalled')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-muted mt-0.5">{server.description}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-text-muted">{tt('supportedLanguages')}:</span>
                    <div className="flex gap-1">
                      {server.displayLanguages.map((lang) => (
                        <span
                          key={lang}
                          className="text-xs px-1.5 py-0.5 bg-accent/10 text-accent rounded"
                        >
                          {lang}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 安装按钮 */}
                {canInstall ? (
                  <Button
                    variant={isInstalled ? 'ghost' : 'secondary'}
                    size="sm"
                    onClick={() => handleInstall(server.id)}
                    disabled={isInstalling || installing.has('all')}
                    className="ml-4"
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        {tt('installing')}
                      </>
                    ) : isInstalled ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-1" />
                        {language === 'zh' ? '重装' : 'Reinstall'}
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-1" />
                        {tt('install')}
                      </>
                    )}
                  </Button>
                ) : (
                  // 不可安装的服务器显示外部链接提示
                  <span className="text-xs text-text-muted flex items-center gap-1 ml-4">
                    <ExternalLink className="w-3 h-3" />
                    {language === 'zh' ? '需手动安装' : 'Manual install'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
