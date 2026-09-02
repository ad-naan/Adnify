/**
 * MCP 设置页面
 * 管理 MCP 服务器配置和状态
 */

import { useState, useEffect } from 'react'
import { logger } from '@shared/utils/Logger'
import {
  Server, RefreshCw, Power, PowerOff, AlertCircle, CheckCircle, Loader2, Wrench, FileText, MessageSquare, FolderOpen, Plus, Trash2, Globe, Key, LogIn, Lightbulb, Import, Check, } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { mcpService } from '@services/mcpService'
import { Button, Modal, Switch } from '@components/ui'
import type { McpServerConfig, McpServerState, McpServerStatus } from '@shared/types/mcp'
import { isRemoteConfig, isLocalConfig } from '@shared/types/mcp'
import { MCP_PRESETS } from '@shared/config/mcpPresets'
import McpAddServerModal, { type McpServerFormData } from './McpAddServerModal'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { ProgressiveReveal } from '../ProgressiveReveal'
import { t, tDynamic } from '@shared/i18n'

interface McpSettingsProps {
  language: 'en' | 'zh'
  mcpConfig: { autoConnect?: boolean }
  setMcpConfig: (config: { autoConnect?: boolean }) => void
  onOpenFile: (path: string, options?: { initialContent?: string }) => Promise<boolean>
}

const EMPTY_MCP_CONFIG = `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`

