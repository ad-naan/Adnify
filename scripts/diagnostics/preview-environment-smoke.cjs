// Real BrowserPreviewTab + IPC + webview, with fixture workspace/discovery data.
// node scripts/diagnostics/preview-environment-smoke.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')

if (typeof electron === 'string') {
  (async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp', 'preview-environment-smoke')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
    const esbuild = require('esbuild')
    await esbuild.build({ stdin: { contents: "export { registerPreviewHandlers } from './src/main/ipc/preview'; export { registerWebviewGuards } from './src/main/security/webviewGuard'; export { previewBrowserService } from './src/main/services/previewBrowserService';", resolveDir: root },
      outfile: path.join(output, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], tsconfig: path.join(root, 'tsconfig.main.json') })
    const fixtures = {
      store: `const params = new URLSearchParams(location.search); const state = { workspace: { roots: [params.get('project')] }, language: params.get('language') || 'zh', openPreview() {}, updatePreviewMetadata() {} }; export const useStore = Object.assign(selector => selector(state), { getState: () => state });`,
      discovery: `const state = { scanning: false, candidates: [] }; export const devServerDiscoveryService = { getState: () => state, subscribe: fn => { fn(state); return () => {} }, getCandidatesForWorkspace: () => [], refresh: async () => {}, getPreferredCandidate: () => null, registerManualUrl() {} };`,
      api: `export const api = { preview: { ...window.smoke.preview, configureDevice: async request => { const result = await window.smoke.preview.configureDevice(request); if (result.success) window.deviceApplied = request; return result; } }, clipboard: { writeText: async () => {} }, settings: { get: async key => JSON.parse(localStorage.getItem(key) || 'null'), set: async (key, value) => localStorage.setItem(key, JSON.stringify(value)) } };`,
    }
    await esbuild.build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import BrowserPreviewTab from './src/renderer/components/editor/BrowserPreviewTab';
      const params = new URLSearchParams(location.search); const id = params.get('id'); const file = { path: 'preview://session/' + id, kind: 'preview', preview: { sessionId: id, url: params.get('url'), title: 'Preview fixture', source: 'manual', workspaceRoot: params.get('project') } };
      createRoot(document.getElementById('root')).render(<BrowserPreviewTab file={file} />);`, loader: 'tsx', resolveDir: root },
      outfile: path.join(output, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"./"' },
      plugins: [{ name: 'fixture-app-context', setup(build) {
        build.onResolve({ filter: /^@store$|(?:^|\/)devServerDiscoveryService$|\/services\/electronAPI$/ }, args => ({
          path: args.path === '@store' ? 'store' : args.path.endsWith('devServerDiscoveryService') ? 'discovery' : 'api', namespace: 'fixture',
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'js' }))
      } }] })
    const tailwind = require(path.join(root, 'tailwind.config.js'))
    const css = await require('postcss')([require('tailwindcss')({ ...(tailwind.default ?? tailwind), content: [path.join(root, 'src/renderer/components/editor/{BrowserPreviewTab,PreviewDeviceToolbar}.tsx'), path.join(root, 'src/renderer/components/ui/Button.tsx')] })])
      .process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })
    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(path.join(output, 'ui.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>')
    fs.writeFileSync(path.join(output, 'preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('smoke', { preview: {
      prepareSession: workspaceRoot => ipcRenderer.invoke('preview:prepareSession', { workspaceRoot }),
      configureDevice: request => ipcRenderer.invoke('preview:configureDevice', request),
      openExternal: () => Promise.resolve(false),
    } });
    ipcRenderer.on('smoke:click', (_event, { requestId, label }) => {
      try {
        const button = [...document.querySelectorAll('button')].find(button =>
          button.textContent.trim() === label || button.getAttribute('aria-label') === label);
        if (!button) throw new Error('Button missing: ' + label);
        button.click();
        ipcRenderer.send('smoke:clicked', { requestId });
      } catch (error) {
        ipcRenderer.send('smoke:clicked', { requestId, error: String(error) });
      }
    });`)
    const env = { ...process.env, ADNIFY_PREVIEW_SMOKE: output }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(electron, [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 60000 })
    console.log(`Artifacts: ${output}`)
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
  const { app, BrowserWindow, ipcMain } = electron
  const output = process.env.ADNIFY_PREVIEW_SMOKE
  app.setPath('userData', path.join(output, 'profile'))
  app.on('window-all-closed', () => {})
  const { registerPreviewHandlers, registerWebviewGuards, previewBrowserService } = require(path.join(output, 'main.cjs'))
  const windows = [], roots = new Map()
  let server
  const timeout = setTimeout(() => { console.error('Preview environment smoke timed out'); app.exit(1) }, 45000)
  const wait = async (fn, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const result = await fn(); if (result) return result } catch { /* Renderer may still be loading. */ }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${label}`)
  }
  const guestOf = window => electron.webContents.fromId(previewBrowserService.list(window.webContents.id)[0]?.id || -1)
  const metrics = guest => guest.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints,value:document.querySelector("#keep").value})')
  let nextClickId = 0
  // Button labels cross IPC as data; they are never interpolated into executable code.
  const click = (window, label) => new Promise((resolve, reject) => {
    const requestId = ++nextClickId
    const cleanup = () => { clearTimeout(timer); ipcMain.removeListener('smoke:clicked', onClicked) }
    const onClicked = (event, result) => {
      if (event.sender !== window.webContents || result.requestId !== requestId) return
      cleanup()
      if (result.error) reject(new Error(result.error)); else resolve()
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Click timed out: ' + label)) }, 5000)
    ipcMain.on('smoke:clicked', onClicked)
    try { window.webContents.send('smoke:click', { requestId, label }) }
    catch (error) { cleanup(); reject(error) }
  })
  const screenshot = async (window, name) => {
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG())
  }
  app.whenReady().then(async () => {
    server = require('node:http').createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fieldnotes</title>
        <style>*{box-sizing:border-box}body{margin:0;background:#f5f3ef;color:#283d36;font:16px system-ui;padding:32px}header{display:flex;justify-content:space-between;font-size:14px}h1{font-size:clamp(32px,6vw,60px);line-height:1.1;letter-spacing:-2px;margin:56px 0 20px}p{line-height:1.7;color:#66736c}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:32px}.card{background:#e4e9df;border-radius:16px;padding:24px;min-height:130px}.card:nth-child(2){background:#ebe4d8}.card:nth-child(3){background:#dce6e5}input{border:1px solid #bdc8bd;border-radius:8px;padding:12px;max-width:100%;background:transparent}small{font-size:11px;letter-spacing:2px}@media(max-width:600px){body{padding:24px}h1{margin-top:40px}.grid{grid-template-columns:1fr}.card{min-height:90px;padding:18px}}</style>
        <header><b>Fieldnotes.</b><span>Issue 04</span></header><h1>A little room<br>for better ideas.</h1><p>A responsive fixture for your next project.<br>Change the device and keep exploring.</p><input id="keep" placeholder="Keep a thought here"><div class="grid"><div class="card"><small>01 / DISCOVER</small><h3>Find your focus</h3></div><div class="card"><small>02 / CREATE</small><h3>Make it yours</h3></div><div class="card"><small>03 / REFINE</small><h3>Mind the details</h3></div></div>`)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}`
    registerPreviewHandlers(id => roots.get(id) || null)
    const create = async (project, language = 'zh') => {
      const window = new BrowserWindow({ show: false, width: 1024, height: 900, webPreferences: {
        offscreen: true, webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, preload: path.join(output, 'preload.cjs'),
      } })
      windows.push(window)
      roots.set(window.webContents.id, [project])
      registerWebviewGuards(window)
      await window.loadFile(path.join(output, 'ui.html'), { query: { project, language, url, id: String(window.id) } })
      await wait(async () => { const guest = guestOf(window); return guest && (await metrics(guest)) && guest }, 'preview mounted')
      return window
    }
    const projectA = path.join(output, 'project-a'), projectB = path.join(output, 'project-b')
    const first = await create(projectA)
    const guest = guestOf(first)
    await guest.executeJavaScript('document.querySelector("#keep").value = "retained"; document.cookie = "project=A;path=/"; localStorage.setItem("project", "A")')
    await click(first, '手机')
    await wait(async () => { const m = await metrics(guest); return m.width === 390 && m.height === 844 && m.dpr === 3 && m.touch === 5 }, 'phone metrics')
    await screenshot(first, 'phone-zh.png')
    await click(first, '切换横竖屏')
    await wait(async () => (await metrics(guest)).width === 844, 'landscape')
    first.setSize(560, 650)
    await wait(async () => first.webContents.executeJavaScript('(() => { const view = document.querySelector("webview").getBoundingClientRect(); const parent = document.querySelector("webview").parentElement.getBoundingClientRect(); return view.width <= parent.width && view.height <= parent.height && Math.abs(window.deviceApplied.scale - view.width / 844) < 0.002; })()'), 'fit narrow pane')
    assert.equal((await metrics(guest)).width, 844)
    await screenshot(first, 'landscape-narrow-zh.png')
    await click(first, '平板')
    await wait(async () => { const m = await metrics(guest); return m.width === 1180 && m.height === 820 && m.dpr === 2 }, 'tablet metrics')
    await click(first, '桌面')
    await wait(async () => (await metrics(guest)).touch === 0, 'desktop restored')
    assert.equal((await metrics(guest)).value, 'retained')
    console.log('PASS: actual preview controls, native metrics, narrow-pane fit and form retention')
    const same = await create(projectA, 'en')
    const other = await create(projectB, 'en')
    const storage = window => guestOf(window).executeJavaScript('({cookie:document.cookie,value:localStorage.getItem("project")})')
    assert.deepEqual(await storage(same), { cookie: 'project=A', value: 'A' })
    assert.deepEqual(await storage(other), { cookie: '', value: null })
    await guestOf(other).executeJavaScript('document.cookie="project=B;path=/";localStorage.setItem("project","B")')
    assert.deepEqual(await storage(first), { cookie: 'project=A', value: 'A' })
    assert.equal(guestOf(first).session, guestOf(same).session)
    assert.notEqual(guestOf(first).session, guestOf(other).session)
    assert.equal(guestOf(other).getLastWebPreferences().sandbox, true)
    await click(other, 'Tablet')
    await wait(async () => (await metrics(guestOf(other))).dpr === 2, 'English tablet controls')
    await screenshot(other, 'tablet-en.png')
    first.destroy()
    const reopened = await create(projectA)
    assert.deepEqual(await storage(reopened), { cookie: 'project=A', value: 'A' })
    await wait(async () => { const m = await metrics(guestOf(reopened)); return m.width === 1180 && m.height === 820 && m.dpr === 2 }, 'saved device preference restored').catch(async error => {
      console.error('Restored metrics', await metrics(guestOf(reopened)), await reopened.webContents.executeJavaScript('({device:window.deviceApplied,settings:localStorage.getItem("previewSettings")})'))
      throw error
    })
    console.log('PASS: same-project storage sharing, cross-project Cookie/localStorage isolation, reopening and English UI')
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
    server.close()
    clearTimeout(timeout)
    app.exit(0)
  }).catch(error => {
    console.error(error)
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
    server?.close()
    clearTimeout(timeout)
    app.exit(1)
  })
}
