import { safeIpcHandle } from './safeHandle'
import { ProviderCredentialStore } from '../services/credentials/ProviderCredentialStore'
import { OpenAIAuthService } from '../services/openai/OpenAIAuthService'
import { OpenAIUsageStore } from '../services/openai/OpenAIUsageStore'
import { logger } from '@shared/utils/Logger'

const CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

async function refreshUsage(): Promise<boolean> {
  const token = await OpenAIAuthService.getValidToken()
  if (!token) return false

  const { accountID } = await OpenAIAuthService.getStatus()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(CHATGPT_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(accountID ? { 'chatgpt-account-id': accountID } : {}),
        originator: 'adnify',
      },
      signal: controller.signal,
      body: JSON.stringify({ model: 'gpt-5.5', input: [], store: false, stream: true }),
    })
    return OpenAIUsageStore.captureFromHeaders(response.headers)
  } catch (error) {
    logger.ipc.warn('[Credentials] OAuth usage refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export function registerProviderCredentialHandlers(): void {
  safeIpcHandle('credentials:api-keys:get', async () => ProviderCredentialStore.getApiKeys())
  safeIpcHandle('credentials:api-keys:replace', async (_event, apiKeys: Record<string, string>) => {
    ProviderCredentialStore.replaceApiKeys(apiKeys)
    return true
  })

  safeIpcHandle('credentials:oauth:login', async () => {
    const tokens = await OpenAIAuthService.login()
    return { success: true, accountID: tokens.accountID }
  })

  safeIpcHandle('credentials:oauth:logout', async () => {
    await OpenAIAuthService.logout()
    OpenAIUsageStore.clear()
    return { success: true }
  })

  safeIpcHandle('credentials:oauth:usage', async (_event, options?: { refresh?: boolean }) => {
    if (options?.refresh || !OpenAIUsageStore.get()) await refreshUsage()
    return { usage: OpenAIUsageStore.get() }
  })

  safeIpcHandle('credentials:oauth:status', async () => OpenAIAuthService.getStatus())
  // 这里曾经有一个 credentials:oauth:token 通道，直接把刷新后的 ChatGPT
  // access token 交给渲染进程，而渲染进程从来没有调用过它 —— 所有真正的消费方
  // （modelFactory、healthCheck）都在主进程里直接调 getValidToken()。
  // 打包后的 CSP 是 connect-src 'self' https:，一个能在渲染进程里执行的脚本
  // 拿到 bearer token 就能发去任意 HTTPS 主机，所以这是纯粹白送的攻击面。
}
