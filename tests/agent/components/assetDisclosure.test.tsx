import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { ToolCall } from '@renderer/agent/types'
import type { AssetJobSummary } from '@shared/types/assets'
import { AssetCanvas, AssetJobCard, AssetPreview } from '@renderer/components/agent/AssetJobCard'
import AssetToolCard from '@renderer/components/agent/AssetToolCard'
import SmoothCollapse from '@renderer/components/agent/SmoothCollapse'

// This project's unit suite has no DOM renderer. Keep hook state between shallow
// renders so we can exercise the real disclosure hook and job polling callbacks.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Array<() => unknown> }))
const request = vi.hoisted(() => vi.fn())
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }
    return hooks.slots[index]
  },
  useCallback: (callback: unknown) => callback,
  useId: () => 'asset-body',
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect) },
}))
vi.mock('@store', () => ({ useStore: (select: (state: { language: string }) => unknown) => select({ language: 'en' }) }))
vi.mock('@services/assetService', () => ({ assetService: { request } }))
vi.mock('@components/ui', () => ({ Modal: () => null }))
vi.mock('@renderer/components/agent/ImageLightbox', () => ({ ImageLightbox: () => null }))
vi.mock('@renderer/agent/presentation/toolDisplay', () => ({
  useToolDisplayState: (tool: ToolCall) => ({
    effectiveName: tool.name, args: tool.arguments,
    isRunning: tool.status === 'running', isStreaming: false,
    isError: tool.status === 'error', isRejected: tool.status === 'rejected', isSuccess: tool.status === 'success',
  }),
}))

function render<T>(component: () => T): T {
  hooks.cursor = 0
  hooks.effects = []
  return component()
}

function find(node: ReactNode, type: unknown): ReactElement<Record<string, any>> {
  const pending = Children.toArray(node)
  while (pending.length) {
    const next = pending.shift()
    if (!isValidElement<Record<string, any>>(next)) continue
    if (next.type === type) return next
    pending.push(...Children.toArray(next.props.children))
  }
  throw new Error(`Element not found: ${String(type)}`)
}

const tool = (name: string, extra: Partial<ToolCall> = {}): ToolCall => ({
  id: 'tool', name, status: 'success', arguments: {}, ...extra,
})

beforeEach(() => {
  hooks.cursor = 0
  hooks.slots = []
  hooks.effects = []
  request.mockReset()
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers() })

describe('asset canvas disclosure', () => {
  it('follows the timeline and uses the shared collapse animation', () => {
    const canvas = (automaticOpen: boolean) => render(() => AssetCanvas({ automaticOpen, children: 'preview' }))
    expect(find(canvas(true), SmoothCollapse).props.open).toBe(true)
    expect(find(canvas(false), SmoothCollapse).props.open).toBe(false)
    expect(find(canvas(true), SmoothCollapse).props.open).toBe(true)
  })

  it.each([true, false])('preserves a manual toggle from %s across timeline changes', initialOpen => {
    const canvas = (automaticOpen: boolean) => render(() => AssetCanvas({ automaticOpen, children: 'preview' }))
    find(canvas(initialOpen), 'button').props.onClick()
    expect(find(canvas(!initialOpen), SmoothCollapse).props.open).toBe(!initialOpen)
    expect(find(canvas(initialOpen), SmoothCollapse).props.open).toBe(!initialOpen)
  })

  it('keeps standalone previews open by default and manually collapsible', () => {
    const canvas = () => render(() => AssetCanvas({ children: 'preview' }))
    expect(find(canvas(), SmoothCollapse).props.open).toBe(true)
    find(canvas(), 'button').props.onClick()
    expect(find(canvas(), SmoothCollapse).props.open).toBe(false)
  })
})

