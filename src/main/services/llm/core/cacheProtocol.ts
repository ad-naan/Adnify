import type { ApiProtocol } from '@shared/config/providers'

export function resolveCacheProtocol(protocol: ApiProtocol | undefined, provider: string): ApiProtocol {
  if (protocol === 'custom') {
    return 'openai'
  }

  if (protocol) {
    return protocol
  }

  if (provider === 'anthropic') {
    return 'anthropic'
  }

  if (provider === 'gemini') {
    return 'google'
  }

  return 'openai'
}
