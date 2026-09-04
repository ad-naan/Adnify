/** Run with Node after a build: loads the actual IPC bundle in an isolated, hidden Electron window. */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
    env, windowsHide: true, stdio: 'inherit', timeout: 45000,
  })
  if (child.error) console.error(child.error.message)
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow, protocol, net, nativeImage } = require('electron')
protocol.registerSchemesAsPrivileged([{ scheme: 'adnify-asset', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
const root = path.resolve(__dirname, '../..')
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true })
const profile = fs.mkdtempSync(path.join(root, 'tmp', 'ipc-startup-'))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.disableHardwareAcceleration()
const timeout = setTimeout(() => { console.error('IPC startup check timed out'); app.exit(1) }, 30000)

app.whenReady().then(async () => {
  const mainPath = path.join(root, 'dist/main/main.js')
  const main = fs.readFileSync(mainPath, 'utf8')
  const match = main.match(/["'`](\.\/ipc-[^"'`]+\.js)["'`]/)
  if (!match) throw new Error('Cannot locate the built IPC entry in dist/main/main.js')
  const bundle = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(mainPath), match[1])
  console.log(`IPC bundle: ${path.basename(bundle)}`)
  const ipc = require(bundle)
  const Store = require('electron-store')
  const store = new Store({ cwd: profile, name: 'smoke', defaults: { language: 'en' } })
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(root, 'dist/preload/preload.js'), contextIsolation: true, sandbox: false },
  })
  ipc.registerAllHandlers({
    getMainWindow: () => win, createWindow: () => win, resolveStore: () => store,
    preferencesStore: store, workspaceMetaStore: store, bootstrapStore: store,
    getWindowWorkspace: () => [profile],
  })
  await win.loadURL('data:text/html,<title>IPC startup check</title>')
  const result = await win.webContents.executeJavaScript(`(async () => {
    const language = await window.electronAPI.getSetting('language');
    const assets = await window.electronAPI.assetRequest({ type: 'snapshot' });
    return { language, assetsReady: assets.ok, capabilities: assets.value?.capabilities?.length, error: assets.error };
  })()`)
  if (result.language !== 'en' || !result.assetsReady || result.capabilities !== 0) throw new Error(JSON.stringify(result))
  if (!store.get('assetConfiguration') || !store.get('settingsPersistence.assetConfigMigrated')) throw new Error('Asset configuration is not in the application settings store')
  const { DatabaseSync: MigrationDatabase } = require('node:sqlite')
  const migrationDb = new MigrationDatabase(path.join(profile, 'assets/assets.sqlite'), { readOnly: true })
  const legacy = migrationDb.prepare("SELECT count(*) AS total FROM records WHERE collection IN ('settings','capability','secret')").get()
  migrationDb.close()
  if (legacy.total !== 0) throw new Error('New asset configuration was written to SQLite')
  const projectStorage = await win.webContents.executeJavaScript(`window.electronAPI.assetRequest({ type: 'useProjectStorage' })`)
  if (!projectStorage.ok || !fs.statSync(path.join(profile, '.adnify/assets')).isDirectory()) throw new Error('Project storage creation failed')
  // Also exercise the late native dependency in Electron, without a provider or remote request.
  // Do not preload sharp here: the IPC path must perform its first native load itself.
  const png = nativeImage.createFromBitmap(Buffer.alloc(3 * 2 * 4, 255), { width: 3, height: 2 }).toPNG()
  fs.writeFileSync(path.join(profile, 'reference.png'), png)
  const imageResult = await win.webContents.executeJavaScript(`(async () => {
    const imported = await window.electronAPI.assetRequest({ type: 'import', path: 'reference.png' });
    if (!imported.ok) throw new Error(imported.error);
    const preview = await window.electronAPI.assetRequest({ type: 'preview', id: imported.value.id });
    const history = await window.electronAPI.assetRequest({ type: 'history', kind: 'references', page: 1 });
    if (!history.ok || history.value.total !== 1 || history.value.pageSize !== 6) throw new Error('History paging failed');
    const removed = await window.electronAPI.assetRequest({ type: 'removeHistory', kind: 'references', id: imported.value.id });
    if (!removed.ok || removed.value !== 1) throw new Error('History removal failed');
    const empty = await window.electronAPI.assetRequest({ type: 'history', kind: 'references', page: 2 });
    if (!empty.ok || empty.value.total !== 0 || empty.value.page !== 1) throw new Error('History removal was not persisted');
    const retained = await window.electronAPI.assetRequest({ type: 'preview', id: imported.value.id });
    if (!retained.ok || !retained.value) throw new Error('History removal deleted the image');
    const cleared = await window.electronAPI.assetRequest({ type: 'clearHistory', kind: 'jobs' });
    if (!cleared.ok || cleared.value !== 0) throw new Error('Empty history clear failed');
    return { ok: preview.ok, isImage: typeof preview.value === 'string' && preview.value.startsWith('data:image/webp;base64,') };
  })()`)
  if (!imageResult.ok || !imageResult.isImage) throw new Error('Native asset preview check failed')
  if (!require.cache[require.resolve('sharp')]) throw new Error('Asset image processing did not use the native CommonJS entry')
  // Seed isolated storage with a tiny media fixture, then test the actual registered protocol.
  const { DatabaseSync } = require('node:sqlite')
  const database = new DatabaseSync(path.join(profile, 'assets/assets.sqlite'))
  fs.writeFileSync(path.join(profile, '.adnify/assets/test.webm'), '0123456789')
  const media = { id: 'smoke-video', workspace: fs.realpathSync(profile), root: fs.realpathSync(path.join(profile, '.adnify/assets')), relativePath: 'test.webm', kind: 'video', mimeType: 'video/webm', bytes: 10, name: 'test.webm', sha256: 'fixture', createdAt: Date.now() }
  database.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?)').run('asset', media.id, JSON.stringify(media))
  database.close()
  const playback = await win.webContents.executeJavaScript(`window.electronAPI.assetRequest({ type: 'mediaPreview', id: 'smoke-video' })`)
  if (!playback.ok || !playback.value.url) throw new Error('Media URL unavailable')
  const response = await net.fetch(playback.value.url, { headers: { Range: 'bytes=3-6' } })
  if (response.status !== 206 || await response.text() !== '3456') throw new Error('Media range protocol failed')
  const invalid = await net.fetch('adnify-asset://unregistered/media')
  if (invalid.status !== 404) throw new Error('Media access must require a registered token')
  console.log('PASS: built IPC; settings; project storage; native image preview; scoped media range protocol.')
  ipc.cleanupAllHandlers()
  win.destroy()
  clearTimeout(timeout)
  app.exit(0)
}).catch(error => {
  console.error(error.stack || error)
  clearTimeout(timeout)
  app.exit(1)
})
