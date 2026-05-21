import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import { getConfigFilePath } from './configPath'

export type RemoteHostTrustStatus = 'known' | 'accepted_new' | 'mismatch_rejected'

export interface RemoteHostTrustRecord {
  host: string
  port: number
  fingerprintSha256: string
  addedAt: number
  lastSeenAt: number
}

export interface RemoteHostTrustDecision {
  host: string
  port: number
  hostTrustStatus: RemoteHostTrustStatus
  hostFingerprintSha256: string
  knownHostFingerprintSha256?: string
}

export class RemoteHostFingerprintMismatchError extends Error {
  readonly code = 'REMOTE_HOST_FINGERPRINT_MISMATCH'
  readonly decision: RemoteHostTrustDecision

  constructor(decision: RemoteHostTrustDecision) {
    super(
      `Remote host fingerprint mismatch for ${decision.host}:${decision.port}. ` +
      `Known: ${decision.knownHostFingerprintSha256 || 'unknown'}, ` +
      `Received: ${decision.hostFingerprintSha256}.`
    )
    this.name = 'RemoteHostFingerprintMismatchError'
    this.decision = decision
  }
}

interface RemoteHostTrustStatusSnapshot {
  known: boolean
  fingerprintSha256?: string
}

class RemoteHostTrustService {
  private recordsCache: RemoteHostTrustRecord[] | null = null
  private loadPromise: Promise<RemoteHostTrustRecord[]> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private lastDecisions = new Map<string, RemoteHostTrustDecision>()

  getKnownHostsPath(): string {
    return getConfigFilePath('known_hosts.json', 'ssh')
  }

  getFingerprintSha256(publicKey: Buffer): string {
    return `SHA256:${crypto.createHash('sha256').update(publicKey).digest('base64')}`
  }

  async getStatus(host: string, port?: number): Promise<RemoteHostTrustStatusSnapshot> {
    const record = await this.findRecord(host, port)
    return {
      known: Boolean(record),
      fingerprintSha256: record?.fingerprintSha256,
    }
  }

  getLastDecision(host: string, port?: number): RemoteHostTrustDecision | null {
    return this.lastDecisions.get(this.getKey(host, port)) || null
  }

  async verifyOrRecordHost(input: {
    host: string
    port?: number
    publicKey: Buffer
  }): Promise<RemoteHostTrustDecision> {
    const host = this.normalizeHost(input.host)
    const port = this.normalizePort(input.port)
    const hostFingerprintSha256 = this.getFingerprintSha256(input.publicKey)
    const records = await this.loadRecords()
    const existing = records.find(record => record.host === host && record.port === port)
    const now = Date.now()

    if (!existing) {
      const nextRecord: RemoteHostTrustRecord = {
        host,
        port,
        fingerprintSha256: hostFingerprintSha256,
        addedAt: now,
        lastSeenAt: now,
      }
      await this.persistRecords([...records, nextRecord])

      const decision: RemoteHostTrustDecision = {
        host,
        port,
        hostTrustStatus: 'accepted_new',
        hostFingerprintSha256,
      }
      this.lastDecisions.set(this.getKey(host, port), decision)
      return decision
    }

    if (existing.fingerprintSha256 === hostFingerprintSha256) {
      existing.lastSeenAt = now
      await this.persistRecords(records)

      const decision: RemoteHostTrustDecision = {
        host,
        port,
        hostTrustStatus: 'known',
        hostFingerprintSha256,
      }
      this.lastDecisions.set(this.getKey(host, port), decision)
      return decision
    }

    const mismatchDecision: RemoteHostTrustDecision = {
      host,
      port,
      hostTrustStatus: 'mismatch_rejected',
      hostFingerprintSha256,
      knownHostFingerprintSha256: existing.fingerprintSha256,
    }
    this.lastDecisions.set(this.getKey(host, port), mismatchDecision)
    logger.security.warn('[RemoteHostTrust] Host fingerprint mismatch', mismatchDecision)
    throw new RemoteHostFingerprintMismatchError(mismatchDecision)
  }

  private normalizePort(port?: number): number {
    return port && port > 0 ? port : 22
  }

  private normalizeHost(host: string): string {
    return host.trim().toLowerCase()
  }

  private getKey(host: string, port?: number): string {
    return `${this.normalizeHost(host)}:${this.normalizePort(port)}`
  }

  private async findRecord(host: string, port?: number): Promise<RemoteHostTrustRecord | null> {
    const records = await this.loadRecords()
    const normalizedHost = this.normalizeHost(host)
    return records.find(record => record.host === normalizedHost && record.port === this.normalizePort(port)) || null
  }

  private async loadRecords(): Promise<RemoteHostTrustRecord[]> {
    if (this.recordsCache) return this.recordsCache
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      const filePath = this.getKnownHostsPath()
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const parsed = JSON.parse(content) as RemoteHostTrustRecord[]
        this.recordsCache = Array.isArray(parsed) ? parsed : []
      } catch (error) {
        const appError = error as NodeJS.ErrnoException
        if (appError.code !== 'ENOENT') {
          logger.security.warn('[RemoteHostTrust] Failed to load known hosts file, using empty state', error)
        }
        this.recordsCache = []
      } finally {
        this.loadPromise = null
      }

      return this.recordsCache
    })()

    return this.loadPromise
  }

  private async persistRecords(records: RemoteHostTrustRecord[]): Promise<void> {
    const filePath = this.getKnownHostsPath()
    const nextRecords = records.map(record => ({ ...record }))

    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, `${JSON.stringify(nextRecords, null, 2)}\n`, 'utf8')
      this.recordsCache = nextRecords
    })

    await this.writeQueue
  }
}

export const remoteHostTrustService = new RemoteHostTrustService()
