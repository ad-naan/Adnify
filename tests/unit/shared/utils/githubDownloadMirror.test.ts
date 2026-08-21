import { describe, expect, it } from 'vitest'
import {
  applyGithubDownloadMirror,
  buildMirroredGithubLatestFeedUrl,
  isGithubDownloadUrl,
  resolveUpdateDownloadSource,
} from '@/shared/utils/githubDownloadMirror'

describe('githubDownloadMirror', () => {
  it('detects github download hosts', () => {
    expect(isGithubDownloadUrl('https://github.com/ad-naan/adnify/releases/download/v1.0.0/a.exe')).toBe(true)
    expect(isGithubDownloadUrl('https://example.com/a.exe')).toBe(false)
  })

  it('prefixes mirror once', () => {
    const url = 'https://github.com/ad-naan/adnify/releases/download/v1.0.0/a.exe'
    const mirrored = applyGithubDownloadMirror(url, 'https://ghfast.top/')
    expect(mirrored).toBe(`https://ghfast.top/${url}`)
    expect(applyGithubDownloadMirror(mirrored, 'https://ghfast.top/')).toBe(mirrored)
  })

  it('builds mirrored latest/download feed', () => {
    expect(buildMirroredGithubLatestFeedUrl('ad-naan', 'adnify', 'https://ghfast.top/')).toBe(
      'https://ghfast.top/https://github.com/ad-naan/adnify/releases/latest/download',
    )
  })

  it('resolves source from locale and env override', () => {
    expect(resolveUpdateDownloadSource({ locale: 'zh-CN' })).toBe('mirror')
    expect(resolveUpdateDownloadSource({ locale: 'en-US' })).toBe('github')
    expect(resolveUpdateDownloadSource({ locale: 'zh-CN', envForce: 'github' })).toBe('github')
    expect(resolveUpdateDownloadSource({ locale: 'en-US', envForce: 'mirror' })).toBe('mirror')
  })
})
