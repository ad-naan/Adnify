# User preference persistence architecture

## Source of truth

The scoped `electron-store` config file is the only source of truth for user
preferences. `localStorage` may be read once only to migrate a legacy value, and
must not remain a long-lived mirror.

## Adding a preference

1. Add the storage key and legacy key to `src/renderer/settings/preferenceKeys.ts`.
2. Add a typed default and normalizer to `src/renderer/settings/userPreferences.ts`.
3. Create the feature accessor with `createPersistentPreference`.
4. Add the key to `cleanConfigValue` in `src/shared/config/configCleaner.ts`.
5. Register reset/import/export behavior through `src/renderer/services/preferenceService.ts`.

The registry is intentionally split in two layers: `preferenceKeys.ts` contains
only stable storage keys and can be imported by feature modules, while
`userPreferences.ts` contains defaults and normalizers. This prevents feature
normalizers from creating import cycles.

## Classification

- User preferences: settings and authored data the user expects after restart,
  such as prompts, animation switches, shortcuts, snippets, themes, profiles,
  shell configurations, and preview choices.
- Runtime state/cache: window sizes, recent searches, version notices, emotion
  baselines/feedback, and generated caches. These do not belong in the preference
  registry.

## Rules

- Never read a stale `localStorage` value and write it back over the file.
- Normalize at the persistence boundary.
- Use `api.settings.onChanged` for multi-window propagation.
- Reset and export/import must use the registry rather than ad-hoc key lists.
- Legacy migration must write the durable value first, then remove the legacy
  key. If the write fails, keep the legacy key and retry on the next launch.
- Aggregate settings and each individual preference write a durable migration
  marker after their first successful migration. A marked migration never reads
  localStorage again, even if an older executable later recreates the key.
- `save()` and `update()` may return optimistic values before IPC hydration
  finishes, but their writes are queued and merged into the hydrated value so
  a fast toggle cannot overwrite durable data with defaults.
- Preference exports are redacted by default. Import restores marked redacted
  fields from the local durable store instead of silently deleting local keys.
- Preferences with cross-process consumers (such as `indexConfig`) may keep a
  main-process reader, but renderer writes must still go through the registry
  so normalize, import, export, and reset behavior remains identical.
