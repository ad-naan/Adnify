import { useEffect, useMemo } from 'react'
import { useStore } from '@store'

const EMPTY_ROOTS: string[] = []

export function usePreviewDiscoveryToasts(active: boolean): void {
  const roots = useStore((state) => state.workspace?.roots ?? EMPTY_ROOTS)
  const rootsKey = roots.join('|')
  const workspaceRoots = useMemo(() => roots.slice(), [rootsKey])

  useEffect(() => {
    if (!active || workspaceRoots.length === 0) {
      return
    }

    let cancelled = false

    const timer = window.setTimeout(() => {
      void import('@/renderer/preview/previewPromptService')
        .then(({ previewPromptService }) => {
          if (cancelled) {
            return
          }

          previewPromptService.setWorkspaceRoots(workspaceRoots)
        })
        .catch((error) => {
          console.error('[Preview] Failed to initialize discovery toasts', error)
        })
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, rootsKey, workspaceRoots])
}
