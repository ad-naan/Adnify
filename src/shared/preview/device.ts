import { z } from 'zod'

export type PreviewDevice = 'desktop' | 'phone' | 'tablet'
export type PreviewOrientation = 'portrait' | 'landscape'

export const previewDeviceSchema = z.object({
  targetId: z.number().int().positive(),
  device: z.enum(['desktop', 'phone', 'tablet']),
  orientation: z.enum(['portrait', 'landscape']),
  scale: z.number().finite().min(0.05).max(1),
}).strict()
export type PreviewDeviceRequest = z.infer<typeof previewDeviceSchema>

export function getPreviewDeviceSize(device: PreviewDevice, orientation: PreviewOrientation) {
  if (device === 'desktop') return null
  const [width, height, deviceScaleFactor] = device === 'phone' ? [390, 844, 3] : [820, 1180, 2]
  return orientation === 'portrait'
    ? { width, height, deviceScaleFactor }
    : { width: height, height: width, deviceScaleFactor }
}

export function fitPreviewDevice(size: { width: number; height: number } | null, available: { width: number; height: number }): number {
  if (!size) return 1
  return Math.max(0.05, Math.min(1, (available.width - 32) / size.width, (available.height - 32) / size.height))
}

/** Shared by tab deduplication and the main process partition identity. */
export function previewWorkspaceKey(root?: string): string {
  const normalized = (root || '').replace(/\\/g, '/').replace(/(.+?)\/+$/, '$1')
  return /^[a-z]:/i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

export type PreviewPartitionResult =
  | { success: true; partition: string; scope: 'workspace' | 'window' }
  | { success: false; error?: string }
