/**
 * MCP 设置页面
 * 管理 MCP 服务器配置和状态
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useEffect } from 'react'
import { logger } from '@shared/utils/Logger'
import {
  Server,
  RefreshCw,
  Power,
  PowerOff,
  AlertCircle,
  CheckCircle,
  Loader2,
  Wrench,
  FileText,
  MessageSquare,
  FolderOpen,
  Plus,
  Trash2,
  Globe,
  Key,
  LogIn,
  Lightbulb,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { mcpService } from '@services/mcpService'
import { Button, Switch } from '@components/ui'
import type { McpServerState, McpServerStatus } from '@shared/types/mcp'
import { isRemoteConfig, isLocalConfig } from '@shared/types/mcp'
import { MCP_PRESETS } from '@shared/config/mcpPresets'
import McpAddServerModal, { type McpServerFormData } from './McpAddServerModal'

interface McpSettingsProps {
  language: 'en' | 'zh'
  mcpConfig: { autoConnect?: boolean }
  setMcpConfig: (config: { autoConnect?: boolean }) => void
}

export default function McpSettings({ language, mcpConfig, setMcpConfig }: McpSettingsProps) {
  const { mcpServers, mcpLoading, mcpError } = useStore(useShallow(s => ({ mcpServers: s.mcpServers, mcpLoading: s.mcpLoading, mcpError: s.mcpError })))
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [configPaths, setConfigPaths] = useState<{ user: string; workspace: string[] } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
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

  const handleDeleteServer = async (serverId: string) => {
    setActionLoading(`delete-${serverId}`)
    try {
      const success = await mcpService.removeServer(serverId)
      if (success) {
        await mcpService.reloadConfig()
      }
    } catch (err) {
      logger.settings.error('Failed to delete server:', err)
    }
    setActionLoading(null)
    setDeleteConfirm(null)
  }

  const handleToggleServer = async (serverId: string, disabled: boolean) => {
    setActionLoading(`toggle-${serverId}`)
    try {
      await mcpService.toggleServer(serverId, disabled)
      await mcpService.reloadConfig()
    } catch (err) {
      logger.settings.error('Failed to toggle server:', err)
    }
    setActionLoading(null)
  }

  const openConfigFile = async (path: string) => {
    try {
      await api.file.showInFolder(path)
    } catch (err) {
      logger.settings.error('Failed to open config file:', err)
    }
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
      connected: language === 'zh' ? '已连接' : 'Connected',
      connecting: language === 'zh' ? '连接中' : 'Connecting',
      error: language === 'zh' ? '错误' : 'Error',
      disconnected: language === 'zh' ? '未连接' : 'Disconnected',
      needs_auth: language === 'zh' ? '需要认证' : 'Auth Required',
      needs_registration: language === 'zh' ? '需要注册' : 'Registration Required',
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
    const isExpanded = expandedServer === server.id
    const isLoading = actionLoading?.startsWith(server.id) || actionLoading === `refresh-${server.id}` || actionLoading === `oauth-${server.id}`
    const isDeleting = actionLoading === `delete-${server.id}`
    const showDeleteConfirm = deleteConfirm === server.id
    const isRemote = server.config.type === 'remote'
    const isOAuthPending = oauthPendingServers.has(server.id)

    // 通过 presetId 查找预设获取使用示例
    const presetId = server.config.presetId
    const preset = presetId ? MCP_PRESETS.find(p => p.id === presetId) : undefined
    const usageExamples = language === 'zh' ? preset?.usageExamplesZh : preset?.usageExamples

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
          <div
            className="flex gap-4 flex-1 cursor-pointer"
            onClick={() => setExpandedServer(isExpanded ? null : server.id)}
          >
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
                {server.config.source && (
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border uppercase tracking-tight ${
                    server.config.source === 'workspace'
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                  }`}>
                    {server.config.source === 'workspace' ? (language === 'zh' ? '项目' : 'Project') : (language === 'zh' ? '全局' : 'Global')}
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
                    {language === 'zh' ? '等待浏览器授权...' : 'Waiting for browser...'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancelOAuth(server.id)}
                    title={language === 'zh' ? '取消' : 'Cancel'}
                    className="text-text-muted hover:text-red-400 text-xs"
                  >
                    {language === 'zh' ? '取消' : 'Cancel'}
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
                  title={language === 'zh' ? '开始认证' : 'Start Authentication'}
                >
                  <Key className="w-4 h-4 mr-1" />
                  {language === 'zh' ? '认证' : 'Auth'}
                </Button>
              )}

              {!server.config.disabled && server.status === 'connected' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRefreshCapabilities(server.id)}
                    disabled={isLoading}
                    title={language === 'zh' ? '刷新能力' : 'Refresh capabilities'}
                  >
                    <RefreshCw className={`w-4 h-4 ${actionLoading === `refresh-${server.id}` ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDisconnectServer(server.id)}
                    disabled={isLoading}
                    title={language === 'zh' ? '断开连接' : 'Disconnect'}
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
                  title={language === 'zh' ? '连接' : 'Connect'}
                >
                  <Power className="w-4 h-4" />
                </Button>
              )}

              {/* Toggle Enable/Disable */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleToggleServer(server.id, !server.config.disabled)}
                disabled={isLoading}
                title={server.config.disabled 
                  ? (language === 'zh' ? '启用' : 'Enable')
                  : (language === 'zh' ? '禁用' : 'Disable')
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
                title={language === 'zh' ? '删除' : 'Delete'}
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
            <div className="flex items-center justify-between p-3 bg-red-500/10 rounded-lg">
              <span className="text-sm text-red-400">
                {language === 'zh' ? '确定要删除此服务器吗？' : 'Are you sure you want to delete this server?'}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirm(null)}
                >
                  {language === 'zh' ? '取消' : 'Cancel'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleDeleteServer(server.id)}
                  disabled={isDeleting}
                  className="bg-red-500 hover:bg-red-600"
                >
                  {isDeleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    language === 'zh' ? '删除' : 'Delete'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Expanded Content */}
        {isExpanded && !showDeleteConfirm && (
          <div className="border-t border-border/50 p-5 space-y-6 animate-slide-down">
            {/* OAuth Pending Banner */}
            {isOAuthPending && (
              <div className="flex items-start gap-3 p-4 bg-orange-500/10 rounded-xl border border-orange-500/20 text-orange-300 text-xs font-medium">
                <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" />
                <div>
                  <div className="font-bold mb-1">
                    {language === 'zh' ? '正在等待浏览器授权...' : 'Waiting for browser authorization...'}
                  </div>
                  <div className="opacity-80">
                    {language === 'zh'
                      ? '请在打开的浏览器窗口中完成授权，完成后将自动连接。'
                      : 'Please complete authorization in the opened browser window. The server will connect automatically.'}
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
                  {server.authStatus === 'authenticated' && (language === 'zh' ? '已认证' : 'Authenticated')}
                  {server.authStatus === 'expired' && (language === 'zh' ? '认证已过期' : 'Authentication Expired')}
                  {server.authStatus === 'not_authenticated' && (language === 'zh' ? '未认证' : 'Not Authenticated')}
                </span>
              </div>
            )}

            {/* Config Details */}
            <div className="space-y-2">
              <h5 className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">
                {language === 'zh' ? '配置详情' : 'Configuration'}
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
                  {language === 'zh' ? '工具列表' : 'Tools'} <span className="bg-white/10 px-1.5 rounded-md text-[10px]">{server.tools.length}</span>
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
                  {language === 'zh' ? '资源' : 'Resources'} ({server.resources.length})
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
                  {language === 'zh' ? '提示模板' : 'Prompts'} ({server.prompts.length})
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
                  {language === 'zh' ? '自动批准的工具' : 'Auto-approved Tools'}
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
                  {language === 'zh' ? '使用示例' : 'Usage Examples'}
                </h5>
                <div className="space-y-1.5">
                  {usageExamples.map((example) => (
                    <div
                      key={`example-${example.slice(0, 30)}`}
                      className="p-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-sm text-text-secondary"
                    >
                      <span className="text-yellow-500/70 mr-2">💡</span>
                      {example}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-muted">
                  {language === 'zh' 
                    ? '在聊天中输入类似的内容即可触发此工具' 
                    : 'Type similar prompts in chat to trigger this tool'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const existingServerIds = mcpServers.map(s => s.id)

  return (
    <div className="space-y-6">
      {/* Auto Connect Setting */}
      <div className="p-4 bg-surface/20 rounded-xl border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Power className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary">
                {language === 'zh' ? '启动时自动连接' : 'Auto-connect on Startup'}
              </h4>
              <p className="text-xs text-text-muted mt-0.5">
                {language === 'zh'
                  ? '应用启动时自动连接所有已启用的 MCP 服务器'
                  : 'Automatically connect all enabled MCP servers when the app starts'}
              </p>
            </div>
          </div>
          <Switch
            checked={mcpConfig.autoConnect ?? true}
            onChange={(e) => setMcpConfig({ autoConnect: e.target.checked })}
          />
        </div>
      </div>

      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted">
            {language === 'zh'
              ? '配置和管理 MCP (Model Context Protocol) 服务器，扩展 AI 助手的能力。'
              : 'Configure and manage MCP (Model Context Protocol) servers to extend AI assistant capabilities.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReloadConfig}
            disabled={actionLoading === 'reload'}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${actionLoading === 'reload' ? 'animate-spin' : ''}`} />
            {language === 'zh' ? '刷新' : 'Refresh'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            {language === 'zh' ? '添加服务器' : 'Add Server'}
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

      {/* Server List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-text-secondary">
            {language === 'zh' ? 'MCP 服务器' : 'MCP Servers'} ({mcpServers.length})
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
              {language === 'zh'
                ? '暂无配置的 MCP 服务器'
                : 'No MCP servers configured'}
            </p>
            <p className="text-xs mt-1 mb-4">
              {language === 'zh'
                ? '添加 MCP 服务器来扩展 AI 助手的能力'
                : 'Add MCP servers to extend AI assistant capabilities'}
            </p>
            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {language === 'zh' ? '添加服务器' : 'Add Server'}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {mcpServers.map(renderServerCard)}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="p-4 rounded-xl bg-accent/5 border border-accent/20 text-xs text-text-muted space-y-2">
        <p className="font-bold text-sm text-accent/90 flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4 text-accent animate-pulse" />
          {language === 'zh' ? '💡 使用提示' : '💡 Tips'}
        </p>
        <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed pl-1">
          <li>
            {language === 'zh'
              ? '工具自动接入：启用的 MCP 服务器在连接成功后，其工具将自动接入 AI 助手，在聊天或任务执行时可直接调用。'
              : 'Auto-connection: Tools of enabled MCP servers will automatically be registered to the AI assistant once successfully connected.'}
          </li>
          <li>
            {language === 'zh'
              ? '快速状态排查：卡片左侧指示灯代表当前状态，若遇到错误，点击展开卡片即可查看详细的服务器 stderr 日志。'
              : 'Status monitoring: The left dot indicates connection status. Click the card to expand details and view stderr logs if errors occur.'}
          </li>
          <li>
            {language === 'zh'
              ? '配置合并生效：用户级（全局）与项目级（工作区）服务器配置将合并生效。若有同名冲突，以项目级配置为先。'
              : 'Config merging: Global and workspace server configs are merged. Workspace configs take precedence in case of duplicate names.'}
          </li>
        </ul>
      </div>

      {/* Local MCP Config Directories */}
      {configPaths && (
        <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-accent" />
            <h5 className="text-sm font-medium text-text-primary">
              {language === 'zh' ? '本地 MCP 配置文件' : 'Local MCP Configuration Files'}
            </h5>
          </div>

          <p className="text-xs text-text-muted leading-relaxed">
            {language === 'zh'
              ? '已有 MCP 配置文件存储在本地 JSON 目录中。你可以点击下方卡片，定位并手动编辑这些文件以进行高级参数微调。'
              : 'MCP server configurations are stored in local JSON files. Click the cards below to locate and manually edit these files for advanced tuning.'}
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {/* User (Global) Config Card */}
            <div className="rounded-lg border border-border bg-surface p-4 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">
                    {language === 'zh' ? '用户配置文件' : 'User Configuration File'}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">
                    {language === 'zh' ? '全局' : 'GLOBAL'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted break-all font-mono opacity-80 leading-relaxed bg-black/10 p-2 rounded border border-border/30">
                  {configPaths.user}
                </p>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => openConfigFile(configPaths.user)}
                className="w-full text-xs justify-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {language === 'zh' ? '在文件夹中定位用户配置' : 'Locate User Config'}
              </Button>
            </div>

            {/* Workspace (Project) Config Cards */}
            {configPaths.workspace.length > 0 ? (
              configPaths.workspace.map((path, index) => (
                <div key={path} className="rounded-lg border border-border bg-surface p-4 space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text-primary">
                        {language === 'zh' ? `项目配置文件 ${index + 1}` : `Project Config File ${index + 1}`}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-bold">
                        {language === 'zh' ? '项目' : 'PROJECT'}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted break-all font-mono opacity-80 leading-relaxed bg-black/10 p-2 rounded border border-border/30">
                      {path}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openConfigFile(path)}
                    className="w-full text-xs justify-center gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {language === 'zh' ? '在文件夹中定位项目配置' : 'Locate Project Config'}
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-surface/10 p-4 flex flex-col items-center justify-center text-center space-y-2 min-h-[140px]">
                <FolderOpen className="w-8 h-8 text-text-muted opacity-40 animate-pulse" />
                <div className="text-xs font-medium text-text-muted">
                  {language === 'zh' ? '暂未检测到项目级 MCP 配置' : 'No workspace MCP config detected'}
                </div>
                <p className="text-[10px] text-text-muted max-w-[200px] leading-relaxed">
                  {language === 'zh'
                    ? '在项目根目录下创建 .adnify/settings/mcp.json 可启用项目级配置。'
                    : 'Create .adnify/settings/mcp.json in your workspace root to enable project-level config.'}
                </p>
              </div>
            )}
          </div>

          {/* MCP Standard & Spec Info */}
          <div className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-text-primary">
                {language === 'zh' ? '可识别的 MCP 服务器类型与协议规范' : 'Recognized MCP Server Types & Spec'}
              </p>
              <p className="text-[11px] text-text-muted leading-relaxed">
                {language === 'zh'
                  ? 'Model Context Protocol (MCP) 是 Anthropic 推出的一项全新开放标准，旨在使 AI 助手通过安全、统一的协议与本地开发环境、专有数据源及第三方 API 进行无缝的数据和工具交互。'
                  : 'Model Context Protocol (MCP) is an open standard proposed by Anthropic that enables AI assistants to seamlessly interface with local development environments, proprietary data sources, and third-party APIs via a unified protocol.'}
              </p>
              <p className="text-[11px] text-text-muted leading-relaxed">
                {language === 'zh'
                  ? 'Adnify 完全兼容 MCP 规范，既支持通过 stdio 执行本地服务器指令（支持 Node/Python 运行环境与环境变量 env 注入），也支持基于 SSE (Server-Sent Events) 的远程 HTTP 连接，并具备自动 OAuth2 授权接入能力。'
                  : 'Adnify is fully compliant with the MCP spec. It supports running local command-based servers via stdio (with Node/Python env & env var injections) as well as remote SSE (Server-Sent Events) connections equipped with automated OAuth2 authentication flows.'}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-border/30">
              <div className="space-y-1 text-[11px] text-text-muted">
                <p>
                  {language === 'zh'
                    ? '如果你添加或修改了本地配置文件中的内容，点击右侧的“重新加载”即可立即同步。'
                    : 'If you modified configuration files manually, click "Reload Config" to immediately sync your changes.'}
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
                {language === 'zh' ? '重新加载并同步' : 'Reload & Sync'}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Add Server Modal */}
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
