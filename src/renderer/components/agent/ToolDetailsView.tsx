import { useId, useState, type ReactNode } from 'react'
import { t, type Language } from '@shared/i18n'
import { ToolPayloadView } from './ToolPayloadView'

/** Parameters and response share one bounded viewport, including while streaming. */
export function ToolDetailsView({ args, response, language, children, isError = false }: {
    args: Record<string, unknown>
    response?: unknown
    language: Language
    children?: ReactNode
    isError?: boolean
}) {
    const id = useId()
    const [selected, setSelected] = useState<'arguments' | 'response' | null>(null)
    const hasResponse = response !== undefined || Boolean(children)
    const active = selected ?? (hasResponse ? 'response' : 'arguments')
    const tabs = ['arguments', 'response'] as const
    const labels = { arguments: t('toolPayload.arguments', language), response: t('toolPayload.response', language) }
    const label = labels[active]

    return <ToolPayloadView
        data={active === 'arguments' ? args : response}
        label={label}
        language={language}
        isError={active === 'response' && isError}
        panelId={`${id}-panel`}
        labelledBy={`${id}-${active}`}
        tabs={<div role="tablist" aria-label={t('toolPayload.details', language)} className="flex h-9 min-w-0 shrink-0 items-stretch">
            {tabs.map((tab, index) => <button
                key={tab}
                id={`${id}-${tab}`}
                type="button"
                role="tab"
                aria-selected={active === tab}
                aria-controls={`${id}-panel`}
                tabIndex={active === tab ? 0 : -1}
                onClick={() => setSelected(tab)}
                onKeyDown={event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
                    setSelected(tabs[next])
                    document.getElementById(`${id}-${tabs[next]}`)?.focus()
                }}
                className={`flex items-center gap-1.5 px-2 text-[11px] outline-none transition-colors focus-visible:bg-accent/10 ${active === tab ? 'font-medium text-accent' : 'text-text-muted hover:text-text-primary'}`}
            >
                {labels[tab]}
                {tab === 'arguments' && <span className="font-mono text-[10px] text-text-muted">{Object.keys(args).length}</span>}
                {tab === 'response' && isError && <span className="h-1.5 w-1.5 rounded-full bg-status-error" aria-label={t('toolPayload.error', language)} />}
            </button>)}
        </div>}
    >
        {active === 'response' ? children || (!hasResponse ? <p className="text-text-muted">{t('toolPayload.waiting', language)}</p> : undefined) : undefined}
    </ToolPayloadView>
}
