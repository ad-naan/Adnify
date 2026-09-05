// node scripts/diagnostics/background-tasks-smoke.cjs
// Isolated profile, hidden windows, simulated power events; never sleeps the host.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')

if (typeof electron === 'string') {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp/background-tasks-smoke')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
    const esbuild = require('esbuild')
    await esbuild.build({ stdin: { contents: "export { backgroundTaskService } from './src/main/services/backgroundTasks/BackgroundTaskService';", resolveDir: root },
      outfile: path.join(output, 'service.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], tsconfig: path.join(root, 'tsconfig.main.json') })
    await esbuild.build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import { BackgroundTaskSettings } from './src/renderer/components/settings/tabs/BackgroundTaskSettings';
      import { useBackgroundConnections } from './src/renderer/backgroundTasks/connections';
      window.electronAPI.onBackgroundConnections(state => useBackgroundConnections.setState(state));
      createRoot(document.getElementById('root')).render(<BackgroundTaskSettings language={new URLSearchParams(location.search).get('language') === 'en' ? 'en' : 'zh'} />);`, loader: 'tsx', resolveDir: root },
      outfile: path.join(output, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' } })
    const tailwind = require(path.join(root, 'tailwind.config.js'))
    const css = await require('postcss')([require('tailwindcss')({ ...(tailwind.default ?? tailwind),
      content: [path.join(root, 'src/renderer/components/settings/tabs/BackgroundTaskSettings.tsx'), path.join(root, 'src/renderer/components/ui/{Button,Switch}.tsx')] })])
      .process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })
    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(path.join(output, 'ui.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>body{padding:24px;background:rgb(var(--background));color:rgb(var(--text-primary))}#root{width:auto;height:auto}</style><div id="root"></div><script src="ui.js"></script>')
    // Test-only narrow bridge; no real user settings, model endpoints, or MCP servers.
    fs.writeFileSync(path.join(output, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');
      const on=(channel,callback)=>{const handler=(_,value)=>callback(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler)};
      contextBridge.exposeInMainWorld('electronAPI',{
        getSetting:key=>ipcRenderer.invoke('smoke:get',key), setSetting:(key,value)=>ipcRenderer.invoke('smoke:set',key,value),
        onSettingsChanged:cb=>on('settings:changed',cb),
        backgroundTasksCheck:()=>ipcRenderer.invoke('smoke:check'),
        onBackgroundConnections:cb=>on('backgroundTasks:connections',cb),
        mcpReconnectServer:id=>ipcRenderer.invoke('smoke:reconnect',id)
      });`)
    const env = { ...process.env, ADNIFY_BACKGROUND_SMOKE: output }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(electron, [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 60000 })
    console.log(`Artifacts: ${output}`)
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
} else {
  const { app, BrowserWindow, ipcMain, powerMonitor, powerSaveBlocker } = electron
  const output = process.env.ADNIFY_BACKGROUND_SMOKE
  app.setPath('userData', path.join(output, 'profile'))
  app.on('window-all-closed', () => {})
  const { backgroundTaskService: service } = require(path.join(output, 'service.cjs'))
  const windows = []
  const blockers = []
  const realStart = powerSaveBlocker.start.bind(powerSaveBlocker)
  powerSaveBlocker.start = type => { const id = realStart(type); blockers.push(id); return id }
  let settings = { taskbarProgress: true, preventIdleSleep: false, checkConnectionsOnResume: true }
  let failed = true
  let checks = 0
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 80; attempt++) { if (await predicate()) return; await pause(100) }
    throw new Error(`Timed out: ${label}`)
  }
  const timeout = setTimeout(() => { service.stop(); console.error('Background smoke timed out'); app.exit(1) }, 45000)
  app.whenReady().then(async () => {
    service.start(() => settings, async () => {
      checks++
      return { checkedAt: Date.now(), model: failed ? 'unreachable' : 'reachable',
        mcp: { checked: 1, failed: failed ? [{ id: 'fixture', name: 'Example MCP' }] : [] }, checkFailed: false }
    })
    ipcMain.handle('smoke:get', (_event, key) => key === 'backgroundTaskSettings' ? settings : undefined)
    ipcMain.handle('smoke:set', (_event, key, value) => {
      assert.equal(key, 'backgroundTaskSettings')
      settings = value
      service.refresh()
      windows.filter(win => !win.isDestroyed()).forEach(win => win.webContents.send('settings:changed', { key, value }))
      return true
    })
    ipcMain.handle('smoke:check', event => service.check(BrowserWindow.fromWebContents(event.sender)))
    ipcMain.handle('smoke:reconnect', (_event, id) => { assert.equal(id, 'fixture'); failed = false; return { success: true } })
    const create = async language => {
      const win = new BrowserWindow({ show: false, skipTaskbar: true, width: 720, height: 680,
        webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
          backgroundThrottling: false, preload: path.join(output, 'preload.cjs') } })
      windows.push(win)
      win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message) })
      await win.loadFile(path.join(output, 'ui.html'), { query: { language } })
      await waitFor(async () => (await win.webContents.executeJavaScript('document.querySelectorAll("input").length')) === 3, 'settings controls')
      return win
    }
    const first = await create('zh'), second = await create('en')
    const presentations = []
    const nativeProgress = first.setProgressBar.bind(first)
    first.setProgressBar = (value, options) => { presentations.push({ value, options }); return nativeProgress(value, options) }
    service.update(first, { state: 'running' })
    assert.equal(blockers.length, 0)
    assert.equal(presentations.at(-1).options.mode, 'indeterminate')
    await first.webContents.executeJavaScript('document.querySelectorAll("input")[1].click()')
    await waitFor(() => blockers.length === 1 && powerSaveBlocker.isStarted(blockers[0]), 'native power blocker')
    await waitFor(async () => second.webContents.executeJavaScript('document.querySelectorAll("input")[1].checked'), 'cross-window preference sync')
    service.update(second, { state: 'running', progress: 0.5 })
    service.update(first, { state: 'paused', progress: 0.5 })
    assert(powerSaveBlocker.isStarted(blockers[0]))
    service.update(second, { state: 'idle' })
    assert(!powerSaveBlocker.isStarted(blockers[0]))
    console.log('PASS: real power blocker, native progress calls, approval release, cross-window settings')
    powerMonitor.emit('resume')
    await waitFor(() => checks === 2 && !service.getConnections(first).checking, 'simulated wake checks')
    await waitFor(async () => (await first.webContents.executeJavaScript('document.body.innerText')).includes('Example MCP'), 'recovery report')
    for (const [window, language] of [[first, 'zh'], [second, 'en']]) {
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      fs.writeFileSync(path.join(output, `background-${language}.png`), (await window.webContents.capturePage()).toPNG())
    }
    await first.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(button => button.innerText === "重新连接").click()')
    await waitFor(() => service.getConnections(first).report?.model === 'reachable', 'explicit MCP recovery')
    assert.equal(service.getConnections(first).report.mcp.failed.length, 0)
    console.log('PASS: wake report renders in both languages and explicit reconnect clears failure')
    service.update(first, { state: 'running' })
    assert(powerSaveBlocker.isStarted(blockers.at(-1)))
    console.log('Checking reload cleanup')
    await first.reload()
    await waitFor(() => !powerSaveBlocker.isStarted(blockers.at(-1)), 'reload releases blocker')
    console.log('Checking window destruction cleanup')
    service.update(second, { state: 'running' })
    second.destroy()
    assert(!powerSaveBlocker.isStarted(blockers.at(-1)))
    console.log('PASS: real navigation and window destruction release sleep prevention')
    service.stop()
    windows.filter(win => !win.isDestroyed()).forEach(win => win.destroy())
    clearTimeout(timeout)
    app.exit(0)
  }).catch(error => {
    console.error(error)
    service.stop()
    windows.filter(win => !win.isDestroyed()).forEach(win => win.destroy())
    clearTimeout(timeout)
    app.exit(1)
  })
}
