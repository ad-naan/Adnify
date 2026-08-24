import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { formatWithProjectTool, resolveFormatterCommand } from '../../../src/main/services/formatterService'

const temporaryRoots: string[] = []
const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-formatter-'))
  temporaryRoots.push(root)
  return root
}

function write(root: string, relativePath: string, content = ''): string {
  const target = path.join(root, ...relativePath.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf-8')
  return target
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  process.env.PATH = originalPath
  process.env.PATHEXT = originalPathExt
})

describe('formatterService', () => {
  it('prefers configured Biome over Prettier for supported web files', () => {
    const root = createWorkspace()
    const filePath = write(root, 'src/app.ts', 'const value=1')
    write(root, 'biome.json', '{}')
    write(root, '.prettierrc', '{}')
    write(root, 'node_modules/@biomejs/biome/bin/biome', '')
    write(root, 'node_modules/prettier/bin/prettier.cjs', '')

    expect(resolveFormatterCommand(filePath, root)?.name).toBe('Biome')
  })

  it('uses the nearest project Prettier for its language family', () => {
    const root = createWorkspace()
    const filePath = write(root, 'packages/web/src/view.vue', '<template><div /></template>')
    write(root, 'packages/web/.prettierrc', '{}')
    const prettier = write(root, 'packages/web/node_modules/prettier/bin/prettier.cjs', '')

    const command = resolveFormatterCommand(filePath, root)
    expect(command?.name).toBe('Prettier')
    expect(command?.args[0]).toBe(prettier)
    expect(command?.args).toContain(filePath)
  })

  it('does not apply a web formatter to an unrelated language', () => {
    const root = createWorkspace()
    const filePath = write(root, 'notes.txt', 'plain text')
    write(root, '.prettierrc', '{}')
    write(root, 'node_modules/prettier/bin/prettier.cjs', '')

    expect(resolveFormatterCommand(filePath, root)).toBeNull()
  })

  it('formats through stdin without a shell', async () => {
    const root = createWorkspace()
    const filePath = write(root, 'src/app.ts', 'const value=1')
    write(root, '.prettierrc', '{}')
    write(
      root,
      'node_modules/prettier/bin/prettier.cjs',
      "let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>process.stdout.write(input.replace('=', ' = ')))",
    )

    await expect(formatWithProjectTool(filePath, 'const value=1', root)).resolves.toMatchObject({
      status: 'formatted',
      formatter: 'Prettier',
      content: 'const value = 1',
    })
  })

  it('uses canonical Go formatting but requires project configuration for clang-format', () => {
    const root = createWorkspace()
    const bin = path.join(root, 'test-bin')
    const executable = (name: string) => process.platform === 'win32' ? `${name}.exe` : name
    write(root, `test-bin/${executable('gofmt')}`)
    write(root, `test-bin/${executable('clang-format')}`)
    process.env.PATH = bin
    if (process.platform === 'win32') process.env.PATHEXT = '.EXE'

    const goFile = write(root, 'main.go', 'package main')
    const cppFile = write(root, 'main.cpp', 'int main(){}')
    expect(resolveFormatterCommand(goFile, root)?.name).toBe('gofmt')
    expect(resolveFormatterCommand(cppFile, root)).toBeNull()

    write(root, '.clang-format', 'BasedOnStyle: Google')
    expect(resolveFormatterCommand(cppFile, root)?.name).toBe('clang-format')
  })

  it('passes the Cargo edition to rustfmt', () => {
    const root = createWorkspace()
    const bin = path.join(root, 'test-bin')
    const rustfmtName = process.platform === 'win32' ? 'rustfmt.exe' : 'rustfmt'
    write(root, `test-bin/${rustfmtName}`)
    process.env.PATH = bin
    if (process.platform === 'win32') process.env.PATHEXT = '.EXE'
    write(root, 'Cargo.toml', '[package]\nname = "demo"\nedition = "2024"\n')
    const rustFile = write(root, 'src/main.rs', 'fn main() {}')

    expect(resolveFormatterCommand(rustFile, root)?.args).toEqual(['--emit', 'stdout', '--edition', '2024'])
  })
})
