// Run with: node scripts/diagnostics/preview-browser-smoke.cjs
// Exercises a real sandboxed Electron webview, without launching the editor.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')

if (typeof electron === 'string') {
  const root = path.resolve(__dirname, '../..')
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'adnify-browser-smoke-'))
  const bundle = path.join(directory, 'service.cjs')
  require('esbuild').buildSync({ stdin: { contents: "export { previewBrowserService } from './src/main/services/previewBrowserService'; export { registerWebviewGuards } from './src/main/security/webviewGuard';", resolveDir: root },
    outfile: bundle, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], tsconfig: path.join(root, 'tsconfig.main.json') })
  const env = { ...process.env, ADNIFY_BROWSER_SMOKE_BUNDLE: bundle }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(electron, [__filename], { env, stdio: 'inherit', windowsHide: true, timeout: 45000 })
  fs.unlinkSync(bundle)
  fs.rmdirSync(directory)
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = electron
app.on('window-all-closed', () => {})
const { previewBrowserService: service, registerWebviewGuards } = require(process.env.ADNIFY_BROWSER_SMOKE_BUNDLE)
app.commandLine.appendSwitch('host-resolver-rules', 'MAP preview-smoke.test 127.0.0.1')
const { createServer } = require('node:http')
let window, server
const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1) }, 35000)

app.whenReady().then(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html')
    if (req.url === '/missing') { res.writeHead(404); return res.end('missing') }
    if (req.url === '/host') return res.end(require('react-dom/server').renderToStaticMarkup(require('react').createElement('webview', {
      allowpopups: '', src: `http://preview-smoke.test:${server.address().port}/page`, style: { display: 'flex', width: 800, height: 600 },
    })))
    res.end(`<!doctype html><title>Browser fixture</title><style>#save{color:rgb(12,34,56);padding:12px} body{height:1800px}</style>
      <input id="name"><button id="save">Save</button><div id="result">waiting</div><button id="disabled" disabled>Disabled</button><a id="next" href="/next" target="_blank">Next page</a>
      <script>
      document.querySelector('#name').addEventListener('input', e => document.querySelector('#result').textContent = e.target.value);
      document.querySelector('#save').addEventListener('click', e => { document.querySelector('#result').textContent = e.isTrusted ? 'trusted click' : 'synthetic'; console.error('fixture-console'); fetch('/missing'); setTimeout(() => { throw new Error('fixture-exception') }, 5); });
      document.querySelector('#name').addEventListener('keydown', e => { if (e.key === 'Enter') document.querySelector('#result').textContent = 'entered'; });
      </script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  window = new BrowserWindow({ show: false, opacity: 0, skipTaskbar: true, width: 900, height: 700, webPreferences: { webviewTag: true, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } })
  // A mapped but invisible window gives Chromium a compositor/input surface.
  window.showInactive()
  registerWebviewGuards(window)
  await window.webContents.session.setProxy({ mode: 'direct' })
  const ready = new Promise(resolve => window.webContents.once('did-attach-webview', (_event, guest) => {
    guest.once('did-finish-load', () => resolve(guest))
  }))
  await window.loadURL(`http://127.0.0.1:${server.address().port}/host`)
  const guest = await ready
  // The test window intentionally remains hidden; simulate focus for keyboard events.
  await guest.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  console.log('Smoke: guest loaded')
  const owner = window.webContents.id
  await service.inspect(owner, { action: 'screenshot' })
  assert.equal(service.list(owner).length, 1)
  const dom = await service.inspect(owner, { action: 'dom' })
  assert(dom.elements.some(e => e.selector === '#save'))
  const styles = await service.inspect(owner, { action: 'styles', selector: '#save' })
  console.log('Smoke: DOM and styles read')
  assert.equal(styles.computed.color, 'rgb(12, 34, 56)')
  const value = 'hello "quotes" ${literal} <markup>'
  await service.act(owner, { action: 'fill', selector: '#name', text: value })
  assert.equal(await guest.executeJavaScript('document.querySelector("#result").textContent'), value)
  await service.act(owner, { action: 'press', selector: '#name', key: 'Enter' })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await guest.executeJavaScript('document.querySelector("#result").textContent'), 'entered')
  await assert.rejects(service.act(owner, { action: 'click', selector: 'button' }), /exactly one/)
  await assert.rejects(service.act(owner, { action: 'click', selector: '#disabled' }), /disabled/)
  await service.act(owner, { action: 'click', selector: '#save' })
  await new Promise(resolve => setTimeout(resolve, 100))
  console.log('Smoke: fill, keys and click dispatched')
  assert.equal(await guest.executeJavaScript('document.querySelector("#result").textContent'), 'trusted click')
  await service.act(owner, { action: 'wait_for', selector: '#result' })
  await assert.rejects(service.act(owner, { action: 'wait_for', selector: '#absent', timeout_ms: 100 }), /Timed out/)
  await service.act(owner, { action: 'scroll', y: 300 })
  assert(await guest.executeJavaScript('scrollY') > 0)
  const screenshot = await service.inspect(owner, { action: 'screenshot' })
  console.log('Smoke: screenshot captured')
  assert(Buffer.from(screenshot.image, 'base64').length > 100)
  const diagnostics = await service.inspect(owner, { action: 'diagnostics' })
  assert(diagnostics.records.some(r => r.message.includes('fixture-console')))
  assert(diagnostics.records.some(r => r.message.includes('fixture-exception')))
  assert(diagnostics.records.some(r => r.kind === 'http-error' && r.status === 404))
  await assert.rejects(service.act(owner + 1000, { action: 'click', target_id: guest.id, selector: '#save' }), /another window/)
  await assert.rejects(service.act(owner, { action: 'navigate', url: 'file:///etc/passwd' }), /HTTP\(S\)/)
  await service.act(owner, { action: 'reload' })
  const refreshed = await service.inspect(owner, { action: 'dom', selector: '#result' })
  assert(refreshed.html.includes('waiting'))
  const navigated = new Promise(resolve => guest.once('did-finish-load', resolve))
  await service.act(owner, { action: 'click', selector: '#next' })
  await navigated
  assert(guest.getURL().endsWith('/next'))
  assert.equal(service.list(owner).length, 1)
  window.destroy()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(service.list(owner).length, 0)
  console.log('PASS: external-domain webview, DOM, styles, fill, trusted click, keys, scroll, wait/timeout, screenshot, errors, reload, new-window links, owner isolation and cleanup')
  server.close()
  clearTimeout(timeout)
  app.exit(0)
}).catch(error => {
  console.error(error)
  window?.destroy()
  server?.close()
  clearTimeout(timeout)
  app.exit(1)
})
