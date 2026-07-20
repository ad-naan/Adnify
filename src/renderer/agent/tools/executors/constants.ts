export const RICH_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'])
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'])

export function getFileExtension(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop() || ''
  const match = fileName.match(/\.([^.]+)$/)
  return match?.[1]?.toLowerCase() || ''
}
