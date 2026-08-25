import { describe, expect, it } from 'vitest'
import { normalizeReadFileArgs, resolveReadFileRequest } from '@/shared/utils/readFile'

describe('readFile utils', () => {
  it('normalizes explicit multi-file paths without line ranges', () => {
    const normalized = normalizeReadFileArgs({
      paths: ['src/a.ts', 'src/b.ts'],
      start_line: 10,
      end_line: 20,
    })

    expect(normalized.paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(normalized.path).toBeUndefined()
    expect(normalized.start_line).toBeUndefined()
    expect(normalized.end_line).toBeUndefined()
  })

  it('resolves multi-file requests from array payloads', () => {
    const result = resolveReadFileRequest({
      paths: ['src/a.ts', 'src/b.ts'],
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'multi') {
      expect(result.args.paths).toEqual(['src/a.ts', 'src/b.ts'])
    }
  })

  it('resolves single-file requests with line ranges', () => {
    const result = resolveReadFileRequest({
      path: 'src/main.ts',
      start_line: 5,
      end_line: 9,
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'single') {
      expect(result.args.start_line).toBe(5)
      expect(result.args.end_line).toBe(9)
    }
  })

  it('auto-swaps inverted line ranges instead of failing', () => {
    const result = resolveReadFileRequest({
      path: 'src/main.ts',
      start_line: 9,
      end_line: 5,
    })

    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'single') {
      expect(result.args.start_line).toBe(5)
      expect(result.args.end_line).toBe(9)
    }
  })

  // 回归：客户日志里 read_file 51/51 全失败，因为模型每次都同时发了
  // path 和 paths，而空数组在 JS 里是真值，被判成「两个都给了」。
  describe('path / paths 同时出现（回归）', () => {
    it('path 搭配空 paths 占位时按单文件读取', () => {
      const result = resolveReadFileRequest({
        path: 'source/apps/admin-web/package.json',
        paths: [],
        start_line: 1,
        end_line: 240,
      })

      expect(result.ok).toBe(true)
      if (result.ok && result.mode === 'single') {
        expect(result.args.path).toBe('source/apps/admin-web/package.json')
        expect(result.args.start_line).toBe(1)
        expect(result.args.end_line).toBe(240)
      }
    })

    it('path 与 paths 指向同一文件时按多文件读取，不再报冲突', () => {
      const result = resolveReadFileRequest({
        path: 'source/apps/server-java/pom.xml',
        paths: ['source/apps/server-java/pom.xml'],
        start_line: 1,
        end_line: 260,
      })

      expect(result.ok).toBe(true)
      if (result.ok && result.mode === 'single') {
        // 去重后只剩一个文件，仍按单文件读取并保留行范围
        expect(result.args.path).toBe('source/apps/server-java/pom.xml')
        expect(result.args.start_line).toBe(1)
        expect(result.args.end_line).toBe(260)
      }
    })

    it('path 与 paths 指向不同文件时取并集', () => {
      const result = resolveReadFileRequest({
        path: 'src/a.ts',
        paths: ['src/b.ts'],
      })

      expect(result.ok).toBe(true)
      if (result.ok && result.mode === 'multi') {
        expect(result.args.paths).toEqual(['src/a.ts', 'src/b.ts'])
      }
    })

    it('空 paths 占位会被归一化掉，不残留字段', () => {
      const normalized = normalizeReadFileArgs({ path: 'src/a.ts', paths: [] })

      expect(normalized.path).toBe('src/a.ts')
      expect(normalized.paths).toBeUndefined()
    })

    it('两者都缺失时给出可操作的报错', () => {
      const result = resolveReadFileRequest({ paths: [] })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('path is required')
      }
    })
  })
})
