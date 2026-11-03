import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { hasPathTraversal } from '@shared/utils/pathUtils'

export function parseSourceLocation(href: string) {
  const match = /^([^?#]+)#L([1-9]\d*)$/.exec(href)
  if (!match) return null
  const line = Number(match[2])
  try {
    const path = decodeURIComponent(match[1])
    if (!Number.isSafeInteger(line) || /^[/\\]|[:?#]/.test(path) || hasPathTraversal(path)) return null
    return { path, line }
  } catch { return null }
}

export type OpenLocation = (path: string, line: number) => void

export default memo(function DojoMessageBody({ content, onOpenLocation }: { content: string; onOpenLocation?: OpenLocation }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href = '', children }) => {
      const location = parseSourceLocation(href)
      if (location && onOpenLocation) return <button type="button" className="dojo-source-link" title={href}
        onClick={() => onOpenLocation(location.path, location.line)}>{children}</button>
      if (/^(https?:\/\/|mailto:)/i.test(href)) return <a href={href} target="_blank" rel="noreferrer">{children}</a>
      return <>{children}</>
    },
  }}>{content}</ReactMarkdown>
})
