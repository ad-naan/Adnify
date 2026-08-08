import { safeIpcHandle } from './safeHandle'
import { OpenAIAuthService } from '../services/openai/OpenAIAuthService'
import { OpenAIUsageStore } from '../services/openai/OpenAIUsageStore'
import { logger } from '@shared/utils/Logger'

const CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/**
 * Refresh the usage snapshot by issuing a deliberately invalid request.
 *
 * The ChatGPT backend has no quota endpoint, but it attaches `x-codex-*` usage
 * headers to *every* response — including 4xx ones. Sending an empty input is
 * rejected before any tokens are billed, which makes it a cheap probe.
 */
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
    logger.ipc.warn('[OpenAIAuth] Usage refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export function registerOpenAIAuthHandlers(): void {
  safeIpcHandle('openai:auth:login', async () => {
    const tokens = await OpenAIAuthService.login()
    return { success: true, accountID: tokens.accountID }
  })

  safeIpcHandle('openai:auth:logout', async () => {
    await OpenAIAuthService.logout()
    OpenAIUsageStore.clear()
    return { success: true }
  })

  safeIpcHandle('openai:auth:usage', async (_event, options?: { refresh?: boolean }) => {
    // Serve the cached snapshot unless the caller explicitly wants a probe;
    // every real request keeps it current for free.
    if (options?.refresh || !OpenAIUsageStore.get()) {
      await refreshUsage()
    }
    return { usage: OpenAIUsageStore.get() }
  })

  safeIpcHandle('openai:auth:status', async () => {
    return OpenAIAuthService.getStatus()
  })

  safeIpcHandle('openai:auth:token', async () => {
    const token = await OpenAIAuthService.getValidToken()
    return { token }
  })
}
