import { z } from 'zod'
import type { ToolConfig } from '@shared/config/tools'
import type { ToolLoadingContext } from '@shared/config/toolGroups'
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '@shared/types'
import { api } from '@services/electronAPI'
import type { ToolProvider } from './types'

const definitions: ToolDefinition[] = [
  {
    name: 'extension_list',
    description: 'List installed MCP servers and Adnify Skills in user and current-workspace scopes, including runtime status. Use this before proposing a new installation.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'extension_history',
    description: 'Read recent persisted extension audit events. Secret values and resolved configuration are never included.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Number of recent events, from 1 to 100.' } },
    },
  },
  {
    name: 'extension_search',
    description: 'Search trusted MCP and Skill registries. Use the exact returned source value when preparing an installation.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mcp', 'skill'], description: 'Extension type.' },
        query: { type: 'string', description: 'Capability, server, or Skill name to search for.' },
      },
      required: ['kind', 'query'],
    },
  },
  {
    name: 'extension_prepare',
    description: 'Resolve an MCP or Skill source into an expiring, immutable change set. This does not install anything. Show the returned summary and credential requirements to the user before applying.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mcp', 'skill'], description: 'Extension type.' },
        source: { type: 'string', description: 'Exact source returned by extension_search.' },
        scope: { type: 'string', enum: ['user', 'workspace'], description: 'Install for the user or only the current workspace.' },
      },
      required: ['kind', 'source', 'scope'],
    },
  },
  {
    name: 'extension_apply',
    description: 'Apply one prepared extension change set after explicit user approval. The main process stage-verifies the extension and rolls back failed installs. Never invent or alter a change-set ID.',
    parameters: {
      type: 'object',
      properties: { change_set_id: { type: 'string', description: 'Opaque ID returned by extension_prepare.' } },
      required: ['change_set_id'],
    },
  },
  {
    name: 'extension_verify',
    description: 'Verify a previously committed extension change set without modifying it.',
    parameters: {
      type: 'object',
      properties: { change_set_id: { type: 'string', description: 'Opaque change-set ID.' } },
      required: ['change_set_id'],
    },
  },
]

const extensionKind = z.enum(['mcp', 'skill'])
const extensionScope = z.enum(['user', 'workspace'])
const changeSetId = z.string().uuid()
const schemas: Record<string, z.ZodTypeAny> = {
  extension_list: z.object({}).strict(),
  extension_history: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
  extension_search: z.object({ kind: extensionKind, query: z.string().trim().min(1).max(200) }).strict(),
  extension_prepare: z.object({ kind: extensionKind, source: z.string().trim().min(1).max(500), scope: extensionScope }).strict(),
  extension_apply: z.object({ change_set_id: changeSetId }).strict(),
  extension_verify: z.object({ change_set_id: changeSetId }).strict(),
}

const readOnlyTools = new Set(['extension_list', 'extension_history', 'extension_search', 'extension_verify'])

export class ConfigurationToolProvider implements ToolProvider {
  readonly id = 'configuration'
  readonly name = 'Extension configuration'
  private context: ToolLoadingContext = { mode: 'agent' }

  setContext(context: ToolLoadingContext): void {
    this.context = context
  }

  hasTool(name: string): boolean {
    return Boolean(schemas[name])
  }

  getToolDefinitions(): ToolDefinition[] {
    const readOnly = this.context.isSubAgent || (this.context.mode === 'plan' && this.context.planPhase !== 'executing')
    return readOnly ? definitions.filter(definition => readOnlyTools.has(definition.name)) : definitions
  }

  getApprovalType(name: string) {
    return name === 'extension_apply' ? 'dangerous' as const : 'none' as const
  }

  getMetadata(name: string): ToolConfig | undefined {
    if (!this.hasTool(name)) return undefined
    return {
      name,
      displayName: definitions.find(definition => definition.name === name)?.description || name,
      description: 'Search, prepare, apply, and verify Agent-managed MCP and Skill extensions.',
      category: name === 'extension_apply' ? 'write' : 'network',
      approvalType: this.getApprovalType(name),
      parallel: false,
      outputFormat: 'json',
      retryPolicy: { maxAttempts: 1 },
      resourceScope: name === 'extension_apply' ? ['extensions:write'] : ['extensions:read'],
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
    if (ctx.abortSignal?.aborted) throw new Error('Execution stopped before starting the extension operation')
    if ((ctx.isSubAgent || (ctx.chatMode === 'plan' && ctx.planPhase !== 'executing')) && !readOnlyTools.has(name)) {
      throw new Error('Extension changes are unavailable in planning or hidden agents')
    }
    const args = { ...rawArgs }
    delete args._meta
    const parsed = schemas[name].parse(args) as Record<string, string>
    if (name === 'extension_apply' && !ctx.securityApproval) throw new Error('Installing an extension requires explicit approval')

    const result = name === 'extension_list'
      ? await api.extensions.list()
      : name === 'extension_history'
        ? await api.extensions.history(parsed.limit ? Number(parsed.limit) : undefined)
        : name === 'extension_search'
          ? await api.extensions.search({ kind: parsed.kind as 'mcp' | 'skill', query: parsed.query })
      : name === 'extension_prepare'
        ? await api.extensions.prepare({
          kind: parsed.kind as 'mcp' | 'skill',
          source: parsed.source,
          scope: parsed.scope as 'user' | 'workspace',
          workspacePath: ctx.workspacePath,
        })
        : name === 'extension_apply'
          ? await api.extensions.apply({ changeSetId: parsed.change_set_id, approval: ctx.securityApproval! })
          : await api.extensions.verify(parsed.change_set_id)

    return {
      success: result.success,
      result: JSON.stringify(result),
      error: result.error,
      outcome: { kind: result.success ? 'success' : 'error', retryable: false },
    }
  }
}

export const configurationToolProvider = new ConfigurationToolProvider()
