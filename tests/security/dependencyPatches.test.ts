import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { extract } from '@electron-internal/extract-zip'
import JSZip from 'jszip'

const tempRoots: string[] = []

afterEach(async () => {
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
      .rejects.toThrow(/target (?:escapes destination|is absolute or empty)/)
    await expect(fs.lstat(path.join(destination, 'nested/link'))).rejects.toThrow()
  })

  it('extracts regular files used by Electron archives', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const archivePath = path.join(root, 'files.zip')
    const destination = path.join(root, 'destination')
    const archive = new JSZip()
    archive.file('nested/target.txt', 'internal data')
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))

    await extract(archivePath, { dir: destination })
    expect(await fs.readFile(path.join(destination, 'nested/target.txt'), 'utf8')).toBe('internal data')
  })

  it('rejects traversal through another archive symlink', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const archivePath = path.join(root, 'chain.zip')
    const destination = path.join(root, 'destination')
    const archive = new JSZip()
    archive.file('nested/link', 'inside/../outside.txt', { unixPermissions: 0o120777 })
    archive.file('nested/inside', '..', { unixPermissions: 0o120777 })
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))

    await expect(extract(archivePath, { dir: destination })).rejects.toThrow('target escapes destination')
    await expect(fs.lstat(path.join(destination, 'nested/link'))).rejects.toThrow()
  })

  it('rejects pre-existing destination directory links without overwriting outside files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const destination = path.join(root, 'destination')
    const outside = path.join(root, 'outside')
    await fs.mkdir(destination)
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'target.txt'), 'original')
    // Junctions exercise Windows reparse points without requiring symlink privileges.
    await fs.symlink(outside, path.join(destination, 'nested'), process.platform === 'win32' ? 'junction' : 'dir')
    const archive = new JSZip()
    archive.file('nested/target.txt', 'attacker data')
    const archivePath = path.join(root, 'destination-link.zip')
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer' }))

    await expect(extract(archivePath, { dir: destination })).rejects.toThrow()
    expect(await fs.readFile(path.join(outside, 'target.txt'), 'utf8')).toBe('original')
  })

  it.skipIf(process.platform === 'win32')('rejects pre-existing destination file symlinks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const destination = path.join(root, 'destination')
    await fs.mkdir(destination)
    const outside = path.join(root, 'outside.txt')
    await fs.writeFile(outside, 'original')
    await fs.symlink(outside, path.join(destination, 'target.txt'))
    const archive = new JSZip()
    archive.file('target.txt', 'attacker data')
    const archivePath = path.join(root, 'file-link.zip')
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer' }))

    await expect(extract(archivePath, { dir: destination })).rejects.toThrow()
    expect(await fs.readFile(outside, 'utf8')).toBe('original')
  })

  it('overwrites regular files and preserves executable permissions for language servers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const destination = path.join(root, 'destination')
    await fs.mkdir(path.join(destination, 'bin'), { recursive: true })
    await fs.writeFile(path.join(destination, 'bin/server'), 'old version')
    const archive = new JSZip()
    archive.file('bin/server', 'new version', { unixPermissions: 0o100755 })
    const archivePath = path.join(root, 'server.zip')
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))

    await extract(archivePath, { dir: destination })
    expect(await fs.readFile(path.join(destination, 'bin/server'), 'utf8')).toBe('new version')
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.join(destination, 'bin/server'))).mode & 0o777).toBe(0o755)
    }
  })

  // Windows requires symlink privileges; Linux CI exercises real links without mocking the extractor.
  it.skipIf(process.platform === 'win32')('preserves internal relative symlinks needed by Electron archives', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-extract-audit-'))
    tempRoots.push(root)
    const archivePath = path.join(root, 'internal.zip')
    const destination = path.join(root, 'destination')
    const archive = new JSZip()
    archive.file('target.txt', 'internal data')
    archive.file('nested/link', '../target.txt', { unixPermissions: 0o120777 })
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
    await extract(archivePath, { dir: destination })
    expect(await fs.readFile(path.join(destination, 'target.txt'), 'utf8')).toBe('internal data')
    expect(await fs.readlink(path.join(destination, 'nested/link'))).toBe('../target.txt')
    expect(await fs.readFile(path.join(destination, 'nested/link'), 'utf8')).toBe('internal data')
  })

  it('keeps onnx-proto encoding compatible with the patched protobufjs runtime', async () => {
    const { onnx } = await import('onnx-proto')
    const encoded = onnx.ModelProto.encode(onnx.ModelProto.create({ producerName: 'adnify-audit' })).finish()

    expect(onnx.ModelProto.decode(encoded).producerName).toBe('adnify-audit')
  })
})
