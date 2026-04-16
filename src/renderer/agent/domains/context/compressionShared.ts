export type CompressionLevel = 0 | 1 | 2 | 3 | 4

export const LEVEL_NAMES = [
  'Full Context',
  'Truncate Args',
  'Clear Results',
  'Deep Compress',
  'Session Handoff',
] as const

export function calculateLevel(ratio: number): CompressionLevel {
  if (ratio < 0.5) return 0
  if (ratio < 0.7) return 1
  if (ratio < 0.85) return 2
  if (ratio < 0.95) return 3
  return 4
}
