import { useMemo, useState } from 'react'
import { Check, Send } from 'lucide-react'
import type { InteractiveContent } from '@/renderer/agent/types'
import { t, type Language } from '@shared/i18n'

const isCustomOption = (id: string, label: string) => ['custom', 'other', '其他', '自定义'].some(value => id.toLowerCase().includes(value) || label.toLowerCase().includes(value))

interface Props {
  content: InteractiveContent
  language: Language
  onSubmit: (selectedIds: string[], customText?: string) => void
}
export function PlanWorkbenchQuestion({ content, language, onSubmit }: Props) {
  const [selected, setSelected] = useState(() => new Set(content.selectedIds || []))
  const [customText, setCustomText] = useState('')
  const [customMode, setCustomMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const selectedCustom = useMemo(() => content.options.some(option => selected.has(option.id) && isCustomOption(option.id, option.label)), [content.options, selected])
  const needsCustomText = customMode || selectedCustom

  const choose = (id: string) => setSelected(previous => {
    setCustomMode(false)
    const next = content.multiSelect ? new Set(previous) : new Set<string>()
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const submit = () => {
    const ids = Array.from(selected)
    if ((!ids.length && !customMode) || (needsCustomText && !customText.trim()) || submitting) return
    setSubmitting(true)
    onSubmit(ids, needsCustomText ? customText.trim() : undefined)
  }

  return <section>
    <div className="mb-2.5">
      <div className="text-[11px] font-medium text-accent">{t('planWorkbenchQuestion.yourInputIsNeeded', language)}</div>
      <div className="mt-1.5 text-[12px] font-semibold leading-[19px] text-text-primary">{content.question}</div>
    </div>
    <div className="divide-y divide-border/35 overflow-hidden rounded-lg border border-border/50 bg-background/35">
      {content.options.map(option => {
        const active = selected.has(option.id)
        return <button key={option.id} onClick={() => choose(option.id)} className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${active ? 'bg-accent/[0.055]' : 'hover:bg-surface-hover/35'}`}>
          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-accent bg-accent text-white' : 'border-border text-transparent'}`}><Check className="h-2.5 w-2.5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[10px] font-medium text-text-secondary">{option.label}</span>{option.description && <span className="mt-1 block text-[11px] leading-4 text-text-muted">{option.description}</span>}</span>
        </button>
      })}
    </div>
    <button type="button" onClick={() => { setCustomMode(value => !value); if (!content.multiSelect) setSelected(new Set()) }} className={`mt-2 w-full rounded-md border border-dashed px-2.5 py-2 text-left text-[10px] transition-colors ${customMode ? 'border-accent/45 bg-accent/10 text-text-primary' : 'border-border/60 text-text-muted hover:border-accent/35'}`}>{t('common.customResponse', language)}</button>
    {needsCustomText && <textarea value={customText} onChange={event => setCustomText(event.target.value)} rows={3} autoFocus placeholder={t('planWorkbenchQuestion.addDetails', language)} className="mt-2 w-full resize-none rounded-lg border border-border/60 bg-background/55 px-2.5 py-2 text-[10px] leading-4 text-text-primary outline-none placeholder:text-text-muted/55 focus:border-accent/40" />}
    <div className="mt-2.5 flex items-center justify-between gap-3">
      <span className="text-[10px] leading-4 text-text-muted/65">{t('planWorkbenchQuestion.thePlanIsCreated', language)}</span>
      <button onClick={submit} disabled={(!selected.size && !customMode) || (needsCustomText && !customText.trim()) || submitting} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-35"><Send className="h-3 w-3" />{t('planWorkbenchQuestion.confirm', language)}</button>
    </div>
  </section>
}
