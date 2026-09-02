/**
 * 主进程抛码、渲染层解析的往返。
 *
 * 这条通路上没有类型能兜住的地方只有一处：码是编在 `Error.message` 里的字符串，
 * 而它要穿过五种 IPC 形状，中途可能被别的 catch 加前缀。所以这里钉的是解析器的边界行为，
 * 不是文案内容（文案有 localeParity 守）。
 */
import { describe, expect, it } from 'vitest'
import {
  providerAuthError,
  providerAuthErrorText,
  tryProviderAuthErrorText,
  type ProviderAuthErrorCode,
} from '@shared/errors/providerAuthError'
import { toAppError } from '@shared/utils/errorHandler'
import { translations } from '@shared/i18n'

/**
 * 码的清单从 locale 表推出来，而不是在测试里再抄一遍：新增一个码必须同时补两个语言的键
 * （`t()` 的模板字面量类型逼着补），所以下面那条遍历会自动覆盖到它。
 */
const CODES = Object.keys(translations.en)
  .filter((key) => key.startsWith('providerAuthError.'))
  .map((key) => key.slice('providerAuthError.'.length) as ProviderAuthErrorCode)

describe('providerAuthError', () => {
  it('round-trips a code with no params in both languages', () => {
    const message = providerAuthError('chatgptNotSignedIn').message
    expect(tryProviderAuthErrorText(message, 'en')).toBe(translations.en['providerAuthError.chatgptNotSignedIn'])
    expect(tryProviderAuthErrorText(message, 'zh')).toBe(translations.zh['providerAuthError.chatgptNotSignedIn'])
  })

  it('interpolates params through the locale table', () => {
    const provider = providerAuthError('providerKeyMissing', { provider: 'Z.ai' }).message
    expect(tryProviderAuthErrorText(provider, 'en')).toContain('Z.ai')
    expect(tryProviderAuthErrorText(provider, 'zh')).toContain('Z.ai')

    // 端口是数字，编码时要串化，解析后仍要出现在文案里。
    const port = providerAuthError('oauthPortInUse', { port: 1455 }).message
    expect(tryProviderAuthErrorText(port, 'en')).toContain('1455')
  })

  it('encodes a display name containing a space without breaking the token', () => {
    // 解析器切到第一个空白为止，所以参数值里的空格必须是被编码过的（`+`），
    // 否则显示名带空格的自定义供应商会把码截断。
    const message = providerAuthError('providerKeyMissing', { provider: 'My Gateway' }).message
    expect(message).not.toMatch(/\s/)
    expect(tryProviderAuthErrorText(message, 'en')).toContain('My Gateway')
  })

  it('survives an upstream prefix', () => {
    // `StructuredService` 那条路径上 Electron 会串化成这个形状。
    const wrapped = `Error invoking remote method 'llm:generateObject': LLMError: ${providerAuthError('openAiKeyMissing').message}`
    expect(tryProviderAuthErrorText(wrapped, 'en')).toBe(translations.en['providerAuthError.openAiKeyMissing'])
  })

  it('refuses a garbled code instead of rendering a raw key', () => {
    // 尾巴粘上来之后 `t()` 会缺键并原样返回键名 —— 那比退回原文更糟，所以要认不出。
    const trailing = `${providerAuthError('oauthLoginTimeout').message}.`
    expect(tryProviderAuthErrorText(trailing, 'en')).toBeNull()
    expect(providerAuthErrorText(trailing, 'en')).toBe(trailing)
  })

  it('is the identity function for anything else', () => {
    expect(tryProviderAuthErrorText('Request timed out', 'en')).toBeNull()
    expect(providerAuthErrorText('Request timed out', 'en')).toBe('Request timed out')
    expect(providerAuthErrorText(undefined, 'en')).toBe('')
    expect(providerAuthErrorText('', 'zh')).toBe('')
  })

  it('keeps every code intact through toAppError', () => {
    // 这条钉的是本类和 `mapAISDKError` 关键词兜底的关系。`oauthLoginTimeout` 的码名里带
    // `timeout`，撞上 `msg.includes('timeout')` 之后 `toAppError` 会把整条 message 换成
    // `getErrorMessage(TIMEOUT)`（"请求超时"）—— 码在 `safeIpcHandle` 那层就丢了，
    // 渲染层拿到的是通用文案。OAuth 登录走的正是这条包装。
    //
    // 遍历而不是只测那一个码：下次加的码要是叫 `…Network` 或 `…Fetch`，同样会被吃掉。
    expect(CODES.length).toBeGreaterThan(0)
    for (const code of CODES) {
      const appError = toAppError(providerAuthError(code, { provider: 'Z.ai', port: 1455 }))
      expect(tryProviderAuthErrorText(appError.message, 'en'), code).not.toBeNull()
    }
  })
})
