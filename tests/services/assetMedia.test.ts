import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { assetMediaResponse } from '@/main/services/assets/assetMedia'
let directory: string
let file: string
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'adnify-media-test-'))
  file = path.join(directory, 'sample.webm')
  await fs.writeFile(file, '0123456789')
})
afterEach(async () => {
  if (path.dirname(directory) !== path.resolve(tmpdir())) throw new Error('Invalid test directory')
  await fs.rm(directory, { recursive: true, force: true })
})
describe('local media streaming', () => {
  it('streams only requested bytes and supports suffix ranges for seeking', async () => {
    const response = await assetMediaResponse(file, 'video/webm', new Request('https://local.test', { headers: { Range: 'bytes=3-6' } }))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(await response.text()).toBe('3456')
    const suffix = await assetMediaResponse(file, 'video/webm', new Request('https://local.test', { headers: { Range: 'bytes=-2' } }))
    expect(await suffix.text()).toBe('89')
  })
  it('rejects invalid ranges and returns metadata for HEAD', async () => {
    for (const range of ['bytes=12-', 'bytes=-0', 'bytes=3-2', 'bytes=1-2,4-5', 'bytes=-']) {
      expect((await assetMediaResponse(file, 'video/webm', new Request('https://local.test', { headers: { Range: range } }))).status).toBe(416)
    }
    const head = await assetMediaResponse(file, 'video/webm', new Request('https://local.test', { method: 'HEAD' }))
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')
  })
})
