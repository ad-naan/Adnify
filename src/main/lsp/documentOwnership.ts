export interface ReleasedDocument {
  serverKey: string
  uri: string
}

export class DocumentOwnership {
  private readonly ownersByDocument = new Map<string, Map<string, Set<number>>>()
  private readonly documentsByOwner = new Map<number, Set<string>>()

  acquire(serverKey: string, uri: string, ownerId: number): boolean {
    let documents = this.ownersByDocument.get(serverKey)
    if (!documents) {
      documents = new Map()
      this.ownersByDocument.set(serverKey, documents)
    }

    let owners = documents.get(uri)
    const isFirstOwner = !owners || owners.size === 0
    if (!owners) {
      owners = new Set()
      documents.set(uri, owners)
    }
    owners.add(ownerId)

    let ownedDocuments = this.documentsByOwner.get(ownerId)
    if (!ownedDocuments) {
      ownedDocuments = new Set()
      this.documentsByOwner.set(ownerId, ownedDocuments)
    }
    ownedDocuments.add(this.toOwnerKey(serverKey, uri))
    return isFirstOwner
  }

  release(serverKey: string, uri: string, ownerId: number): boolean {
    const owners = this.ownersByDocument.get(serverKey)?.get(uri)
    if (!owners?.delete(ownerId)) return false

    const ownerDocuments = this.documentsByOwner.get(ownerId)
    ownerDocuments?.delete(this.toOwnerKey(serverKey, uri))
    if (ownerDocuments?.size === 0) this.documentsByOwner.delete(ownerId)

    if (owners.size > 0) return false
    this.ownersByDocument.get(serverKey)?.delete(uri)
    if (this.ownersByDocument.get(serverKey)?.size === 0) this.ownersByDocument.delete(serverKey)
    return true
  }

  releaseOwner(ownerId: number): ReleasedDocument[] {
    const ownedDocuments = this.documentsByOwner.get(ownerId)
    if (!ownedDocuments) return []

    const released: ReleasedDocument[] = []
    for (const ownerKey of [...ownedDocuments]) {
      const { serverKey, uri } = this.fromOwnerKey(ownerKey)
      if (this.release(serverKey, uri, ownerId)) released.push({ serverKey, uri })
    }
    return released
  }

  releaseOwnerDocument(ownerId: number, uri: string): ReleasedDocument[] {
    const ownedDocuments = this.documentsByOwner.get(ownerId)
    if (!ownedDocuments) return []

    const released: ReleasedDocument[] = []
    for (const ownerKey of [...ownedDocuments]) {
      const document = this.fromOwnerKey(ownerKey)
      if (document.uri === uri && this.release(document.serverKey, uri, ownerId)) {
        released.push(document)
      }
    }
    return released
  }

  clearServer(serverKey: string): void {
    const documents = this.ownersByDocument.get(serverKey)
    if (!documents) return

    for (const [uri, owners] of documents) {
      const ownerKey = this.toOwnerKey(serverKey, uri)
      for (const ownerId of owners) {
        const ownedDocuments = this.documentsByOwner.get(ownerId)
        ownedDocuments?.delete(ownerKey)
        if (ownedDocuments?.size === 0) this.documentsByOwner.delete(ownerId)
      }
    }
    this.ownersByDocument.delete(serverKey)
  }

  private toOwnerKey(serverKey: string, uri: string): string {
    return `${serverKey}\0${uri}`
  }

  private fromOwnerKey(ownerKey: string): ReleasedDocument {
    const separator = ownerKey.indexOf('\0')
    return { serverKey: ownerKey.slice(0, separator), uri: ownerKey.slice(separator + 1) }
  }
}