describe('asset tool routing', () => {
  it.each([true, false])('passes presenting=%s to capability cards and job cards', isPresenting => {
    const capabilities = render(() => AssetToolCard({ toolCall: tool('asset_capabilities'), isPresenting }))
    expect(find(capabilities, AssetCanvas).props.automaticOpen).toBe(isPresenting)
    const job = render(() => AssetToolCard({ toolCall: tool('asset_generate', { arguments: { _meta: { assetJobId: 'job' } } }), isPresenting }))
    expect(find(job, AssetJobCard).props.isPresenting).toBe(isPresenting)
  })

  it.each(['asset_import', 'asset_export'])('passes the timeline signal through %s previews', name => {
    const result = render(() => AssetToolCard({ toolCall: tool(name, { result: '{"id":"asset"}', arguments: { asset_id: 'asset' } }), isPresenting: false }))
    expect(find(result, AssetPreview).props.automaticOpen).toBe(false)
    const preview = render(() => AssetPreview({ id: 'asset', automaticOpen: false }))
    expect(find(preview, AssetCanvas).props.automaticOpen).toBe(false)
  })

  it('keeps approval controls visible even outside the presented stage', () => {
    const result = render(() => AssetToolCard({ toolCall: tool('asset_generate', { status: 'awaiting' }), isPresenting: false, isAwaitingApproval: true }))
    expect(find(result, AssetCanvas).props.automaticOpen).toBe(true)
    expect(find(result, AssetCanvas).props.footer).toBeTruthy()
  })
})

describe('asynchronous asset jobs', () => {
  it.each(['queued', 'submitting', 'running', 'collecting'] as const)('holds %s jobs open after handoff, then folds a ready job', async state => {
    request.mockResolvedValueOnce({ state, assetIds: [] } as Partial<AssetJobSummary>)
      .mockResolvedValueOnce({ state: 'ready', assetIds: ['asset'] } as Partial<AssetJobSummary>)
    const card = () => render(() => AssetJobCard({ jobId: 'job', isPresenting: false }))
    expect(find(card(), AssetCanvas).props.automaticOpen).toBe(false)
    const cleanup = hooks.effects[0]() as () => void
    await vi.advanceTimersByTimeAsync(0)
    expect(find(card(), AssetCanvas).props.automaticOpen).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(find(card(), AssetCanvas).props.automaticOpen).toBe(false)
    expect(request).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it.each(['ready', 'failed', 'cancelled', 'submission_unknown'] as const)('lets the timeline fold %s jobs', async state => {
    request.mockResolvedValue({ state, assetIds: [] } as Partial<AssetJobSummary>)
    const card = (isPresenting?: boolean) => render(() => AssetJobCard({ jobId: 'job', isPresenting }))
    card(true)
    const cleanup = hooks.effects[0]() as () => void
    await vi.advanceTimersByTimeAsync(0)
    expect(find(card(true), AssetCanvas).props.automaticOpen).toBe(true)
    expect(find(card(false), AssetCanvas).props.automaticOpen).toBe(false)
    expect(find(card(), AssetCanvas).props.automaticOpen).toBeUndefined()
    cleanup()
  })

  it('does not replay an open/close cycle when a completed process is remounted', async () => {
    request.mockResolvedValue({ state: 'ready', assetIds: ['asset'] } as Partial<AssetJobSummary>)
    const card = () => render(() => AssetJobCard({ jobId: 'job', isPresenting: false }))
    expect(find(card(), AssetCanvas).props.automaticOpen).toBe(false)
    const cleanup = hooks.effects[0]() as () => void
    await vi.advanceTimersByTimeAsync(0)
    expect(find(card(), AssetCanvas).props.automaticOpen).toBe(false)
    cleanup()
  })

  it('does not hold a failed initial job lookup open forever', async () => {
    request.mockRejectedValue(new Error('Unavailable'))
    const card = () => render(() => AssetJobCard({ jobId: 'job', isPresenting: false }))
    card()
    const cleanup = hooks.effects[0]() as () => void
    await vi.advanceTimersByTimeAsync(0)
    expect(find(card(), AssetCanvas).props.automaticOpen).toBe(false)
    cleanup()
  })
})
