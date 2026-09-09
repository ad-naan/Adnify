import { describe, expect, it, vi } from 'vitest'
import { extensionApprovalScope } from '@shared/security/executionPolicy'
import type { ExtensionChangeSet } from '@shared/types/extensions'
import {
  ExtensionTransactionService,
  type ExtensionTransactionAdapter,
} from './ExtensionTransactionService'

function adapter(verificationOk = true): ExtensionTransactionAdapter {
  return {
    search: vi.fn(async () => []),
    list: vi.fn(async () => []),
    prepare: vi.fn(async () => ({
      displayName: 'Example',
      summary: 'Install Example',
      risk: 'dangerous' as const,
      credentialRequirements: [],
      payload: { resolved: true },
    })),
    apply: vi.fn(async () => undefined),
    verify: vi.fn(async () => ({ ok: verificationOk, status: verificationOk ? 'installed' : 'broken' })),
    rollback: vi.fn(async () => undefined),
  }
}

function approval(changeSetId: string, approvedAt: number) {
  return {
    requestId: 'request-1',
    toolCallId: 'tool-call-1',
    approvedAt,
    scope: extensionApprovalScope(changeSetId),
  }
}

describe('ExtensionTransactionService', () => {
  it('applies and verifies a prepared change only with its exact approval scope', async () => {
    const backend = adapter()
    const service = new ExtensionTransactionService(backend, () => 1_000, () => '9e4ff04b-9460-4309-81a8-fbd80397dd39')
    const change = await service.prepare({ kind: 'mcp', source: 'io.example/server', scope: 'user' })

    const result = await service.apply({ changeSetId: change.id, approval: approval(change.id, 1_000) })

    expect(result.success).toBe(true)
    expect(result.changeSet?.state).toBe('committed')
    expect(backend.apply).toHaveBeenCalledOnce()
    expect(backend.verify).toHaveBeenCalledOnce()
    expect(backend.rollback).not.toHaveBeenCalled()
  })

  it('rejects a proof issued for another change set without touching the adapter', async () => {
    const backend = adapter()
    const service = new ExtensionTransactionService(backend, () => 2_000, () => '2c146d4f-931c-40b4-83ca-b3c1804f2a61')
    const change = await service.prepare({ kind: 'skill', source: 'owner/repo@skill', scope: 'user' })

    const result = await service.apply({
      changeSetId: change.id,
      approval: approval('11d62f87-1a15-45d3-bfb3-0ead1423d1b7', 2_000),
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('mismatched')
    expect(backend.apply).not.toHaveBeenCalled()
  })

  it('expires unapproved changes and rejects approval replay after commit', async () => {
    let now = 5_000
    const backend = adapter()
    const service = new ExtensionTransactionService(backend, () => now, () => '2ef611ff-b530-45f6-af31-9b66943938cf')
    const expired = await service.prepare({ kind: 'mcp', source: 'expired', scope: 'user' })
    now += 10 * 60_000
    expect((await service.apply({ changeSetId: expired.id, approval: approval(expired.id, now) })).changeSet?.state).toBe('expired')

    now += 1
    const active = await service.prepare({ kind: 'mcp', source: 'active', scope: 'user' })
    const proof = approval(active.id, now)
    expect((await service.apply({ changeSetId: active.id, approval: proof })).success).toBe(true)
    expect((await service.apply({ changeSetId: active.id, approval: proof })).success).toBe(false)
    expect(backend.apply).toHaveBeenCalledOnce()
  })

  it('rolls back when post-install verification fails', async () => {
    const backend = adapter(false)
    const service = new ExtensionTransactionService(backend, () => 8_000, () => '1969de73-77d4-46d3-a8ea-eefeb3ccaf6e')
    const change = await service.prepare({ kind: 'skill', source: 'owner/repo@skill', scope: 'user' })

    const result = await service.apply({ changeSetId: change.id, approval: approval(change.id, 8_000) })

    expect(result.success).toBe(false)
    expect(result.changeSet?.state).toBe('rolled_back')
    expect(backend.rollback).toHaveBeenCalledOnce()
  })

  it('blocks unresolved required credentials before installation', async () => {
    const backend = adapter()
    vi.mocked(backend.prepare).mockResolvedValueOnce({
      displayName: 'Credentialed MCP',
      summary: 'Install it',
      risk: 'dangerous',
      credentialRequirements: [{ name: 'TOKEN', required: true, secret: true }],
      payload: {},
    })
    const service = new ExtensionTransactionService(backend, () => 13_000, () => '25998595-e508-4e3f-b6fe-6ed8f8aa2ee6')
    const change = await service.prepare({ kind: 'mcp', source: 'credentialed', scope: 'user' })

    const result = await service.apply({ changeSetId: change.id, approval: approval(change.id, 13_000) })

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires credentials')
    expect((service.get(change.id) as ExtensionChangeSet).state).toBe('prepared')
    expect(backend.apply).not.toHaveBeenCalled()
  })

  it('refreshes credential status before applying without exposing a value', async () => {
    const backend = adapter()
    vi.mocked(backend.prepare).mockResolvedValueOnce({
      displayName: 'Credentialed MCP',
      summary: 'Install it',
      risk: 'dangerous',
      credentialRequirements: [{ name: 'TOKEN', required: true, secret: true, reference: 'mcp:server:TOKEN', configured: false }],
      payload: {},
    })
    backend.refreshCredentialRequirements = vi.fn(async () => [
      { name: 'TOKEN', required: true, secret: true, reference: 'mcp:server:TOKEN', configured: true },
    ])
    const service = new ExtensionTransactionService(backend, () => 21_000, () => '282378e5-2a31-48f8-aa42-280d50b74dc7')
    const change = await service.prepare({ kind: 'mcp', source: 'credentialed', scope: 'user' })

    const result = await service.apply({ changeSetId: change.id, approval: approval(change.id, 21_000) })

    expect(result.success).toBe(true)
    expect(result.changeSet?.credentialRequirements).toEqual([
      { name: 'TOKEN', required: true, secret: true, reference: 'mcp:server:TOKEN', configured: true },
    ])
    expect(backend.apply).toHaveBeenCalledOnce()
  })

  it('emits an auditable transaction sequence without payload data', async () => {
    const backend = adapter()
    const events: Array<{ event: string; changeSet: ExtensionChangeSet }> = []
    const audit = {
      record: vi.fn(async (event: string, changeSet: ExtensionChangeSet) => {
        events.push({ event, changeSet: { ...changeSet } })
      }),
    }
    const service = new ExtensionTransactionService(
      backend,
      () => 34_000,
      () => 'e8075c45-fb71-4ab3-8c43-71c887762d68',
      audit,
    )
    const change = await service.prepare({ kind: 'skill', source: 'owner/repo@skill', scope: 'user' })
    await service.apply({ changeSetId: change.id, approval: approval(change.id, 34_000) })

    expect(events.map(item => item.event)).toEqual(['prepared', 'apply_started', 'committed'])
    expect(events.every(item => !('payload' in item.changeSet))).toBe(true)
  })
})
