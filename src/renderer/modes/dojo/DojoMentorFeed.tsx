import { useEffect, useMemo, useRef } from 'react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { materializeThreadMessages } from '@/renderer/agent/types'
import { t, asLanguage } from '@shared/i18n'
import { Loader2, FileSearch, Check, AlertTriangle } from 'lucide-react'

/** Live tool activity is separate from durable learner/mentor conversation. */
export default function DojoMentorFeed({ threadId, language }: { threadId: string | null; language: string }) {
  const thread = useAgentStore(state => threadId ? state.threads[threadId] : undefined)
  const items = useMemo(() => {
    const messages = thread ? materializeThreadMessages(thread) : []
    const last = [...messages].reverse().find(item => item.role === 'assistant')
    if (!last || last.role !== 'assistant') return []
    const result: Array<{ id: string; text: string; state: string }> = []
    for (const call of last.toolCalls ?? []) {
      const args = call.arguments ?? {}
      const target = args.path ?? args.relative_path ?? args.name_path ?? args.query ?? args.pattern ?? args.url
      result.push({ id: call.id, text: `${call.name}${typeof target === 'string' ? ` · ${target}` : ''}`, state: call.status })
    }
    return result.slice(-8)
  }, [thread])
  const content = useMemo(() => {
    const messages = thread ? materializeThreadMessages(thread) : []
    const last = [...messages].reverse().find(item => item.role === 'assistant')
    if (!last || last.role !== 'assistant') return ''
    return (last.displayContent || last.content || '').replace(/```(?:json)?\s*\{[\s\S]*$/, '').trim()
  }, [thread])
  const ref = useRef<HTMLDivElement>(null)
  const followsTail = useRef(true)
  useEffect(() => { if (followsTail.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [items, content])
  return <div className="dojo-live" aria-live="polite">
    <div className="dojo-live-title"><Loader2 size={13} className="animate-spin" />{t('dojo.mentorThinking', asLanguage(language))}</div>
    <div ref={ref} className="dojo-live-body" onScroll={() => { const el = ref.current; if (el) followsTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
      {items.map(item => <div key={item.id} className="dojo-live-tool">
        {item.state === 'error' ? <AlertTriangle size={12} /> : item.state === 'success' ? <Check size={12} /> : <FileSearch size={12} />}
        <span>{item.text}</span>
      </div>)}
      {content && <p className="dojo-live-preview">{content}</p>}
    </div>
  </div>
}
