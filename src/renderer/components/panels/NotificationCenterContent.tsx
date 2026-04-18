import { Trash2, Bell, CheckCircle2, XCircle, AlertTriangle, Info, CheckCheck } from 'lucide-react'
import { useInlineToast } from '../common/InlineToast'

interface NotificationCenterContentProps {
  language?: 'en' | 'zh'
}

export default function NotificationCenterContent({ language = 'zh' }: NotificationCenterContentProps) {
  const { toasts, removeToast } = useInlineToast()

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)
  
  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />
      case 'info':
      default: return <Info className="w-4 h-4 text-blue-400" />
    }
  }

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('刚刚', 'Just now')
    if (mins < 60) return `${mins}${t('分钟前', 'm ago')}`
    return `${Math.floor(mins / 60)}${t('小时前', 'h ago')}`
  }

  return (
    <div className="h-full flex flex-col">
      {/* 极简高级区头 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-[11px] font-bold tracking-wider uppercase text-text-muted">
            {t('消息记录', 'Notifications')}
          </span>
        </div>

        <button 
          onClick={() => toasts.forEach(t => removeToast(t.id))}
          className="flex items-center justify-center p-1.5 rounded-md text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors" 
          title={t('清空', 'Clear')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto custom-scrollbar p-2">
        {toasts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 opacity-60">
            <CheckCheck className="w-8 h-8 opacity-40" />
            <span className="text-[11px] font-medium tracking-wide">{t('暂无消息', 'No records')}</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {[...toasts].reverse().map((toast) => (
              <div key={toast.id} className="group relative flex items-start gap-3 px-3.5 py-3 rounded-[10px] bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.03] hover:border-white/10 transition-all overflow-hidden">
                <div className="shrink-0 mt-[1px]">
                  {getIcon(toast.type)}
                </div>
                
                <div className="flex-1 min-w-0 flex flex-col pr-8">
                  {toast.title && (
                    <div className="mb-1 flex items-center gap-2">
                      <div className="text-[11px] font-semibold text-text-primary">
                        {toast.title}
                      </div>
                      <span className="rounded-full border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted">
                        {toast.variant}
                      </span>
                    </div>
                  )}
                  <div className="text-[11.5px] font-medium text-text-primary/95 leading-relaxed whitespace-pre-wrap break-words">
                    {toast.message}
                  </div>
                </div>

                {/* 时间与操作按钮 */}
                <div className="absolute right-3.5 top-3 flex items-center">
                  <span className="text-[9px] text-text-muted/40 font-mono tracking-wide group-hover:opacity-0 transition-opacity">
                    {formatTime(toast.timestamp || Date.now())}
                  </span>
                </div>

                <button 
                  onClick={() => removeToast(toast.id)}
                  className="absolute right-2 top-1.5 p-1.5 rounded-md text-text-muted/50 hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
