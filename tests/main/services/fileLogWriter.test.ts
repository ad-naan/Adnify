import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileLogWriter } from '@main/services/fileLogWriter'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('createFileLogWriter', () => {
  it('writes asynchronously and rotates before exceeding the configured limit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-log-writer-'))
    tempDirectories.push(directory)
    const logPath = path.join(directory, 'main.log')
    const writer = createFileLogWriter(logPath, 10, 2)

    await writer.write('0123456789')
    await writer.write('next')

    expect(await fs.readFile(path.join(directory, 'main.1.log'), 'utf-8')).toBe('0123456789')
    expect(await fs.readFile(logPath, 'utf-8')).toBe('next')
  })

  it('supports a synchronous final flush during process exit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-log-flush-'))
    tempDirectories.push(directory)
    const logPath = path.join(directory, 'main.log')
    const writer = createFileLogWriter(logPath)

    writer.writeSync('shutdown\n')

    expect(await fs.readFile(logPath, 'utf-8')).toBe('shutdown\n')
  })
})
