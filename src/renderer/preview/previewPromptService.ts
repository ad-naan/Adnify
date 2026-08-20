import { useStore } from '@store'
import type { PreviewServerCandidate } from '@shared/types/preview'
import { toast } from '@/renderer/components/common/ToastProvider'
import { t, type Language } from '@/renderer/i18n'
import { devServerDiscoveryService } from './devServerDiscoveryService'
import { previewSessionService } from './previewSessionService'
import { dismissOrigin, isOriginDismissed, loadPreviewSettings, subscribePreviewSettings } from './previewSettings'

function areRootsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((root, index) => root === right[index])
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isWithinWorkspace(candidateRoot: string, workspaceRoots: string[]): boolean {
  const normalizedCandidate = normalizePath(candidateRoot)
  return workspaceRoots.some((workspaceRoot) => {
    const normalizedWorkspaceRoot = normalizePath(workspaceRoot)
    return normalizedCandidate === normalizedWorkspaceRoot
      || normalizedCandidate.startsWith(`${normalizedWorkspaceRoot}/`)
  })
}

function getSourceLabel(source: PreviewServerCandidate['source'], language: Language): string {
  if (source === 'terminal') return t('preview.toast.source.terminal', language)
  if (source === 'workspace-script') return t('preview.toast.source.workspace', language)
  return t('preview.toast.source.discovery', language)
}

/**
 * 发现本地服务后的主动提示。
 *
 * 默认不弹（见 previewSettings.autoPrompt）。开启后每个 origin 在一次会话里
 * 最多弹一次，且卡片会自己消失 —— 之前的实现是常驻卡片 + 按完整 URL 去重，
 * dev server 每刷一条带地址的日志就换一个 dedupeKey，于是右下角反复闪出新卡片。
 */
const TOAST_DURATION_MS = 12000

export class PreviewPromptService {
  /** 本次会话里已经提示过的 origin，不持久化。 */
  private readonly promptedOrigins = new Set<string>()
  private readonly activeToastIds = new Map<string, string>()
  private initialized = false
  private workspaceRoots: string[] = []
  private autoPrompt = loadPreviewSettings().autoPrompt

  initialize(): void {
    if (this.initialized) {
      return
    }

    this.initialized = true
    this.autoPrompt = loadPreviewSettings().autoPrompt

    subscribePreviewSettings((settings) => {
      this.autoPrompt = settings.autoPrompt
      if (!settings.autoPrompt) {
        this.dismissAllToasts()
      }
    })

    devServerDiscoveryService.initialize()
    devServerDiscoveryService.subscribe((state) => {
      this.syncFromDiscovery(state.candidates)
    })
  }

  setWorkspaceRoots(roots: string[]): void {
    const nextRoots = roots.filter(Boolean)
    if (nextRoots.length === 0) {
      this.workspaceRoots = []
      return
    }

    this.initialize()

    if (areRootsEqual(this.workspaceRoots, nextRoots)) {
      return
    }

    this.workspaceRoots = nextRoots
    void devServerDiscoveryService.refresh(this.workspaceRoots)
  }

  private dismissAllToasts(): void {
    for (const toastId of this.activeToastIds.values()) {
      toast.dismiss(toastId)
    }
    this.activeToastIds.clear()
  }

  private syncFromDiscovery(candidates: PreviewServerCandidate[]): void {
    if (!this.autoPrompt || this.workspaceRoots.length === 0) {
      return
    }

    for (const candidate of candidates) {
      if (this.shouldPromptFor(candidate)) {
        this.showCandidateToast(candidate)
      }
    }
  }

  private shouldPromptFor(candidate: PreviewServerCandidate): boolean {
    if (candidate.status !== 'ready') return false
    if (candidate.workspaceRoot && !isWithinWorkspace(candidate.workspaceRoot, this.workspaceRoots)) return false
    if (this.promptedOrigins.has(candidate.url)) return false
    if (isOriginDismissed(candidate.url)) return false
    if (this.activeToastIds.has(candidate.id)) return false
    return !this.hasOpenPreview(candidate)
  }

  private hasOpenPreview(candidate: PreviewServerCandidate): boolean {
    return useStore.getState().openFiles.some((file) =>
      file.kind === 'preview'
      && !!file.preview
      && (file.preview.candidateId === candidate.id || file.preview.url === candidate.url),
    )
  }

  private showCandidateToast(candidate: PreviewServerCandidate): void {
    // 先登记再弹：showCard 是同步的，回调里也会读这个集合。
    this.promptedOrigins.add(candidate.url)

    const language = (useStore.getState().language || 'en') as Language
    const candidateLabel = candidate.label || candidate.url

    const settle = (toastId: string | undefined) => {
      this.activeToastIds.delete(candidate.id)
      if (toastId) {
        toast.dismiss(toastId)
      }
    }

    const toastId = toast.card({
      type: 'info',
      title: t('preview.toast.title', language),
      message: t('preview.toast.message', language, { target: candidateLabel }),
      source: getSourceLabel(candidate.source, language),
      dedupeKey: candidate.id,
      duration: TOAST_DURATION_MS,
      actions: [
        {
          id: 'never',
          label: t('preview.toast.never', language),
          style: 'ghost',
          onClick: () => {
            dismissOrigin(candidate.url)
            settle(toastId)
          },
        },
        {
          id: 'open',
          label: t('preview.toast.open', language),
          style: 'primary',
          onClick: () => {
            previewSessionService.openCandidate(candidate, { activate: true })
            settle(toastId)
          },
        },
      ],
    })

    if (toastId) {
      this.activeToastIds.set(candidate.id, toastId)
    }
  }
}

export const previewPromptService = new PreviewPromptService()
