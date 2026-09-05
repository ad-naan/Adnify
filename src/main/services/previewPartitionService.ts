import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { WebContents } from 'electron'
import { previewWorkspaceKey } from '@shared/preview/device'

export class PreviewPartitionService {
  private allowed = new Map<number, Set<string>>()

  prepare(owner: WebContents, roots: string[], requestedRoot?: string) {
    const normalize = (root: string) => previewWorkspaceKey(resolve(root))
    const root = requestedRoot ? normalize(requestedRoot) : roots[0] ? normalize(roots[0]) : undefined
    if (root && !roots.some(candidate => normalize(candidate) === root)) {
      throw new Error('Preview workspace does not belong to this window')
    }
    const scope = root ? 'workspace' as const : 'window' as const
    const partition = root
      ? `persist:adnify-preview-project-${createHash('sha256').update(root).digest('hex')}`
      : `adnify-preview-window-${owner.id}`
    let partitions = this.allowed.get(owner.id)
    if (!partitions) {
      partitions = new Set()
      this.allowed.set(owner.id, partitions)
      owner.once('destroyed', () => this.allowed.delete(owner.id))
    }
    partitions.add(partition)
    return { partition, scope }
  }

  isAllowed(ownerId: number, partition: unknown): boolean {
    return typeof partition === 'string' && !!this.allowed.get(ownerId)?.has(partition)
  }
}

export const previewPartitionService = new PreviewPartitionService()