export default function McpSettings({ language, mcpConfig, setMcpConfig, onOpenFile }: McpSettingsProps) {
  const { mcpServers, mcpLoading, mcpError } = useStore(useShallow(s => ({ mcpServers: s.mcpServers, mcpLoading: s.mcpLoading, mcpError: s.mcpError })))
  const [configPaths, setConfigPaths] = useState<{ user: string; workspace: string[] } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [externalConfigs, setExternalConfigs] = useState<McpServerConfig[]>([])
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set())
  const [importLevel, setImportLevel] = useState<'user' | 'workspace'>('user')
  const [importLoading, setImportLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // 追踪正在等待浏览器授权的服务器（OAuth pending）
  const [oauthPendingServers, setOauthPendingServers] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadConfigPaths()
  }, [])

  // 当服务器状态变为 connected/error/disconnected/needs_auth 时，清除 OAuth pending 标记
  useEffect(() => {
    setOauthPendingServers(prev => {
      if (prev.size === 0) return prev
      const next = new Set(prev)
      let changed = false
      for (const serverId of prev) {
        const server = mcpServers.find(s => s.id === serverId)
        if (!server || server.status === 'connected' || server.status === 'error' || server.status === 'needs_auth') {
          next.delete(serverId)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [mcpServers])

  const loadConfigPaths = async () => {
    const paths = await mcpService.getConfigPaths()
    setConfigPaths(paths)
  }

  const handleReloadConfig = async () => {
    setActionLoading('reload')
    await mcpService.reloadConfig()
    setActionLoading(null)
  }

  const handleConnectServer = async (serverId: string) => {
    setActionLoading(serverId)
    await mcpService.connectServer(serverId)
    setActionLoading(null)
  }

  const handleDisconnectServer = async (serverId: string) => {
    setActionLoading(serverId)
    await mcpService.disconnectServer(serverId)
    setActionLoading(null)
  }

  const handleRefreshCapabilities = async (serverId: string) => {
    setActionLoading(`refresh-${serverId}`)
    await mcpService.refreshCapabilities(serverId)
    setActionLoading(null)
  }

  const handleAddServer = async (config: McpServerFormData): Promise<boolean> => {
    try {
      const success = await mcpService.addServer(config, config.saveLevel)
      if (success) {
        await mcpService.reloadConfig()
      }
      return success
    } catch (err) {
      logger.settings.error('Failed to add server:', err)
      return false
    }
  }

  const externalKey = (config: McpServerConfig) => `${config.sourcePath || ''}::${config.id}`

  const handleOpenImport = async () => {
    setShowImportModal(true)
    setImportLoading(true)
    setSelectedImports(new Set())
    setExternalConfigs(await mcpService.discoverExternalConfigs())
    setImportLoading(false)
  }

  const handleImportSelected = async () => {
    setImportLoading(true)
    let imported = 0
    for (const config of externalConfigs) {
      if (!selectedImports.has(externalKey(config)) || !config.sourcePath || !config.sourceProvider) continue
      const {
        source: _source,
        sourcePath,
        sourceProvider,
        shadowedSources: _shadowedSources,
        importedFrom: _importedFrom,
        ...localConfig
      } = config
      const success = await mcpService.addServer({
        ...localConfig,
        importedFrom: { provider: sourceProvider, path: sourcePath, importedAt: Date.now() },
      }, importLevel)
      if (success) imported++
    }
    if (imported > 0) await mcpService.reloadConfig()
    setImportLoading(false)
    setShowImportModal(false)
    setActionError(imported === selectedImports.size ? null : (t('mcpSettings.someConfigsCouldNot', language)))
  }

  const handleDeleteServer = async (server: McpServerState) => {
    setActionLoading(`delete-${server.id}`)
    setActionError(null)
    try {
      const success = await mcpService.removeServer(server.id, server.config.source, server.config.sourcePath)
      if (success) {
        await mcpService.reloadConfig()
        setDeleteConfirm(null)
      } else {
        setActionError(t('mcpSettings.deleteFailedCouldNot', language, { id: server.id }))
      }
    } catch (err) {
      logger.settings.error('Failed to delete server:', err)
      setActionError(t('mcpSettings.deleteFailedTheSource', language))
    }
    setActionLoading(null)
  }

  const handleToggleServer = async (server: McpServerState, disabled: boolean) => {
    setActionLoading(`toggle-${server.id}`)
    setActionError(null)
    try {
      const success = await mcpService.toggleServer(server.id, disabled, server.config.source, server.config.sourcePath)
      if (success) {
        await mcpService.reloadConfig()
      } else {
        setActionError(t('mcpSettings.updateFailedTheSource', language, { id: server.id }))
      }
    } catch (err) {
      logger.settings.error('Failed to toggle server:', err)
      setActionError(t('mcpSettings.updateFailedCheckThe', language))
    }
    setActionLoading(null)
  }

  const getProviderLabel = (provider: McpServerState['config']['sourceProvider']) => {
    const labels = {
      adnify: 'Adnify',
      'claude-desktop': 'Claude Desktop',
      'claude-code': 'Claude Code',
      codex: 'Codex',
      cursor: 'Cursor',
      vscode: 'VS Code',
      generic: t('mcpSettings.generic', language),
    }
    return provider ? labels[provider] : (t('mcpSettings.unknown', language))
  }

  const getStatusIcon = (status: McpServerStatus) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'connecting':
        return <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      case 'needs_auth':
        return <Key className="w-4 h-4 text-orange-500" />
      case 'needs_registration':
        return <LogIn className="w-4 h-4 text-orange-500" />
      default:
        return <PowerOff className="w-4 h-4 text-text-muted" />
    }
  }

  const getStatusText = (status: McpServerStatus) => {
    const texts: Record<McpServerStatus, string> = {
      connected: t('mcpSettings.connected', language),
      connecting: t('mcpSettings.connecting', language),
      error: t('toolError', language),
      disconnected: t('mcpSettings.disconnected', language),
      needs_auth: t('mcpSettings.authRequired', language),
      needs_registration: t('mcpSettings.registrationRequired', language),
    }
    return texts[status]
  }

  const handleStartOAuth = async (serverId: string) => {
    setActionLoading(`oauth-${serverId}`)
    try {
      await mcpService.startOAuth(serverId)
      // 标记为等待浏览器授权状态
      setOauthPendingServers(prev => new Set(prev).add(serverId))
    } catch (err) {
      logger.settings.error('Failed to start OAuth:', err)
    }
    setActionLoading(null)
  }

  const handleCancelOAuth = async (serverId: string) => {
    setOauthPendingServers(prev => { const s = new Set(prev); s.delete(serverId); return s })
    await mcpService.disconnectServer(serverId)
  }

  const renderServerCard = (server: McpServerState) => {
    const isLoading = actionLoading?.startsWith(server.id) || actionLoading === `refresh-${server.id}` || actionLoading === `oauth-${server.id}`
    const isDeleting = actionLoading === `delete-${server.id}`
    const showDeleteConfirm = deleteConfirm === server.id
    const isRemote = server.config.type === 'remote'
    const isOAuthPending = oauthPendingServers.has(server.id)
    const providerLabel = getProviderLabel(server.config.importedFrom?.provider || server.config.sourceProvider)

    // 通过 presetId 查找预设获取使用示例
    const presetId = server.config.presetId
    const preset = presetId ? MCP_PRESETS.find(p => p.id === presetId) : undefined
    const usageExamples = preset?.usageExamples?.map(example => tDynamic(example, language, example))

    return (
      <div
        key={server.id}
        className={`rounded-xl border transition-all duration-300 relative group overflow-hidden ${
          server.config.disabled
            ? 'bg-surface/5 border-border/50 opacity-60 grayscale'
            : 'bg-surface/70 border-border hover:border-accent/30 hover:bg-surface/80 hover:shadow-md hover:shadow-accent/5'
        }`}
      >
        {/* Active Pulse Glow */}
        {!server.config.disabled && server.status === 'connected' && (
          <div className="settings-glow absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-[60px] pointer-events-none -translate-y-1/2 translate-x-1/2" />
        )}

        {/* Header */}
        <div className="flex items-start justify-between p-5">
          <div className="flex min-w-0 flex-1 gap-4">
            <div className="relative">
              <div className={`p-2.5 rounded-xl ${server.config.disabled ? 'bg-white/5' : isRemote ? 'bg-blue-500/10' : 'bg-accent/10'}`}>
                {isRemote ? (
                  <Globe className={`w-6 h-6 ${server.config.disabled ? 'text-text-muted' : 'text-blue-400'}`} />
                ) : (
                  <Server className={`w-6 h-6 ${server.config.disabled ? 'text-text-muted' : 'text-accent'}`} />
                )}
              </div>
              {/* Status Dot */}
              {!server.config.disabled && (
                <div className="absolute -bottom-1 -right-1 p-0.5 bg-background rounded-full">
                  <div className={`w-2.5 h-2.5 rounded-full border-2 border-background ${
                    server.status === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
                    server.status === 'error' ? 'bg-red-500' :
                    server.status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                    'bg-text-muted'
                  }`} />
                </div>
              )}
            </div>
            
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2.5">
                <h4 className="text-base font-bold text-text-primary tracking-tight">{server.config.name}</h4>
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-accent/10 text-accent border-accent/20 tracking-tight">
                  {server.config.importedFrom ? (t('mcpSettings.from', language, { providerLabel })) : 'Adnify'}
                </span>
                {server.config.source && (
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border uppercase tracking-tight ${
                    server.config.source === 'workspace'
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                  }`}>
                    {server.config.source === 'workspace' ? (t('common.project', language)) : (t('common.global', language))}
                  </span>
                )}
                {isRemote && (
                  <span className="px-1.5 py-0.5 text-[9px] font-bold bg-blue-500/10 text-blue-400 rounded border border-blue-500/20 uppercase tracking-tight">
                    Remote
                  </span>
                )}
              </div>
              <div className="text-xs text-text-muted mt-1.5 font-mono truncate max-w-[300px] opacity-70 bg-black/20 px-2 py-0.5 rounded w-fit">
                {isRemote
                  ? ('url' in server.config ? server.config.url : '')
                  : `${'command' in server.config ? server.config.command : ''} ...`
                }
              </div>
              {server.config.sourcePath && (
                <div
                  className="mt-2 max-w-[520px] truncate text-[11px] text-text-muted/80 font-mono"
                  title={server.config.sourcePath}
                >
                  {t('mcpSettings.source', language)}{server.config.sourcePath}
                </div>
              )}
              {server.config.importedFrom && (
                <div
                  className="mt-1 max-w-[520px] truncate text-[10px] text-accent/70 font-mono"
                  title={server.config.importedFrom.path}
                >
                  {t('common.originallyImported', language)}{server.config.importedFrom.path}
                </div>
              )}
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center gap-3 ml-4">
            {/* Status */}
            {!server.config.disabled && (
              <div className="flex items-center gap-2">
                {getStatusIcon(server.status)}
                <span className="text-sm text-text-secondary">{getStatusText(server.status)}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1">
              {/* OAuth waiting state */}
              {!server.config.disabled && isOAuthPending && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                  <span className="text-xs text-orange-400">
                    {t('common.waitingForBrowser', language)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancelOAuth(server.id)}
                    title={t('cancel', language)}
                    className="text-text-muted hover:text-red-400 text-xs"
                  >
                    {t('cancel', language)}
                  </Button>
                </div>
              )}

              {/* OAuth Button for remote servers needing auth */}
              {!server.config.disabled && !isOAuthPending && (server.status === 'needs_auth' || server.status === 'needs_registration') && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleStartOAuth(server.id)}
                  disabled={isLoading}
                  title={t('mcpSettings.startAuthentication', language)}
                >
                  <Key className="w-4 h-4 mr-1" />
                  {t('mcpSettings.auth', language)}
                </Button>
              )}

              {!server.config.disabled && server.status === 'connected' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRefreshCapabilities(server.id)}
                    disabled={isLoading}
                    title={t('mcpSettings.refreshCapabilities', language)}
                  >
                    <RefreshCw className={`w-4 h-4 ${actionLoading === `refresh-${server.id}` ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDisconnectServer(server.id)}
                    disabled={isLoading}
                    title={t('mcpSettings.disconnect', language)}
                  >
                    <PowerOff className="w-4 h-4" />
                  </Button>
                </>
              )}
              {!server.config.disabled && server.status === 'connecting' && (
                <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
              )}
              {!server.config.disabled && server.status !== 'connected' && server.status !== 'connecting' && server.status !== 'needs_auth' && server.status !== 'needs_registration' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleConnectServer(server.id)}
                  disabled={isLoading}
                  title={t('mcpSettings.connect', language)}
                >
                  <Power className="w-4 h-4" />
                </Button>
              )}

              {/* Toggle Enable/Disable */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleToggleServer(server, !server.config.disabled)}
                disabled={isLoading}
                title={server.config.disabled 
                  ? (t('common.enable', language))
                  : (t('common.disable', language))
                }
              >
                {server.config.disabled ? (
                  <Power className="w-4 h-4 text-green-500" />
                ) : (
                  <PowerOff className="w-4 h-4 text-text-muted" />
                )}
              </Button>

              {/* Delete */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirm(server.id)}
                disabled={isLoading}
                title={t('delete', language)}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Delete Confirmation */}
        {showDeleteConfirm && (
          <div className="px-4 pb-4">
            <div className="flex flex-col gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="text-sm font-semibold text-red-300">
                  {t('mcpSettings.deleteTheAdnifyConfig', language)}
                </div>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {server.config.importedFrom
                    ? t('mcpSettings.deleteOnlyAdnifyCopyKeepsOriginal', language, { provider: providerLabel })
                    : t('mcpSettings.deleteOnlyAdnifyCopy', language)}
                </p>
                <div className="break-all rounded-lg border border-red-500/15 bg-black/20 px-2.5 py-2 font-mono text-[11px] text-red-200/80">
                  {server.config.sourcePath || (t('mcpSettings.sourcePathUnavailable', language))}
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirm(null)}
                >
                  {t('cancel', language)}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleDeleteServer(server)}
                  disabled={isDeleting}
                  className="bg-red-500 hover:bg-red-600"
                >
                  {isDeleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    t('delete', language)
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {!showDeleteConfirm && (
          <ProgressiveReveal language={language} collapsedHeight={420} expandLabel={t('mcpSettings.showAllServerDetails', language)}>
          <div className="space-y-6 border-t border-border/50 p-5">
            {/* OAuth Pending Banner */}
            {isOAuthPending && (
              <div className="flex items-start gap-3 p-4 bg-orange-500/10 rounded-xl border border-orange-500/20 text-orange-300 text-xs font-medium">
                <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" />
                <div>
                  <div className="font-bold mb-1">
                    {t('mcpSettings.waitingForBrowserAuthorization', language)}
                  </div>
                  <div className="opacity-80">
                    {t('mcpSettings.pleaseCompleteAuthorizationIn', language)}
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {server.error && !isOAuthPending && (
              <div className="flex items-start gap-3 p-4 bg-red-500/10 rounded-xl border border-red-500/20 text-red-400 text-xs font-medium">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span className="leading-relaxed">{server.error}</span>
              </div>
            )}

            {/* Auth Status for remote servers */}
            {isRemote && server.authStatus && (
              <div className={`flex items-center gap-2.5 p-3 rounded-xl text-sm font-medium border ${
                server.authStatus === 'authenticated' 
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : server.authStatus === 'expired'
                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                  : 'bg-white/5 text-text-muted border-border'
              }`}>
                <Key className="w-4 h-4" />
                <span>
                  {server.authStatus === 'authenticated' && (t('mcpSettings.authenticated', language))}
                  {server.authStatus === 'expired' && (t('mcpSettings.authenticationExpired', language))}
                  {server.authStatus === 'not_authenticated' && (t('mcpSettings.notAuthenticated', language))}
                </span>
              </div>
            )}

            {/* Config Details */}
            <div className="space-y-2">
              <h5 className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">
                {t('mcpSettings.configuration', language)}
              </h5>
              <div className="text-xs text-text-secondary space-y-1.5 font-mono bg-black/20 p-4 rounded-xl border border-border shadow-inner">
                <div className="flex"><span className="text-text-muted w-20 shrink-0">id:</span> <span className="select-all">{server.id}</span></div>
                <div className="flex"><span className="text-text-muted w-20 shrink-0">type:</span> <span>{server.config.type}</span></div>
                {isRemote ? (
                  <>
                    <div className="flex"><span className="text-text-muted w-20 shrink-0">url:</span> <span className="select-all">{isRemoteConfig(server.config) && server.config.url}</span></div>
                    {isRemoteConfig(server.config) && server.config.oauth !== false && (
                      <div className="flex"><span className="text-text-muted w-20 shrink-0">oauth:</span> <span>enabled</span></div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex"><span className="text-text-muted w-20 shrink-0">command:</span> <span className="text-accent">{isLocalConfig(server.config) && server.config.command}</span></div>
                    {isLocalConfig(server.config) && server.config.args && server.config.args.length > 0 && (
                      <div className="flex"><span className="text-text-muted w-20 shrink-0">args:</span> <span>{isLocalConfig(server.config) && server.config.args?.join(' ')}</span></div>
                    )}
                    {isLocalConfig(server.config) && server.config.env && Object.keys(server.config.env).length > 0 && (
                      <div>
                        <span className="text-text-muted block mb-1">env:</span>
                        {Object.entries((isLocalConfig(server.config) ? server.config.env : {}) as Record<string, string>).map(([k, v]) => (
                          <div key={k} className="ml-4 flex gap-2"><span className="text-text-primary">{k}</span>=<span className="text-text-muted">{v.length > 20 ? v.slice(0, 8) + '***' : v}</span></div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Tools */}
            {server.tools.length > 0 && (
              <div className="space-y-3">
                <h5 className="text-[11px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-2 ml-1">
                  <Wrench className="w-3.5 h-3.5" />
                  {t('mcpSettings.tools', language)} <span className="bg-white/10 px-1.5 rounded-md text-[10px]">{server.tools.length}</span>
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {server.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className="p-3 bg-black/20 rounded-lg border border-border hover:border-accent/30 transition-colors group"
                      title={tool.description}
                    >
                      <div className="font-bold text-xs text-text-primary mb-1 group-hover:text-accent transition-colors">{tool.name}</div>
                      {tool.description && (
                        <div className="text-[11px] text-text-muted line-clamp-2 leading-relaxed opacity-80">{tool.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resources */}
            {server.resources.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-text-secondary flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {t('mcpSettings.resources', language)} ({server.resources.length})
                </h5>
                <div className="space-y-1">
                  {server.resources.map((resource) => (
                    <div
                      key={resource.uri}
                      className="p-2 bg-black/20 rounded text-xs"
                      title={resource.description}
                    >
                      <div className="font-medium text-text-primary truncate">{resource.name}</div>
                      <div className="text-text-muted truncate">{resource.uri}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prompts */}
            {server.prompts.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-text-secondary flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  {t('mcpSettings.prompts', language)} ({server.prompts.length})
                </h5>
                <div className="space-y-1">
                  {server.prompts.map((prompt) => (
                    <div
                      key={prompt.name}
                      className="p-2 bg-black/20 rounded text-xs"
                      title={prompt.description}
                    >
                      <div className="font-medium text-text-primary">{prompt.name}</div>
                      {prompt.description && (
                        <div className="text-text-muted truncate">{prompt.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto Approve */}
            {server.config.autoApprove && server.config.autoApprove.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-text-secondary">
                  {t('common.autoApprovedTools', language)}
                </h5>
                <div className="flex flex-wrap gap-1">
                  {server.config.autoApprove.map((tool) => (
                    <span
                      key={tool}
                      className="px-2 py-0.5 bg-accent/20 text-accent text-xs rounded"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Usage Examples */}
            {usageExamples && usageExamples.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-text-secondary flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-yellow-500" />
                  {t('mcpSettings.usageExamples', language)}
                </h5>
                <div className="space-y-1.5">
                  {usageExamples.map((example) => (
                    <div
                      key={`example-${example.slice(0, 30)}`}
                      className="p-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-sm text-text-secondary"
                    >
                      <OtterAsset asset="idea" className="inline-block h-4 w-4 object-contain mr-2 align-[-3px] opacity-80" />
                      {example}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-muted">
                  {t('mcpSettings.typeSimilarPromptsIn', language)}
                </p>
              </div>
            )}
          </div>
          </ProgressiveReveal>
        )}
      </div>
    )
  }

  const existingServerIds = mcpServers.map(s => s.id)

  return (
    <div className="space-y-5 pb-10">
      {/* Auto Connect Setting */}
      <section className="rounded-xl border border-border/70 bg-surface/25 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Power className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary">
                {t('mcpSettings.autoConnectOnStartup', language)}
              </h4>
              <p className="text-xs text-text-muted mt-0.5">
                {t('mcpSettings.automaticallyConnectAllEnabled', language)}
              </p>
            </div>
          </div>
          <Switch
            checked={mcpConfig.autoConnect ?? true}
            onChange={(e) => setMcpConfig({ autoConnect: e.target.checked })}
          />
        </div>
      </section>

      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted">
            {t('mcpSettings.configureAndManageMcp', language)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleOpenImport}>
            <Import className="w-4 h-4 mr-2" />
            {t('common.importFromAgent', language)}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReloadConfig}
            disabled={actionLoading === 'reload'}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${actionLoading === 'reload' ? 'animate-spin' : ''}`} />
            {t('refresh', language)}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('common.addServer', language)}
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {mcpError && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-lg text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{mcpError}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{actionError}</span>
          </div>
          <button type="button" className="shrink-0 text-xs text-red-300 hover:text-red-200" onClick={() => setActionError(null)}>
            {t('mcpSettings.dismiss', language)}
          </button>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-text-secondary">
            {t('mcpSettings.mcpServers', language)} ({mcpServers.length})
          </h4>
        </div>
        
        {mcpLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : mcpServers.length === 0 ? (
          <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
            <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">
              {t('mcpSettings.noMcpServersConfigured', language)}
            </p>
            <p className="text-xs mt-1 mb-4">
              {t('mcpSettings.addMcpServersTo', language)}
            </p>
            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t('common.addServer', language)}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {mcpServers.map(renderServerCard)}
          </div>
        )}
      </div>

      {/* Tips */}
      <aside className="space-y-2 rounded-xl border border-accent/20 bg-accent/[0.04] p-4 text-xs text-text-muted">
        <p className="font-bold text-sm text-accent/90 flex items-center gap-1.5">
          <OtterAsset asset="question" className="h-6 w-6 object-contain" />
          {t('common.tips', language)}
        </p>
        <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed pl-1">
          <li>
            {t('mcpSettings.autoConnectionToolsOf', language)}
          </li>
          <li>
            {t('mcpSettings.statusMonitoringTheLeft', language)}
          </li>
          <li>
            {t('mcpSettings.configMergingGlobalAnd', language)}
          </li>
        </ul>
      </aside>

      {/* Local MCP Config Directories */}
      {configPaths && (
        <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-accent" />
            <h5 className="text-sm font-medium text-text-primary">
              {t('mcpSettings.localMcpConfigurationFiles', language)}
            </h5>
          </div>

          <p className="text-xs text-text-muted leading-relaxed">
            {t('mcpSettings.mcpConfigurationIsStored', language)}
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {/* User (Global) Config Card */}
            <div className="rounded-lg border border-border bg-surface p-4 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">
                    {t('mcpSettings.userConfigurationFile', language)}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">
                    {t('mcpSettings.global', language)}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted break-all font-mono opacity-80 leading-relaxed bg-black/10 p-2 rounded border border-border/30">
                  {configPaths.user}
                </p>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onOpenFile(configPaths.user, { initialContent: EMPTY_MCP_CONFIG })}
                className="w-full text-xs justify-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                {t('mcpSettings.openInEditor', language)}
              </Button>
            </div>

            {/* Workspace (Project) Config Cards */}
            {configPaths.workspace.length > 0 ? (
              configPaths.workspace.map((path, index) => (
                <div key={path} className="rounded-lg border border-border bg-surface p-4 space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text-primary">
                        {t('mcpSettings.projectConfigFile', language, { index1: index + 1 })}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-bold">
                        {t('mcpSettings.project', language)}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted break-all font-mono opacity-80 leading-relaxed bg-black/10 p-2 rounded border border-border/30">
                      {path}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void onOpenFile(path, { initialContent: EMPTY_MCP_CONFIG })}
                    className="w-full text-xs justify-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {t('mcpSettings.openInEditor', language)}
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-surface/10 p-4 flex flex-col items-center justify-center text-center space-y-2 min-h-[140px]">
                <OtterAsset asset="standFront" className="w-12 h-12 object-contain opacity-70" />
                <div className="text-xs font-medium text-text-muted">
                  {t('mcpSettings.noWorkspaceMcpConfig', language)}
                </div>
                <p className="text-[10px] text-text-muted max-w-[200px] leading-relaxed">
                  {t('mcpSettings.createAdnifySettingsMcp', language)}
                </p>
              </div>
            )}
          </div>

          {/* MCP Standard & Spec Info */}
          <div className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-text-primary">
                {t('mcpSettings.recognizedMcpServerTypes', language)}
              </p>
              <p className="text-[11px] text-text-muted leading-relaxed">
                {t('mcpSettings.modelContextProtocolMcp', language)}
              </p>
              <p className="text-[11px] text-text-muted leading-relaxed">
                {t('mcpSettings.adnifyIsFullyCompliant', language)}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-border/30">
              <div className="space-y-1 text-[11px] text-text-muted">
                <p>
                  {t('mcpSettings.ifYouModifiedConfiguration', language)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleReloadConfig}
                disabled={actionLoading === 'reload'}
                className="text-xs shrink-0 gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'reload' ? 'animate-spin' : ''}`} />
                {t('mcpSettings.reloadSync', language)}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Add Server Modal */}
      <Modal
        isOpen={showImportModal}
        onClose={() => !importLoading && setShowImportModal(false)}
        title={t('mcpSettings.importMcpFromAnother', language)}
        size="3xl"
      >
        <div className="space-y-5">
          <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-4 text-xs leading-relaxed text-text-secondary">
            {t('mcpSettings.externalConfigsAreScanned', language)}
          </div>
          <div className="flex gap-2">
            {(['user', 'workspace'] as const).map(level => (
              <button
                key={level}
                type="button"
                disabled={level === 'workspace' && !configPaths?.workspace.length}
                onClick={() => setImportLevel(level)}
                className={`rounded-lg border px-3 py-2 text-xs transition-colors ${importLevel === level ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-text-muted hover:bg-white/5'} disabled:opacity-40`}
              >
                {level === 'user' ? (t('common.saveGlobally', language)) : (t('common.saveToProject', language))}
              </button>
            ))}
          </div>
          <div className="max-h-[440px] space-y-2 overflow-auto pr-1">
            {importLoading && externalConfigs.length === 0 ? (
              <div className="flex h-36 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
            ) : externalConfigs.length === 0 ? (
              <div className="flex h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
                {t('mcpSettings.noExternalMcpConfigs', language)}
              </div>
            ) : externalConfigs.map(config => {
              const key = externalKey(config)
              const exists = existingServerIds.includes(config.id)
              const selected = selectedImports.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={exists}
                  onClick={() => setSelectedImports(previous => {
                    const next = new Set(previous)
                    selected ? next.delete(key) : next.add(key)
                    return next
                  })}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-accent/40 bg-accent/[0.08]' : 'border-border bg-surface/40 hover:border-accent/25'} disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-accent bg-accent text-white' : 'border-border'}`}>
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary">{config.name || config.id}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-text-muted">{getProviderLabel(config.sourceProvider)}</span>
                      {exists && <span className="text-[10px] text-amber-400">{t('mcpSettings.alreadyExistsInAdnify', language)}</span>}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-text-muted" title={config.sourcePath}>{config.sourcePath}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="text-xs text-text-muted">{t('common.selected', language, { size: selectedImports.size })}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowImportModal(false)} disabled={importLoading}>{t('cancel', language)}</Button>
              <Button variant="primary" size="sm" onClick={handleImportSelected} disabled={selectedImports.size === 0 || importLoading}>
                {importLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('common.import', language, { size: selectedImports.size })}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <McpAddServerModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddServer}
        language={language}
        existingServerIds={existingServerIds}
      />
    </div>
  )
}
