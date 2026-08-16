import { describe, expect, it } from 'vitest'
import { TOOL_CONFIGS, getToolMetadata } from '@/shared/config/tools'

/**
 * Retry was structurally impossible: every tool declared
 * `retryPolicy: { maxAttempts: 1 }`, which makes `ToolManager.inferRetryable`
 * return false unconditionally, and `executeSingle` discarded the `envelope` and
 * `outcome` that carried the flag. So a transient network blip reached the model
 * as a hard tool error with no retry.
 *
 * `executeWithRetry` now honours the policy, but only for side-effect-free tools:
 * a "failed" write may have partially applied, and repeating it can double-apply.
 * Safety is judged by category and resourceScope, NOT by the `parallel` flag —
 * `web_search` is `parallel: false` purely to discourage scattered searches, yet
 * it is perfectly safe to retry. These tests pin the invariant at the config
 * level, where a future tool could otherwise quietly opt a write into retrying.
 */
const RETRY_SAFE_CATEGORIES = new Set(['read', 'search', 'lsp', 'network'])

describe('tool retry policy', () => {
  it('only grants retries to side-effect-free tools', () => {
    const offenders: string[] = []

    for (const [name, config] of Object.entries(TOOL_CONFIGS)) {
      const attempts = config.retryPolicy?.maxAttempts ?? 1
      if (attempts <= 1) continue

      const safeCategory = RETRY_SAFE_CATEGORIES.has(config.category)
      const declaresWrite = (config.resourceScope || []).some(scope => scope.includes('write'))
      if (!safeCategory || declaresWrite) {
        offenders.push(`${name} (category=${config.category}, scope=${config.resourceScope}, attempts=${attempts})`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('grants retries to the idempotent network reads', () => {
    // These are the cases retry actually exists for: a flaky network on a read
    // that can safely be repeated.
    for (const name of ['web_search', 'read_url']) {
      expect(getToolMetadata(name)?.retryPolicy?.maxAttempts).toBeGreaterThan(1)
    }
  })

  it('never grants retries to file writes or command execution', () => {
    for (const name of ['write_file', 'edit_file', 'delete_file_or_folder', 'run_command']) {
      const attempts = getToolMetadata(name)?.retryPolicy?.maxAttempts ?? 1
      expect(attempts).toBe(1)
    }
  })
})
