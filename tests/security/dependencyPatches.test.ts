import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import extract from 'extract-zip'
import JSZip from 'jszip'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('dependency security patches', () => {
  it.each(['../../../../outside.txt', '../..', path.resolve(os.tmpdir(), 'outside.txt')])('rejects extract-zip symlinks that escape the destination root: %s', async target => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const archivePath = path.join(root, 'malicious.zip')
    const destination = path.join(root, 'destination')
    const archive = new JSZip()
    archive.file('nested/link', target, {
      unixPermissions: 0o120777,
    })
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))

    await expect(extract(archivePath, { dir: destination }))
      .rejects.toThrow('Out of bound symlink target')
    await expect(fs.lstat(path.join(destination, 'nested/link'))).rejects.toThrow()
  })

  it('preserves internal relative symlinks needed by Electron archives', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const archivePath = path.join(root, 'internal.zip')
    const destination = path.join(root, 'destination')
    const archive = new JSZip()
    archive.file('target.txt', 'internal data')
    archive.file('nested/link', '../target.txt', { unixPermissions: 0o120777 })
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
    // Windows symlink creation requires privileges; verify the extraction decision on every platform.
    const symlink = vi.spyOn(fs, 'symlink').mockResolvedValue(undefined)
    await extract(archivePath, { dir: destination })
    expect(symlink).toHaveBeenCalledWith('../target.txt', path.join(await fs.realpath(destination), 'nested/link'))
    expect(await fs.readFile(path.join(destination, 'target.txt'), 'utf8')).toBe('internal data')
  })

  it('keeps onnx-proto encoding compatible with the patched protobufjs runtime', async () => {
    const { onnx } = await import('onnx-proto')
    const encoded = onnx.ModelProto.encode(onnx.ModelProto.create({ producerName: 'adnify-audit' })).finish()

    expect(onnx.ModelProto.decode(encoded).producerName).toBe('adnify-audit')
  })
})
