import { useStore } from '@store'
import type { PreviewServerCandidate } from '@shared/types/preview'
import { toast } from '@/renderer/components/common/ToastProvider'
import { t, type Language } from '@/renderer/i18n'
import { devServerDiscoveryService } from './devServerDiscoveryService'
import { previewSessionService } from './previewSessionService'

function areRootsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((root, index) => root === right[index])
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
  if (source === 'terminal') {
    return t('preview.toast.source.terminal', language)
  }

  if (source === 'workspace-script') {
    return t('preview.toast.source.workspace', language)
  }

  return t('preview.toast.source.discovery', language)
}

export class PreviewPromptService {
  private readonly handledPromptKeys = new Set<string>()
  private readonly activeToastIds = new Map<string, string>()
  private initialized = false
  private workspaceRoots: string[] = []

  initialize(): void {
    if (this.initialized) {
      return
    }

    this.initialized = true
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

  private syncFromDiscovery(candidates: PreviewServerCandidate[]): void {
    if (this.workspaceRoots.length === 0) {
      return
    }

    for (const candidate of candidates) {
      if (!this.shouldPromptFor(candidate)) {
        continue
      }

      this.showCandidateToast(candidate)
    }
  }

  private shouldPromptFor(candidate: PreviewServerCandidate): boolean {
    if (candidate.status !== 'ready') {
      return false
    }

    if (candidate.workspaceRoot && !isWithinWorkspace(candidate.workspaceRoot, this.workspaceRoots)) {
      return false
    }

    if (this.handledPromptKeys.has(candidate.id)) {
      return false
    }

    if (this.activeToastIds.has(candidate.id)) {
      return false
    }

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
    const language = (useStore.getState().language || 'en') as Language
    const sourceLabel = getSourceLabel(candidate.source, language)
    const candidateLabel = candidate.label || candidate.url

    const toastId = toast.card({
      type: 'info',
      title: t('preview.toast.title', language),
      message: t('preview.toast.message', language, { target: candidateLabel }),
      source: sourceLabel,
      dedupeKey: candidate.id,
      actions: [
        {
          id: 'dismiss',
          label: t('preview.toast.notNow', language),
          style: 'secondary',
          onClick: () => {
            this.handledPromptKeys.add(candidate.id)
            this.activeToastIds.delete(candidate.id)
            if (toastId) {
              toast.dismiss(toastId)
            }
          },
        },
        {
          id: 'open',
          label: t('preview.toast.open', language),
          style: 'primary',
          onClick: () => {
            this.handledPromptKeys.add(candidate.id)
            this.activeToastIds.delete(candidate.id)
            previewSessionService.openCandidate(candidate, { activate: true })
            if (toastId) {
              toast.dismiss(toastId)
            }
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
