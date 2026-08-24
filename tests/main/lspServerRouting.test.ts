import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { lspManager } from '@main/lsp/lspManager'
import { LSP_SERVER_DEFINITIONS } from '@shared/languages'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

afterAll(async () => {
  await lspManager.stopAllServers()
})

function createWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-lsp-route-'))
  tempDirectories.push(workspace)
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
  return workspace
}

describe('LSP project server routing', () => {
  it('has one main-process runtime strategy for every shared server definition', () => {
    for (const definition of LSP_SERVER_DEFINITIONS) {
      expect(lspManager.getServerConfig(definition.id), definition.id).toBeDefined()
    }
  })

  it('routes TypeScript files in a Deno project to Deno', async () => {
    const workspace = createWorkspace()
    fs.writeFileSync(path.join(workspace, 'deno.json'), '{}')

    await expect(lspManager.resolveServerRouteForFile(
      path.join(workspace, 'src', 'main.ts'),
      'typescript',
      workspace,
    )).resolves.toEqual({ serverName: 'deno', workspacePath: workspace })
  })

  it('routes ordinary TypeScript projects to typescript-language-server', async () => {
    const workspace = createWorkspace()
    fs.writeFileSync(path.join(workspace, 'package.json'), '{}')

    await expect(lspManager.resolveServerRouteForFile(
      path.join(workspace, 'src', 'main.ts'),
      'typescript',
      workspace,
    )).resolves.toEqual({ serverName: 'typescript', workspacePath: workspace })
  })
})
