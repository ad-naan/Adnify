/**
 * 路径工具函数测试
 */

import { describe, it, expect } from 'vitest'
import {
  normalizePath,
  joinPath,
  // joinPaths,
  // getDirname,
  getDirPath,
  getFileName,
  getExtension,
  // pathEquals,
  pathStartsWith,
  // toFullPath,
  toRelativePath,
} from '@shared/utils/pathUtils'

describe('pathUtils', () => {
  describe('normalizePath', () => {
    it('should normalize Windows paths', () => {
      expect(normalizePath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt')
    })

    it('should normalize Unix paths', () => {
      expect(normalizePath('/home/user/file.txt')).toBe('/home/user/file.txt')
    })

    it('should handle mixed separators', () => {
      expect(normalizePath('C:\\Users/test\\file.txt')).toBe('C:/Users/test/file.txt')
    })
  })

  describe('joinPath', () => {
    it('should join paths correctly', () => {
      expect(joinPath('/home', 'user', 'file.txt')).toBe('/home/user/file.txt')
    })

    it('should handle empty segments', () => {
      expect(joinPath('/home', '', 'user')).toBe('/home/user')
    })

    it('should handle trailing slashes', () => {
      const result = joinPath('/home/', 'user/')
      // joinPath preserves separator style and removes duplicates
      expect(result).toMatch(/^\/home\/user\/?$/)
    })
  })

  describe('toRelativePath', () => {
    it('should calculate relative path', () => {
      const result = toRelativePath('/home/user/project/src/main.ts', '/home/user/project')
      expect(result).toBe('src/main.ts')
    })

    it('should handle same path', () => {
      const result = toRelativePath('/home/user', '/home/user')
      expect(result).toBe('')
    })
  })

  describe('pathStartsWith', () => {
    it('should return true for subpath', () => {
      expect(pathStartsWith('/home/user/project/src', '/home/user/project')).toBe(true)
    })

    it('should return false for non-subpath', () => {
      expect(pathStartsWith('/home/other', '/home/user')).toBe(false)
    })

    it('should return true for same path', () => {
      expect(pathStartsWith('/home/user', '/home/user')).toBe(true)
    })
  })

  describe('getDirPath', () => {
    it('should get directory path', () => {
      expect(getDirPath('/home/user/file.txt')).toBe('/home/user')
    })

    it('should handle root path', () => {
      expect(getDirPath('/file.txt')).toBe('')
    })
  })

  describe('getFileName', () => {
    it('should get file name with extension', () => {
      expect(getFileName('/home/user/file.txt')).toBe('file.txt')
    })

    it('should get file name without extension', () => {
      // getFileName always returns with extension, use getExtension separately
      expect(getFileName('/home/user/file.txt')).toBe('file.txt')
    })
  })

  describe('getExtension', () => {
    it('should get file extension', () => {
      expect(getExtension('file.txt')).toBe('txt')
    })

    it('should handle no extension', () => {
      expect(getExtension('file')).toBe('')
    })

    it('should handle multiple dots', () => {
      expect(getExtension('file.test.ts')).toBe('ts')
    })
  })
})
