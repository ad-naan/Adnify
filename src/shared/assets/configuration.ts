import { z } from 'zod'
import { parseCapability } from './capability'
import type { AssetCapability } from '../types/assets'

export interface AssetConfiguration {
  capabilities: AssetCapability[]
  storage: { customRoot?: string; projectRoots: Record<string, string> }
}
export const DEFAULT_ASSET_CONFIGURATION: AssetConfiguration = { capabilities: [], storage: { projectRoots: {} } }
export function normalizeAssetConfiguration(value: unknown): AssetConfiguration {
  const config = z.object({
    capabilities: z.array(z.unknown()).max(200).default([]),
    storage: z.object({ customRoot: z.string().min(1).max(4000).optional(), projectRoots: z.record(z.string().min(1).max(4000)).default({}) }).default({ projectRoots: {} }),
  }).parse(value ?? {})
  const capabilities = config.capabilities.map(parseCapability)
  if (new Set(capabilities.map(cap => cap.id)).size !== capabilities.length) throw new Error('Duplicate asset capability IDs')
  return { capabilities, storage: config.storage }
}
