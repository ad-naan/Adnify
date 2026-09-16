import { hasAsciiControlCharacters, resolvePathLexically } from '@shared/utils/pathUtils'

const MAX_PATH_LENGTH = 2048
const FILE_NAME = /^(?:\.[\w-]+|[\p{L}\p{N}_ .@()+-]+\.(?:[cm]?[jt]sx?|vue|uvue|md|mdx|json|jsonc|ya?ml|toml|xml|txt|log|csv|tsv|css|scss|less|html?|go|rs|py|java|[ch]|[ch]pp|sh|ps1|sql|zip|tar|gz|rar|7z|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg))$/iu
const ASCII_RELATIVE_PATH = /^(?:\.{0,2}\/)?[\w.@()+-]+(?:\/[\w.@()+-]+)+\/?$/u

function isFileName(value: string): boolean {
  return FILE_NAME.test(value.replace(/%[\da-f]{2}/gi, '_'))
}

/** Pure, bounded syntax recognition. Never checks the disk during rendering. */
export function parseChatFilePath(value: string): string | null {
  if (!value || value.length > MAX_PATH_LENGTH) return null
  let path = value.trim()
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path)
      path = decodeURIComponent(url.pathname)
      if (url.hostname && url.hostname !== 'localhost') path = `//${url.hostname}${path}`
      else if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
    } catch { return null }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[/\\]/i.test(path)) {
    return null
  }
  path = path.replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/, '').replace(/\\/g, '/')
  if (!path || hasAsciiControlCharacters(path, true) || /[<>"|?*`=]/.test(path)) return null
  if (path.replace(/^[a-z]:\//i, '').includes(':')) return null
  // Avoid expressions, options and prose that happen to contain a slash.
  if (/\s\//.test(path) || /\/\s/.test(path) || /^[-@~]/.test(path) || /\(\)$/.test(path)) return null
  if (path.includes('/')) {
    if (path === '/') return path
    if (!/[^./]/.test(path)) return null

    // A slash alone does not make prose a path (for example, Chinese text that
    // uses "/" as an alternative separator). Relative directory paths without
    // a trailing slash are accepted only when they use conventional ASCII path
    // segments; Unicode relative paths remain supported when they name a file.
    const basename = path.replace(/\/$/, '').split('/').pop() || ''
    const isAbsolute = /^(?:\/|[a-z]:\/)/i.test(path)
    if (!path.endsWith('/') && !isAbsolute && !isFileName(basename) && !ASCII_RELATIVE_PATH.test(path)) return null
    return path
  }
  return isFileName(path) ? path : null
}

export function resolveChatFilePath(value: string, workspacePath: string | null): string | null {
  const path = parseChatFilePath(value)
  if (!path || (!workspacePath && !/^(?:\/|[a-z]:\/)/i.test(path))) return null
  return resolvePathLexically(path, workspacePath)
}

/** Markdown destinations are URL-encoded; inline code paths are literal. */
export function parseChatFileHref(value: string): string | null {
  if (value.startsWith('//') || value.length > MAX_PATH_LENGTH) return null
  try {
    return parseChatFilePath(/^file:/i.test(value) ? value : decodeURIComponent(value))
  } catch { return null }
}

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

/** Runs inside the existing Markdown parse, only on prose (never code/links/math).
 * Bounds both scanning and extra nodes per block; streaming tails remain plain text.
 */
export function remarkChatFilePaths() {
  return (tree: MarkdownNode) => {
    let remainingChars = 32_768
    let remainingLinks = 128
    const visit = (parent: MarkdownNode) => {
      if (!parent.children || /^(?:link|linkReference|code|inlineCode|html|math|inlineMath)$/.test(parent.type)) return
      const children: MarkdownNode[] = []
      for (const child of parent.children) {
        if (child.type !== 'text' || !child.value || remainingChars <= 0 || remainingLinks <= 0) {
          if (remainingChars > 0 && remainingLinks > 0) visit(child)
          children.push(child)
          continue
        }
        const value = child.value
        const scan = value.slice(0, remainingChars)
        remainingChars -= scan.length
        let end = 0
        // Delimiters include Chinese prose punctuation. Quoted paths with spaces
        // should use inline code or an explicit Markdown link.
        for (const match of scan.matchAll(/[^\s<>"'`，。；：！？（）【】、]+/g)) {
          if (remainingLinks <= 0) break
          if (scan.length < value.length && match.index! + match[0].length === scan.length) break
          const token = match[0].replace(/^[([{]+/, '').replace(/[.,;!?)\]}]+$/, '')
          const path = parseChatFilePath(token)
          if (!path || token.startsWith('//')) continue
          let url: string
          try { url = encodeURI(token) } catch { continue }
          const start = match.index! + match[0].indexOf(token)
          if (start > end) children.push({ type: 'text', value: value.slice(end, start) })
          children.push({ type: 'link', url, children: [{ type: 'text', value: token }] })
          end = start + token.length
          remainingLinks--
        }
        if (end === 0) children.push(child)
        else if (end < value.length) children.push({ type: 'text', value: value.slice(end) })
      }
      parent.children = children
    }
    visit(tree)
  }
}
