import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AGENT_SETTINGS } from '../agentSettings'
import { parseSettingValue } from '../settingValue'

const parse = (key: string, value: unknown) => parseSettingValue(key, AGENT_SETTINGS[key].schema, value)
const issues = (value: unknown) => {
  try { parse('editorConfig', value) } catch (error) {
    expect(error).toBeInstanceOf(z.ZodError)
    return (error as z.ZodError).issues
  }
  throw new Error('Expected validation to fail')
}

describe('setting value decoding', () => {
  it.each(['false', '14', 'null', '{"example":true}', '"quoted"', '  {unfinished\n'])('preserves a valid literal string setting: %s', value => {
    expect(parse('aiInstructions', value)).toBe(value)
  })

  it('supports encoded booleans and arrays while retaining schema validation', () => {
    expect(parse('enableFileLogging', 'false')).toBe(false)
    expect(parse('snippets', '[]')).toEqual([])
    expect(() => parse('snippets', '[{"bad":true}]')).toThrow()
  })

  it('preserves quotes, Unicode and backslashes inside object string fields', () => {
    const patch = { fontFamily: "'JetBrains Mono', 'Microsoft YaHei', monospace", terminal: { fontFamily: 'C:\\Fonts\\字体\\"Mono"' } }
    expect(parse('editorConfig', JSON.stringify(patch))).toEqual(patch)
  })

  it.each([
    { fontSize: '14' },
    { fontSize: -1 },
    { terminal: '{"fontFamily":"Mono"}' },
    { editorConfig: { fontFamily: 'Mono' } },
    { unknownSettingField: true },
  ])('rejects an invalid decoded patch just as it rejects a native patch: %j', patch => {
    expect(issues(JSON.stringify(patch))).toEqual(issues(patch))
    expect(issues(patch)[0].path[0]).toBe('value')
  })

  it('includes the nested field path in validation errors', () => {
    expect(issues('{"terminal":{"fontFamily":42}}')[0].path).toEqual(['value', 'terminal', 'fontFamily'])
  })

  it('does not repair malformed JSON or recursively decode repeated encodings', () => {
    expect(issues('{"fontFamily":')[0].message).toContain('not valid JSON')
    expect(issues(JSON.stringify(JSON.stringify({ fontSize: 14 })))[0].code).toBe('invalid_type')
  })

  it('does not expose the supplied string in a JSON parse error', () => {
    const secret = '{"secret":"do-not-echo-this'
    expect(JSON.stringify(issues(secret))).not.toContain('do-not-echo-this')
  })
})
