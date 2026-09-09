import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import type { McpServerConfig } from '@shared/types/mcp'
import type {
  ExtensionChangeSet,
  ExtensionPrepareRequest,
  ExtensionSearchRequest,
  ExtensionSearchResult,
  ExtensionVerification,
  InstalledExtensionSummary,
} from '@shared/types/extensions'
import { getUserConfigDir, getWorkspaceConfigFilePath, CONFIG_FILES } from '../configPath'
import { McpClient, mcpManager, mcpRegistry } from '../mcp'
import { extensionCredentialBroker } from './ExtensionCredentialBroker'
import type { ExtensionTransactionAdapter, PreparedExtension } from './ExtensionTransactionService'

interface McpPayload {
  kind: 'mcp'
  config: McpServerConfig
  installed: boolean
  credentialRequirements: ExtensionChangeSet['credentialRequirements']
}

interface SkillPayload {
  kind: 'skill'
  repositoryUrl: string
  skillId: string
  commit: string
  targetDir: string
  installed: boolean
}

type ExtensionPayload = McpPayload | SkillPayload

function normalizePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function ensureKnownWorkspace(workspacePath: string | null | undefined): string {
  if (!workspacePath) throw new Error('Open a workspace before installing a workspace extension')
  const expected = normalizePath(getWorkspaceConfigFilePath(workspacePath, CONFIG_FILES.MCP, CONFIG_FILES.SETTINGS_DIR))
  const known = normalizePath(mcpManager.getConfigPaths().workspace[0] || '') === expected
  if (!known) throw new Error('The requested workspace is not active in this window')
  return path.resolve(workspacePath)
}

function parseSkillSource(source: string): { repositoryUrl: string; skillId: string } {
  const match = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/.exec(source.trim())
  if (!match) throw new Error('Skill source must use the skills.sh owner/repository@skill-id format')
  return { repositoryUrl: `https://github.com/${match[1]}/${match[2]}.git`, skillId: match[3] }
}

function runGitCapture(args: string[], cwd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      operation()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error('Git operation timed out')))
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-8_000) })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4_000) })
    child.once('error', error => finish(() => reject(error)))
    child.once('exit', code => {
      finish(() => code === 0
        ? resolve(stdout.trim())
        : reject(new Error(stderr.trim() || `Git exited with code ${code}`)))
    })
  })
}

async function runGit(args: string[], cwd: string, timeoutMs = 60_000): Promise<void> {
  await runGitCapture(args, cwd, timeoutMs)
}

async function rejectSymbolicLinks(directory: string): Promise<void> {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Skill packages containing symbolic links are not supported: ${entry.name}`)
    if (entry.isDirectory()) await rejectSymbolicLinks(entryPath)
  }
}

function normalizeMcpConfig(raw: McpServerConfig, name: string): McpServerConfig {
  return 'url' in raw
    ? { ...raw, type: 'remote', name: raw.name || name }
    : { ...raw, type: 'local', name: raw.name || name }
}

async function searchSkills(query: string): Promise<ExtensionSearchResult[]> {
  const response = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Skills marketplace returned HTTP ${response.status}`)
  const data = await response.json() as { skills?: Array<{ name: string; source: string; installs: number; skillId: string }> }
  return (data.skills || []).slice(0, 20).map(skill => ({
    kind: 'skill',
    id: `${skill.source}@${skill.skillId}`,
    name: skill.name,
    description: `Skill from ${skill.source}`,
    source: `${skill.source}@${skill.skillId}`,
    installs: skill.installs,
  }))
}

export class MainExtensionAdapter implements ExtensionTransactionAdapter {
  redactError(message: string): string {
    return extensionCredentialBroker.redact(message)
  }

  async search(request: ExtensionSearchRequest): Promise<ExtensionSearchResult[]> {
    if (request.kind === 'skill') return searchSkills(request.query)
    const results = await mcpRegistry.search(request.query)
    return results.slice(0, 20).map(server => ({
      kind: 'mcp',
      id: server.id,
      name: server.title || server.name,
      description: server.description,
      source: server.name,
      version: server.version,
    }))
  }

