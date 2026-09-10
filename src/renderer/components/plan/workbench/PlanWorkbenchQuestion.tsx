import { useMemo, useState } from 'react'
import { Check, Circle, Send } from 'lucide-react'
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

  return <section className="plan-question">
    <div className="mb-2.5">
      <div className="text-[11px] font-medium text-accent">{t('planWorkbenchQuestion.yourInputIsNeeded', language)}</div>
      <h2 className="plan-question-title text-text-primary">{content.question}</h2>
    </div>
    <div className="plan-question-options">
      {content.options.map(option => {
        const active = selected.has(option.id)
        return <button key={option.id} type="button" aria-pressed={active} disabled={submitting} onClick={() => choose(option.id)} className="plan-question-option">
          <span className={`mt-0.5 shrink-0 ${active ? 'text-accent' : 'text-text-muted/50'}`}>{active ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}</span>
          <span className="min-w-0 flex-1"><strong className="text-text-primary">{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        </button>
      })}
    </div>
    <button type="button" aria-pressed={customMode} disabled={submitting} onClick={() => { setCustomMode(value => !value); if (!content.multiSelect) setSelected(new Set()) }} className={`mt-3 rounded-md px-3 py-2 text-left text-xs transition-colors ${customMode ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-accent'}`}>{t('common.customResponse', language)}</button>
    {needsCustomText && <textarea value={customText} onChange={event => setCustomText(event.target.value)} rows={3} autoFocus placeholder={t('planWorkbenchQuestion.addDetails', language)} className="mt-2 w-full resize-none rounded-lg border border-border/60 bg-background/55 px-2.5 py-2 text-[10px] leading-4 text-text-primary outline-none placeholder:text-text-muted/55 focus:border-accent/40" />}
    <div className="mt-2.5 flex items-center justify-between gap-3">
      <span className="text-[10px] leading-4 text-text-muted/65">{t('planWorkbenchQuestion.thePlanIsCreated', language)}</span>
      <button onClick={submit} disabled={(!selected.size && !customMode) || (needsCustomText && !customText.trim()) || submitting} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-35"><Send className="h-3.5 w-3.5" />{t('planWorkbenchQuestion.confirm', language)}</button>
    </div>
  </section>
}
