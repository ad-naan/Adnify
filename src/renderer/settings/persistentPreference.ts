import { api } from '@/renderer/services/electronAPI'
import { logger } from '@shared/utils/Logger'

export interface PersistentPreferenceOptions<T> {
  /** electron-store key; this file is the source of truth. */
  storageKey: string
  /** Legacy localStorage key migrated once when the durable value is absent. */
  legacyStorageKey: string
  /** Set to false for new preferences that never had a localStorage format. */
  migration?: boolean
  fallback: T
  normalize: (value: unknown) => T
}

export interface PersistentPreference<T> {
  load: () => T
  hydrate: () => Promise<T>
  save: (value: T) => T
  update: (patch: Partial<T>) => T
  subscribe: (listener: (value: T) => void) => () => void
}

const LEGACY_MIGRATION_MARKER_PREFIX = 'settingsPersistence.legacyMigrated'

function readLegacyValue(legacyStorageKey: string): unknown {
  try {
    const raw = localStorage.getItem(legacyStorageKey)
    if (!raw) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      // A few legacy callers stored scalar strings directly.
      return raw
    }
  } catch {
    return undefined
  }
}

function removeFromLocalStorage(legacyStorageKey: string): void {
  try {
    localStorage.removeItem(legacyStorageKey)
  } catch {
    // The durable electron-store value remains authoritative.
  }
}

export function createPersistentPreference<T>(
  options: PersistentPreferenceOptions<T>,
): PersistentPreference<T> {
  const listeners = new Set<(value: T) => void>()
  let cache: T | null = null
  let hydrated = false
  let pendingFullValue: T | null = null
  let pendingPatches: Array<Partial<T>> = []
  let writeChain: Promise<void> = Promise.resolve()
  let hydratePromise: Promise<T> | null = null
  const migrationMarkerKey = `${LEGACY_MIGRATION_MARKER_PREFIX}.${options.legacyStorageKey}`

  const notify = (value: T) => {
    for (const listener of listeners) listener(value)
  }

  const applyPendingUpdates = (base: T): T => {
    let next = base
    if (pendingFullValue !== null) {
      next = options.normalize({ ...next, ...pendingFullValue })
    }
    for (const patch of pendingPatches) {
      next = options.normalize({ ...next, ...patch })
    }
    return next
  }

  const enqueueWrite = (value: T): void => {
    writeChain = writeChain.then(async () => {
      await api.settings.set(options.storageKey, value)
      removeFromLocalStorage(options.legacyStorageKey)
    }).catch(error => {
      logger.settings.error(`[PersistentPreference] Failed to save ${options.storageKey}:`, error)
    })
  }

  const hydrate = async (): Promise<T> => {
    // What subscribers are currently showing; load() seeds this with the
    // fallback, so hydration must notify whenever the durable value differs.
    const previous = cache
    try {
      const [persisted, migrationMarker] = await Promise.all([
        api.settings.get(options.storageKey),
        options.migration === false
          ? Promise.resolve(true)
          : api.settings.get(migrationMarkerKey),
      ])

      const shouldReadLegacy = options.migration !== false && migrationMarker !== true
      const legacy = shouldReadLegacy ? readLegacyValue(options.legacyStorageKey) : undefined

      let base: T
      let migratedFromLegacy = false
      if (legacy !== undefined) {
        // Before the persistence refactor, localStorage was the live writer.
        // It wins exactly once; the durable marker then prevents a stale
        // localStorage copy from ever overriding the config file again.
        base = options.normalize(legacy)
        migratedFromLegacy = true
      } else if (persisted === undefined || persisted === null) {
        base = options.fallback
      } else {
        base = options.normalize(persisted)
      }

      const next = applyPendingUpdates(base)
      const hasPendingUpdates = pendingFullValue !== null || pendingPatches.length > 0
      if (migratedFromLegacy || hasPendingUpdates) {
        await api.settings.set(options.storageKey, next)
      }
      if (options.migration !== false) {
        await api.settings.set(migrationMarkerKey, true)
      }

      pendingFullValue = null
      pendingPatches = []
      hydrated = true
      cache = next
      removeFromLocalStorage(options.legacyStorageKey)
      // Compare by value, not identity: on the migration path `next` is often
      // the very object `base` points at, so an identity check would skip the
      // notify and leave subscribers stuck on the fallback until a later write.
      if (previous === null || JSON.stringify(previous) !== JSON.stringify(next)) notify(next)
      return cache
    } catch (error) {
      logger.settings.warn(`[PersistentPreference] Failed to load ${options.storageKey}:`, error)
      const shouldRetryWrite = pendingFullValue !== null || pendingPatches.length > 0
      const next = applyPendingUpdates(cache ?? options.fallback)
      pendingFullValue = null
      pendingPatches = []
      hydrated = true
      cache = next
      if (shouldRetryWrite) enqueueWrite(next)
      notify(next)
      return cache
    }
  }

  const hydrateOnce = (): Promise<T> => {
    ensureChangeSubscription()
    hydratePromise ??= hydrate().finally(() => {
      hydratePromise = null
    })
    return hydratePromise
  }

  const load = (): T => {
    if (cache !== null) return cache

    cache = options.fallback
    void hydrateOnce()
    return cache
  }

  const save = (value: T): T => {
    cache = options.normalize(value)
    notify(cache)

    if (!hydrated) {
      pendingFullValue = cache
      pendingPatches = []
      return cache
    }

    enqueueWrite(cache)

    return cache
  }

  const handleExternalChange = ({ key, value }: { key: string; value: unknown }) => {
    if (key !== options.storageKey || value === undefined || value === null) return
    if (!hydrated) return
    const next = options.normalize(value)
    if (JSON.stringify(next) === JSON.stringify(cache)) return
    let merged = next
    if (pendingFullValue !== null) merged = options.normalize({ ...merged, ...pendingFullValue })
    for (const patch of pendingPatches) {
      merged = options.normalize({ ...merged, ...patch })
    }
    cache = merged
    notify(cache)
  }

  // Subscribe lazily and defensively. Creating a preference is a module-scope
  // side effect, so a missing or not-yet-ready settings bridge must not make the
  // importing module throw on load.
  let changeSubscribed = false
  const ensureChangeSubscription = (): void => {
    if (changeSubscribed) return
    changeSubscribed = true
    try {
      api.settings?.onChanged?.(handleExternalChange)
    } catch (error) {
      logger.settings.warn(
        `[PersistentPreference] No change channel for ${options.storageKey}:`,
        error,
      )
    }
  }

  return {
    load,
    hydrate: hydrateOnce,
    save,
    update: patch => {
      const base = cache ?? options.fallback
      const next = options.normalize({ ...base, ...patch })
      cache = next
      notify(cache)

      if (!hydrated) {
        if (pendingFullValue === null) pendingFullValue = base
        pendingPatches = [...pendingPatches, patch]
        return cache
      }

      enqueueWrite(cache)
      return cache
    },
    subscribe: listener => {
      ensureChangeSubscription()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
