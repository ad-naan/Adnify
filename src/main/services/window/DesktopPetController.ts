import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, Point } from 'electron'
import type Store from 'electron-store'
import path from 'node:path'
import {
  DEFAULT_PET_PREFERENCES,
  PET_WINDOW_TITLE,
  type PetAction,
  type PetActivity,
  type PetPerformance,
  type PetPlacement,
  type PetPreferences,
  type PetReactionResult,
  type PetState,
  type PetViewState,
} from '@shared/desktopPet'
import { asLanguage } from '@shared/i18n'
import { PET_GALLERY } from '@shared/petGallery'
import { normalizePetSpeech, parsePetSpeechConfig } from '@shared/petSpeechConfig'
import { encryptPetSpeechKey, synthesizePetSpeech } from './petSpeech'
import { installGalleryPetModel, installPetModel, readPetModelAsset, removePetModelFiles, type InstalledPetModel } from './petModels'
import { generatePetPerformance, isPetModelConfigured, resolvePetModel } from './petReaction'

const PET_WIDTH = 292
const PET_HEIGHT = 400
const ACTIVITY_COOLDOWN_MS = 30000
const STORAGE_KEY = 'desktopPet'
const PLACEMENTS = new Set<PetPlacement>(['custom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'])

interface StoredPet {
  preferences?: Partial<PetPreferences>
  models?: InstalledPetModel[]
  position?: Point
  speechKey?: string
}

function toViewState(state: PetState): PetViewState {
  const { character, name, voice } = state.preferences
  return { language: state.language, models: state.models, preferences: { character, name, voice } }
}

function sameSpeechOrigin(previous: string, next: string): boolean {
  return previous === next || (URL.canParse(previous) && URL.canParse(next)
    && new URL(previous).origin === new URL(next).origin)
}

function normalizeActivity(activity: PetActivity): PetActivity | undefined {
  if (!activity || typeof activity !== 'object') return
  if (activity.type === 'agent.event') {
    if (typeof activity.event === 'string' && /^agent(?:\.[a-z][a-z0-9]*){2,4}$/.test(activity.event) &&
      ['success', 'warning', 'error'].includes(activity.level)) {
      return { type: activity.type, event: activity.event, level: activity.level }
    }
    return
  }
  if (activity.type !== 'editor.edit' || typeof activity.language !== 'string'
    || !/^[a-z0-9_+-]{1,32}$/.test(activity.language)) return
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(100000, Math.trunc(value))) : 0
  const syntax = Array.isArray(activity.syntax) ? activity.syntax.slice(0, 10)
    .filter(item => item && typeof item.kind === 'string' && typeof item.parent === 'string'
      && /^[A-Z][A-Za-z0-9]{0,49}$/.test(item.kind) && /^[A-Z][A-Za-z0-9]{0,49}$/.test(item.parent)
      && Number.isSafeInteger(item.delta))
    .map(({ kind, parent, delta }) => ({ kind, parent, delta: Math.max(-100, Math.min(100, delta)) })) : undefined
  return {
    type: activity.type,
    language: activity.language,
    insertedCharacters: count(activity.insertedCharacters),
    removedCharacters: count(activity.removedCharacters),
    syntax,
  }
}

export class DesktopPetController {
  private window: BrowserWindow | null = null
  private lastActivity = -Infinity
  private pendingActivity: PetActivity | undefined
  private generation: AbortController | undefined
  private latest: PetPerformance | undefined
  private nextPerformanceId = 0
  private speech: AbortController | undefined
  private importing = false
  private moveTimer: ReturnType<typeof setTimeout> | undefined
  private targetPosition: Point | undefined
  private dragStart: { cursor: Point; position: Point } | undefined

  constructor(
    private readonly store: Store<Record<string, unknown>>,
    private readonly editors: ReadonlyMap<number, BrowserWindow>,
    private readonly isQuitting: () => boolean,
    private readonly getActiveEditor: () => BrowserWindow | null,
  ) {}

