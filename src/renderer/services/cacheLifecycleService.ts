import { cacheManager, type CacheCleanupPhase } from '@shared/utils'
import { directoryCacheService } from './directoryCacheService'
import { completionService } from './completionService'
import { clearHealthCache } from './healthCheckService'
import { lintService } from '@/renderer/agent/services/lintService'
import { fileCacheService } from '@/renderer/agent/services/fileCacheService'

let registered = false

function registerHooks(): void {
  if (registered) return
  registered = true

  cacheManager.registerCleanupHook('directory-cache', ['workspace-switch', 'shutdown', 'deep'], () => {
    directoryCacheService.clear()
  })
  cacheManager.registerCleanupHook('completion-cache', ['workspace-switch', 'shutdown', 'deep'], () => {
    completionService.clearCache()
  })
  cacheManager.registerCleanupHook('health-cache', ['workspace-switch', 'shutdown', 'deep'], () => {
    clearHealthCache()
  })
  cacheManager.registerCleanupHook('lint-cache', ['workspace-switch', 'shutdown', 'deep'], () => {
    lintService.clearCache()
  })
  cacheManager.registerCleanupHook('file-cache', ['workspace-switch', 'shutdown', 'deep'], () => {
    fileCacheService.clear()
  })
}

export function initCacheLifecycleService(): void {
  registerHooks()
}

export async function runCacheCleanupPhase(phase: CacheCleanupPhase): Promise<void> {
  registerHooks()
  await cacheManager.runPhase(phase)
}
