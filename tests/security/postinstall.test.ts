import { promises as fs, readFileSync } from 'node:fs'
import { execFileSync as runFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(path.resolve('scripts/postinstall.js'), 'utf8')

function loadActivation(vsPath: string, toolset = '14.44.35207', runCommand = false) {
  const execFileSync = vi.fn((file: string, args: string[], options: Parameters<typeof runFile>[2]) => file.endsWith('vswhere.exe')
    ? vsPath
    : runCommand ? runFile(file, args, options)
      : 'LIB=C:\\VS\\lib\r\nPATH=C:\\VS\\bin\r\nVCToolsInstallDir=C:\\VS\\tools\r\nADNIFY_VCVARS=temporary\r\n')
  const module = { exports: {} as { activateVSEnv: () => Record<string, string> | null } }
  const fs = { existsSync: () => true, readdirSync: () => [toolset] }
  const warn = vi.fn()
  vm.runInNewContext(source, {
    module,
    require: (id: string) => {
      if (id === 'child_process') return { execFileSync }
      if (id === 'fs') return fs
      if (id === 'path') return path.win32
      throw new Error(`Unexpected import: ${id}`)
    },
    process: { platform: 'win32', env: { ...process.env, 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PATH: 'C:\\Windows\\System32' } },
    __dirname: 'C:\\project\\scripts',
    console: { log: vi.fn(), warn, error: vi.fn() },
  })
  return { activate: module.exports.activateVSEnv, execFileSync, warn }
}

describe('Visual Studio environment activation', () => {
  it.skipIf(process.platform !== 'win32')('executes a batch file with shell metacharacters in its directory name literally', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-vs-env-'))
    const installation = path.join(root, 'VS & tools %PATH% !literal!')
    const batch = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    try {
      await fs.mkdir(path.dirname(batch), { recursive: true })
      await fs.writeFile(batch, '@echo off\r\nset LIB=C:\\VS\\lib\r\nset VCToolsInstallDir=C:\\VS\\tools\r\nset ADNIFY_VS_TEST=activated\r\n')
      const { activate, warn } = loadActivation(installation, '14.44.35207', true)
      const env = activate()
      expect(warn).not.toHaveBeenCalled()
      expect(env?.ADNIFY_VS_TEST).toBe('activated')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('keeps installation paths out of shell command text', () => {
    const installation = 'C:\\VS & tools\\%PATH% !literal!'
    const { activate, execFileSync } = loadActivation(installation)
    const env = activate()
    expect(env?.LIB).toBe('C:\\VS\\lib')
    expect(env).not.toHaveProperty('ADNIFY_VCVARS')
    expect(execFileSync).toHaveBeenNthCalledWith(1,
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
      ['-latest', '-products', '*', '-requires', 'Microsoft.VisualCpp.Tools.HostX86.TargetX64', '-property', 'installationPath'],
      expect.any(Object))
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'cmd.exe',
      ['/d', '/v:off', '/s', '/c', '""%ADNIFY_VCVARS%" %ADNIFY_VCTOOLS_ARG% && set"'],
      expect.objectContaining({ env: expect.objectContaining({
        ADNIFY_VCVARS: path.win32.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'),
        ADNIFY_VCTOOLS_ARG: '-vcvars_ver=14.44.35207',
      }) }))
  })

  it.each(['C:\\VS" & echo injected', 'C:\\VS\r\ninjected'])('rejects shell-breaking installation paths: %j', installation => {
    const { activate, execFileSync } = loadActivation(installation)
    expect(activate()).toBeNull()
    expect(execFileSync).toHaveBeenCalledTimes(1)
  })

  it('rejects a toolset directory name containing shell operators', () => {
    const { activate, execFileSync } = loadActivation('C:\\VS', '14.44 & echo injected')
    expect(activate()).toBeNull()
    expect(execFileSync).toHaveBeenCalledTimes(1)
  })
})
