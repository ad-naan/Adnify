import { safeStorage } from 'electron'
import type Store from 'electron-store'
import type { McpServerConfig } from '@shared/types/mcp'
import { createScopedStore } from '../configPath'

const STORE_KEY = 'encryptedSecrets'
const REFERENCE_PATTERN = /^mcp:[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/
const MARKER_PATTERN = /^\$\{ADNIFY_SECRET:([a-zA-Z0-9:_.-]+)\}$/

function assertReference(reference: string): void {
  if (!REFERENCE_PATTERN.test(reference)) throw new Error('Invalid extension credential reference')
}

function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
    && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
}

export class ExtensionCredentialBroker {
  private store: Store<Record<string, unknown>> | undefined

  reference(serverId: string, name: string): string {
    const safeServerId = serverId.replace(/[^a-zA-Z0-9_.-]/g, '-')
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error(`Unsupported MCP credential name '${name}'`)
    const reference = `mcp:${safeServerId}:${name}`
    assertReference(reference)
    return reference
  }

  marker(reference: string): string {
    assertReference(reference)
    return `\${ADNIFY_SECRET:${reference}}`
  }

  has(reference: string): boolean {
    assertReference(reference)
    return typeof this.records()[reference] === 'string'
  }

  set(reference: string, secret: string): void {
    assertReference(reference)
    if (!secret || secret.length > 16_000) throw new Error('Credential value is empty or too large')
    if (!encryptionAvailable()) throw new Error('OS credential encryption is unavailable')
    const encrypted = safeStorage.encryptString(secret).toString('base64')
    this.requireStore().set(STORE_KEY, { ...this.records(), [reference]: encrypted })
  }

  remove(reference: string): boolean {
    assertReference(reference)
    const records = { ...this.records() }
    if (!records[reference]) return false
    delete records[reference]
    this.requireStore().set(STORE_KEY, records)
    return true
  }

  status(references: string[]): Array<{ reference: string; configured: boolean }> {
    return references.map(reference => ({ reference, configured: this.has(reference) }))
  }

  resolveConfig(config: McpServerConfig): McpServerConfig {
    if (config.type === 'remote') {
      return {
        ...config,
        headers: this.resolveRecord(config.headers),
        oauth: typeof config.oauth === 'object'
          ? { ...config.oauth, clientSecret: this.resolveValue(config.oauth.clientSecret) }
          : config.oauth,
      }
    }
    return { ...config, env: this.resolveRecord(config.env) }
  }

  redact(text: string): string {
    let result = text
    if (!encryptionAvailable()) return result
    for (const encrypted of Object.values(this.records())) {
      try {
        const secret = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
        if (secret) result = result.split(secret).join('[REDACTED]')
      } catch {
        // A corrupt credential must not make error reporting fail open.
      }
    }
    return result
  }

  private resolveRecord(record?: Record<string, string>): Record<string, string> | undefined {
    if (!record) return undefined
    return Object.fromEntries(Object.entries(record).map(([name, value]) => [name, this.resolveValue(value) || '']))
  }

  private resolveValue(value?: string): string | undefined {
    if (!value) return value
    const match = MARKER_PATTERN.exec(value)
    if (!match) return value
    const encrypted = this.records()[match[1]]
    if (!encrypted) throw new Error(`Credential '${match[1]}' is not configured`)
    if (!encryptionAvailable()) throw new Error('OS credential encryption is unavailable')
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  private records(): Record<string, string> {
    const value = this.requireStore().get(STORE_KEY)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, encrypted]) => typeof encrypted === 'string'))
  }

  private requireStore(): Store<Record<string, unknown>> {
    if (!this.store) this.store = createScopedStore('extension-credentials')
    return this.store
  }
}

export const extensionCredentialBroker = new ExtensionCredentialBroker()
