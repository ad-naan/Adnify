/**
 * read_file 工具 schema 校验测试
 *
 * 背景：客户日志（tool-logs-2026-08-25.json）里 read_file 51 次调用 100% 失败，
 * 全部止于参数校验 —— 模型每次都同时发了 path 和 paths，而空数组在 JS 里是真值，
 * 旧实现 `Boolean(data.path) === Boolean(data.paths)` 把它判成「两个都给了」而拒绝。
 *
 * customSchema 此前没有任何测试覆盖，所以这个 bug 一路发到了客户手上。
 * 这里直接对 TOOL_CONFIGS.read_file.customSchema 断言，锁住校验入口的行为。
 */

import { describe, it, expect } from 'vitest'
import { TOOL_CONFIGS } from '@/shared/config/tools'

function parseReadFileArgs(input: unknown) {
  const schema = TOOL_CONFIGS.read_file.customSchema
  if (!schema) throw new Error('read_file.customSchema is not defined')
  return schema.safeParse(input)
}

function errorMessages(result: ReturnType<typeof parseReadFileArgs>): string[] {
  if (result.success) return []
  return result.error.issues.map(issue => issue.message)
}

describe('read_file customSchema', () => {
  describe('回归：日志中 100% 失败的两种形状', () => {
    it('接受 path + 空 paths 占位（日志中 35/51 次）', () => {
      const result = parseReadFileArgs({
        path: 'source/apps/admin-web/package.json',
        paths: [],
        start_line: 1,
        end_line: 240,
      })

      expect(errorMessages(result)).toEqual([])
      expect(result.success).toBe(true)
      if (result.success) {
        const data = result.data as Record<string, unknown>
        expect(data.path).toBe('source/apps/admin-web/package.json')
        // 空占位不应残留，否则下游会再次误判成多文件请求
        expect(data.paths).toBeUndefined()
        expect(data.start_line).toBe(1)
        expect(data.end_line).toBe(240)
      }
    })

    it('接受 path 与 paths 指向同一文件（日志中 16/51 次）', () => {
      const result = parseReadFileArgs({
        path: 'source/apps/server-java/pom.xml',
        paths: ['source/apps/server-java/pom.xml'],
        start_line: 1,
        end_line: 260,
      })

      expect(errorMessages(result)).toEqual([])
      expect(result.success).toBe(true)
      if (result.success) {
        const data = result.data as Record<string, unknown>
        // 并集去重后只剩一个文件 —— 按单文件读取，行范围保留
        expect(data.path).toBe('source/apps/server-java/pom.xml')
        expect(data.paths).toBeUndefined()
        expect(data.start_line).toBe(1)
        expect(data.end_line).toBe(260)
      }
    })

    it('path 与 paths 指向不同文件时取并集，不丢文件', () => {
      const result = parseReadFileArgs({
        path: 'src/a.ts',
        paths: ['src/b.ts', 'src/c.ts'],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const data = result.data as Record<string, unknown>
        expect(data.paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
        expect(data.path).toBeUndefined()
      }
    })
  })

  describe('正常形状', () => {
    it('接受单文件 path', () => {
      const result = parseReadFileArgs({ path: 'src/main.ts' })
      expect(result.success).toBe(true)
    })

    it('接受单文件 path 加行范围', () => {
      const result = parseReadFileArgs({ path: 'src/main.ts', start_line: 10, end_line: 40 })
      expect(result.success).toBe(true)
      if (result.success) {
        const data = result.data as Record<string, unknown>
        expect(data.start_line).toBe(10)
        expect(data.end_line).toBe(40)
      }
    })

    it('接受多文件 paths', () => {
      const result = parseReadFileArgs({ paths: ['src/a.ts', 'src/b.ts'] })
      expect(result.success).toBe(true)
      if (result.success) {
        expect((result.data as Record<string, unknown>).paths).toEqual(['src/a.ts', 'src/b.ts'])
      }
    })

    it('倒置的行范围通过校验（实际交换发生在执行阶段）', () => {
      const result = parseReadFileArgs({ path: 'src/main.ts', start_line: 40, end_line: 10 })

      // 这一层只做校验与归一化，不纠正顺序 —— 交换由 resolveReadFileRequest
      // 在执行时完成（见 tests/unit/shared/utils/readFile.test.ts）。
      // 关键是别在这里就把调用打回。
      expect(result.success).toBe(true)
      if (result.success) {
        const data = result.data as Record<string, unknown>
        expect(data.start_line).toBe(40)
        expect(data.end_line).toBe(10)
      }
    })
  })

  describe('仍应拒绝的形状', () => {
    it('两者都不给时拒绝，并提示该怎么传', () => {
      const result = parseReadFileArgs({ start_line: 1, end_line: 10 })

      expect(result.success).toBe(false)
      expect(errorMessages(result).join(' ')).toContain('Provide either path')
    })

    it('只给空 paths 时拒绝', () => {
      const result = parseReadFileArgs({ paths: [] })
      expect(result.success).toBe(false)
    })

    it('path 为空字符串时拒绝', () => {
      const result = parseReadFileArgs({ path: '' })
      expect(result.success).toBe(false)
    })

    it('paths 含空字符串条目时拒绝', () => {
      const result = parseReadFileArgs({ paths: ['src/a.ts', ''] })
      expect(result.success).toBe(false)
    })
  })
})
