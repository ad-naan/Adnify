import { z } from 'zod'
import { SETTINGS } from './settings'
import { serializePersistedLLMConfig } from './llmPersistence'
import { EXECUTION_SETTINGS_DEFAULTS, EXECUTION_SETTING_RANGES } from './executionSettings'
import { DEFAULT_BACKGROUND_TASK_SETTINGS } from '../types/backgroundTasks'
import { DEFAULT_ASSET_CONFIGURATION } from '../assets/configuration'
import { assetCapabilitySchema } from '../assets/capability'

const text = z.string().max(32_000)
const strings = z.array(text).max(1000)
const object = (shape: z.ZodRawShape) => z.object(shape).strict().partial()
const enums: Record<string, readonly [string, ...string[]]> = {
  language: ['en', 'zh'],
  'editorConfig.layoutDensity': ['compact', 'comfortable', 'expanded'],
  'editorConfig.wordWrap': ['on', 'off', 'wordWrapColumn'],
  'editorConfig.lineNumbers': ['on', 'off', 'relative'],
  'editorConfig.autoSave': ['off', 'afterDelay', 'onFocusChange'],
  'editorConfig.terminal.nodePackageManager': ['auto', 'npm', 'pnpm', 'yarn', 'bun'],
  'llmConfig.reasoningEffort': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  'llmConfig.toolChoice': ['auto', 'none', 'required'],
  'modelRouting.fallbackPolicy': ['primary_with_notice'],
  'modelRouting.handoffFormat': ['structured_summary_with_raw_block'],
  'previewSettings.device': ['desktop', 'phone', 'tablet'],
  'previewSettings.orientation': ['portrait', 'landscape'],
  'emotionPanelSettings.sensitivity': ['low', 'medium', 'high'],
  'indexConfig.mode': ['structural', 'semantic'],
  currentMode: ['agent', 'plan'],
}
const ranges: Record<string, readonly [number, number]> = {
  'editorConfig.fontSize': [8, 72], 'editorConfig.chatFontSize': [8, 72],
  'editorConfig.uiScale': [0.5, 3], 'editorConfig.tabSize': [1, 16],
  'editorConfig.lineHeight': [1, 3], 'editorConfig.minimapScale': [1, 3],
  'llmConfig.temperature': [0, 2], 'llmConfig.topP': [0, 1],
  'llmConfig.frequencyPenalty': [-2, 2], 'llmConfig.presencePenalty': [-2, 2],
  'previewSettings.zoomLevel': [-5, 5],
  ...Object.fromEntries(Object.entries(EXECUTION_SETTING_RANGES).map(([key, range]) => [`executionSettings.${key}`, range])),
}

export function settingsSchema(value: unknown, key: string): z.ZodTypeAny {
  if (enums[key]) return z.enum(enums[key])
  if (Array.isArray(value)) return strings
  if (value && typeof value === 'object') {
    return object(Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, settingsSchema(v, `${key}.${k}`)])))
  }
  if (typeof value === 'boolean') return z.boolean()
  if (typeof value === 'number') {
    const range = ranges[key] || [0, Number.MAX_SAFE_INTEGER]
    return z.number().finite().min(range[0]).max(range[1])
  }
  return text
}

export interface AgentSettingDefinition {
  key: string
  storageKey: string
  appField?: string
  defaults: unknown
  schema: z.ZodTypeAny
  description: string
  validate?: (value: unknown) => unknown
}

const descriptions: Record<string, string> = {
  editorConfig: 'Editor, fonts, layout, autosave, terminal, Git, LSP, performance and AI completion. 编辑器 字体 布局 自动保存 终端 性能',
  llmConfig: 'Active model and generation parameters. 模型 思考 温度',
  providerConfigs: 'Model providers, endpoints and custom models. 服务商 API 地址',
  agentConfig: 'Agent loops, context, retries, timeouts and ignored directories. 智能体 上下文 超时',
  proxySettings: 'Network proxy: enabled, rules and bypassRules. 网络 代理',
  securitySettings: 'Workspace trust and command security. 安全 工作区 信任',
  autoApprove: 'Approved terminal command rules. 自动批准 命令权限',
  language: 'Interface language. 语言 中文 英文',
  themeId: 'Theme identifier. 主题 外观',
  enableFileLogging: 'File logging (takes effect after restart). 日志 重启生效',
}

