import { Server } from 'lucide-react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import type { ChatMessage, ContextItem, LastActiveServer, ShellServerContext } from '@/renderer/agent/types'
import { getMessageText } from '@/renderer/agent/types'
import { shellRegistryService } from '@/renderer/shell/services/shellRegistryService'
import type { ShellLink, RemoteServerConfig } from '@/renderer/shell/types'
import type { ToolExecutionContext } from '@/shared/types'

export interface RemoteShellLink extends ShellLink {
  type: 'remote'
  remote: RemoteServerConfig
}

export interface ShellServerMentionCandidate {
  id: string
  type: 'server'
  label: string
  description: string
  icon: typeof Server
  data: {
    serverLinkId: string
    serverName: string
    host: string
    port?: number
    username?: string
    remotePath?: string
  }
}

export interface ResolvedShellServerTarget {
  executionTarget: 'local' | 'remote'
  resolvedBy: 'arg' | 'explicit_context' | 'last_active_server' | 'auto_routing' | 'local_default'
  server?: LastActiveServer
}

export interface ExplicitShellServerResolution {
  kind: 'none' | 'resolved' | 'not_found' | 'ambiguous'
  token?: string
  server?: LastActiveServer
  matches?: LastActiveServer[]
}

const REMOTE_ONLY_TOOL_NAMES = new Set([
  'list_remote_directory',
  'read_remote_file',
  'write_remote_file',
  'rename_remote_path',
  'delete_remote_path',
  'upload_to_remote',
  'download_from_remote',
])

const REMOTE_COMMAND_PATTERNS = [
  /\b(journalctl|systemctl|service|docker|kubectl|kustomize|helm|pm2|supervisorctl|nginx|apachectl)\b/i,
  /\b(tail|less|cat)\s+\/(var|etc|srv|opt|home)\//i,
  /\b(ls|cd)\s+\/(var|etc|srv|opt|home)\b/i,
  /\b(restart|deploy|reload|logs?)\b/i,
]

const LOCAL_COMMAND_PATTERNS = [
  /\b(npm|pnpm|yarn|bun|node|vitest|jest|tsc|cargo|go\s+test|python|uv|gradle|mvn)\b/i,
  /\bgit\s+(status|diff|log|branch|commit|checkout|switch)\b/i,
]

const REMOTE_PROMPT_PATTERNS = [
  /远程|服务器|机器|线上|部署|日志|重启|上传|下载|ssh|shell studio|remote|server|deploy|restart|logs?/i,
]

const LOCAL_PROMPT_PATTERNS = [
  /本地|当前项目|当前仓库|工作区|workspace|local/i,
]

function normalizeServerName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function toLastActiveServer(link: RemoteShellLink): LastActiveServer {
  return {
    serverLinkId: link.id,
    serverName: link.name.trim(),
    host: link.remote.host.trim(),
    port: link.remote.port,
    username: link.remote.username,
    remotePath: link.remote.remotePath,
    updatedAt: Date.now(),
  }
}

function toShellServerContext(server: LastActiveServer, bindingMode: ShellServerContext['bindingMode']): ShellServerContext {
  return {
    type: 'ShellServer',
    serverLinkId: server.serverLinkId,
    serverName: server.serverName,
    host: server.host,
    port: server.port,
    username: server.username,
    remotePath: server.remotePath,
    bindingMode,
  }
}

function isRemoteLink(link: ShellLink): link is RemoteShellLink {
  return link.type === 'remote' && !!link.remote?.host
}

function contextItemsFromMessage(message: ChatMessage | undefined): ContextItem[] {
  if (!message) return []
  if (message.role === 'user' || message.role === 'assistant') {
    return Array.isArray(message.contextItems) ? message.contextItems : []
  }
  return []
}

function findShellServerContext(items: ContextItem[]): ShellServerContext | null {
  return items.find((item): item is ShellServerContext => item.type === 'ShellServer') || null
}

function buildServerMentionCandidate(link: RemoteShellLink): ShellServerMentionCandidate {
  return {
    id: `server-${link.id}`,
    type: 'server',
    label: `#${link.name}#`,
    description: `${link.remote.username || 'root'}@${link.remote.host}:${link.remote.port || 22}${link.remote.remotePath ? ` · ${link.remote.remotePath}` : ''}`,
    icon: Server,
    data: {
      serverLinkId: link.id,
      serverName: link.name,
      host: link.remote.host,
      port: link.remote.port,
      username: link.remote.username,
      remotePath: link.remote.remotePath,
    },
  }
}

function getThreadMessages(threadId?: string | null): ChatMessage[] {
  if (!threadId) return []
  return useAgentStore.getState().threads[threadId]?.messages || []
}

