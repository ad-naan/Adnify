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
  safeIpcHandle('credentials:oauth:token', async () => ({
    token: await OpenAIAuthService.getValidToken(),
  }))
}