const llmDefaults = serializePersistedLLMConfig(SETTINGS.llmConfig.default)
const defaults: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(SETTINGS).map(([key, meta]) => [key, meta.default])),
  llmConfig: llmDefaults,
  executionSettings: EXECUTION_SETTINGS_DEFAULTS,
  backgroundTaskSettings: DEFAULT_BACKGROUND_TASK_SETTINGS,
  themeId: 'adnify-dark',
  keybindings: {}, snippets: [],
  previewSettings: { autoPrompt: false, dismissedOrigins: [], zoomLevel: 0, device: 'desktop', orientation: 'portrait' },
  emotionPanelSettings: { ambientGlow: true, soundEnabled: false, companionEnabled: true, privacyMode: false, sensitivity: 'medium', decorativeAnimations: true },
  indexConfig: { mode: 'structural', embedding: { provider: '', apiKey: '', model: '', baseUrl: '', cacheDir: '' } },
  assetConfiguration: DEFAULT_ASSET_CONFIGURATION,
  userProfile: { avatarStyle: 'adventurer', avatarSeed: 'Adnify', displayName: 'You' },
  emotionWelcome: { dismissed: false },
  currentMode: 'agent',
  customThemes: [],
  shellRegistry: { presets: [], links: [] },
}
const modelReference = object({ provider: text, model: text })
const capabilities = object({
  openAIReasoningModel: z.boolean(), openAIReasoningSupportsSampling: z.boolean(),
  openAICompatibleSupportsExtendedReasoningEffort: z.boolean(), openAIPromptCacheRetention: z.boolean(),
  openAIResponsesSupportsMaxOutputTokens: z.boolean(), googleThinkingMode: z.enum(['budget', 'level']),
  thinkingTagFormat: z.enum(['native', 'xml-think']), pseudoToolCallFallback: z.boolean(),
})
const json: z.ZodTypeAny = z.lazy(() => z.union([text, z.number().finite(), z.boolean(), z.null(), z.array(json).max(1000), z.record(json)]))
const overrides: Record<string, z.ZodTypeAny> = {
  llmConfig: (settingsSchema(llmDefaults, 'llmConfig') as z.AnyZodObject).extend({
    capabilities: capabilities.optional(), seed: z.number().int().optional(),
    topK: z.number().int().nonnegative().optional(), logitBias: z.record(z.number().min(-100).max(100)).optional(),
    toolChoice: z.union([z.enum(['auto', 'none', 'required']), z.object({ type: z.literal('tool'), toolName: text }).strict()]).optional(),
    providerOptions: object({ openai: z.record(json), anthropic: z.record(json), google: z.record(json) }).optional(),
  }),
  agentConfig: (settingsSchema(SETTINGS.agentConfig.default, 'agentConfig') as z.AnyZodObject).extend({
    retryBackoffMultiplier: z.number().min(1).max(10).optional(), enableAutoContext: z.boolean().optional(),
    pruneMinimumTokens: z.number().int().nonnegative().optional(), pruneProtectTokens: z.number().int().nonnegative().optional(),
    summaryMaxContextChars: object({ quick: z.number().int().positive(), detailed: z.number().int().positive(), handoff: z.number().int().positive() }).optional(),
    dynamicConcurrency: object({ enabled: z.boolean(), minConcurrency: z.number().int().positive(), maxConcurrency: z.number().int().positive(), cpuMultiplier: z.number().positive() }).optional(),
  }),
  providerConfigs: z.record(z.string().regex(/^[\w-]+$/), object({
    baseUrl: text, model: text, timeout: z.number().int().positive(), customModels: strings,
    displayName: text, protocol: z.enum(['openai', 'openai-responses', 'anthropic', 'google', 'custom']),
    openAICompatibilityProfile: z.enum(['full', 'compatible']),
    capabilities, headers: z.record(text),
  })),
  autoApprove: object({ terminalCommandRules: z.array(z.object({ executable: text.min(1), argumentPrefix: strings.min(1), description: text.optional() }).strict()).max(200) }),
  modelRouting: object({ enabled: z.boolean(), primary: modelReference, multimodal: modelReference,
    fallbackPolicy: z.literal('primary_with_notice'), handoffFormat: z.literal('structured_summary_with_raw_block') }),
  keybindings: z.record(z.string().max(200), z.string().max(200)),
  snippets: z.array(z.object({ id: text, name: text, prefix: text, body: text, languages: strings, description: text.optional(), createdAt: z.number(), updatedAt: z.number() }).strict()).max(500),
  assetConfiguration: object({ capabilities: z.array(assetCapabilitySchema).max(200), storage: object({ customRoot: text, projectRoots: z.record(text) }) }),
  shellRegistry: object({
    defaultShell: text,
    presets: z.array(z.object({ id: text, name: text, shellPath: text.optional(), cwd: text.optional(), args: strings.optional(), isDefault: z.boolean().optional(), visibleInMenu: z.boolean().optional(), group: text.optional(), favorite: z.boolean().optional() }).strict()).max(200),
    links: z.array(z.object({ id: text, name: text, type: z.enum(['local-shell', 'directory', 'remote', 'command']), target: text,
      shellPath: text.optional(), args: strings.optional(), visibleInMenu: z.boolean().optional(), group: text.optional(), favorite: z.boolean().optional(), cwd: text.optional(),
      remote: object({ host: text, port: z.number().int().min(1).max(65535), username: text, password: text, privateKeyPath: text, remotePath: text }).optional(),
    }).strict()).max(200),
  }),
  customThemes: z.array(z.object({ id: text, name: text, type: z.enum(['dark', 'light']), monacoTheme: text,
    colors: z.object(Object.fromEntries('background backgroundSecondary backgroundTertiary surface surfaceHover surfaceActive surfaceMuted textPrimary textSecondary textMuted textInverted border borderSubtle borderActive accent accentHover accentActive accentForeground accentSubtle statusSuccess statusWarning statusError statusInfo'.split(' ').map(key => [key, text]))).strict(),
  }).strict()).max(100),
}

