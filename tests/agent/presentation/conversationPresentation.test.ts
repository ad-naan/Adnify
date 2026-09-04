import { describe, expect, it } from 'vitest'
import { ConversationPresentation } from '@renderer/agent/presentation/conversationPresentation'

function fixture() {
  let now = 0
  const callbacks = new Set<() => void>()
  const presentation = new ConversationPresentation({
    now: () => now,
    schedule: callback => { callbacks.add(callback); return () => { callbacks.delete(callback) } },
  })
  return {
    presentation, callbacks,
    tick() { now += 16; const batch = [...callbacks]; callbacks.clear(); batch.forEach(callback => callback()) },
  }
}

describe('conversation presentation lifetime', () => {
  it('owns one scheduled tick regardless of source update frequency', () => {
    const { presentation, callbacks } = fixture()
    for (let i = 0; i < 100; i++) presentation.observe('thread', 'message', [{ type: 'text', content: 'x'.repeat(i) }], true)
    expect(callbacks.size).toBe(1)
    presentation.dispose()
    expect(callbacks.size).toBe(0)
    expect(presentation.store.getState().turns).toEqual({})
  })

  it('keeps advancing without any mounted message subscribers', () => {
    const { presentation, callbacks, tick } = fixture()
    presentation.observe('thread', 'message', [{ type: 'text', content: 'a complete answer' }], true)
    const unsubscribe = presentation.store.subscribe(() => {})
    unsubscribe()
    presentation.observe('thread', 'message', [{ type: 'text', content: 'a complete answer' }], false)
    for (let i = 0; i < 500 && callbacks.size; i++) tick()
    expect(presentation.store.getState().turns.message.parts[0]).toMatchObject({ content: 'a complete answer' })
    expect(presentation.store.getState().dock?.isPresenting).toBe(false)
    expect(callbacks.size).toBe(0)
  })

  it('does not notify dock selectors on every character', () => {
    const { presentation, tick } = fixture()
    presentation.observe('thread', 'message', [{ type: 'text', content: 'x'.repeat(100) }], true)
    const dock = presentation.store.getState().dock
    for (let i = 0; i < 20; i++) tick()
    expect(presentation.store.getState().dock).toBe(dock)
    expect(presentation.store.getState().turns.message.parts[0]).not.toMatchObject({ content: '' })
  })

  it('cancels stale work on thread switches and does not replay historical turns', () => {
    const { presentation, callbacks } = fixture()
    presentation.observe('first', 'live', [{ type: 'text', content: 'pending' }], true)
    presentation.observe('second', 'history', [{ type: 'text', content: 'saved answer' }], false)
    expect(callbacks.size).toBe(0)
    expect(presentation.store.getState().turns).toEqual({})
    presentation.observe('second', 'new', [{ type: 'text', content: 'new answer' }], true)
    expect(callbacks.size).toBe(1)
    presentation.observe('second', undefined, [], false)
    expect(callbacks.size).toBe(0)
  })
})
