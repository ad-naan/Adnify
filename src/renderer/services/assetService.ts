import type { AssetAction } from '@shared/types/assets'

export const assetService = {
  async request<T = unknown>(action: AssetAction): Promise<T> {
    const result = await window.electronAPI.assetRequest(action)
    if (!result.ok) throw new Error(result.error || 'Asset operation failed')
    return result.value as T
  },
}
