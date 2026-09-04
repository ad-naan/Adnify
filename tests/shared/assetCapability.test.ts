import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { assetCapabilitySchema, parseCapability } from '@/shared/assets/capability'
import example from '../../docs/examples/image-service-config.json'

function capability() {
  return {
    ...example,
    request: { ...example.request, url: 'https://example.test/generate' },
    async: {
      jobIdPath: '/id', statusUrl: 'https://example.test/jobs/{job_id}', statusPath: '/status',
      successValues: ['done'], failureValues: ['failed'], pollSeconds: 2,
    },
    output: { ...example.output, allowedOrigins: ['https://example.test'] },
  }
}

describe('asset capability URL validation', () => {
  it('accepts HTTP(S) endpoints and async job placeholders', () => {
    expect(parseCapability(capability())).toMatchObject(capability())
    const cap = capability()
    cap.request.url = 'http://example.test/generate'
    cap.async.statusUrl = 'http://example.test/jobs/{job_id}'
    cap.output.allowedOrigins = ['http://example.test']
    expect(parseCapability(cap)).toMatchObject(cap)
  })

  describe.each(['request', 'status', 'output'] as const)('%s URL', field => {
    it.each(['', 'not-a-url', '/relative', 'https://', 'ftp://example.test', 'https://user:password@example.test'])('rejects %j with a validation error', value => {
      const cap = capability()
      if (field === 'request') cap.request.url = value
      else if (field === 'status') cap.async.statusUrl = value
      else cap.output.allowedOrigins = [value]

      const result = assetCapabilitySchema.safeParse(cap)
      expect(result.success).toBe(false)
      if (!result.success) {
        const expectedPath = field === 'request' ? ['request', 'url']
          : field === 'status' ? ['async', 'statusUrl'] : ['output', 'allowedOrigins', 0]
        expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: expectedPath })]))
      }
      expect(() => parseCapability(cap)).toThrow(z.ZodError)
    })
  })
})
