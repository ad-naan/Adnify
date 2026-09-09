import { z } from 'zod'
import type { ToolConfig } from '@shared/config/tools'
import type { ToolLoadingContext } from '@shared/config/toolGroups'
import type {
  ExtensionKind,
  ExtensionOperationResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@shared/types'
import { api } from '@services/electronAPI'
import type { ToolProvider } from './types'

const DISCOVER_TOOL = 'configuration_discover'
const PREPARE_TOOL = 'configuration_prepare'
const APPLY_TOOL = 'configuration_apply'

const definitions: ToolDefinition[] = [
  {
    name: DISCOVER_TOOL,
    description: 'Inspect installed Agent configurations when query is omitted, or search the available configuration catalogs when query is provided. Current adapters support MCP servers and Skills.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mcp', 'skill'], description: 'Optional configuration type filter.' },
        query: { type: 'string', description: 'Optional capability or package name. Omit it to inspect installed configurations.' },
      },
    },
  },
  {
    name: PREPARE_TOOL,
    description: 'Resolve a configuration source into an expiring, immutable change set without modifying the system. Show its summary and credential requirements before applying it.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mcp', 'skill'], description: 'Configuration type.' },
        source: { type: 'string', description: 'Exact catalog source, owner/repository@skill-id, or direct GitHub repository URL.' },
        scope: { type: 'string', enum: ['user', 'workspace'], description: 'Configure for the user or only the current workspace.' },
      },
      required: ['kind', 'source', 'scope'],
    },
  },
  {
    name: APPLY_TOOL,
    description: 'Apply one prepared configuration change set after explicit user approval. The main process verifies the result and rolls back a failed change. Never invent or alter a change-set ID.',
    parameters: {
      type: 'object',
      properties: { change_set_id: { type: 'string', description: 'Opaque ID returned by configuration_prepare.' } },
      required: ['change_set_id'],
    },
  },
]

const configurationKind = z.enum(['mcp', 'skill'])
const configurationScope = z.enum(['user', 'workspace'])
const schemas: Record<string, z.ZodTypeAny> = {
  [DISCOVER_TOOL]: z.object({
    kind: configurationKind.optional(),
    query: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  [PREPARE_TOOL]: z.object({
    kind: configurationKind,
    source: z.string().trim().min(1).max(500),
    scope: configurationScope,
  }).strict(),
  [APPLY_TOOL]: z.object({ change_set_id: z.string().uuid() }).strict(),
}

async function discoverConfigurations(args: { kind?: ExtensionKind; query?: string }): Promise<ExtensionOperationResult> {
  const query = args.query
  if (!query) {
    const result = await api.extensions.list()
    if (!args.kind || !result.installed) return result
    return { ...result, installed: result.installed.filter(item => item.kind === args.kind) }
  }

  const kinds: ExtensionKind[] = args.kind ? [args.kind] : ['mcp', 'skill']
  const responses = await Promise.all(kinds.map(kind => api.extensions.search({ kind, query })))
  const errors = responses.flatMap(response => response.error ? [response.error] : [])
  return {
    success: errors.length === 0,
    results: responses.flatMap(response => response.results || []),
    error: errors.length > 0 ? errors.join('; ') : undefined,
  }
}

export class ConfigurationToolProvider implements ToolProvider {
  readonly id = 'configuration'
  readonly name = 'Agent configuration'
  private context: ToolLoadingContext = { mode: 'agent' }

  setContext(context: ToolLoadingContext): void {
    this.context = context
  }

  hasTool(name: string): boolean {
    return Boolean(schemas[name])
  }

  getToolDefinitions(): ToolDefinition[] {
    const readOnly = this.context.isSubAgent || (this.context.mode === 'plan' && this.context.planPhase !== 'executing')
    if (readOnly) return definitions.filter(definition => definition.name === DISCOVER_TOOL)
    return definitions
  }

  getApprovalType(name: string) {
    return name === APPLY_TOOL ? 'dangerous' as const : 'none' as const
  }

  getMetadata(name: string): ToolConfig | undefined {
    if (!this.hasTool(name)) return undefined
    const mutatesConfiguration = name === APPLY_TOOL
    return {
      name,
      displayName: definitions.find(definition => definition.name === name)?.description || name,
      description: 'Discover, prepare, and safely apply Agent-managed configuration changes.',
      category: mutatesConfiguration ? 'write' : 'network',
      approvalType: this.getApprovalType(name),
      parallel: false,
      outputFormat: 'json',
      retryPolicy: { maxAttempts: 1 },
      resourceScope: mutatesConfiguration ? ['configuration:write'] : ['configuration:read'],
      requiresWorkspace: false,
      enabled: true,
      parameters: {},
    }
  }

  validateArgs(name: string, args: unknown) {
    const clean = { ...(args as Record<string, unknown>) }
    delete clean._meta
    const result = schemas[name]?.safeParse(clean)
    return { valid: Boolean(result?.success), error: result && !result.success ? result.error.message : undefined }
  }

  async execute(name: string, rawArgs: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (ctx.abortSignal?.aborted) throw new Error('Execution stopped before starting the configuration operation')

    const readOnly = ctx.isSubAgent || (ctx.chatMode === 'plan' && ctx.planPhase !== 'executing')
    if (readOnly && name !== DISCOVER_TOOL) {
      throw new Error('Configuration changes are unavailable in planning or hidden agents')
    }

    const args = { ...rawArgs }
    delete args._meta
    const parsed = schemas[name].parse(args)
    let result: ExtensionOperationResult

    switch (name) {
      case DISCOVER_TOOL:
        result = await discoverConfigurations(parsed as { kind?: ExtensionKind; query?: string })
        break
      case PREPARE_TOOL: {
        const request = parsed as { kind: ExtensionKind; source: string; scope: 'user' | 'workspace' }
        result = await api.extensions.prepare({ ...request, workspacePath: ctx.workspacePath })
        break
      }
      case APPLY_TOOL: {
        if (!ctx.securityApproval) throw new Error('Applying a configuration change requires explicit approval')
        const request = parsed as { change_set_id: string }
        result = await api.extensions.apply({ changeSetId: request.change_set_id, approval: ctx.securityApproval })
        break
      }
      default:
        throw new Error(`Unknown configuration tool: ${name}`)
    }

    return {
      success: result.success,
      result: JSON.stringify(result),
      error: result.error,
      outcome: { kind: result.success ? 'success' : 'error', retryable: false },
    }
  }
}

export const configurationToolProvider = new ConfigurationToolProvider()