function getLatestUserText(threadId?: string | null): string {
  const messages = getThreadMessages(threadId)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'user') {
      return getMessageText(message.content)
    }
  }
  return ''
}

function getExplicitContextServer(threadId?: string | null, assistantId?: string | null): LastActiveServer | null {
  const messages = getThreadMessages(threadId)
  const assistantMessage = assistantId
    ? messages.find((message) => message.role === 'assistant' && message.id === assistantId)
    : undefined
  const assistantContext = findShellServerContext(contextItemsFromMessage(assistantMessage))
  if (assistantContext) {
    return {
      serverLinkId: assistantContext.serverLinkId,
      serverName: assistantContext.serverName,
      host: assistantContext.host,
      port: assistantContext.port,
      username: assistantContext.username,
      remotePath: assistantContext.remotePath,
      updatedAt: Date.now(),
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'assistant') {
      continue
    }

    if (message.role === 'user') {
      const context = findShellServerContext(contextItemsFromMessage(message))
      if (!context) return null
      return {
        serverLinkId: context.serverLinkId,
        serverName: context.serverName,
        host: context.host,
        port: context.port,
        username: context.username,
        remotePath: context.remotePath,
        updatedAt: Date.now(),
      }
    }
  }

  return null
}

function shouldTreatAsRemoteTool(toolName: string): boolean {
  return REMOTE_ONLY_TOOL_NAMES.has(toolName)
}

function shouldTreatAsRemoteCommand(command: string, userPrompt: string): boolean {
  if (REMOTE_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
    return true
  }
  if (LOCAL_COMMAND_PATTERNS.some((pattern) => pattern.test(command)) && !REMOTE_PROMPT_PATTERNS.some((pattern) => pattern.test(userPrompt))) {
    return false
  }
  if (REMOTE_PROMPT_PATTERNS.some((pattern) => pattern.test(userPrompt))) {
    return true
  }
  if (LOCAL_PROMPT_PATTERNS.some((pattern) => pattern.test(userPrompt))) {
    return false
  }
  return false
}

function makeNotFoundResolution(token: string): ExplicitShellServerResolution {
  return { kind: 'not_found', token }
}

function makeAmbiguousResolution(token: string, matches: LastActiveServer[]): ExplicitShellServerResolution {
  return { kind: 'ambiguous', token, matches }
}

