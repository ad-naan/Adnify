import { useEffect, useMemo } from 'react'
import { useStore } from '@store'
import { previewSessionService } from '@/renderer/preview/previewSessionService'

const EMPTY_ROOTS: string[] = []

/**
 * 启动本地 dev server 发现。
 *
 * 只负责把工作区根目录交给发现服务 —— 是否弹提示由 previewSettings.autoPrompt
 * 决定（默认关），状态栏指示器和预览标签都直接订阅发现服务。
 *
 * 同时负责回收已关闭标签的预览会话：会话表原先只增不减，关掉标签再打开同一地址
 * 会命中一个没有 UI 挂载的僵尸会话。
 */
export function usePreviewDiscovery(active: boolean): void {
  const roots = useStore((state) => state.workspace?.roots ?? EMPTY_ROOTS)
  const rootsKey = roots.join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const workspaceRoots = useMemo(() => roots.slice(), [rootsKey])

  const openPreviewSessionKey = useStore((state) => state.openFiles
    .filter((openFile) => openFile.kind === 'preview' && openFile.preview)
    .map((openFile) => openFile.preview!.sessionId)
    .join('|'))

  useEffect(() => {
    previewSessionService.pruneSessions(openPreviewSessionKey ? openPreviewSessionKey.split('|') : [])
  }, [openPreviewSessionKey])

  useEffect(() => {
    if (!active || workspaceRoots.length === 0) {
      return
    }

    let cancelled = false

    // 延后一点：启动瞬间终端还没恢复，探活也会和索引抢 IO。
    const timer = window.setTimeout(() => {
      void import('@/renderer/preview/previewPromptService')
        .then(({ previewPromptService }) => {
          if (!cancelled) {
            previewPromptService.setWorkspaceRoots(workspaceRoots)
          }
        })
        .catch((error) => {
          console.error('[Preview] Failed to initialize dev server discovery', error)
        })
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, workspaceRoots])
}
