import type { WebContents } from 'electron'
import { browserActionSchema, browserInspectSchema, type BrowserTarget } from '@shared/preview/browserAutomation'
import { domScript, stylesScript, elementActionScript } from '@shared/preview/browserScripts'
import { isBrowserPreviewUrl } from '@shared/preview/discovery'
import { getPreviewDeviceSize, previewDeviceSchema } from '@shared/preview/device'

interface Diagnostic {
  timestamp: number
  kind: string
  message: string
  url?: string
  status?: number
}

interface TargetEntry {
  ownerId: number
  guest: WebContents
  records: Diagnostic[]
  requests: Map<string, string>
  monitoringError?: string
  connecting?: Promise<void>
  busy: boolean
  deviceUpdate?: Promise<void>
}

const MAX_RECORDS = 200

async function bounded<T>(promise: Promise<T>, timeout = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser operation timed out; inspect the page before retrying')), timeout)
    })])
  } finally {
    clearTimeout(timer)
  }
}

/** Only guests registered by the window's webview guard can be controlled. */
export class PreviewBrowserService {
  private targets = new Map<number, TargetEntry>()

  register(owner: WebContents, guest: WebContents): void {
    if (this.targets.has(guest.id)) return
    const entry: TargetEntry = { ownerId: owner.id, guest, records: [], requests: new Map(), busy: false }
    this.targets.set(guest.id, entry)
    const record = (value: Omit<Diagnostic, 'timestamp'>) => {
      entry.records.push({ ...value, message: value.message.slice(0, 3000), url: value.url?.slice(0, 4000), timestamp: Date.now() })
      if (entry.records.length > MAX_RECORDS) entry.records.shift()
    }
    guest.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        record({ kind: `console.${params.type}`, message: (params.args || []).map((arg: { value?: unknown; description?: string }) =>
          arg.description || String(arg.value ?? '')).join(' '), url: guest.getURL() })
      } else if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails
        record({ kind: 'exception', message: details.exception?.description || details.text, url: details.url || guest.getURL() })
      } else if (method === 'Network.requestWillBeSent') {
        entry.requests.set(params.requestId, String(params.request.url).slice(0, 4000))
        if (entry.requests.size > 500) entry.requests.delete(entry.requests.keys().next().value!)
      } else if (method === 'Network.responseReceived' && params.response.status >= 400) {
        record({ kind: 'http-error', message: params.response.statusText || `HTTP ${params.response.status}`, url: params.response.url, status: params.response.status })
      } else if (method === 'Network.loadingFailed') {
        record({ kind: 'network-error', message: params.errorText, url: entry.requests.get(params.requestId) })
        entry.requests.delete(params.requestId)
      } else if (method === 'Network.loadingFinished') {
        entry.requests.delete(params.requestId)
      }
    })
    guest.debugger.on('detach', (_event, reason) => {
      entry.monitoringError = `Debugger detached (${reason}); diagnostics may have a gap. Close guest DevTools and inspect again.`
      record({ kind: 'monitor', message: entry.monitoringError })
    })
    guest.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (code !== -3) record({ kind: isMainFrame ? 'navigation-error' : 'resource-error', message: `${description} (${code})`, url })
    })
    guest.on('render-process-gone', (_event, details) => record({ kind: 'crash', message: details.reason }))
    const cleanup = () => {
      this.targets.delete(guest.id)
      owner.removeListener('destroyed', cleanup)
      entry.requests.clear()
      if (!guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
    }
    guest.once('destroyed', cleanup)
    owner.once('destroyed', cleanup)
    // Enable before DOM-ready so early JavaScript errors are retained.
    void this.connect(entry).catch(() => {})
  }

  list(ownerId: number): BrowserTarget[] {
    return [...this.targets.values()].filter(e => e.ownerId === ownerId && !e.guest.isDestroyed()).map(({ guest }) => ({
      id: guest.id, url: guest.getURL(), title: guest.getTitle(), loading: guest.isLoading(),
    }))
  }

  async configureDevice(ownerId: number, input: unknown): Promise<void> {
    const request = previewDeviceSchema.parse(input)
    const entry = this.resolve(ownerId, request.targetId)
    // Resize and orientation changes can arrive while a CDP command is pending.
    // Preserve their order so an older mobile request cannot overwrite desktop.
    const update = (entry.deviceUpdate ?? Promise.resolve()).catch(() => {}).then(async () => {
      this.resolve(ownerId, request.targetId)
      await this.connect(entry)
      const size = getPreviewDeviceSize(request.device, request.orientation)
      if (size) {
        entry.guest.setZoomLevel(0)
        entry.guest.enableDeviceEmulation({
          screenPosition: 'mobile', screenSize: { width: size.width, height: size.height },
          viewPosition: { x: 0, y: 0 },
          viewSize: { width: size.width, height: size.height },
          deviceScaleFactor: size.deviceScaleFactor, scale: request.scale,
        })
      } else {
        entry.guest.disableDeviceEmulation()
      }
      await bounded(entry.guest.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: !!size, maxTouchPoints: size ? 5 : 1 }))
    })
    entry.deviceUpdate = update
    try { await update } finally { if (entry.deviceUpdate === update) entry.deviceUpdate = undefined }
  }

  private resolve(ownerId: number, targetId?: number): TargetEntry {
    const candidates = this.list(ownerId)
    if (targetId === undefined && candidates.length !== 1) {
      throw new Error(candidates.length ? 'Multiple preview targets; call browser_inspect(action=list) and specify target_id' : 'No mounted preview. Use browser_open with an HTTP(S) URL first.')
    }
    const entry = this.targets.get(targetId ?? candidates[0].id)
    if (!entry || entry.ownerId !== ownerId || entry.guest.isDestroyed()) throw new Error('Preview target is closed or belongs to another window; list targets again')
    if (!isBrowserPreviewUrl(entry.guest.getURL())) throw new Error('Only HTTP(S) preview pages can be controlled; wait for the page to load')
    return entry
  }

  private async connect(entry: TargetEntry): Promise<void> {
    if (entry.connecting) return entry.connecting
    if (entry.guest.debugger.isAttached() && !entry.monitoringError) return
    entry.connecting = (async () => {
      try {
        if (!entry.guest.debugger.isAttached()) entry.guest.debugger.attach('1.3')
        await bounded(entry.guest.debugger.sendCommand('Runtime.enable'))
        await bounded(entry.guest.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 1000000, maxResourceBufferSize: 100000 }))
        entry.monitoringError = undefined
      } catch (error) {
        entry.monitoringError = error instanceof Error ? error.message : String(error)
        throw new Error(`Browser debugger unavailable: ${entry.monitoringError}. Close guest DevTools and retry.`)
      }
    })().finally(() => { entry.connecting = undefined })
    return entry.connecting
  }

  private async evaluate(entry: TargetEntry, expression: string): Promise<any> {
    if (entry.guest.isDestroyed() || !isBrowserPreviewUrl(entry.guest.getURL())) throw new Error('Preview target navigated away or closed')
    const result = await bounded(entry.guest.debugger.sendCommand('Runtime.evaluate', {
      expression, returnByValue: true, timeout: 5000,
    }))
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }

  private async waitForFrame(entry: TargetEntry): Promise<void> {
    // did-finish-load can precede the guest's first compositor/input surface.
    const result = await bounded(entry.guest.debugger.sendCommand('Runtime.evaluate', {
      expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      awaitPromise: true, returnByValue: true,
    }), 5000)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }

  async inspect(ownerId: number, input: unknown): Promise<unknown> {
    const args = browserInspectSchema.parse(input)
    if (args.action === 'list') return { targets: this.list(ownerId) }
    const entry = this.resolve(ownerId, args.target_id)
    if (entry.busy) throw new Error('Preview target is busy; wait for the current action to finish')
    entry.busy = true
    try {
      if (args.action === 'diagnostics') {
        await this.connect(entry).catch(() => {})
        return { targetId: entry.guest.id, url: entry.guest.getURL(), monitoring: !entry.monitoringError,
          monitoringError: entry.monitoringError, retainedLimit: MAX_RECORDS,
          records: entry.records.slice(-args.limit), note: 'Captured since this guest was attached; timestamps and URLs identify earlier navigations.' }
      }
      await this.connect(entry)
      if (args.action === 'screenshot') {
        await this.waitForFrame(entry)
        const capture = await bounded(entry.guest.capturePage(undefined, { stayHidden: true, stayAwake: true }))
        if (capture.isEmpty()) throw new Error('Preview has no rendered frame yet; wait for the page to render')
        const size = capture.getSize()
        const scaled = size.width > 1600 ? capture.resize({ width: 1600 }) : capture
        const image = scaled.toJPEG(70).toString('base64')
        if (image.length > 4000000) throw new Error('Screenshot exceeds the 4 MB limit; reduce the preview size')
        return { targetId: entry.guest.id, mimeType: 'image/jpeg', image }
      }
      return { targetId: entry.guest.id, ...await this.evaluate(entry,
        args.action === 'styles' ? stylesScript(args.selector!) : domScript(args.selector, args.limit)) }
    } finally {
      entry.busy = false
    }
  }

  async act(ownerId: number, input: unknown): Promise<unknown> {
    const args = browserActionSchema.parse(input)
    const entry = this.resolve(ownerId, args.target_id)
    if (entry.busy) throw new Error('Preview target is busy; wait for the current action to finish')
    entry.busy = true
    try {
      if (args.action === 'navigate') {
        if (!isBrowserPreviewUrl(args.url!)) throw new Error('Only HTTP(S) preview URLs without embedded credentials are allowed')
        await bounded(entry.guest.loadURL(args.url!))
      } else if (args.action === 'reload') {
        // loadURL returns a navigation completion promise, unlike reload().
        await bounded(entry.guest.loadURL(entry.guest.getURL()))
      } else {
        await this.connect(entry)
        if (args.action === 'click' || args.action === 'press') await this.waitForFrame(entry)
        if (args.action === 'wait_for') {
          const deadline = Date.now() + args.timeout_ms
          for (;;) {
            try {
              if ((await this.evaluate(entry, elementActionScript('wait_for', args.selector))).visible) break
            } catch (error) {
              if (entry.guest.isDestroyed() || !entry.guest.debugger.isAttached()) throw error
              if (!String(error).includes('matched 0')) throw error
            }
            if (Date.now() >= deadline) throw new Error(`Timed out waiting for visible element: ${args.selector}`)
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        } else if (args.action === 'press') {
          entry.guest.focus()
          if (args.selector) await this.evaluate(entry, elementActionScript('focus', args.selector))
          const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 }
          const key = args.key!
          await bounded(entry.guest.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key], ...(key === 'Enter' ? { text: '\r' } : {}) }))
          await bounded(entry.guest.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] }))
        } else {
          const result = await this.evaluate(entry, elementActionScript(args.action, args.selector, args.text, args.x, args.y))
          if (args.action === 'click') {
            for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
              await bounded(entry.guest.debugger.sendCommand('Input.dispatchMouseEvent', {
                type, x: result.x, y: result.y, ...(type !== 'mouseMoved' ? { button: 'left', clickCount: 1 } : {}),
              }))
            }
          }
        }
      }
      return { targetId: entry.guest.id, action: args.action, url: entry.guest.getURL(),
        note: 'Action dispatched. Use wait_for, DOM, screenshot or diagnostics to verify the resulting page state.' }
    } finally {
      entry.busy = false
    }
  }
}

export const previewBrowserService = new PreviewBrowserService()
