export function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL || './'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = path.replace(/^\/+/, '')

  return `${normalizedBase}${normalizedPath}`
}
