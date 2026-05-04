import { api } from '@/renderer/services/electronAPI'

function fallbackCopyText(text: string): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.left = '-1000px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }

  try {
    return await api.clipboard.writeText(text)
  } catch {
    return fallbackCopyText(text)
  }
}

export async function readClipboardText(): Promise<string> {
  try {
    return await api.clipboard.readText()
  } catch {
    // fall through
  }

  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText()
  }

  throw new Error('Clipboard read unavailable')
}
