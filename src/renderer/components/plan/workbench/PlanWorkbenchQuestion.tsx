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
  const selectedCustom = useMemo(() => content.options.some(option => selected.has(option.id) && isCustomOption(option.id, option.label)), [content.options, selected])

  const choose = (id: string) => {
    const option = content.options.find(item => item.id === id)
    if (!option) return
    if (!content.multiSelect && !isCustomOption(option.id, option.label)) {
      setSelected(new Set([id]))
      onSubmit([id])
      return
    }
    setSelected(previous => {
      const next = content.multiSelect ? new Set(previous) : new Set<string>()
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = () => {
    const ids = Array.from(selected)
    if (!ids.length || (selectedCustom && !customText.trim())) return
    onSubmit(ids, selectedCustom ? customText.trim() : undefined)
  }

  return <section className="overflow-hidden rounded-xl border border-accent/20 bg-accent/[0.035]">
    <div className="px-3.5 pb-2 pt-3">
      <div className="text-[9px] font-medium text-accent">{language === 'zh' ? '需要你的确认' : 'Your input is needed'}</div>
      <div className="mt-1.5 text-[11px] font-semibold leading-[18px] text-text-primary">{content.question}</div>
    </div>
    <div className="space-y-1 px-2.5 pb-2.5">
      {content.options.map(option => {
        const active = selected.has(option.id)
        return <button key={option.id} onClick={() => choose(option.id)} className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${active ? 'border-accent/30 bg-accent/[0.08]' : 'border-transparent hover:border-border/60 hover:bg-surface/30'}`}>
          <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${active ? 'border-accent bg-accent text-white' : 'border-border text-transparent'}`}><Check className="h-2.5 w-2.5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[10px] font-medium text-text-secondary">{option.label}</span>{option.description && <span className="mt-0.5 block text-[9px] leading-4 text-text-muted">{option.description}</span>}</span>
        </button>
      })}
      {selectedCustom && <textarea value={customText} onChange={event => setCustomText(event.target.value)} rows={3} autoFocus placeholder={language === 'zh' ? '补充你的要求…' : 'Add details…'} className="mt-1 w-full resize-none rounded-lg border border-border/60 bg-background/55 px-2.5 py-2 text-[10px] leading-4 text-text-primary outline-none placeholder:text-text-muted/55 focus:border-accent/40" />}
      {(content.multiSelect || selectedCustom) && <div className="flex justify-end pt-1"><button onClick={submit} disabled={!selected.size || (selectedCustom && !customText.trim())} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-35"><Send className="h-3 w-3" />{language === 'zh' ? '确认' : 'Confirm'}</button></div>}
    </div>
  </section>
}
