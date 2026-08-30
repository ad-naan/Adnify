/**
 * 共享 JSON 扫描器的单元测试。
 *
 * 这一份取代了四处手写扫描循环，外加 experimental_repairToolCall 里那个朴素正则计数器，
 * 所以「转义与字符串感知」这件事必须逐条钉住——它正是那个正则版本错的地方。
 */

import { describe, it, expect } from 'vitest'
import { scanJson, findJsonValueEnd, sliceJsonValue, closeUnterminatedJson } from '@shared/utils/jsonScan'

describe('findJsonValueEnd', () => {
  it('括号配对是字符串与转义感知的', () => {
    // 字符串里的 } 不算闭合
    expect(findJsonValueEnd('{"a":"}"}', 0)).toBe(8)
    // 转义引号不结束字符串
    expect(findJsonValueEnd('{"a":"\\""}', 0)).toBe(9)
    expect(findJsonValueEnd('{"a":{"b":1}}', 0)).toBe(12)
    expect(findJsonValueEnd('[1,[2],3]', 0)).toBe(8)
  })

  it('未闭合返回 -1', () => {
    expect(findJsonValueEnd('{"a":1', 0)).toBe(-1)
    expect(findJsonValueEnd('{"a":"unterminated', 0)).toBe(-1)
  })

  it('起始字符不是开括号一律 -1', () => {
    expect(findJsonValueEnd('x{}', 0)).toBe(-1)
    expect(findJsonValueEnd('{}', 1)).toBe(-1)
    expect(findJsonValueEnd('', 0)).toBe(-1)
  })

  it('从中途的开括号开始也能配对', () => {
    const text = '"parameters":{"path":"a"},"x":1'
    expect(findJsonValueEnd(text, text.indexOf('{'))).toBe(24)
  })

  it('尾部多余内容不影响配对位置', () => {
    expect(findJsonValueEnd('{"a":1} trailing junk }', 0)).toBe(6)
  })
})

describe('sliceJsonValue', () => {
  it('完整值切到闭括号', () => {
    expect(sliceJsonValue('{"a":1},{"b":2}', 0)).toEqual({ slice: '{"a":1}', complete: true })
  })

  it('截断值把剩下的整段交给调用方', () => {
    expect(sliceJsonValue('{"a":1,"b":', 0)).toEqual({ slice: '{"a":1,"b":', complete: false })
  })

  it('起点不是开括号返回 null', () => {
    expect(sliceJsonValue('a{}', 0)).toBeNull()
  })
})

describe('scanJson', () => {
  it('报告未闭合的栈、字符串状态与最后一个完整顶层结构', () => {
    expect(scanJson('{"a":[1,2')).toMatchObject({ openStack: ['{', '['], inString: false, lastCompleteEnd: -1 })
    expect(scanJson('{"a":"x')).toMatchObject({ openStack: ['{'], inString: true, escaped: false })
    expect(scanJson('{"a":"x\\')).toMatchObject({ inString: true, escaped: true })
    expect(scanJson('{"a":1}{"b":2}')).toMatchObject({ openStack: [], lastCompleteEnd: 13 })
  })

  it('栈空时多余的闭括号被忽略，不让计数变负', () => {
    expect(scanJson('}}{"a":1}')).toMatchObject({ openStack: [], lastCompleteEnd: 8 })
  })
})

describe('closeUnterminatedJson', () => {
  it('按栈序补收尾，而不是先补一类再补另一类', () => {
    // 正则计数器版本会产出 `[{"a":1]}`——括号数对了，JSON.parse 照样失败
    expect(closeUnterminatedJson('[{"a":1')).toBe('[{"a":1}]')
    expect(JSON.parse(closeUnterminatedJson('[{"a":1'))).toEqual([{ a: 1 }])
  })

  it('未闭合的字符串补引号，再补括号', () => {
    expect(closeUnterminatedJson('{"path":"src/a')).toBe('{"path":"src/a"}')
    expect(JSON.parse(closeUnterminatedJson('{"path":"src/a'))).toEqual({ path: 'src/a' })
  })

  it('末尾孤立的反斜杠先补成合法转义（否则补的引号会被它吃掉）', () => {
    const fixed = closeUnterminatedJson('{"path":"a\\')
    expect(fixed).toBe('{"path":"a\\\\"}')
    expect(JSON.parse(fixed)).toEqual({ path: 'a\\' })
  })

  it('字符串里的括号不参与计数（回归：正则版本在这里补错）', () => {
    const input = '{"path":"a}b["}'
    // 已经完整，不该动它
    expect(closeUnterminatedJson(input)).toBe(input)
    expect(JSON.parse(closeUnterminatedJson(input))).toEqual({ path: 'a}b[' })
  })

  it('已完整的 JSON 原样返回', () => {
    expect(closeUnterminatedJson('{"a":[1,2]}')).toBe('{"a":[1,2]}')
    expect(closeUnterminatedJson('')).toBe('')
  })
})
