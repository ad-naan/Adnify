import { shell } from 'electron'
import { logger } from '@shared/utils/Logger'

export function isLocalDevServerUrl(url: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:[/?#]|$)/i.test(url)
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)

    if (parsed.protocol === 'https:') {
      return true
    }

    if (parsed.protocol === 'http:') {
      return isLocalDevServerUrl(url)
    }

    return parsed.protocol === 'mailto:' || parsed.protocol === 'file:'
  } catch {
    return false
  }
}

export async function openExternalSafely(url: string): Promise<boolean> {
  if (!isSafeExternalUrl(url)) {
    logger.security.warn('[ExternalUrl] Blocked unsafe external navigation', { url })
    return false
  }

  await shell.openExternal(url)
  return true
}
