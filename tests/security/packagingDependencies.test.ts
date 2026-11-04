import { promises as fs } from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it } from 'vitest'

// Exercise the CommonJS consumers used by electron-builder, including the two
// patched default imports. Importing minimatch alone would miss these failures.
const require = createRequire(import.meta.url)
const asar = require('@electron/asar') as typeof import('@electron/asar')
const dirCompare = require('dir-compare') as typeof import('dir-compare')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher') as typeof import('app-builder-lib/out/fileMatcher')
const { FileList } = require('filelist')
const glob = require('glob')
const { build } = require('../../package.json')
const tempRoots: string[] = []

async function fixture(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-packaging-'))
  tempRoots.push(root)
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  }
  return root
}

afterEach(async () => {
  asar.uncacheAll()
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('packaging with the patched minimatch dependency', () => {
  it('archives files through glob and preserves file and directory unpack rules', async () => {
    const root = await fixture({
      'app/main.js': 'main',
      'app/.config': 'hidden',
      'app/nested/addon.node': 'native',
      'app/assets/runtime/data.bin': 'runtime',
    })
    const archive = path.join(root, 'app.asar')

    await asar.createPackageWithOptions(path.join(root, 'app'), archive, {
      unpack: '*.node',
      unpackDir: '**/runtime',
    })

    expect(asar.extractFile(archive, 'main.js').toString()).toBe('main')
    expect(asar.extractFile(archive, '.config').toString()).toBe('hidden')
    expect(asar.statFile(archive, 'main.js')).not.toHaveProperty('unpacked', true)
    for (const [name, content] of [['nested/addon.node', 'native'], ['assets/runtime/data.bin', 'runtime']]) {
      expect(asar.statFile(archive, path.normalize(name))).toHaveProperty('unpacked', true)
      expect(await fs.readFile(path.join(`${archive}.unpacked`, name), 'utf8')).toBe(content)
    }
  })

  it('compares included files while excluding ignored files and directories', async () => {
    const root = await fixture({
      'left/nested/main.js': 'same',
      'right/nested/main.js': 'same',
      'left/.hidden.js': 'same',
      'right/.hidden.js': 'same',
      'left/main.js.map': 'left map',
      'right/main.js.map': 'right map',
      'left/ignored/skip.js': 'left ignored',
      'right/ignored/skip.js': 'right ignored',
    })
    const options = { compareContent: true, includeFilter: '*.js', excludeFilter: 'ignored' }
    const left = path.join(root, 'left')
    const right = path.join(root, 'right')

    const equal = await dirCompare.compare(left, right, options)
    expect(equal.same).toBe(true)
    expect(equal.equalFiles).toBe(2)
    await fs.writeFile(path.join(right, 'nested/main.js'), 'changed')
    const different = await dirCompare.compare(left, right, options)
    expect(different.same).toBe(false)
    expect(different.distinctFiles).toBe(1)
  })

  it('keeps the project file exclusions and native module unpack filters working', async () => {
    const root = await fixture({
      'dist/main/main.js': 'main',
      'dist/main/main.js.map': 'source map',
      'public/brand/icon.png': 'icon',
      'public/.git/config': 'excluded',
      'node_modules/cpu-features/build/Release/cpufeatures.node': 'native',
      'node_modules/ssh2/lib/index.js': 'ssh',
      'node_modules/other/index.js': 'other',
    })
    const files = new FileMatcher(root, root, value => value, build.files).createFilter()
    const unpack = new FileMatcher(root, root, value => value, build.asarUnpack).createFilter()
    for (const [name, included] of [
      ['dist/main/main.js', true],
      ['dist/main/main.js.map', false],
      ['public/brand/icon.png', true],
      ['public/.git', false],
    ] as const) {
      const file = path.join(root, name)
      expect(files(file, await fs.stat(file)), name).toBe(included)
    }
    for (const [name, included] of [
      ['node_modules/cpu-features/build/Release/cpufeatures.node', true],
      ['node_modules/ssh2/lib/index.js', true],
      ['node_modules/other/index.js', false],
    ] as const) {
      const file = path.join(root, name)
      expect(unpack(file, await fs.stat(file)), name).toBe(included)
    }
  })

  it('expands filelist globs and applies exclusions used by the build toolchain', async () => {
    const root = await fixture({ 'nested/main.js': 'main', 'nested/skip.js': 'skip', 'nested/readme.txt': 'text' })
    const base = root.replace(/\\/g, '/')
    const files = new FileList(`${base}/**/*.js`)
    files.exclude(`${base}/**/skip.js`)
    expect(files.toArray().map((file: string) => path.relative(root, file))).toEqual([path.join('nested', 'main.js')])
  })

  it.each(['sync', 'async'])('preserves glob %s brace expansion, dotfiles and ignores', async mode => {
    const root = await fixture({
      'main.js': 'main',
      'nested/tool.ts': 'tool',
      'nested/skip.js': 'skip',
      '.hidden.ts': 'hidden',
      'readme.txt': 'text',
    })
    const run = mode === 'sync' ? glob.sync : promisify(glob)
    for (const dot of [false, true]) {
      const files = await run('**/*.{js,ts}', { cwd: root, nodir: true, dot, ignore: '**/skip.js' })
      expect(files.sort()).toEqual((dot ? ['.hidden.ts', 'main.js', 'nested/tool.ts'] : ['main.js', 'nested/tool.ts']).sort())
    }
  })
})
