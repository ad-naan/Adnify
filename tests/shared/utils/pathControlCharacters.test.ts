import { describe, expect, it } from 'vitest'
import { hasAsciiControlCharacters } from '@shared/utils/pathUtils'
import { parseChatFileHref, parseChatFilePath } from '@renderer/components/agent/chatFilePaths'

describe('path control character rejection', () => {
  it.each(Array.from({ length: 32 }, (_, code) => code))('rejects C0 character %i in literal and encoded paths', code => {
    const path = `src/a${String.fromCharCode(code)}b.ts`
    expect(hasAsciiControlCharacters(path)).toBe(true)
    expect(parseChatFilePath(path)).toBeNull()
    expect(parseChatFileHref(encodeURIComponent(path))).toBeNull()
  })

  it('preserves the separate DEL policy for OS paths and chat paths', () => {
    const path = `src/a${String.fromCharCode(127)}b.ts`
    expect(hasAsciiControlCharacters(path)).toBe(false)
    expect(hasAsciiControlCharacters(path, true)).toBe(true)
    expect(parseChatFilePath(path)).toBeNull()
    expect(parseChatFileHref(encodeURIComponent(path))).toBeNull()
  })

  it('accepts ordinary paths with spaces, Unicode and Windows separators', () => {
    const path = 'C:\\项目\\发布 包.zip'
    expect(hasAsciiControlCharacters(path, true)).toBe(false)
    expect(parseChatFilePath(path)).toBe('C:/项目/发布 包.zip')
  })
})
