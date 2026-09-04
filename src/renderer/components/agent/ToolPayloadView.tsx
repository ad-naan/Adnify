import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Code2, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { t, type Language } from '@shared/i18n'
import { writeClipboardText } from '@renderer/services/clipboardService'
import './ToolPayloadView.css'

const actionClass = 'inline-flex h-6 items-center justify-center gap-1 rounded px-1.5 text-text-muted transition-colors hover:bg-text-primary/[0.05] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

/** A readable payload first, with the complete source available for inspection. */
export function ToolPayloadView({ data, label, language, children, isError = false, tabs, panelId, labelledBy }: {
    data?: unknown
    label: string
    language: Language
    children?: ReactNode
    isError?: boolean
    tabs?: ReactNode
    panelId?: string
    labelledBy?: string
}) {
    const container = useRef<HTMLElement>(null)
    const [expanded, setExpanded] = useState(false)
    const [raw, setRaw] = useState(false)
    const [copied, setCopied] = useState(false)
    const [copyFailed, setCopyFailed] = useState(false)
    useEffect(() => {
        setRaw(false)
        setCopied(false)
        setCopyFailed(false)
    }, [label])
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
        <section ref={container} aria-label={label} className="tool-payload min-w-0 text-[11px]">
            <div className="tool-payload-toolbar flex shrink-0 items-center gap-2">
                {tabs || <span className={`px-2 font-medium ${isError ? 'text-status-error' : 'text-text-secondary'}`}>{label}</span>}
                <div className="ml-auto flex shrink-0 items-center gap-0.5 pr-1">
                    {source !== undefined && <>
                        <button type="button" className={actionClass} onClick={() => setRaw(!raw)} aria-pressed={raw} aria-label={t(raw ? 'toolPayload.preview' : 'toolPayload.source', language)} title={t(raw ? 'toolPayload.preview' : 'toolPayload.source', language)}>
                            <Code2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button type="button" className={actionClass} title={t(copied ? 'toolPayload.copied' : 'toolPayload.copy', language)} aria-label={t(copied ? 'toolPayload.copied' : 'toolPayload.copy', language)} onClick={async () => {
                            const success = await writeClipboardText(source)
                            setCopied(success)
                            setCopyFailed(!success)
                        }}>
                            {copied ? <Check className="h-3 w-3 text-status-success" /> : <Copy className="h-3 w-3" />}
                        </button>
                    </>}
                    <button type="button" className={actionClass} title={t(expanded ? 'toolPayload.restoreSize' : 'toolPayload.expandSize', language)} aria-label={t(expanded ? 'toolPayload.restoreSize' : 'toolPayload.expandSize', language)} aria-pressed={expanded} onClick={() => {
                        if (container.current) container.current.style.height = expanded ? 'min(120px, 60vh)' : 'min(560px, 60vh)'
                        setExpanded(!expanded)
                    }}>
                        {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                    </button>
                </div>
            </div>
            {copyFailed && <p role="alert" className="px-3 pt-2 text-status-error">{t('toolPayload.copyFailed', language)}</p>}
            <div id={panelId} role={tabs ? 'tabpanel' : undefined} aria-labelledby={labelledBy} tabIndex={0} className="tool-payload-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/40">
                {raw ? (
                    <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-secondary">{source}</pre>
                ) : children ? <div className="px-2 py-3">{children}</div> : entries?.length ? (
                    <dl className="px-2 py-2">
                        {entries.map(([key, item]) => (
                            <div key={key} className="tool-payload-field grid grid-cols-[minmax(0,88px)_minmax(0,1fr)] gap-x-4 gap-y-1 py-2.5">
                                <dt className="font-mono text-[10px] leading-4 text-text-muted [overflow-wrap:anywhere]">{key}</dt>
                                <dd className={`m-0 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed text-text-primary ${typeof item === 'string' ? '' : 'font-mono text-[11px]'}`}>{displayValue(item)}</dd>
                            </div>
                        ))}
                    </dl>
                ) : (
                    <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] px-3 py-2.5 font-sans text-[11px] leading-relaxed text-text-primary">{displayValue(value)}</pre>
                )}
            </div>
            <div className="h-3 shrink-0" aria-hidden="true" />
        </section>
    )
}
