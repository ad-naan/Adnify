import { type Language } from '@renderer/i18n'

interface HitokotoResponse {
  hitokoto?: string
  from?: string
  from_who?: string | null
}

const HITOKOTO_ENDPOINT = 'https://v1.hitokoto.cn/'
const HITOKOTO_TIMEOUT_MS = 2800

export async function fetchWorkPosterQuote(language: Language, signal?: AbortSignal): Promise<string> {
  if (language !== 'zh') {
    return ''
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), HITOKOTO_TIMEOUT_MS)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })

  try {
    const url = new URL(HITOKOTO_ENDPOINT)
    url.searchParams.set('encode', 'json')
    url.searchParams.set('min_length', '8')
    url.searchParams.set('max_length', '42')

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Hitokoto failed with ${response.status}`)
    }

    const data = await response.json() as HitokotoResponse
    const quote = data.hitokoto?.trim()
    if (!quote) {
      throw new Error('Hitokoto returned empty quote')
    }

    const source = [data.from_who, data.from].filter(Boolean).join(' - ')
    return source ? `${quote} —— ${source}` : quote
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
