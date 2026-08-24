import { describe, expect, it } from 'vitest'
import path from 'path'
import {
  assertSafeRemoteName,
  buildDirectoryDownloadTarget,
  buildDirectoryUploadRemoteTarget,
  isSftpSymbolicLinkMode,
  remoteDirectoryBasename,
  safeJoinUnderDownloadRoot,
} from '@/shared/utils/remoteDownloadPath'

describe('remoteDownloadPath', () => {
  it('builds a destination folder from the remote basename', () => {
    // buildDirectoryDownloadTarget resolves the parent to an absolute path, so the
    // expectation must resolve too — otherwise on Windows `path.join` yields a
    // drive-letter-less `\tmp\...` while `resolve` prepends the current drive.
    expect(buildDirectoryDownloadTarget('/tmp/downloads', '/home/ubuntu/project')).toBe(
      path.join(path.resolve('/tmp/downloads'), 'project'),
    )
    expect(remoteDirectoryBasename('/')).toBe('remote-download')
    expect(remoteDirectoryBasename('/var/log/')).toBe('log')
  })

  it('builds a remote upload target from the local basename', () => {
    expect(buildDirectoryUploadRemoteTarget('/var/www', '/tmp/my-app')).toBe('/var/www/my-app')
    expect(buildDirectoryUploadRemoteTarget('.', '/tmp/my-app')).toBe('my-app')
    expect(buildDirectoryUploadRemoteTarget('/', '/tmp/my-app')).toBe('/my-app')
  })

  it('rejects unsafe remote names and path escapes', () => {
    expect(() => assertSafeRemoteName('..')).toThrow(/Unsafe/)
    expect(() => assertSafeRemoteName('a/b')).toThrow(/Unsafe/)
    expect(() => assertSafeRemoteName(' padded ')).toThrow(/Unsafe/)
    expect(() => safeJoinUnderDownloadRoot('/tmp/out', '..')).toThrow()
    expect(safeJoinUnderDownloadRoot('/tmp/out', 'src', 'main.ts')).toBe(
      path.join(path.resolve('/tmp/out'), 'src', 'main.ts'),
    )
  })

  it('detects SFTP symlink mode bits', () => {
    expect(isSftpSymbolicLinkMode(0o120777)).toBe(true)
    expect(isSftpSymbolicLinkMode(0o040755)).toBe(false)
    expect(isSftpSymbolicLinkMode(0o100644)).toBe(false)
  })
})
