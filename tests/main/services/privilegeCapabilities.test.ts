import { describe, expect, it } from 'vitest'
import { isPrivilegeCapability, PRIVILEGE_CAPABILITY_COPY } from '@main/services/privilegeCapabilities'

describe('privilege capability registry', () => {
  it.each(Object.keys(PRIVILEGE_CAPABILITY_COPY))('accepts registered capability %s', capability => {
    expect(isPrivilegeCapability(capability)).toBe(true)
  })

  it.each(['', 'terminal.exec', '__proto__', { capability: 'lsp.install' }])('rejects unregistered capability', capability => {
    expect(isPrivilegeCapability(capability)).toBe(false)
  })
})
