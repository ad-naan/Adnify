import { describe, it, expect } from 'vitest'
import { fixMarkdownTables } from '../markdownTableFixer'

describe('markdownTableFixer', () => {
  it('should fix table with missing separator columns', () => {
    const input = `
| 严重度 | 问题 | 影响 |
|--------|------|
| 🔴 高 | Audit 复用 | 功能错误 |
| 🟡 中 | 数据问题 | 脏数据 |
`.trim()

    const output = fixMarkdownTables(input)
    
    // 分隔行应该有3列
    const lines = output.split('\n')
    expect(lines[1]).toMatch(/\|.*\|.*\|.*\|/)
    
    // 应该包含3个分隔符
    const separatorCells = lines[1].split('|').filter(cell => cell.trim().includes('-'))
    expect(separatorCells.length).toBe(3)
  })

  it('should fix table with extra separator columns', () => {
    const input = `
| Col1 | Col2 |
|------|------|------|------|
| A | B |
`.trim()

    const output = fixMarkdownTables(input)
    
    const lines = output.split('\n')
    const separatorCells = lines[1].split('|').filter(cell => cell.trim().includes('-'))
    
    // 应该只有2列
    expect(separatorCells.length).toBe(2)
  })

  it('should fix data rows with missing columns', () => {
    const input = `
| A | B | C |
|---|---|---|
| 1 | 2 |
| 3 | 4 | 5 |
`.trim()

    const output = fixMarkdownTables(input)
    
    const lines = output.split('\n')
    // 第一个数据行应该被补全为3列
    const row1Cells = lines[2].split('|').filter(cell => cell !== '')
    expect(row1Cells.length).toBe(3)
  })

  it('should not modify correct tables', () => {
    const input = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`.trim()

    const output = fixMarkdownTables(input)
    
    // 应该保持不变
    expect(output).toBe(input)
  })

  it('should handle multiple tables in one document', () => {
    const input = `
Some text before

| A | B |
|---|
| 1 | 2 |

Some text between

| X | Y | Z |
|---|---|
| a | b | c |

Some text after
`.trim()

    const output = fixMarkdownTables(input)
    
    // 两个表格都应该被修复
    const lines = output.split('\n')
    
    // 第一个表格的分隔行
    expect(lines[3]).toMatch(/\|.*-.*\|.*-.*\|/)
    
    // 第二个表格的分隔行
    expect(lines[9]).toMatch(/\|.*-.*\|.*-.*\|.*-.*\|/)
  })

  it('should preserve non-table content', () => {
    const input = `
# Title

Some paragraph with | pipes | in it.

| Table | Header |
|-------|--------|
| Data  | Value  |

Another paragraph.
`.trim()

    const output = fixMarkdownTables(input)
    
    // 非表格内容应该保持不变
    expect(output).toContain('# Title')
    expect(output).toContain('Some paragraph with | pipes | in it.')
    expect(output).toContain('Another paragraph.')
  })
})
