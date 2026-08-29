/**
 * 通用 settings 通道不得读写凭据键。
 *
 * 回归背景：OAuth 的 access/refresh token 原本存在 userData/openai-auth.json
 * （0600，settings 通道碰不到），改用 ProviderCredentialStore 后落进
 * config.json 的 `providerCredentials` 键，于是渲染进程里任意脚本
 * `getSetting('providerCredentials')` 就能一次性拿走全部凭据。
 */

import { describe, expect, it } from 'vitest'
import { isSensitiveSettingsKey, sensitiveSettingsKeyError } from '@main/ipc/sensitiveSettings'

describe('isSensitiveSettingsKey', () => {
  it('拦截凭据键', () => {
    expect(isSensitiveSettingsKey('providerCredentials')).toBe(true)
  })

  it('按点号首段判断，覆盖 electron-store 的路径式读取', () => {
    // 只挡整键而放过路径等于没挡：store.get('a.b') 是 electron-store 的合法用法
    expect(isSensitiveSettingsKey('providerCredentials.openai-oauth')).toBe(true)
    expect(isSensitiveSettingsKey('providerCredentials.openai-oauth.refreshToken')).toBe(true)
  })

  it('放行普通设置键', () => {
    for (const key of ['app-settings', 'securitySettings', 'language', 'lastWorkspacePath']) {
      expect(isSensitiveSettingsKey(key)).toBe(false)
    }
  })

  it('不把前缀相同的其他键误判为敏感', () => {
    expect(isSensitiveSettingsKey('providerCredentialsBackup')).toBe(false)
    expect(isSensitiveSettingsKey('providerConfigs')).toBe(false)
  })

  it('非字符串键不参与判断', () => {
    expect(isSensitiveSettingsKey(undefined)).toBe(false)
    expect(isSensitiveSettingsKey(42)).toBe(false)
  })

  it('错误信息带上键名但不带值', () => {
    expect(sensitiveSettingsKeyError('providerCredentials').message).toContain('providerCredentials')
  })
})
