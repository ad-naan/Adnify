import { describe, expect, it } from 'vitest'
import {
  EXTENSION_TO_LANGUAGE,
  LSP_SERVER_DEFINITIONS,
  LSP_SUPPORTED_LANGUAGES,
  getLanguageFromPath,
  getServerIdForLanguage,
  isLspSupported,
} from '@shared/languages'

describe('LSP language support contract', () => {
  it('routes every declared language to exactly one server', () => {
    const declaredLanguages = LSP_SERVER_DEFINITIONS.flatMap(server => server.languages)
    const serverIds = LSP_SERVER_DEFINITIONS.map(server => server.id)

    expect(new Set(serverIds).size).toBe(serverIds.length)
    expect(new Set(declaredLanguages).size).toBe(declaredLanguages.length)
    expect(LSP_SUPPORTED_LANGUAGES).toEqual(declaredLanguages)

    for (const languageId of declaredLanguages) {
      expect(isLspSupported(languageId)).toBe(true)
      expect(getServerIdForLanguage(languageId)).not.toBeNull()
    }
  })

  it('has at least one file extension for every statically routed language', () => {
    const extensionLanguages = new Set(Object.values(EXTENSION_TO_LANGUAGE))

    for (const languageId of LSP_SUPPORTED_LANGUAGES) {
      expect(extensionLanguages.has(languageId), `${languageId} has no file extension`).toBe(true)
    }
  })

  it('keeps recognized-but-unsupported languages out of the LSP route', () => {
    expect(getLanguageFromPath('build.gradle.kts')).toBe('kotlin')
    expect(isLspSupported('kotlin')).toBe(false)
    expect(getServerIdForLanguage('kotlin')).toBeNull()
  })

  it('keeps Deno project-scoped instead of claiming JavaScript extensions globally', () => {
    const deno = LSP_SERVER_DEFINITIONS.find(server => server.id === 'deno')

    expect(deno?.languages).toEqual([])
    expect(getServerIdForLanguage('typescript')).toBe('typescript')
  })
})
