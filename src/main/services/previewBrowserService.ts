import type { WebContents } from 'electron'
import { browserActionSchema, browserInspectSchema, type BrowserTarget } from '@shared/preview/browserAutomation'
import { domScript, stylesScript, elementActionScript, cursorOverlayScript } from '@shared/preview/browserScripts'
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
  lastMousePos?: { x: number; y: number }
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

  private async ensureCursorOverlay(entry: TargetEntry): Promise<void> {
    try {
      await this.evaluate(entry, cursorOverlayScript())
    } catch {
      // Non-critical if guest page is not ready yet
    }
  }

  private async simulateMouseTrajectory(
    entry: TargetEntry,
    targetX: number,
    targetY: number,
  ): Promise<void> {
    await this.ensureCursorOverlay(entry)

    const from = entry.lastMousePos || { x: Math.round(targetX * 0.5), y: Math.round(targetY * 0.5) }
    const startX = from.x
    const startY = from.y
    const dx = targetX - startX
    const dy = targetY - startY
    const dist = Math.hypot(dx, dy)

    if (dist < 4) {
      entry.lastMousePos = { x: targetX, y: targetY }
      await bounded(entry.guest.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: targetX, y: targetY,
      }))
      await this.evaluate(entry, `window.__adnifyUpdateCursor?.(${targetX}, ${targetY})`).catch(() => {})
      return
    }

    // Dynamic steps based on distance
    const steps = Math.max(10, Math.min(24, Math.round(dist / 30)))

    // Two control points for a natural cubic Bézier curve with human-like perpendicular sway
    const deviation = Math.min(50, dist * 0.15) * (Math.random() > 0.5 ? 1 : -1)
    const perpX = -dy / (dist || 1)
    const perpY = dx / (dist || 1)

    const cp1X = startX + dx * 0.25 + perpX * deviation
    const cp1Y = startY + dy * 0.25 + perpY * deviation
    const cp2X = startX + dx * 0.75 + perpX * (deviation * 0.5)
    const cp2Y = startY + dy * 0.75 + perpY * (deviation * 0.5)

    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      // Ease-out cubic: starts with velocity, smoothly decelerates toward target
      const p = 1 - Math.pow(1 - t, 3)
      const u = 1 - p

      const cx = Math.round(u * u * u * startX + 3 * u * u * p * cp1X + 3 * u * p * p * cp2X + p * p * p * targetX)
      const cy = Math.round(u * u * u * startY + 3 * u * u * p * cp1Y + 3 * u * p * p * cp2Y + p * p * p * targetY)

      // Sub-pixel hand micro-jitter during transit, 0 jitter at destination
      const jitterX = i < steps ? Math.round((Math.random() - 0.5) * 1.5) : 0
      const jitterY = i < steps ? Math.round((Math.random() - 0.5) * 1.5) : 0
      const curX = cx + jitterX
      const curY = cy + jitterY

      await bounded(entry.guest.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: curX, y: curY,
      }))
      await this.evaluate(entry, `window.__adnifyUpdateCursor?.(${curX}, ${curY})`).catch(() => {})

      await new Promise(resolve => setTimeout(resolve, 8))
    }

    entry.lastMousePos = { x: targetX, y: targetY }
  }

  private async simulateWheelScroll(
    entry: TargetEntry,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    const mousePos = entry.lastMousePos || { x: 500, y: 400 }
    // Decompose total delta into decaying momentum frames (simulating natural flick friction)
    const fractions = [0.30, 0.25, 0.18, 0.12, 0.08, 0.04, 0.02, 0.01]
    for (const f of fractions) {
      const stepX = Math.round(deltaX * f)
      const stepY = Math.round(deltaY * f)
      await bounded(entry.guest.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: mousePos.x,
        y: mousePos.y,
        deltaX: stepX,
        deltaY: stepY,
      }))
      await new Promise(resolve => setTimeout(resolve, 16))
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

        const targetSelector = args.element !== undefined
          ? (String(args.element).startsWith('@') ? String(args.element) : `@${args.element}`)
          : args.selector

        if (args.action === 'wait_for') {
          const deadline = Date.now() + args.timeout_ms
          for (;;) {
            try {
              if ((await this.evaluate(entry, elementActionScript('wait_for', targetSelector))).visible) break
            } catch (error) {
              if (entry.guest.isDestroyed() || !entry.guest.debugger.isAttached()) throw error
              if (!String(error).includes('matched 0')) throw error
            }
            if (Date.now() >= deadline) throw new Error(`Timed out waiting for visible element: ${targetSelector}`)
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        } else if (args.action === 'press') {
          entry.guest.focus()
          if (targetSelector) await this.evaluate(entry, elementActionScript('focus', targetSelector))
          const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 }
          const key = args.key!
          await bounded(entry.guest.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key], ...(key === 'Enter' ? { text: '\r' } : {}) }))
          await bounded(entry.guest.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] }))
        } else if (args.action === 'scroll') {
          await this.simulateWheelScroll(entry, args.x, args.y)
        } else {
          const result = await this.evaluate(entry, elementActionScript(args.action, targetSelector, args.text, args.x, args.y))
          if (args.action === 'click') {
            await this.simulateMouseTrajectory(entry, result.x, result.y)
            // Human pre-click pause
            await new Promise(resolve => setTimeout(resolve, 40))
            // Click ripple animation in view
            await this.evaluate(entry, `window.__adnifyClickRipple?.(${result.x}, ${result.y})`).catch(() => {})
            // Physical mouse press
            await bounded(entry.guest.debugger.sendCommand('Input.dispatchMouseEvent', {
              type: 'mousePressed', button: 'left', x: result.x, y: result.y, clickCount: 1,
            }))
            // Physical hold duration (dwell time)
            await new Promise(resolve => setTimeout(resolve, 75))
            // Physical mouse release
            await bounded(entry.guest.debugger.sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseReleased', button: 'left', x: result.x, y: result.y, clickCount: 1,
            }))
          } else if (args.action === 'fill') {
            if (typeof result.x === 'number' && typeof result.y === 'number') {
              await this.simulateMouseTrajectory(entry, result.x, result.y)
              await this.evaluate(entry, `window.__adnifyClickRipple?.(${result.x}, ${result.y})`).catch(() => {})
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
