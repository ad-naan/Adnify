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

/**
 * 换掉整份凭据表：写失败就回滚内存。
 *
 * 顺序反过来（先改内存再 persist）时，一次写失败会让本次会话继续使用
 * 一组从未保存的凭据，内存和磁盘从此不一致，而调用方拿到异常也无从恢复。
 */
function commit(next: ProviderCredentials): void {
  const previous = credentials
  credentials = next
  try {
    persist()
  } catch (error) {
    credentials = previous
    throw error
  }
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
      try {
        store.set('app-settings', { ...appSettings, providerConfigs: nextProviderConfigs })
      } catch (error) {
        // 写不进去不能让启动挂掉：这个 set 只是把已经复制到 credentials 里的
        // apiKey 从 app-settings 清掉，失败的后果仅仅是下次启动再迁一次。
        // 它原本没有 try/catch，于是配置目录只读时会一路抛出 initStores()，
        // 而 whenReady 的 rejection 只被记录 —— 应用带着 0 个窗口活着。
        logger.store.error('[Credentials] Failed to strip legacy API keys from app-settings:', error)
      }
    }
  }

  // 旧版把 OAuth 凭据单独放在 userData/openai-auth.json。
  const legacyOAuthPath = path.join(app.getPath('userData'), 'openai-auth.json')
  let legacyOAuth: 'absent' | 'adopted' | 'redundant' | 'unusable' = 'absent'
  try {
    const raw = await fs.promises.readFile(legacyOAuthPath, 'utf8')
    const legacyCredential = { ...(JSON.parse(raw) as Record<string, unknown>), type: 'oauth' }
    if (credentials[OPENAI_OAUTH_PROVIDER]) {
      legacyOAuth = 'redundant'
    } else if (isOAuthCredential(legacyCredential)) {
      credentials[OPENAI_OAUTH_PROVIDER] = legacyCredential
      legacyOAuth = 'adopted'
      changed = true
    } else {
      legacyOAuth = 'unusable'
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      // 只记类型不记 message：JSON.parse 的报错会把出错位置附近的原文嵌进
      // message，而这个文件的原文就是 refresh token。
      logger.store.warn('[Credentials] Legacy OAuth migration failed', {
        reason: code ?? (error as Error).name,
      })
      legacyOAuth = 'unusable'
    }
  }

  let persisted = !changed
  if (changed) {
    try {
      persist()
      persisted = true
    } catch (error) {
      // 写不进去不该让启动失败：内存里的凭据本次会话仍然可用，
      // 旧文件也还在，下次启动可以重试迁移。
      logger.store.error('[Credentials] Failed to persist migrated credentials:', error)
    }
  }

  // 先确认已落到新存储，再删旧文件。反过来的话 persist() 一失败
  // （磁盘满、配置目录只读）凭据就两头都没了，用户表现为莫名退出登录
  // 且无法恢复 —— refresh token 是不可再生的。
  // 'unusable' 同样保留文件：既然没能迁走，就不该销毁唯一的副本。
  if (legacyOAuth === 'redundant' || (legacyOAuth === 'adopted' && persisted)) {
    try {
      await fs.promises.unlink(legacyOAuthPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.store.warn('[Credentials] Failed to remove legacy OAuth file', { reason: code })
      }
    }
  }
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
      // 只接受字符串：这个方法背后是 IPC，非字符串值能进内存并被
      // credentials:api-keys:get 读回去，但下次启动 readStoredCredentials 的
      // isApiKeyCredential 会把它整条丢掉 —— 用户看到的是「重启后 key 没了」。
      if (typeof apiKey === 'string' && apiKey) next[providerId] = { type: 'api-key', apiKey }
    }
    // 先落盘再改内存：反过来的话一次写失败就让本次会话用着一组从未保存的 key，
    // 内存和磁盘从此不一致，而用户毫无感知。
    commit(next)
  },

  getOAuth(providerId: string): OAuthCredential | null {
    const credential = credentials[providerId]
    if (!credential || credential.type !== 'oauth') return null
    const { type: _type, ...oauth } = credential
    return { ...oauth }
  },

  setOAuth(providerId: string, credential: OAuthCredential): void {
    commit({ ...credentials, [providerId]: { type: 'oauth', ...credential } })
  },

  clear(providerId: string): void {
    if (!credentials[providerId]) return
    const { [providerId]: _removed, ...rest } = credentials
    commit(rest)
  },
}
