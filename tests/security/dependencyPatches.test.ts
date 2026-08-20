import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import extract from 'extract-zip'
import JSZip from 'jszip'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('dependency security patches', () => {
  it('rejects extract-zip symlinks that escape the destination root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const archivePath = path.join(root, 'malicious.zip')
    const destination = path.join(root, 'destination')
    const archive = new JSZip()
    archive.file('nested/link', '../../../../outside.txt', {
      unixPermissions: 0o120777,
    })
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))

    await expect(extract(archivePath, { dir: destination }))
      .rejects.toThrow('Out of bound symlink target')
  })

  it('keeps onnx-proto encoding compatible with the patched protobufjs runtime', async () => {
    const { onnx } = await import('onnx-proto')
    const encoded = onnx.ModelProto.encode(onnx.ModelProto.create({ producerName: 'adnify-audit' })).finish()

    expect(onnx.ModelProto.decode(encoded).producerName).toBe('adnify-audit')
  })
})
