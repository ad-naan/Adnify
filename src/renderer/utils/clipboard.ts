/**
 * 安全写入剪贴板，兼容 Electron 中右键菜单等场景下
 * navigator.clipboard.writeText 权限被拒绝的情况。
 */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback: 使用隐藏 textarea + execCommand('copy')
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}