  private get stored(): StoredPet {
    return (this.store.get(STORAGE_KEY) as StoredPet | undefined) ?? {}
  }

  private get root(): string {
    return path.join(app.getPath('userData'), 'desktop-pet-models')
  }

  private get preferences(): PetPreferences {
    const saved = this.stored.preferences
    const voice = saved?.voice
    return {
      ...DEFAULT_PET_PREFERENCES,
      ...saved,
      voice: voice === 'custom' || voice === 'system' ? voice : 'off',
      speech: normalizePetSpeech(saved?.speech),
    }
  }

  private get state(): PetState {
    const model = resolvePetModel(this.store.get('app-settings') as Parameters<typeof resolvePetModel>[0])
    return {
      preferences: this.preferences,
      models: (this.stored.models ?? []).map(({ id, name, galleryId }) => ({ id, name, galleryId })),
      language: asLanguage(this.store.get('language') as string | undefined),
      speechKeyConfigured: !!this.stored.speechKey,
      model: isPetModelConfigured(model) ? model.model : '',
      visible: !!this.window?.isVisible(),
      position: this.stored.position ?? this.geometry(this.preferences).position,
    }
  }

  private get watching(): boolean {
    return !!this.window?.isVisible() && this.preferences.reactToActivity
  }

  private broadcastWatching(): void {
    const watching = this.watching
    for (const editor of this.editors.values()) {
      if (!editor.isDestroyed()) editor.webContents.send('desktop-pet:watching', watching)
    }
  }

  refresh(): void {
    const state = this.state
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('desktop-pet:state', toViewState(state))
    for (const editor of this.editors.values()) {
      if (!editor.isDestroyed()) editor.webContents.send('desktop-pet:state', state)
    }
  }

  openOnStartup(): void {
    if (this.preferences.openOnStartup) this.open()
  }

  private geometry(preferences: PetPreferences, savedPosition = this.stored.position) {
    const display = screen.getDisplayNearestPoint(savedPosition ?? screen.getCursorScreenPoint())
    const area = display.workArea
    const zoom = Math.min(preferences.scale / 100, area.width / PET_WIDTH, area.height / PET_HEIGHT)
    const width = Math.round(PET_WIDTH * zoom)
    const height = Math.round(PET_HEIGHT * zoom)
    const maxX = area.x + area.width - width
    const maxY = area.y + area.height - height
    const useManualPosition = preferences.placement === 'custom' && savedPosition
    const x = useManualPosition ? savedPosition.x : preferences.placement.endsWith('left') ? area.x + 18 : maxX - 18
    const y = useManualPosition ? savedPosition.y : preferences.placement.startsWith('top') ? area.y + 18 : maxY - 18
    const position = {
      x: Math.max(area.x, Math.min(x, maxX)),
      y: Math.max(area.y, Math.min(y, maxY)),
    }
    return { position, bounds: { ...position, width, height }, zoom }
  }

