import { randomUUID } from 'node:crypto'

interface Request { requestId: string; operation: unknown }
export type ParentRequest = (event: unknown) => Promise<unknown>

/** Child-only endpoint. Functions stay in the main process; only data crosses IPC. */
export function serveUtility(
  handler: (operation: unknown, askParent: ParentRequest) => Promise<unknown> | unknown,
): void {
  const port = process.parentPort
  if (!port) throw new Error('This entry requires an Electron utility process')
  const callbacks = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  port.on('message', ({ data }: { data: Request | { eventId: string; ok: boolean; result?: unknown; error?: string } }) => {
    if ('eventId' in data) {
      const callback = callbacks.get(data.eventId)
      callbacks.delete(data.eventId)
      if (data.ok) callback?.resolve(data.result)
      else callback?.reject(new Error(data.error || 'Parent operation failed'))
      return
    }
    const askParent: ParentRequest = event => new Promise((resolve, reject) => {
      const eventId = randomUUID()
      callbacks.set(eventId, { resolve, reject })
      port.postMessage({ requestId: data.requestId, eventId, event })
    })
    void Promise.resolve().then(() => handler(data.operation, askParent)).then(
      result => port.postMessage({ requestId: data.requestId, ok: true, result }),
      error => port.postMessage({ requestId: data.requestId, ok: false, error: error instanceof Error ? error.message : String(error) }),
    )
  })
}

export function notifyParent(notification: unknown): void { process.parentPort?.postMessage({ notification }) }
