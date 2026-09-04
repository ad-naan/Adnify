import type { AssetFailure } from '@shared/types/assets'

export class AssetRequestError extends Error {
  constructor(readonly failure: AssetFailure, message: string) { super(message); this.name = 'AssetRequestError' }
}

function redactDetail(value: string, secrets: string[]): string {
  let text = value
  const sensitive = secrets.flatMap(secret => [secret, ...secret.split(';').flatMap(pair => {
    const equals = pair.indexOf('=')
    return equals >= 0 ? [pair.slice(equals + 1).trim()] : []
  })]).filter(Boolean)
  for (const secret of sensitive.sort((a, b) => b.length - a.length)) {
    for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) text = text.split(form).join('[REDACTED]')
  }
  return text
    .replace(/((?:authorization|cookie|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 1000)
}

/** Preserve actionable server errors without storing whole responses or credential echoes. */
export async function readAssetHttpError(response: Response, secrets: string[] = []): Promise<AssetRequestError> {
  let detail: string | undefined
  const reader = response.body?.getReader()
  try {
    if (reader) {
      const chunks: Uint8Array[] = []
      let size = 0
      let oversized = false
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 64 * 1024) { oversized = true; break }
        chunks.push(chunk.value)
      }
      if (!oversized) {
        const body = Buffer.concat(chunks).toString('utf8').trim()
        let message: string | undefined
        try {
          const json = JSON.parse(body)
          // Known error-envelope fields only; omit debug objects, headers, data and echoed requests.
          const error = json?.error
          const candidate = error?.message ?? (typeof error === 'string' ? error : undefined) ?? json?.message ?? json?.detail ?? json?.msg
          if (typeof candidate === 'string') message = candidate
        } catch {
          // Plain-text errors are common on proxies. HTML pages are not useful inline diagnostics.
          if (!body.startsWith('<') && !/text\/html/i.test(response.headers.get('content-type') || '')) message = body
        }
        if (message) detail = redactDetail(message, secrets) || undefined
      }
    }
  } catch { /* Keep the known HTTP status even if its error body is truncated or unreadable. */ }
  finally { await reader?.cancel().catch(() => {}) }
  const message = detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}; the service returned an error response.`
  return new AssetRequestError({ kind: 'http', status: response.status, ...(detail ? { detail } : {}) }, message)
}

/** Never include raw response bodies, header values, or undici's raw invalid-value errors. */
export function describeAssetFailure(error: unknown): { failure?: AssetFailure; message: string } {
  if (error instanceof AssetRequestError) return { failure: error.failure, message: error.message }
  const value = error as { name?: string; message?: string; code?: string; cause?: { code?: string } }
  if (value?.name === 'TimeoutError' || value?.name === 'AbortError') return { failure: { kind: 'timeout' }, message: 'Request timed out before the outcome could be confirmed.' }
  if (value?.message === 'fetch failed' || value?.cause?.code) {
    const raw = value.cause?.code || value.code
    const code = typeof raw === 'string' && /^(?:E[A-Z_0-9]+|UND_ERR_[A-Z_0-9]+|CERT_[A-Z_0-9]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(raw) && raw.length < 80 ? raw : undefined
    return { failure: { kind: 'network', code }, message: `Network request failed${code ? ` (${code})` : ''}.` }
  }
  return { message: error instanceof Error ? error.message : 'Asset operation failed' }
}

/** Explicit validation/auth/rate-limit rejections differ from ambiguous server/network failures. */
export function isRejectedSubmission(failure?: AssetFailure): boolean {
  return failure?.kind === 'http' && [400, 401, 403, 404, 405, 406, 413, 415, 422, 429].includes(failure.status || 0)
}