  async list(workspacePath?: string | null): Promise<InstalledExtensionSummary[]> {
    const mcp = (await mcpManager.getServersState()).map(server => ({
      kind: 'mcp' as const,
      id: server.id,
      name: server.config.name,
      scope: server.config.source || 'user',
      status: server.config.disabled ? 'disabled' : server.status,
      sourcePath: server.config.sourcePath,
    }))
    const roots: Array<{ root: string; scope: 'user' | 'workspace' }> = [
      { root: path.join(getUserConfigDir(), 'skills'), scope: 'user' },
    ]
    if (workspacePath) roots.push({ root: path.join(ensureKnownWorkspace(workspacePath), '.adnify', 'skills'), scope: 'workspace' })
    const skills: InstalledExtensionSummary[] = []
    for (const { root, scope } of roots) {
      let entries: fs.Dirent[] = []
      try { entries = await fs.promises.readdir(root, { withFileTypes: true }) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !fs.existsSync(path.join(root, entry.name, 'SKILL.md'))) continue
        skills.push({ kind: 'skill', id: entry.name, name: entry.name, scope, status: 'installed', sourcePath: path.join(root, entry.name) })
      }
    }
    return [...mcp, ...skills]
  }

  async prepare(request: ExtensionPrepareRequest): Promise<PreparedExtension> {
    if (request.scope === 'workspace') ensureKnownWorkspace(request.workspacePath)
    return request.kind === 'mcp' ? this.prepareMcp(request) : this.prepareSkill(request)
  }

  async apply(changeSet: ExtensionChangeSet, rawPayload: unknown): Promise<void> {
    const payload = rawPayload as ExtensionPayload
    if (payload.kind === 'mcp') {
      const staged = new McpClient(payload.config)
      try {
        await staged.connect()
      } finally {
        await staged.disconnect().catch(() => undefined)
      }
      await mcpManager.addServer(payload.config, changeSet.scope)
      payload.installed = true
      await mcpManager.reloadConfig()
      await mcpManager.connectServer(payload.config.id)
      return
    }
    await this.installSkill(payload)
  }

  async verify(_changeSet: ExtensionChangeSet, rawPayload: unknown): Promise<ExtensionVerification> {
    const payload = rawPayload as ExtensionPayload
    if (payload.kind === 'mcp') {
      const state = (await mcpManager.getServersState()).find(item => item.id === payload.config.id)
      return {
        ok: Boolean(state),
        status: state ? 'installed-and-staged' : 'configuration-not-found',
        details: state ? { serverId: state.id, runtimeStatus: state.status, tools: state.tools.length } : undefined,
      }
    }
    const skillFile = path.join(payload.targetDir, 'SKILL.md')
    const ok = payload.installed && fs.existsSync(skillFile)
    return { ok, status: ok ? 'installed' : 'SKILL.md-not-found', details: ok ? { path: skillFile } : undefined }
  }

  async rollback(changeSet: ExtensionChangeSet, rawPayload: unknown): Promise<void> {
    const payload = rawPayload as ExtensionPayload
    if (!payload.installed) return
    if (payload.kind === 'mcp') {
      await mcpManager.removeServer(payload.config.id, changeSet.scope)
      await mcpManager.reloadConfig()
    } else {
      await fs.promises.rm(payload.targetDir, { recursive: true, force: true })
    }
    payload.installed = false
  }

  async refreshCredentialRequirements(_changeSet: ExtensionChangeSet, rawPayload: unknown): Promise<ExtensionChangeSet['credentialRequirements']> {
    const payload = rawPayload as ExtensionPayload
    if (payload.kind !== 'mcp') return []
    return payload.credentialRequirements.map(item => ({
      ...item,
      configured: item.reference ? extensionCredentialBroker.has(item.reference) : false,
    }))
  }

  private async prepareMcp(request: ExtensionPrepareRequest): Promise<PreparedExtension> {
    const server = await mcpRegistry.getServerDetails(request.source)
    if (!server) throw new Error('MCP server was not found in the official registry')
    const rawConfig = mcpRegistry.toLocalConfig(server)
    if (!rawConfig) throw new Error('The registry entry has no supported local or remote transport')
    const config = normalizeMcpConfig(rawConfig, server.title || server.name)
    const npmPackage = server.packages?.find(item => item.registryType === 'npm')
    if (config.type === 'local' && config.command === 'npx' && npmPackage?.version && config.args?.[1] === npmPackage.identifier) {
      config.args[1] = `${npmPackage.identifier}@${npmPackage.version}`
    }
    const existing = (await mcpManager.getServersState()).some(item => item.id === config.id)
    if (existing) throw new Error(`MCP server '${config.id}' is already configured`)
    const requirements = mcpRegistry.getRequiredEnvVars(server)
      .filter(item => item.isRequired && !item.default)
      .map(item => {
        const reference = extensionCredentialBroker.reference(config.id, item.name)
        const marker = extensionCredentialBroker.marker(reference)
        if (config.type === 'remote') config.headers = { ...config.headers, [item.name]: marker }
        else config.env = { ...config.env, [item.name]: marker }
        return {
          name: item.name,
          description: item.description,
          secret: item.isSecret !== false,
          required: true,
          reference,
          configured: extensionCredentialBroker.has(reference),
        }
      })
    return {
      displayName: server.title || server.name,
      resolvedVersion: server.version,
      summary: `Install MCP server '${server.title || server.name}' from the official registry into ${request.scope} settings, stage-connect it, then verify the saved configuration.`,
      risk: 'dangerous',
      credentialRequirements: requirements,
      payload: { kind: 'mcp', config, installed: false, credentialRequirements: requirements } satisfies McpPayload,
    }
  }

  private async prepareSkill(request: ExtensionPrepareRequest): Promise<PreparedExtension> {
    const parsed = parseSkillSource(request.source)
    const remoteHead = await runGitCapture(['ls-remote', '--exit-code', '--', parsed.repositoryUrl, 'HEAD'], os.tmpdir(), 30_000)
    const commit = remoteHead.split(/\s+/)[0]
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Could not resolve the Skill repository HEAD commit')
    const root = request.scope === 'user'
      ? path.join(getUserConfigDir(), 'skills')
      : path.join(ensureKnownWorkspace(request.workspacePath), '.adnify', 'skills')
    const targetDir = path.join(root, parsed.skillId)
    if (fs.existsSync(targetDir)) throw new Error(`Skill '${parsed.skillId}' is already installed in this scope`)
    return {
      displayName: parsed.skillId,
      resolvedVersion: commit,
      summary: `Install '${parsed.skillId}' at commit ${commit.slice(0, 12)} from ${parsed.repositoryUrl}, validate SKILL.md, and atomically install it into ${request.scope} scope.`,
      risk: 'dangerous',
      credentialRequirements: [],
      payload: { kind: 'skill', ...parsed, commit, targetDir, installed: false } satisfies SkillPayload,
    }
  }

  private async installSkill(payload: SkillPayload): Promise<void> {
    const targetRoot = path.dirname(payload.targetDir)
    await fs.promises.mkdir(targetRoot, { recursive: true })
    if (fs.existsSync(payload.targetDir)) throw new Error(`Skill '${payload.skillId}' was installed after this change set was prepared`)
    const cloneRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'adnify-skill-'))
    const cloneDir = path.join(cloneRoot, 'repository')
    const stagingDir = path.join(targetRoot, `.${payload.skillId}.staging-${path.basename(cloneRoot)}`)
    try {
      await runGit(['clone', '-c', 'core.symlinks=true', '--depth', '1', '--', payload.repositoryUrl, cloneDir], cloneRoot)
      const clonedCommit = await runGitCapture(['rev-parse', 'HEAD'], cloneDir, 10_000)
      if (clonedCommit.toLowerCase() !== payload.commit.toLowerCase()) {
        throw new Error('The Skill repository changed after approval; prepare a new change set')
      }
      const candidates = [
        path.join(cloneDir, '.claude', 'skills', payload.skillId),
        path.join(cloneDir, 'skills', payload.skillId),
        path.join(cloneDir, payload.skillId),
        cloneDir,
      ]
      const sourceDir = candidates.find(candidate => fs.existsSync(path.join(candidate, 'SKILL.md')))
      if (!sourceDir) throw new Error(`Could not find SKILL.md for '${payload.skillId}' in the repository`)
      await rejectSymbolicLinks(sourceDir)
      await fs.promises.cp(sourceDir, stagingDir, { recursive: true, errorOnExist: true, force: false })
      if (!fs.existsSync(path.join(stagingDir, 'SKILL.md'))) throw new Error('Staged Skill is missing SKILL.md')
      await fs.promises.rename(stagingDir, payload.targetDir)
      payload.installed = true
    } finally {
      await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
      await fs.promises.rm(cloneRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