class ShellServerRoutingService {
  private extractServerTokens(input: string): string[] {
    const tokens: string[] = []
    const regex = /#([^#\n]+)#/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(input)) !== null) {
      const token = match[1]?.trim()
      if (token) tokens.push(token)
    }
    return tokens
  }

  async getRemoteServerLinks(): Promise<RemoteShellLink[]> {
    await shellRegistryService.load()
    return shellRegistryService.getState().links.filter(isRemoteLink)
  }

  async getRemoteServerCandidates(query: string): Promise<ShellServerMentionCandidate[]> {
    const normalizedQuery = normalizeServerName(query.replace(/^#/, '').replace(/#$/, ''))
    const links = await this.getRemoteServerLinks()
    return links
      .filter((link) => {
        if (!normalizedQuery) return true
        return normalizeServerName(link.name).includes(normalizedQuery)
          || normalizeServerName(link.remote.host).includes(normalizedQuery)
      })
      .map(buildServerMentionCandidate)
      .slice(0, 20)
  }

  async resolveServerName(serverName: string): Promise<ExplicitShellServerResolution> {
    const normalized = normalizeServerName(serverName)
    if (!normalized) return { kind: 'none' }

    const links = await this.getRemoteServerLinks()
    const matches = links
      .filter((link) => normalizeServerName(link.name) === normalized)
      .map(toLastActiveServer)

    if (matches.length === 0) return makeNotFoundResolution(serverName)
    if (matches.length > 1) return makeAmbiguousResolution(serverName, matches)
    return {
      kind: 'resolved',
      token: serverName,
      server: matches[0],
    }
  }

  async resolveExplicitServerFromInput(input: string): Promise<ExplicitShellServerResolution> {
    const tokens = this.extractServerTokens(input)
    if (tokens.length === 0) return { kind: 'none' }

    let latestResolved: ExplicitShellServerResolution = { kind: 'none' }
    for (const token of tokens) {
      const resolution = await this.resolveServerName(token)
      if (resolution.kind !== 'resolved') {
        return resolution
      }
      latestResolved = resolution
    }

    return latestResolved
  }

  async buildExplicitShellServerContext(input: string): Promise<{ contextItem?: ShellServerContext; lastActiveServer?: LastActiveServer; error?: string }> {
    const resolution = await this.resolveExplicitServerFromInput(input)
    if (resolution.kind === 'none') return {}
    if (resolution.kind === 'not_found') {
      return { error: `Remote server not found: #${resolution.token}#` }
    }
    if (resolution.kind === 'ambiguous') {
      const labels = resolution.matches?.map((match) => match.serverName).join(', ') || resolution.token
      return { error: `Remote server name is ambiguous: #${resolution.token}# (${labels})` }
    }

    const server = resolution.server!
    return {
      contextItem: toShellServerContext(server, 'explicit'),
      lastActiveServer: server,
    }
  }

  async getPromptSection(threadId?: string | null): Promise<string | null> {
    const remoteLinks = await this.getRemoteServerLinks()
    if (remoteLinks.length === 0) return null

    const thread = threadId ? useAgentStore.getState().threads[threadId] : undefined
    const lastActiveServer = thread?.lastActiveServer
    const lines = [
      '## Remote Server Routing',
      '- Routing priority: tool argument `server_name` -> explicit `#server-name#` in the current user message -> recent server memory -> other conservative auto-routing evidence -> local default.',
      '- Remote servers configured in Shell Studio can be targeted with `#server-name#` in the user message.',
      '- `#server-name#` explicitly selects a remote server for this turn and refreshes the thread recent-server memory.',
      '- If no explicit server is present, the recent server is only the first candidate for clearly remote tasks; it is not a hard binding.',
      '- Local file tools operate on the local workspace only. Remote file tools operate on remote paths only.',
      '- Never silently fall back from remote operations to local operations.',
      '',
      'Available remote servers:',
      ...remoteLinks.map((link) => `- ${link.name} -> ${link.remote.username || 'root'}@${link.remote.host}:${link.remote.port || 22}${link.remote.remotePath ? ` (${link.remote.remotePath})` : ''}`),
    ]

    if (lastActiveServer) {
      lines.push('', `Recent server candidate: ${lastActiveServer.serverName} -> ${lastActiveServer.username || 'root'}@${lastActiveServer.host}:${lastActiveServer.port || 22}${lastActiveServer.remotePath ? ` (${lastActiveServer.remotePath})` : ''}`)
    }

    return lines.join('\n')
  }

  async resolveExecutionTarget(
    toolName: string,
    args: Record<string, unknown>,
    context: Pick<ToolExecutionContext, 'threadId' | 'assistantId' | 'currentAssistantId'>
  ): Promise<ResolvedShellServerTarget> {
    const explicitServerName = typeof args.server_name === 'string' ? args.server_name : ''
    if (explicitServerName.trim()) {
      const resolution = await this.resolveServerName(explicitServerName)
      if (resolution.kind === 'resolved' && resolution.server) {
        return {
          executionTarget: 'remote',
          resolvedBy: 'arg',
          server: resolution.server,
        }
      }
    }

    const explicitContext = getExplicitContextServer(context.threadId, context.currentAssistantId ?? context.assistantId ?? null)
    if (explicitContext) {
      return {
        executionTarget: 'remote',
        resolvedBy: 'explicit_context',
        server: explicitContext,
      }
    }

    const thread = context.threadId ? useAgentStore.getState().threads[context.threadId] : undefined
    const lastActiveServer = thread?.lastActiveServer
    const userPrompt = getLatestUserText(context.threadId)

    if (shouldTreatAsRemoteTool(toolName)) {
      if (lastActiveServer) {
        return {
          executionTarget: 'remote',
          resolvedBy: 'last_active_server',
          server: lastActiveServer,
        }
      }

      const remoteLinks = await this.getRemoteServerLinks()
      if (remoteLinks.length === 1) {
        return {
          executionTarget: 'remote',
          resolvedBy: 'auto_routing',
          server: toLastActiveServer(remoteLinks[0]),
        }
      }
    }

    if (toolName === 'run_command') {
      const command = typeof args.command === 'string' ? args.command : ''
      const shouldRouteRemote = shouldTreatAsRemoteCommand(command, userPrompt)
      if (lastActiveServer && shouldRouteRemote) {
        return {
          executionTarget: 'remote',
          resolvedBy: 'last_active_server',
          server: lastActiveServer,
        }
      }

      if (shouldRouteRemote) {
        const remoteLinks = await this.getRemoteServerLinks()
        if (remoteLinks.length === 1) {
          return {
            executionTarget: 'remote',
            resolvedBy: 'auto_routing',
            server: toLastActiveServer(remoteLinks[0]),
          }
        }
      }
    }

    return {
      executionTarget: 'local',
      resolvedBy: 'local_default',
    }
  }
}

export const shellServerRoutingService = new ShellServerRoutingService()
