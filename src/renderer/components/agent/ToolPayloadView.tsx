import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Code2, Copy } from 'lucide-react'
import { t, type Language } from '@shared/i18n'
import { writeClipboardText } from '@renderer/services/clipboardService'

const actionClass = 'inline-flex h-6 items-center justify-center gap-1 rounded px-1.5 text-text-muted transition-colors hover:bg-text-primary/[0.05] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

/** A readable payload first, with the complete source available for inspection. */
export function ToolPayloadView({ data, label, language, children, isError = false }: {
    data?: unknown
    label: string
    language: Language
    children?: ReactNode
    isError?: boolean
}) {
    const [raw, setRaw] = useState(false)
    const [copied, setCopied] = useState(false)
    const [copyFailed, setCopyFailed] = useState(false)
    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), 2000)
        return () => clearTimeout(timer)
    }, [copied])
    const { value, source } = useMemo(() => {
        let value = data
        if (typeof data === 'string') {
            try { value = JSON.parse(data) } catch { /* Plain text response. */ }
        }
        return { value, source: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }
    }, [data])
    const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : null
    const displayValue = (item: unknown) => typeof item === 'string' ? item : JSON.stringify(item, null, 2)

    return (
        <section className={`min-w-0 overflow-hidden rounded-lg border text-[11px] ${isError ? 'border-status-error/20 bg-status-error/[0.025]' : 'border-border/60 bg-text-primary/[0.015]'}`}>
            <div className="flex min-h-8 items-center gap-2 border-b border-border/40 px-3 py-1">
                <span className={`font-medium ${isError ? 'text-status-error' : 'text-text-secondary'}`}>{label}</span>
                {entries && !children && <span className="font-mono text-[10px] text-text-muted/70">{entries.length}</span>}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    {source !== undefined && <>
                        <button type="button" className={actionClass} onClick={() => setRaw(!raw)} aria-pressed={raw} title={t(raw ? 'toolPayload.preview' : 'toolPayload.source', language)}>
                            <Code2 className="h-3 w-3" aria-hidden="true" />
                            <span>{t(raw ? 'toolPayload.preview' : 'toolPayload.source', language)}</span>
                        </button>
                        <button type="button" className={actionClass} title={t(copied ? 'toolPayload.copied' : 'toolPayload.copy', language)} aria-label={t(copied ? 'toolPayload.copied' : 'toolPayload.copy', language)} onClick={async () => {
                            const success = await writeClipboardText(source)
                            setCopied(success)
                            setCopyFailed(!success)
                        }}>
                            {copied ? <Check className="h-3 w-3 text-status-success" /> : <Copy className="h-3 w-3" />}
                        </button>
                    </>}
                </div>
            </div>
            {copyFailed && <p role="alert" className="px-3 pt-2 text-status-error">{t('toolPayload.copyFailed', language)}</p>}
            <div className="max-h-80 overflow-y-auto overflow-x-hidden custom-scrollbar">
                {raw ? (
                    <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-secondary">{source}</pre>
                ) : children ? <div className="px-3 py-2">{children}</div> : entries?.length ? (
                    <dl className="divide-y divide-border/30 px-3">
                        {entries.map(([key, item]) => (
                            <div key={key} className={`grid gap-x-3 gap-y-1 py-2.5 ${item === null || typeof item === 'number' || typeof item === 'boolean' || (typeof item === 'string' && item.length <= 72 && !item.includes('\n')) ? 'grid-cols-[minmax(0,80px)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'}`}>
                                <dt className="font-mono text-[10px] leading-4 text-text-muted [overflow-wrap:anywhere]">{key}</dt>
                                <dd className={`m-0 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed text-text-primary ${typeof item === 'string' ? '' : 'font-mono text-[11px]'}`}>{displayValue(item)}</dd>
                            </div>
                        ))}
                    </dl>
                ) : (
                    <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] px-3 py-2.5 font-sans text-[11px] leading-relaxed text-text-primary">{displayValue(value)}</pre>
                )}
            </div>
        </section>
    )
}
