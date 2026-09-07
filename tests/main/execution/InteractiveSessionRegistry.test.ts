import { describe, expect, it } from 'vitest'
import { InteractiveSessionRegistry } from '@main/services/execution/InteractiveSessionRegistry'
const session = { id: 'terminal', cwd: '/project', shell: 'bash', isAgent: true }
describe('interactive shell leases', () => {
  it('rejects concurrent leases and cannot release a submitted command early', () => {
    const registry = new InteractiveSessionRegistry()
    registry.add(1, session)
    const lease = registry.claim(1, session.id)
    expect(() => registry.claim(1, session.id)).toThrow()
    registry.input(1, session.id, lease)
    registry.release(1, session.id, lease)
    expect(() => registry.claim(1, session.id)).toThrow()
    registry.output(session.id, '\x1b]633;C\x07\x1b]633;D;0\x07')
    expect(registry.claim(1, session.id)).not.toBe(lease)
    expect(() => registry.input(1, session.id, lease)).toThrow()
  })
  it('does not mistake a quiet, unknown, or manually controlled shell for an idle one', () => {
    const registry = new InteractiveSessionRegistry()
    registry.add(1, session)
    registry.error(session.id)
    expect(() => registry.claim(1, session.id)).toThrow()
    registry.output(session.id, '\x1b]633;A\x07')
    registry.input(1, session.id)
    registry.output(session.id, '\x1b]633;D;0\x07')
    expect(() => registry.claim(1, session.id)).toThrow()
    expect(() => registry.claim(2, session.id)).toThrow()
  })
  it('releases a failed command after a large output chunk and allows reuse', () => {
    const registry = new InteractiveSessionRegistry()
    registry.add(1, session)
    const lease = registry.claim(1, session.id)
    let released = 0
    registry.attachPermit(1, session.id, lease, () => { released++ })
    registry.input(1, session.id, lease)
    registry.output(session.id, '\x1b]633;C\x07' + 'build diagnostics\r\n'.repeat(2000) + '\x1b]633;D;2\x07\x1b]633;A\x07')
    expect(released).toBe(1)
    expect(registry.list(1)[0]).toMatchObject({ state: 'ready', exitCode: 2 })
    expect(registry.claim(1, session.id)).not.toBe(lease)
  })
})
