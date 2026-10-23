import { useEffect, useMemo, useRef } from 'react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { getDojoMentorActivity } from './dojoMentorActivity'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t, asLanguage } from '@shared/i18n'
import { Loader2, FileSearch, Check, AlertTriangle } from 'lucide-react'

/** Live tool activity is separate from durable learner/mentor conversation. */
export default function DojoMentorFeed({ threadId, language }: { threadId: string | null; language: string }) {
  const thread = useAgentStore(state => threadId ? state.threads[threadId] : undefined)
  const activity = useMemo(() => getDojoMentorActivity(thread), [thread])
  const ref = useRef<HTMLDivElement>(null)
  const followsTail = useRef(true)
  useEffect(() => { if (followsTail.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [activity])
  return <div className="dojo-live" aria-live="polite">
    <div className="dojo-live-title"><Loader2 size={13} className="animate-spin" />{t('dojo.mentorThinking', asLanguage(language))}</div>
    <div ref={ref} className="dojo-live-body" onScroll={() => { const el = ref.current; if (el) followsTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
      {activity.items.map(item => <div key={item.id} className="dojo-live-tool">
        {item.state === 'error' ? <AlertTriangle size={12} /> : item.state === 'success' ? <Check size={12} /> : <FileSearch size={12} />}
        <span>{item.text}</span>
      </div>)}
      {activity.content && <div className="dojo-markdown dojo-live-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{activity.content}</ReactMarkdown></div>}
    </div>
  </div>
}
