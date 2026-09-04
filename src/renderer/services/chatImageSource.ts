import { defaultUrlTransform } from 'react-markdown'
import { parseThreadDeepLink } from '@renderer/agent/threads/threadReference'
import { assetService } from './assetService'

type ChatImageSource = { type: 'url'; url: string } | { type: 'asset'; id: string } | { type: 'path'; path: string }

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Preserve local references only for our image component, never native links. */
export function parseChatImageSource(value: string): ChatImageSource | null {
  const source = value.trim()
  if (!source || hasControlCharacters(source)) return null
  if (/^https?:\/\//i.test(source)) return { type: 'url', url: source }
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,[a-z0-9+/=]+$/i.test(source)) return { type: 'url', url: source }
  const asset = /^asset:\/\/([a-z0-9_-]{1,200})$/i.exec(source)
  if (asset) return { type: 'asset', id: asset[1] }

  try {
    let filePath = source
    if (/^file:/i.test(source)) {
      const url = new URL(source)
      if (url.hostname && url.hostname !== 'localhost') return null
      filePath = url.pathname
      if (/^\/[a-z]:\//i.test(filePath)) filePath = filePath.slice(1)
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[/\\]/i.test(source)) {
      return null
    }
    filePath = decodeURIComponent(filePath.split(/[?#]/)[0]).replace(/\\/g, '/')
    if (filePath.startsWith('//') || hasControlCharacters(filePath)) return null
    if (filePath.replace(/^[a-z]:\//i, '').includes(':')) return null
    if (!/\.(?:png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(filePath)) return null
    return { type: 'path', path: filePath }
  } catch { return null }
}

export function chatMarkdownUrlTransform(url: string, key: string, node: { tagName: string }): string {
  if (node.tagName === 'img' && key === 'src') return parseChatImageSource(url) ? url : ''
  return parseThreadDeepLink(url) ? url : defaultUrlTransform(url)
}

export async function resolveChatImageSource(source: string): Promise<string> {
  const parsed = parseChatImageSource(source)
  if (!parsed) throw new Error('Unsupported image reference')
  if (parsed.type === 'url') return parsed.url
  // The main process authorizes the current window's workspace and validates
  // image bytes. Raw filesystem paths never become browser image URLs.
  const preview = await assetService.request<string | null>(parsed.type === 'asset'
    ? { type: 'preview', id: parsed.id }
    : { type: 'previewPath', path: parsed.path })
  if (!preview) throw new Error('Image preview unavailable')
  return preview
}
