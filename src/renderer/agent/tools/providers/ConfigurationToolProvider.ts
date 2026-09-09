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
    description: 'Inspect installed MCP servers, Adnify Skills and application settings without a query, or search catalogs / setting keys with a query. Use kind=settings for current values, defaults and supported fields; use kind=skill with owner/repository to inspect a GitHub Skill repository directly. Partial catalog failures do not mean no packages exist.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mcp', 'skill', 'settings'], description: 'Optional configuration type filter. Use settings for software preferences, models, editor, network, security and other settings.' },
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
        kind: { type: 'string', enum: ['mcp', 'skill', 'settings'], description: 'Configuration type.' },
        source: { type: 'string', description: 'Exact catalog source, owner/repository@skill-id, direct GitHub repository URL, or exact setting key returned by discovery.' },
        scope: { type: 'string', enum: ['user', 'workspace'], description: 'Configure for the user or only the current workspace.' },
        value: {
          anyOf: [{ type: 'object', additionalProperties: true }, { type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: {} }],
          description: 'Required for settings: partial object or scalar; JSON-encoded values are also accepted when the setting expects an object or array. Example: source="editorConfig", value={"fontFamily":"Consolas, monospace"}. Do not wrap value in editorConfig or use a dotted source. Objects merge recursively; arrays replace. Settings use user scope. Discover the key first and correct validation errors before retrying.',
        },
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

const configurationKind = z.enum(['mcp', 'skill', 'settings'])
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
    value: z.unknown().optional(),
  }).strict().superRefine((request, ctx) => {
    if (request.kind === 'settings' && (request.value === undefined || request.scope !== 'user')) {
      ctx.addIssue({ code: 'custom', message: 'Settings require value and user scope' })
    }
    if (request.kind !== 'settings' && request.value !== undefined) ctx.addIssue({ code: 'custom', message: 'value is only valid for settings' })
  }),
  [APPLY_TOOL]: z.object({ change_set_id: z.string().uuid() }).strict(),
}

async function discoverConfigurations(args: { kind?: ExtensionKind; query?: string }): Promise<ExtensionOperationResult> {
  const query = args.query
  if (!query) {
    if (args.kind === 'settings') return api.extensions.search({ kind: 'settings', query: '*' })
    const result = await api.extensions.list()
    if (!args.kind || !result.installed) return result
    return { ...result, settings: undefined, installed: result.installed.filter(item => item.kind === args.kind), external: result.external?.filter(item => item.kind === args.kind) }
  }

  const repositoryQuery = /^(?:https:\/\/github\.com\/)?[\w.-]+\/[\w.-]+\/?$/.test(query)
  const kinds: ExtensionKind[] = args.kind ? [args.kind] : repositoryQuery ? ['skill'] : ['settings', 'mcp', 'skill']
  const settled = await Promise.allSettled(kinds.map(kind => api.extensions.search({ kind, query })))
  const responses = settled.map((response, i): ExtensionOperationResult => response.status === 'fulfilled'
    ? response.value : { success: false, error: `${kinds[i]}: ${response.reason instanceof Error ? response.reason.message : String(response.reason)}` })
  const errors = responses.flatMap((response, i) => !response.success ? [`${kinds[i]}: ${response.error || 'Discovery failed'}`] : [])
  const hasResults = responses.some(response => (response.results?.length || 0) + (response.settings?.length || 0) > 0)
  return {
    success: errors.length === 0 || hasResults,
    results: responses.flatMap(response => response.results || []),
    settings: responses.flatMap(response => response.settings || []),
    partial: errors.length > 0 && hasResults,
    warnings: errors.length ? errors : undefined,
    error: errors.length > 0 && !hasResults ? errors.join('; ') : undefined,
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
        const request = parsed as { kind: ExtensionKind; source: string; scope: 'user' | 'workspace'; value?: unknown }
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
