import { describe, expect, it } from 'vitest'
import path from 'path'
import {
  assertSafeRemoteName,
  buildDirectoryDownloadTarget,
  isSftpSymbolicLinkMode,
  remoteDirectoryBasename,
  safeJoinUnderDownloadRoot,
} from '@/shared/utils/remoteDownloadPath'

describe('remoteDownloadPath', () => {
  it('builds a destination folder from the remote basename', () => {
    expect(buildDirectoryDownloadTarget('/tmp/downloads', '/home/ubuntu/project')).toBe(
      path.join('/tmp/downloads', 'project'),
    )
    expect(remoteDirectoryBasename('/')).toBe('remote-download')
    expect(remoteDirectoryBasename('/var/log/')).toBe('log')
  })

  it('rejects unsafe remote names and path escapes', () => {
    expect(() => assertSafeRemoteName('..')).toThrow(/Unsafe/)
    expect(() => assertSafeRemoteName('a/b')).toThrow(/Unsafe/)
    expect(() => safeJoinUnderDownloadRoot('/tmp/out', '..')).toThrow()
    expect(safeJoinUnderDownloadRoot('/tmp/out', 'src', 'main.ts')).toBe(
      path.join('/tmp/out', 'src', 'main.ts'),
    )
  })

  it('detects SFTP symlink mode bits', () => {
    expect(isSftpSymbolicLinkMode(0o120777)).toBe(true)
    expect(isSftpSymbolicLinkMode(0o040755)).toBe(false)
    expect(isSftpSymbolicLinkMode(0o100644)).toBe(false)
  })
})
