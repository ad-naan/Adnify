/**
 * LSP URI 工具函数（跨平台支持）
 */

/**
 * 将文件路径转换为 LSP URI
 */
export function pathToLspUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    return `file:///${normalizedPath}`
  }
  return `file://${normalizedPath}`
}

/**
 * 将 LSP URI 转换为文件路径
 */
export function lspUriToPath(uri: string): string {
  let path = uri
  if (path.startsWith('file:///')) path = path.slice(8)
  else if (path.startsWith('file://')) path = path.slice(7)
  try { path = decodeURIComponent(path) } catch { }
  if (/^[a-zA-Z]:/.test(path)) path = path.replace(/\//g, '\\')
  return path
}

/**
 * 规范化 LSP URI
 * 处理不同 LSP 服务器返回的 URI 格式差异（如 Pyright 返回 file:///e%3A/...）
 */
export function normalizeLspUri(uri: string): string {
  if (!uri) return uri

  try {
    // 解码 URI
    let normalized = decodeURIComponent(uri)

    // 统一 file:// 协议格式
    if (normalized.startsWith('file:///')) {
      // Windows: file:///C:/path -> file:///C:/path
      // Unix: file:///path -> file:///path
      const pathPart = normalized.slice(8)

      // Windows 盘符统一为大写
      if (/^[a-z]:/.test(pathPart)) {
        normalized = `file:///${pathPart.charAt(0).toUpperCase()}${pathPart.slice(1)}`
      }
    } else if (normalized.startsWith('file://')) {
      // 补全第三个斜杠
      normalized = `file:///${normalized.slice(7)}`
    }

    return normalized
  } catch (e) {
    console.error('[URI Utils] Failed to normalize URI:', uri, e)
    return uri
  }
}
