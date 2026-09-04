import { useEffect, useState } from 'react'
import { useStore } from '@store'
import { t } from '@shared/i18n'
import { resolveChatImageSource } from '@renderer/services/chatImageSource'

export function ChatMarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const workspacePath = useStore(state => state.workspacePath)
  const language = useStore(state => state.language)
  const [result, setResult] = useState<{ source?: string; workspace: string | null; url?: string; failed?: boolean }>()
  useEffect(() => {
    let live = true
    setResult(undefined)
    void resolveChatImageSource(src || '').then(url => {
      if (live) setResult({ source: src, workspace: workspacePath, url })
    }).catch(() => {
      if (live) setResult({ source: src, workspace: workspacePath, failed: true })
    })
    return () => { live = false }
  }, [src, workspacePath])
  // Do not show an old image while its source/workspace replacement is loading.
  const current = result?.source === src && result?.workspace === workspacePath ? result : undefined
  if (!current?.url || current.failed) return <span role={current?.failed ? 'status' : undefined} className="inline-flex rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-xs text-text-muted">
    {current?.failed ? `${alt || t('assets.image', language)} — ${t('assets.imageLoadFailed', language)}` : t('assets.loadingPreview', language)}
  </span>
  return <img src={current.url} alt={alt || ''} title={title} className="my-2 max-h-[560px] max-w-full rounded-lg object-contain" onError={() => setResult({ source: src, workspace: workspacePath, failed: true })} />
}
