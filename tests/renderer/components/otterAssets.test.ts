import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OTTER_ASSET_PATHS } from '@/renderer/components/brand/otterAssets'

describe('otter asset registry', () => {
  it('only points to runtime assets that exist in public', () => {
    const missing = Object.entries(OTTER_ASSET_PATHS)
      .filter(([, path]) => !existsSync(resolve(process.cwd(), 'public', path)))
      .map(([key, path]) => `${key}: ${path}`)

    expect(missing).toEqual([])
  })

  it('does not restore retired or incorrectly cropped assets', () => {
    const retiredNames = [
      'bug_plush.webp',
      'coffee.webp',
      'desk_lamp.webp',
      'keyboard.webp',
      'hearts.webp',
      'git_stamp.webp',
      'robot_assistant.webp',
      'surprised.webp',
    ]
    const paths = Object.values(OTTER_ASSET_PATHS)

    for (const retiredName of retiredNames) {
      expect(paths.some((path) => path.endsWith(`/${retiredName}`))).toBe(false)
    }
  })

  it('registers every shipped otter asset', () => {
    const assetRoot = resolve(process.cwd(), 'public/brand/ip/otter')
    const registered = new Set(Object.values(OTTER_ASSET_PATHS))
    const unregistered = readdirSync(assetRoot, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('.webp'))
      .map((path) => `brand/ip/otter/${path.replaceAll('\\', '/')}`)
      .filter((path) => !registered.has(path))

    expect(unregistered).toEqual([])
  })

  it('ships only WebP mascot assets and keeps originals outside public', () => {
    const publicIpRoot = resolve(process.cwd(), 'public/brand/ip')
    const runtimeFiles = readdirSync(publicIpRoot, { recursive: true })
      .map(String)
      .filter((path) => statSync(resolve(publicIpRoot, path)).isFile())

    expect(runtimeFiles.every((path) => path.endsWith('.webp'))).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'public/original'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'original/otter/masters'))).toBe(true)
  })
})
