import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userDataPath },
}))

import { ProviderCredentialStore } from '@main/services/credentials/ProviderCredentialStore'

class MemoryStore {
  constructor(private readonly values: Record<string, unknown> = {}) {}
  get(key: string): unknown { return this.values[key] }
  set(key: string, value: unknown): void { this.values[key] = value }
}

describe('ProviderCredentialStore', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-credentials-'))
    electronState.userDataPath = tempDir
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('migrates API keys and OAuth into one provider credential map and removes old storage', async () => {
    const store = new MemoryStore({
      'app-settings': {
        providerConfigs: {
          openai: { apiKey: 'sk-test', model: 'gpt-5' },
        },
      },
    })
    const oauth = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
      accountID: 'account',
    }
    const legacyPath = path.join(tempDir, 'openai-auth.json')
    fs.writeFileSync(legacyPath, JSON.stringify(oauth))

    await ProviderCredentialStore.initialize(store as never)

    expect(ProviderCredentialStore.getApiKeys()).toEqual({ openai: 'sk-test' })
    expect(ProviderCredentialStore.getOAuth('openai-oauth')).toEqual(oauth)
    expect(fs.existsSync(legacyPath)).toBe(false)
    expect(store.get('app-settings')).toEqual({
      providerConfigs: { openai: { model: 'gpt-5' } },
    })
  })

  it('replaces API keys without touching OAuth credentials', async () => {
    const store = new MemoryStore({
      providerCredentials: {
        anthropic: { type: 'api-key', apiKey: 'old' },
        'openai-oauth': {
          type: 'oauth',
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: 123,
        },
      },
    })
    await ProviderCredentialStore.initialize(store as never)

    ProviderCredentialStore.replaceApiKeys({ openai: 'new' })

    expect(ProviderCredentialStore.getApiKeys()).toEqual({ openai: 'new' })
    expect(ProviderCredentialStore.getOAuth('openai-oauth')).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
    })
  })

  // 迁移曾经是「先 unlink 旧文件，再 persist()」。persist 失败（磁盘满、
  // 配置目录只读）时 refresh token 两头都没了，用户表现为莫名退出登录，
  // 而 refresh token 不可再生 —— 无法恢复。
  describe('legacy OAuth migration is not destructive', () => {
    const oauth = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 1_700_000_000_000,
      accountID: 'account',
    }

    it('keeps the legacy file when persisting the migrated credential fails', async () => {
      const legacyPath = path.join(tempDir, 'openai-auth.json')
      fs.writeFileSync(legacyPath, JSON.stringify(oauth))
      const store = new MemoryStore()
      store.set = () => { throw new Error('EROFS: read-only file system') }

      // 启动不应该因为写不进配置就失败
      await expect(ProviderCredentialStore.initialize(store as never)).resolves.toBeUndefined()

      // 本次会话内存里仍可用，旧文件保留下来供下次启动重试
      expect(ProviderCredentialStore.getOAuth('openai-oauth')).toEqual(oauth)
      expect(fs.existsSync(legacyPath)).toBe(true)
    })

    it('keeps an unparseable legacy file instead of destroying the only copy', async () => {
      const legacyPath = path.join(tempDir, 'openai-auth.json')
      fs.writeFileSync(legacyPath, '{"refreshToken": "truncated')

      await ProviderCredentialStore.initialize(new MemoryStore() as never)

      expect(fs.existsSync(legacyPath)).toBe(true)
    })

    it('removes the legacy file when the new store already holds the credential', async () => {
      const legacyPath = path.join(tempDir, 'openai-auth.json')
      fs.writeFileSync(legacyPath, JSON.stringify(oauth))
      const store = new MemoryStore({
        providerCredentials: { 'openai-oauth': { type: 'oauth', ...oauth } },
      })

      await ProviderCredentialStore.initialize(store as never)

      expect(fs.existsSync(legacyPath)).toBe(false)
      expect(ProviderCredentialStore.getOAuth('openai-oauth')).toEqual(oauth)
    })
  })
})
