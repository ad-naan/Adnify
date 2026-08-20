/**
 * LSP URI 工具函数（跨平台支持）
 */

/**
 * 将文件路径转换为 LSP URI
 */
export function pathToLspUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const encodePath = (value: string) => value
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')

  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    const drive = normalizedPath.charAt(0).toLowerCase()
    return `file:///${drive}%3A${encodePath(normalizedPath.slice(2))}`
  }
  if (normalizedPath.startsWith('//')) {
    const [authority, ...segments] = normalizedPath.slice(2).split('/')
    return `file://${authority}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`
  }
  return `file://${encodePath(normalizedPath)}`
}

/**
 * 将 LSP URI 转换为文件路径
 */
export function lspUriToPath(uri: string): string {
  if (!uri.toLowerCase().startsWith('file://')) return uri

  let filePath = uri.slice(7)
  const hasAuthority = !filePath.startsWith('/')
  if (hasAuthority) {
    const slashIndex = filePath.indexOf('/')
    const authority = slashIndex >= 0 ? filePath.slice(0, slashIndex) : filePath
    const pathname = slashIndex >= 0 ? filePath.slice(slashIndex) : ''
    try { filePath = `//${authority}${decodeURIComponent(pathname)}` } catch { filePath = `//${authority}${pathname}` }
  } else {
    try { filePath = decodeURIComponent(filePath) } catch { /* retain original encoding */ }
    if (/^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.slice(1)
  }

  if (/^[a-zA-Z]:/.test(filePath) || filePath.startsWith('//')) {
    return filePath.replace(/\//g, '\\')
  }
  return filePath
}

/**
 * 规范化 LSP URI
 * 处理不同 LSP 服务器返回的 URI 格式差异（如 Pyright 返回 file:///e%3A/...）
 */
export function normalizeLspUri(uri: string): string {
  if (!uri) return uri
  return uri.toLowerCase().startsWith('file://') ? pathToLspUri(lspUriToPath(uri)) : uri
}
