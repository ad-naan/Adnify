/**
 * Markdown 表格格式修复工具
 * 自动修复常见的表格格式问题，使其能被 remark-gfm 正确解析
 */

/**
 * 修复 Markdown 表格格式
 * - 自动补全分隔行缺失的列
 * - 确保表头、分隔行、数据行的列数一致
 */
export function fixMarkdownTables(markdown: string): string {
  if (!markdown) return markdown

  const lines = markdown.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 检测是否是表格的开始（表头行）
    if (isTableHeaderLine(line)) {
      const tableLines = extractTableLines(lines, i)
      const fixedTable = fixTable(tableLines)
      result.push(...fixedTable)
      i += tableLines.length
    } else {
      result.push(line)
      i++
    }
  }

  return result.join('\n')
}

/**
 * 判断是否是表格表头行
 * 表头行特征：以 | 开头或结尾，包含至少一个 |
 */
function isTableHeaderLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  // 必须包含管道符
  if (!trimmed.includes('|')) return false

  // 排除分隔行（全是 - 和 | 和空格）
  if (/^[\s\-|:]+$/.test(trimmed)) return false

  // 表头行应该有实际内容
  const cells = trimmed.split('|').filter(cell => cell.trim())
  return cells.length >= 2
}

/**
 * 判断是否是表格分隔行
 */
function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim()
  // 分隔行只包含 -, |, :, 和空格
  return /^[\s\-|:]+$/.test(trimmed) && trimmed.includes('|') && trimmed.includes('-')
}

/**
 * 提取完整的表格（表头 + 分隔行 + 数据行）
 */
function extractTableLines(lines: string[], startIndex: number): string[] {
  const tableLines: string[] = []
  let i = startIndex

  // 添加表头
  tableLines.push(lines[i])
  i++

  // 检查下一行是否是分隔行
  if (i < lines.length && isSeparatorLine(lines[i])) {
    tableLines.push(lines[i])
    i++

    // 继续添加数据行
    while (i < lines.length) {
      const line = lines[i].trim()
      
      // 空行或非表格行，表格结束
      if (!line || !line.includes('|')) break
      
      // 如果是另一个表格的表头（后面跟着分隔行），停止
      if (i + 1 < lines.length && isSeparatorLine(lines[i + 1])) break

      tableLines.push(lines[i])
      i++
    }
  }

  return tableLines
}

/**
 * 修复表格格式
 */
function fixTable(tableLines: string[]): string[] {
  if (tableLines.length < 2) return tableLines

  const headerLine = tableLines[0]
  const separatorLine = tableLines[1]

  // 计算表头的列数
  const headerCols = countColumns(headerLine)

  // 修复分隔行
  const fixedSeparator = fixSeparatorLine(separatorLine, headerCols)

  // 修复数据行
  const fixedDataRows = tableLines.slice(2).map(row => fixDataRow(row, headerCols))

  return [headerLine, fixedSeparator, ...fixedDataRows]
}

/**
 * 计算表格行的列数
 */
function countColumns(line: string): number {
  const trimmed = line.trim()
  
  // 移除首尾的 |
  let content = trimmed
  if (content.startsWith('|')) content = content.slice(1)
  if (content.endsWith('|')) content = content.slice(0, -1)

  // 分割并计数非空单元格
  const cells = content.split('|')
  return cells.length
}

/**
 * 修复分隔行，确保列数与表头一致
 */
function fixSeparatorLine(line: string, targetColumns: number): string {
  const trimmed = line.trim()
  
  // 解析现有的分隔符
  let content = trimmed
  const startsWithPipe = content.startsWith('|')
  const endsWithPipe = content.endsWith('|')
  
  if (startsWithPipe) content = content.slice(1)
  if (endsWithPipe) content = content.slice(0, -1)

  const cells = content.split('|').map(cell => cell.trim())
  const currentColumns = cells.length

  // 如果列数已经正确，直接返回
  if (currentColumns === targetColumns) return line

  // 如果列数不足，补充默认分隔符
  if (currentColumns < targetColumns) {
    const defaultSeparator = '------'
    const additionalCells = Array(targetColumns - currentColumns).fill(defaultSeparator)
    const allCells = [...cells, ...additionalCells]
    
    const fixed = allCells.join(' | ')
    return startsWithPipe || endsWithPipe ? `| ${fixed} |` : fixed
  }

  // 如果列数过多，截断
  const truncatedCells = cells.slice(0, targetColumns)
  const fixed = truncatedCells.join(' | ')
  return startsWithPipe || endsWithPipe ? `| ${fixed} |` : fixed
}

/**
 * 修复数据行，确保列数与表头一致
 */
function fixDataRow(line: string, targetColumns: number): string {
  const trimmed = line.trim()
  
  let content = trimmed
  const startsWithPipe = content.startsWith('|')
  const endsWithPipe = content.endsWith('|')
  
  if (startsWithPipe) content = content.slice(1)
  if (endsWithPipe) content = content.slice(0, -1)

  const cells = content.split('|').map(cell => cell.trim())
  const currentColumns = cells.length

  // 如果列数已经正确，直接返回
  if (currentColumns === targetColumns) return line

  // 如果列数不足，补充空单元格
  if (currentColumns < targetColumns) {
    const additionalCells = Array(targetColumns - currentColumns).fill('')
    const allCells = [...cells, ...additionalCells]
    
    const fixed = allCells.join(' | ')
    return startsWithPipe || endsWithPipe ? `| ${fixed} |` : fixed
  }

  // 如果列数过多，截断
  const truncatedCells = cells.slice(0, targetColumns)
  const fixed = truncatedCells.join(' | ')
  return startsWithPipe || endsWithPipe ? `| ${fixed} |` : fixed
}
