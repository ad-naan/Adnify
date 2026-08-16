import { useMemo, useState } from 'react'
import { Check, Send } from 'lucide-react'
import type { InteractiveContent } from '@/renderer/agent/types'

const isCustomOption = (id: string, label: string) => ['custom', 'other', '其他', '自定义'].some(value => id.toLowerCase().includes(value) || label.toLowerCase().includes(value))

interface Props {
  content: InteractiveContent
  language: string
  onSubmit: (selectedIds: string[], customText?: string) => void
}
export function PlanWorkbenchQuestion({ content, language, onSubmit }: Props) {
  const [selected, setSelected] = useState(() => new Set(content.selectedIds || []))
  const [customText, setCustomText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const selectedCustom = useMemo(() => content.options.some(option => selected.has(option.id) && isCustomOption(option.id, option.label)), [content.options, selected])

  const choose = (id: string) => setSelected(previous => {
    const next = content.multiSelect ? new Set(previous) : new Set<string>()
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const submit = () => {
    const ids = Array.from(selected)
    if (!ids.length || (selectedCustom && !customText.trim()) || submitting) return
    setSubmitting(true)
    onSubmit(ids, selectedCustom ? customText.trim() : undefined)
  }

  return <section>
    <div className="mb-2.5">
      <div className="text-[9px] font-medium text-accent">{language === 'zh' ? '需要你的确认' : 'Your input is needed'}</div>
      <div className="mt-1.5 text-[12px] font-semibold leading-[19px] text-text-primary">{content.question}</div>
    </div>
    <div className="divide-y divide-border/35 overflow-hidden rounded-lg border border-border/50 bg-background/35">
      {content.options.map(option => {
        const active = selected.has(option.id)
        return <button key={option.id} onClick={() => choose(option.id)} className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${active ? 'bg-accent/[0.055]' : 'hover:bg-surface-hover/35'}`}>
          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-accent bg-accent text-white' : 'border-border text-transparent'}`}><Check className="h-2.5 w-2.5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[10px] font-medium text-text-secondary">{option.label}</span>{option.description && <span className="mt-1 block text-[9px] leading-4 text-text-muted">{option.description}</span>}</span>
        </button>
      })}
    </div>
    {selectedCustom && <textarea value={customText} onChange={event => setCustomText(event.target.value)} rows={3} autoFocus placeholder={language === 'zh' ? '补充你的要求…' : 'Add details…'} className="mt-2 w-full resize-none rounded-lg border border-border/60 bg-background/55 px-2.5 py-2 text-[10px] leading-4 text-text-primary outline-none placeholder:text-text-muted/55 focus:border-accent/40" />}
    <div className="mt-2.5 flex items-center justify-between gap-3">
      <span className="text-[8px] leading-4 text-text-muted/65">{language === 'zh' ? '确认后 AI 才会继续整理并创建计划' : 'The plan is created only after confirmation'}</span>
      <button onClick={submit} disabled={!selected.size || (selectedCustom && !customText.trim()) || submitting} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[9px] font-medium text-white hover:bg-accent-hover disabled:opacity-35"><Send className="h-3 w-3" />{language === 'zh' ? '确认选择' : 'Confirm'}</button>
    </div>
  </section>
}
