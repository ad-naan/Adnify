/**
 * Central provider definitions and protocol helpers.
 */

export type AuthType = 'bearer' | 'api-key' | 'header' | 'query' | 'none'
export type ApiProtocol = 'openai' | 'openai-responses' | 'anthropic' | 'google' | 'custom'
export type OpenAICompatibilityProfile = 'compatible' | 'full'

export interface AuthConfig {
  type: AuthType
  placeholder?: string
  helpUrl?: string
}

export interface ProtocolConfig {
  authHeader?: {
    name: string
    template: string
  }
  staticHeaders?: Record<string, string>
}

export interface ProviderFeatures {
  streaming: boolean
  tools: boolean
  vision?: boolean
  reasoning?: boolean
}

export interface LLMDefaults {
  maxTokens: number
  temperature: number
  topP: number
  timeout: number
}

export interface BaseProviderConfig {
  id: string
  displayName: string
  description: string
  baseUrl: string
  models: string[]
  defaultModel: string
  protocol: ApiProtocol
  features: ProviderFeatures
  defaults: LLMDefaults
  auth: AuthConfig
}

export interface BuiltinProviderDef extends BaseProviderConfig {
  readonly isBuiltin: true
}

export interface CustomProviderConfig extends BaseProviderConfig {
  isBuiltin: false
  createdAt?: number
  updatedAt?: number
}

export interface UserProviderConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  model?: string
  customModels?: string[]
  headers?: Record<string, string>
  openAICompatibilityProfile?: OpenAICompatibilityProfile
  displayName?: string
  protocol?: ApiProtocol
  createdAt?: number
  updatedAt?: number
}

const PROTOCOL_CONFIGS: Record<ApiProtocol, ProtocolConfig> = {
  openai: {
    authHeader: {
      name: 'Authorization',
      template: 'Bearer {{apiKey}}',
    },
  },
  'openai-responses': {
    authHeader: {
      name: 'Authorization',
      template: 'Bearer {{apiKey}}',
    },
  },
  anthropic: {
    authHeader: {
      name: 'x-api-key',
      template: '{{apiKey}}',
    },
    staticHeaders: {
      'anthropic-version': '2023-06-01',
    },
  },
  google: {
    authHeader: {
      name: 'x-goog-api-key',
      template: '{{apiKey}}',
    },
  },
  custom: {},
}

export function getProtocolConfig(protocol: ApiProtocol): ProtocolConfig {
  return PROTOCOL_CONFIGS[protocol] || {}
}

export function getDefaultHeadersByProtocol(protocol: ApiProtocol): Record<string, string> {
  const config = getProtocolConfig(protocol)
  const headers: Record<string, string> = {}

  if (config.authHeader) {
    headers[config.authHeader.name] = config.authHeader.template
  }

  if (config.staticHeaders) {
    Object.assign(headers, config.staticHeaders)
  }

  return headers
}

export function getProviderDefaultHeaders(
  providerId: string,
  customProtocol?: ApiProtocol,
): Record<string, string> {
  const builtinProvider = BUILTIN_PROVIDERS[providerId]
  if (builtinProvider) {
    return getDefaultHeadersByProtocol(builtinProvider.protocol)
  }

  if (customProtocol) {
    return getDefaultHeadersByProtocol(customProtocol)
  }

  return {}
}

export function replaceHeaderTemplates(
  headers: Record<string, string>,
  apiKey: string,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = value.replace(/\{\{apiKey\}\}/g, apiKey)
  }
  return result
}

export const BUILTIN_PROVIDERS: Record<string, BuiltinProviderDef> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    description: 'GPT-4, GPT-4o, o-series, and GPT-5 models',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
    defaultModel: 'gpt-4o',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-proj-...', helpUrl: 'https://platform.openai.com/api-keys' },
    isBuiltin: true,
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude 3.5 and Claude 4 models',
    baseUrl: 'https://api.anthropic.com',
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'api-key', placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys' },
    isBuiltin: true,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    description: 'Gemini Pro and Gemini Flash models',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.5-pro-preview-05-06'],
    defaultModel: 'gemini-2.0-flash-exp',
    protocol: 'google',
    features: { streaming: true, tools: true, vision: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'query', placeholder: 'AIzaSy...', helpUrl: 'https://aistudio.google.com/apikey' },
    isBuiltin: true,
  },
}

export function getBuiltinProviderIds(): string[] {
  return Object.keys(BUILTIN_PROVIDERS)
}

export function isBuiltinProvider(providerId: string): boolean {
  return providerId in BUILTIN_PROVIDERS
}

export function getBuiltinProvider(providerId: string): BuiltinProviderDef | undefined {
  return BUILTIN_PROVIDERS[providerId]
}

export function getProviderDefaultModel(providerId: string): string {
  const provider = BUILTIN_PROVIDERS[providerId]
  return provider?.defaultModel || provider?.models[0] || ''
}

export function getProviderProtocol(providerId: string): ApiProtocol {
  const provider = BUILTIN_PROVIDERS[providerId]
  return provider?.protocol || 'openai'
}

export function isOpenAIStyleProtocol(
  protocol: ApiProtocol | undefined,
): protocol is 'openai' | 'openai-responses' {
  return protocol === 'openai' || protocol === 'openai-responses'
}

export function getDefaultOpenAICompatibilityProfile(
  providerId: string,
  protocol: ApiProtocol | undefined,
): OpenAICompatibilityProfile | undefined {
  if (!isOpenAIStyleProtocol(protocol)) {
    return undefined
  }

  if (providerId === 'openai' || protocol === 'openai-responses') {
    return 'full'
  }

  return 'compatible'
}

export function resolveOpenAICompatibilityProfile(
  providerId: string,
  protocol: ApiProtocol | undefined,
  configuredProfile?: OpenAICompatibilityProfile,
): OpenAICompatibilityProfile | undefined {
  return configuredProfile ?? getDefaultOpenAICompatibilityProfile(providerId, protocol)
}

export function supportsFullOpenAIStyleFeatures(
  providerId: string,
  protocol: ApiProtocol | undefined,
  configuredProfile?: OpenAICompatibilityProfile,
): boolean {
  return resolveOpenAICompatibilityProfile(providerId, protocol, configuredProfile) === 'full'
}

/** @deprecated Use BUILTIN_PROVIDERS directly. */
export const PROVIDERS = BUILTIN_PROVIDERS
