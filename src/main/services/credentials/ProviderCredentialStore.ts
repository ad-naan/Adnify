import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type Store from 'electron-store'
import { logger } from '@shared/utils/Logger'

export interface OAuthCredential {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountID?: string
  email?: string
  planType?: string
}

type ProviderCredential =
  | { type: 'api-key'; apiKey: string }
  | ({ type: 'oauth' } & OAuthCredential)

type ProviderCredentials = Record<string, ProviderCredential>

const STORE_KEY = 'providerCredentials'
const OPENAI_OAUTH_PROVIDER = 'openai-oauth'

let credentialStore: Store<Record<string, unknown>> | null = null
let credentials: ProviderCredentials = {}

function requireStore(): Store<Record<string, unknown>> {
  if (!credentialStore) throw new Error('Provider credential store is not initialized')
  return credentialStore
}

function persist(): void {
  requireStore().set(STORE_KEY, credentials)
}

function isOAuthCredential(value: unknown): value is ProviderCredential & { type: 'oauth' } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.type === 'oauth'
    && typeof record.accessToken === 'string'
    && typeof record.refreshToken === 'string'
    && typeof record.expiresAt === 'number'
}

function isApiKeyCredential(value: unknown): value is ProviderCredential & { type: 'api-key' } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.type === 'api-key' && typeof record.apiKey === 'string' && record.apiKey.length > 0
}

function readStoredCredentials(store: Store<Record<string, unknown>>): ProviderCredentials {
  const stored = store.get(STORE_KEY)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

  return Object.fromEntries(
    Object.entries(stored).filter(([, credential]) =>
      isApiKeyCredential(credential) || isOAuthCredential(credential)
    )
  ) as ProviderCredentials
}

async function migrateLegacyCredentials(store: Store<Record<string, unknown>>): Promise<void> {
  let changed = false
  const appSettings = store.get('app-settings') as Record<string, unknown> | undefined
  const providerConfigs = appSettings?.providerConfigs as Record<string, Record<string, unknown>> | undefined

  if (providerConfigs) {
    const nextProviderConfigs: Record<string, Record<string, unknown>> = {}
    for (const [providerId, config] of Object.entries(providerConfigs)) {
      const { apiKey, ...rest } = config
      nextProviderConfigs[providerId] = rest
      if (typeof apiKey === 'string' && apiKey && !credentials[providerId]) {
        credentials[providerId] = { type: 'api-key', apiKey }
        changed = true
      }
    }
    if (Object.values(providerConfigs).some(config => typeof config.apiKey === 'string')) {
      store.set('app-settings', { ...appSettings, providerConfigs: nextProviderConfigs })
    }
  }

  const legacyOAuthPath = path.join(app.getPath('userData'), 'openai-auth.json')
  try {
    const parsed = JSON.parse(await fs.promises.readFile(legacyOAuthPath, 'utf8'))
    const legacyCredential = { ...parsed, type: 'oauth' }
    if (!credentials[OPENAI_OAUTH_PROVIDER] && isOAuthCredential(legacyCredential)) {
      credentials[OPENAI_OAUTH_PROVIDER] = legacyCredential
      changed = true
    }
    await fs.promises.unlink(legacyOAuthPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.store.warn('[Credentials] Legacy OAuth migration failed:', error)
    }
  }

  if (changed) persist()
}

export const ProviderCredentialStore = {
  async initialize(store: Store<Record<string, unknown>>): Promise<void> {
    credentialStore = store
    credentials = readStoredCredentials(store)
    await migrateLegacyCredentials(store)
  },

  getApiKeys(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [providerId, credential] of Object.entries(credentials)) {
      if (credential.type === 'api-key') result[providerId] = credential.apiKey
    }
    return result
  },

  replaceApiKeys(apiKeys: Record<string, string>): void {
    const next = Object.fromEntries(
      Object.entries(credentials).filter(([, credential]) => credential.type !== 'api-key')
    ) as ProviderCredentials
    for (const [providerId, apiKey] of Object.entries(apiKeys)) {
      if (apiKey) next[providerId] = { type: 'api-key', apiKey }
    }
    credentials = next
    persist()
  },

  getOAuth(providerId: string): OAuthCredential | null {
    const credential = credentials[providerId]
    if (!credential || credential.type !== 'oauth') return null
    const { type: _type, ...oauth } = credential
    return { ...oauth }
  },

  setOAuth(providerId: string, credential: OAuthCredential): void {
    credentials = { ...credentials, [providerId]: { type: 'oauth', ...credential } }
    persist()
  },

  clear(providerId: string): void {
    if (!credentials[providerId]) return
    const { [providerId]: _removed, ...rest } = credentials
    credentials = rest
    persist()
  },
}
