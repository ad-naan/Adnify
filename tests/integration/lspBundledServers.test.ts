import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { lspManager } from '@main/lsp/lspManager'
import { getInstalledServerPath, setCustomLspBinDir } from '@main/lsp/installer'
import { pathToLspUri } from '@shared/utils/uriUtils'
import type { LanguageId } from '@shared/languages'

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
}))

interface ServerFixture {
  languageId: LanguageId
  relativePath: string
  content: string
  available?: boolean
}

const fixtures: ServerFixture[] = [
  {
    languageId: 'typescript',
    relativePath: 'src/main.ts',
    content: 'export function greet(name: string): string { return `Hello ${name}` }\n',
  },
  {
    languageId: 'html',
    relativePath: 'index.html',
    content: '<main><section id="welcome">Hello</section></main>\n',
  },
  {
    languageId: 'css',
    relativePath: 'styles.css',
    content: '.welcome { color: rebeccapurple; }\n',
  },
  {
    languageId: 'json',
    relativePath: 'config.json',
    content: '{ "application": { "name": "Adnify" } }\n',
  },
  {
    languageId: 'rust',
    relativePath: 'src/lib.rs',
    content: 'pub fn greet(name: &str) -> String { format!("Hello {name}") }\n',
    available: getInstalledServerPath('rust') !== null,
  },
]

let workspace: string

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-lsp-smoke-'))
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'package.json'), '{}')
  fs.writeFileSync(path.join(workspace, 'Cargo.toml'), [
    '[package]',
    'name = "adnify_lsp_smoke"',
    'version = "0.1.0"',
    'edition = "2021"',
    '',
  ].join('\n'))
  setCustomLspBinDir(process.cwd())
})

afterAll(async () => {
  await lspManager.stopAllServers()
  setCustomLspBinDir(null)
  fs.rmSync(workspace, { recursive: true, force: true })
})

describe('bundled development LSP servers', () => {
  for (const fixture of fixtures) {
    it.skipIf(fixture.available === false)(`initializes and returns document symbols for ${fixture.languageId}`, async () => {
      const filePath = path.join(workspace, fixture.relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, fixture.content)
      const uri = pathToLspUri(filePath)

      const serverKey = await lspManager.ensureServerForFile(
        filePath,
        fixture.languageId,
        workspace,
      )
      expect(serverKey).not.toBeNull()

      const sync = lspManager.syncDocument(
        serverKey!,
        uri,
        fixture.languageId,
        fixture.content,
        1,
      )
      expect(sync.action).toBe('open')
      lspManager.sendNotification(serverKey!, 'textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: fixture.languageId,
          version: sync.version,
          text: fixture.content,
        },
      })

      const symbols = await lspManager.sendRequest(
        serverKey!,
        'textDocument/documentSymbol',
        { textDocument: { uri } },
        10_000,
      )
      expect(Array.isArray(symbols)).toBe(true)
      expect(symbols.length).toBeGreaterThan(0)
    }, 20_000)
  }
})
