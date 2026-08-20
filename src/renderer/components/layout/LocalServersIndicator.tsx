/**
 * 状态栏的本地服务指示器。
 *
 * 只在检测到候选时出现；有服务在运行时圆点亮起。点开是候选列表。
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Globe } from 'lucide-react'
import { useStore } from '@store'
import { devServerDiscoveryService } from '@/renderer/preview/devServerDiscoveryService'
import { t, type Language } from '@/renderer/i18n'
import BottomBarPopover from '../ui/BottomBarPopover'

const LocalServersContent = lazy(() => import('../panels/LocalServersContent'))

export default function LocalServersIndicator({ language }: { language: Language }) {
  const workspaceRoot = useStore((state) => state.workspace?.roots?.[0])
  const [discoveryState, setDiscoveryState] = useState(() => devServerDiscoveryService.getState())

  useEffect(() => devServerDiscoveryService.subscribe(setDiscoveryState), [])

  // 走 service 的过滤逻辑（终端来源的候选没有 workspaceRoot，对所有工作区可见），
  // 但依赖 discoveryState 触发重算。
  const scoped = useMemo(
    () => devServerDiscoveryService.getCandidatesForWorkspace(workspaceRoot),
    [discoveryState, workspaceRoot],
  )
  const readyCount = scoped.filter((candidate) => candidate.status === 'ready').length


  // 没有任何候选时不占位 —— 状态栏已经很挤了。
  if (scoped.length === 0) {
    return null
  }

  return (
    <BottomBarPopover
      icon={
        <div className="group flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/5 transition-colors">
          <div className="relative flex items-center justify-center w-4 h-4 transition-colors">
            <Globe className={`w-3 h-3 transition-colors ${
              readyCount > 0
                ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                : 'text-text-muted group-hover:text-text-primary'
            }`} />
            {readyCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_4px_rgba(52,211,153,0.6)] border border-background-secondary" />
            )}
          </div>
        </div>
      }
      tooltip={t('preview.servers.title', language)}
      title={t('preview.servers.title', language)}
      badge={readyCount > 0 ? readyCount : undefined}
      width={320}
      height={340}
      language={language as 'en' | 'zh'}
    >
      <Suspense fallback={<div className="p-4 text-[11px] text-text-muted">{t('preview.servers.scanning', language)}</div>}>
        <LocalServersContent language={language} />
      </Suspense>
    </BottomBarPopover>
  )
}
