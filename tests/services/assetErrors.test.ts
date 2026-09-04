import { describe, expect, it } from 'vitest'
import { readAssetHttpError } from '@/main/services/assets/assetErrors'

describe('safe service error details', () => {
  it('extracts actionable error messages without request/debug fields', async () => {
    const error = await readAssetHttpError(new Response(JSON.stringify({ error: { message: 'Unsupported quality value' }, request: { Cookie: 'private' }, debug: 'private' }), { status: 400 }))
    expect(error.failure).toEqual({ kind: 'http', status: 400, detail: 'Unsupported quality value' })
    expect(error.message).not.toContain('private')
  })
  it('redacts full Cookie headers, individual cookie values and encoded echoes', async () => {
    const cookie = 'session=private/session; auth=hidden-value'
    const message = `Invalid parameter. private/session ${encodeURIComponent('private/session')} hidden-value. Cookie: ${cookie}`
    const error = await readAssetHttpError(new Response(JSON.stringify({ error: { message } }), { status: 400 }), [cookie])
    expect(error.failure.detail).toContain('Invalid parameter.')
    expect(error.failure.detail).toContain('[REDACTED]')
    expect(error.message).not.toMatch(/private|hidden-value/)
  })
  it('handles bounded plaintext errors but omits HTML and oversized bodies', async () => {
    expect((await readAssetHttpError(new Response('Invalid model', { status: 400 }))).failure.detail).toBe('Invalid model')
    for (const body of ['<html>private</html>', 'x'.repeat(65537)]) {
      const error = await readAssetHttpError(new Response(body, { status: 400 }))
      expect(error.failure).toEqual({ kind: 'http', status: 400 })
    }
    const truncated = await readAssetHttpError(new Response(JSON.stringify({ message: 'x'.repeat(1200) }), { status: 400 }))
    expect(truncated.failure.detail).toHaveLength(1000)
  })
  it('preserves the HTTP status when reading the response stream fails', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('private transport error')) } }), { status: 400 })
    expect((await readAssetHttpError(response)).failure).toEqual({ kind: 'http', status: 400 })
  })
})