/** An explicit registry: unknown storage paths are never Agent-writable. */
export const AGENT_SETTINGS: Record<string, AgentSettingDefinition> = Object.fromEntries(
  Object.entries(defaults).map(([key, value]) => {
    const isApp = Object.hasOwn(SETTINGS, key) && !['editorConfig', 'securitySettings'].includes(key)
    return [key, { key, storageKey: isApp ? 'app-settings' : key === 'currentMode' ? 'modeStore.currentMode' : key, appField: isApp ? key : undefined,
      defaults: value, schema: overrides[key] || settingsSchema(value, key), description: descriptions[key] || key }]
  }),
)

export function mergeSettings(current: unknown, patch: unknown): unknown {
  if (patch === '[REDACTED]') throw new Error('Do not write redacted placeholders; omit unchanged credential fields')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch)
  const result: Record<string, unknown> = current && typeof current === 'object' && !Array.isArray(current) ? structuredClone(current as Record<string, unknown>) : {}
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid configuration property')
    if (value !== undefined) result[key] = mergeSettings(result[key], value)
  }
  return result
}

export function redactSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSettings)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    /api.?key|token$|secret|password|authorization|headers|privateKey|webhooks/i.test(key) ? (entry ? '[REDACTED]' : entry) : redactSettings(entry),
  ]))
  if (typeof value === 'string') return value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@')
  return value
}

export function describeSetting(definition: AgentSettingDefinition, current: unknown) {
  return {
    key: definition.key, scope: 'user', description: definition.description,
    value: redactSettings({ [definition.key]: current }),
    defaults: redactSettings({ [definition.key]: definition.defaults }),
    schema: describeSchema(definition.schema),
    enums: Object.fromEntries(Object.entries(enums).filter(([key]) => key === definition.key || key.startsWith(`${definition.key}.`))),
    ranges: Object.fromEntries(Object.entries(ranges).filter(([key]) => key.startsWith(`${definition.key}.`))),
    update: 'configuration_prepare(kind="settings", source=key, scope="user", value=partial object or scalar). JSON-encoded objects/arrays are also accepted. Do not repeat the setting key inside value or use dotted source paths. Objects merge; arrays replace.',
  }
}

/** Compact JSON Schema for discovery, including optional fields absent in defaults. */
export function describeSchema(schema: z.ZodTypeAny, depth = 0): Record<string, unknown> {
  if (depth > 10) return {}
  const next = (child: z.ZodTypeAny) => describeSchema(child, depth + 1)
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return next(schema.unwrap())
  if (schema instanceof z.ZodEffects) return next(schema.innerType())
  if (schema instanceof z.ZodLazy) return next(schema.schema)
  if (schema instanceof z.ZodObject) return { type: 'object', properties: Object.fromEntries(Object.entries(schema.shape).map(([key, child]) => [key, next(child as z.ZodTypeAny)])), additionalProperties: false }
  if (schema instanceof z.ZodRecord) return { type: 'object', additionalProperties: next(schema.valueSchema) }
  if (schema instanceof z.ZodArray) return { type: 'array', items: next(schema.element) }
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options }
  if (schema instanceof z.ZodLiteral) return { const: schema.value }
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map(next) }
  if (schema instanceof z.ZodString) return { type: 'string' }
  if (schema instanceof z.ZodNumber) return { type: 'number', minimum: schema.minValue ?? undefined, maximum: schema.maxValue ?? undefined }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodNull) return { type: 'null' }
  return {}
}
