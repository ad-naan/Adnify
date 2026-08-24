import { describe, expect, it } from 'vitest'
import {
  getLanguageFromPath,
  getServerIdForLanguage,
  isLspSupported,
} from '@shared/languages'

describe('Java language support', () => {
  it('maps Java source files to the Java language service', () => {
    expect(getLanguageFromPath('src/main/java/com/example/App.java')).toBe('java')
    expect(getServerIdForLanguage('java')).toBe('jdtls')
    expect(isLspSupported('java')).toBe(true)
  })
})
