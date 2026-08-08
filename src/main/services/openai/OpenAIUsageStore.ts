/**
 * ChatGPT subscription usage, harvested from `x-codex-*` response headers.
 *
 * The ChatGPT backend exposes no quota endpoint — the only place these numbers
 * appear is on the headers of a real `/responses` call. They are therefore
 * captured opportunistically on each request and cached in memory for the UI.
 *
 * These headers are undocumented and may change or disappear without notice;
 * every field is optional and the UI must degrade gracefully.
 */

export interface OpenAIUsageWindow {
  /** Percentage of the window's quota already consumed (0-100). */
  usedPercent: number
  /** Length of the rolling quota window, in minutes. */
  windowMinutes?: number
  /** Unix seconds at which the window resets. */
  resetAt?: number
}

export interface OpenAIUsage {
  planType?: string
  /** The limit tier currently in force, e.g. `premium`. */
  activeLimit?: string
  primary?: OpenAIUsageWindow
  secondary?: OpenAIUsageWindow
  credits?: {
    balance?: number
    hasCredits: boolean
    unlimited: boolean
  }
  /** When these numbers were captured (epoch ms). */
  capturedAt: number
}

function num(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function bool(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true'
}

function str(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed || undefined
}

function window(
  used: string | null,
  minutes: string | null,
  resetAt: string | null,
): OpenAIUsageWindow | undefined {
  const usedPercent = num(used)
  if (usedPercent === undefined) return undefined
  return {
    usedPercent,
    windowMinutes: num(minutes),
    resetAt: num(resetAt),
  }
}

let current: OpenAIUsage | null = null

export const OpenAIUsageStore = {
  /**
   * Parse `x-codex-*` headers from a ChatGPT backend response.
   * Returns false when the response carries no usage headers at all, leaving
   * any previously captured snapshot untouched.
   */
  captureFromHeaders(headers: Headers): boolean {
    const planType = str(headers.get('x-codex-plan-type'))
    const primary = window(
      headers.get('x-codex-primary-used-percent'),
      headers.get('x-codex-primary-window-minutes'),
      headers.get('x-codex-primary-reset-at'),
    )
    const secondary = window(
      headers.get('x-codex-secondary-used-percent'),
      headers.get('x-codex-secondary-window-minutes'),
      headers.get('x-codex-secondary-reset-at'),
    )

    if (!planType && !primary && !secondary) return false

    current = {
      planType,
      activeLimit: str(headers.get('x-codex-active-limit')),
      primary,
      secondary,
      credits: {
        balance: num(headers.get('x-codex-credits-balance')),
        hasCredits: bool(headers.get('x-codex-credits-has-credits')),
        unlimited: bool(headers.get('x-codex-credits-unlimited')),
      },
      capturedAt: Date.now(),
    }
    return true
  },

  get(): OpenAIUsage | null {
    return current
  },

  clear(): void {
    current = null
  },
}