  private open(): void {
    if (this.isQuitting()) return
    if (this.window) {
      if (this.window.isVisible()) this.window.showInactive()
      this.refresh()
      return
    }
    const layout = this.geometry(this.preferences)
    this.targetPosition = layout.position
    const win = new BrowserWindow({
      ...layout.bounds,
      title: PET_WINDOW_TITLE,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: this.preferences.alwaysOnTop,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/desktopPetPreload.js'),
        partition: 'desktop-pet',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    this.window = win
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    win.webContents.session.setPermissionCheckHandler(() => false)
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType !== 'mainFrame') return callback({})
      const devInline = process.env.VITE_DEV_SERVER_URL ? " 'unsafe-inline'" : ''
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [[
            "default-src 'self'",
            `script-src 'self' 'wasm-unsafe-eval'${devInline} https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' blob: data:",
            "media-src 'self' blob:",
          ].join('; ')],
        },
      })
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.once('ready-to-show', () => {
      win.webContents.setZoomFactor(this.geometry(this.preferences).zoom)
      win.showInactive()
    })
    win.on('show', () => {
      this.broadcastWatching()
      this.refresh()
    })
    win.on('move', () => {
      clearTimeout(this.moveTimer)
      this.moveTimer = setTimeout(() => this.savePosition(win), 220)
    })
    win.on('close', () => this.savePosition(win))
    win.on('closed', () => {
      clearTimeout(this.moveTimer)
      this.cancelInteraction()
      this.dragStart = undefined
      this.window = null
      this.lastActivity = -Infinity
      this.broadcastWatching()
      this.refresh()
    })
    const devUrl = process.env.VITE_DEV_SERVER_URL
    const load = devUrl
      ? win.loadURL(new URL('desktop-pet.html', devUrl).href)
      : win.loadFile(path.join(__dirname, '../renderer/desktop-pet.html'))
    void load.catch(() => {
      if (!win.isDestroyed()) win.destroy()
    })
  }

  private savePosition(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    const [x, y] = win.getPosition()
    if (x === this.targetPosition?.x && y === this.targetPosition.y) return
    try {
      this.store.set(STORAGE_KEY, {
        ...this.stored,
        preferences: { ...this.preferences, placement: 'custom' },
        position: { x, y },
      })
      this.targetPosition = { x, y }
      this.refresh()
    } catch {
      // A failed position write must not block window teardown.
    }
  }

  close(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    this.savePosition(win)
    win.destroy()
  }

  private isEditor(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const win = BrowserWindow.fromWebContents(event.sender)
    return !!win && this.editors.has(win.id) && event.senderFrame === event.sender.mainFrame
  }

  private cancelInteraction(): void {
    this.generation?.abort()
    this.speech?.abort()
    this.latest = undefined
    this.pendingActivity = undefined
  }

  private async addModel(install: () => Promise<InstalledPetModel>): Promise<PetState> {
    if ((this.stored.models ?? []).length >= 24) throw new Error('Model library is full')
    const model = await install()
    try {
      this.store.set(STORAGE_KEY, {
        ...this.stored,
        models: [...(this.stored.models ?? []), model],
        preferences: { ...this.preferences, character: model.id },
      })
    } catch (error) {
      await removePetModelFiles(this.root, model.id)
      throw error
    }
    this.cancelInteraction()
    this.refresh()
    return this.state
  }

  register(): void {
    const fromPet = (event: IpcMainEvent | IpcMainInvokeEvent) =>
      this.window?.webContents === event.sender && event.senderFrame === event.sender.mainFrame

    ipcMain.handle('desktop-pet:open', event => {
      if (this.isEditor(event)) this.open()
    })
    ipcMain.handle('desktop-pet:close-from-editor', event => {
      if (this.isEditor(event)) this.close()
    })
    ipcMain.handle('desktop-pet:is-watching', event => this.isEditor(event) && this.watching)
    ipcMain.on('desktop-pet:activity', (event, input: PetActivity) => {
      if (!this.isEditor(event) || !this.watching || this.isQuitting()) return
      const now = performance.now()
      if (now - this.lastActivity < ACTIVITY_COOLDOWN_MS || this.generation) return
      const activity = normalizeActivity(input)
      if (!activity) return
      this.lastActivity = now
      this.pendingActivity = activity
      this.window?.webContents.send('desktop-pet:reaction', 'activity')
    })
    ipcMain.handle('desktop-pet:get-state', event => {
      if (fromPet(event)) return toViewState(this.state)
      if (this.isEditor(event)) return this.state
    })
    ipcMain.handle('desktop-pet:preferences', (event, value: PetPreferences, position?: Point, speechKey?: string | null) => {
      if (!this.isEditor(event) || !value || typeof value !== 'object') return
      const old = this.preferences
      const preferences: PetPreferences = {
        character: ['otter', 'night-otter'].includes(value.character) || this.state.models.some(model => model.id === value.character)
          ? value.character : old.character,
        name: typeof value.name === 'string' ? value.name.trim().slice(0, 32) : old.name,
        salutation: typeof value.salutation === 'string' ? value.salutation.trim().slice(0, 24) : old.salutation,
        personality: value.personality === 'calm' ? 'calm' : 'playful',
        characterPrompt: typeof value.characterPrompt === 'string' ? value.characterPrompt.trim().slice(0, 280) : old.characterPrompt,
        voice: value.voice === 'custom' || value.voice === 'system' ? value.voice : 'off',
        speech: normalizePetSpeech(value.speech ?? old.speech),
        alwaysOnTop: typeof value.alwaysOnTop === 'boolean' ? value.alwaysOnTop : old.alwaysOnTop,
        reactToActivity: typeof value.reactToActivity === 'boolean' ? value.reactToActivity : old.reactToActivity,
        openOnStartup: typeof value.openOnStartup === 'boolean' ? value.openOnStartup : old.openOnStartup,
        scale: Number.isFinite(value.scale) ? Math.max(70, Math.min(150, Math.round(value.scale))) : old.scale,
        placement: PLACEMENTS.has(value.placement) ? value.placement : old.placement,
      }
      if (preferences.voice === 'custom') parsePetSpeechConfig(preferences.speech)
      let encryptedKey = sameSpeechOrigin(old.speech.endpoint, preferences.speech.endpoint) ? this.stored.speechKey : undefined
      if (speechKey === null) encryptedKey = undefined
      else if (typeof speechKey === 'string' && speechKey.trim()) encryptedKey = encryptPetSpeechKey(speechKey.trim().slice(0, 4096))
      const desired = position && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: Math.round(position.x), y: Math.round(position.y) }
        : undefined
      const layout = this.geometry(preferences, desired)
      this.store.set(STORAGE_KEY, { ...this.stored, preferences, position: layout.position, speechKey: encryptedKey })
      clearTimeout(this.moveTimer)
      this.targetPosition = layout.position
      this.window?.setAlwaysOnTop(preferences.alwaysOnTop)
      this.window?.setBounds(layout.bounds)
      this.window?.webContents.setZoomFactor(layout.zoom)
      this.cancelInteraction()
      this.broadcastWatching()
      this.refresh()
      return this.state
    })
    ipcMain.handle('desktop-pet:import', async event => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || !this.isEditor(event) || this.importing) return
      this.importing = true
      try {
        const result = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'Live2D model3.json', extensions: ['json'] }],
        })
        const file = result.filePaths[0]
        return !result.canceled && file ? await this.addModel(() => installPetModel(this.root, file)) : this.state
      } finally {
        this.importing = false
      }
    })
    ipcMain.handle('desktop-pet:install-gallery-model', async (event, id: string) => {
      if (!this.isEditor(event) || this.importing) return
      const entry = PET_GALLERY.find(model => model.id === id)
      if (!entry) return
      const installed = this.stored.models?.find(model => model.galleryId === id)
      if (installed) {
        this.store.set(STORAGE_KEY, { ...this.stored, preferences: { ...this.preferences, character: installed.id } })
        this.cancelInteraction()
        this.refresh()
        return this.state
      }
      this.importing = true
      try {
        return await this.addModel(() => installGalleryPetModel(this.root, entry))
      } finally {
        this.importing = false
      }
    })
    ipcMain.handle('desktop-pet:remove', async (event, id: string) => {
      if (!this.isEditor(event) || !this.state.models.some(model => model.id === id)) return
      const preferences = this.preferences
      this.store.set(STORAGE_KEY, {
        ...this.stored,
        models: this.stored.models?.filter(model => model.id !== id),
        preferences: preferences.character === id ? { ...preferences, character: 'otter' } : preferences,
      })
      if (preferences.character === id) this.cancelInteraction()
      await removePetModelFiles(this.root, id)
      this.refresh()
      return this.state
    })
    ipcMain.handle('desktop-pet:asset', async (event, id: string, asset: string) => {
      if (!fromPet(event) || typeof asset !== 'string' || asset.length > 1024 || this.preferences.character !== id) return
      const model = this.stored.models?.find(entry => entry.id === id)
      if (model) return readPetModelAsset(this.root, model, asset)
    })
    ipcMain.handle('desktop-pet:react', async (event, reaction: unknown, options: unknown): Promise<PetReactionResult> => {
      if (!fromPet(event) || (reaction !== 'activity' && reaction !== 'preview' && reaction !== 'greeting')) return { status: 'skipped' }
      const activity = reaction === 'activity' ? this.pendingActivity : undefined
      this.pendingActivity = undefined
      if (reaction === 'activity' && (!activity || !this.watching || this.generation || performance.now() - this.lastActivity > 3000)) {
        return { status: 'skipped' }
      }
      const config = resolvePetModel(this.store.get('app-settings') as Parameters<typeof resolvePetModel>[0])
      if (!isPetModelConfigured(config)) return { status: 'unavailable' }
      const actions = Array.isArray(options) ? options.slice(0, 36).filter((item): item is PetAction =>
        item && typeof item.id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(item.id)
        && typeof item.label === 'string' && item.label.length <= 100,
      ).map(({ id, label }) => ({ id, label })) : []
      this.generation?.abort()
      const controller = new AbortController()
      this.generation = controller
      try {
        const { language, preferences, models } = this.state
        const character = preferences.name || models.find(model => model.id === preferences.character)?.name || preferences.character
        const result = await generatePetPerformance(config, preferences, language, character, reaction, activity, actions, controller.signal)
        if (controller.signal.aborted || !result) return { status: 'skipped' }
        this.latest = { ...result, id: ++this.nextPerformanceId }
        return { status: 'played', performance: this.latest }
      } catch {
        return { status: controller.signal.aborted ? 'skipped' : 'error' }
      } finally {
        if (this.generation === controller) this.generation = undefined
      }
    })
    ipcMain.handle('desktop-pet:speak', async (event, performanceId: unknown) => {
      const preferences = this.preferences
      if (!fromPet(event) || this.latest?.id !== performanceId || preferences.voice !== 'custom') return null
      const line = this.latest
      if (!line) return null
      this.latest = undefined
      this.speech?.abort()
      const controller = new AbortController()
      this.speech = controller
      try {
        return await synthesizePetSpeech(preferences.speech, line.text, this.stored.speechKey,
          AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]))
      } catch {
        return null
      } finally {
        if (this.speech === controller) this.speech = undefined
      }
    })
    ipcMain.on('desktop-pet:stop-speech', event => {
      if (fromPet(event)) this.speech?.abort()
    })
    ipcMain.on('desktop-pet:drag', (event, phase: unknown) => {
      const win = this.window
      if (!win || !fromPet(event)) return
      if (phase === 'start') {
        const [x, y] = win.getPosition()
        this.dragStart = { cursor: screen.getCursorScreenPoint(), position: { x, y } }
        return
      }
      const drag = this.dragStart
      if (!drag) return
      if (phase === 'end') {
        this.dragStart = undefined
        clearTimeout(this.moveTimer)
        this.savePosition(win)
      }
      if (phase === 'move') {
        const cursor = screen.getCursorScreenPoint()
        win.setPosition(drag.position.x + cursor.x - drag.cursor.x, drag.position.y + cursor.y - drag.cursor.y)
      }
    })
    ipcMain.on('desktop-pet:open-settings', event => {
      if (!fromPet(event)) return
      const win = this.getActiveEditor()
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.webContents.send('desktop-pet:settings-requested')
    })
    ipcMain.on('desktop-pet:close', event => {
      if (fromPet(event)) this.close()
    })
  }
}
