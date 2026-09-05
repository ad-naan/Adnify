// node scripts/diagnostics/performance-smoke.cjs
// Uses an isolated profile and keeps reports/screenshots in .tmp/performance-smoke.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')

if (typeof electron === 'string') {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp', 'performance-smoke')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
    const esbuild = require('esbuild')
    await esbuild.build({ stdin: { contents: "export { applicationDiagnostics } from './src/main/services/diagnostics/ApplicationDiagnostics'; export { processDiagnostics } from './src/main/services/diagnostics/ProcessDiagnostics';", resolveDir: root },
      outfile: path.join(output, 'services.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], tsconfig: path.join(root, 'tsconfig.main.json') })
    await esbuild.build({ stdin: { contents: "import React from 'react'; import { createRoot } from 'react-dom/client'; import { DiagnosticsSettings } from './src/renderer/components/settings/tabs/DiagnosticsSettings'; createRoot(document.getElementById('root')).render(<DiagnosticsSettings language={new URLSearchParams(location.search).get('language') === 'en' ? 'en' : 'zh'} />);", loader: 'tsx', resolveDir: root },
      outfile: path.join(output, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' } })
    const tailwind = require(path.join(root, 'tailwind.config.js'))
    const css = await require('postcss')([require('tailwindcss')({ ...(tailwind.default ?? tailwind),
      content: [path.join(root, 'src/renderer/components/settings/tabs/DiagnosticsSettings.tsx'), path.join(root, 'src/renderer/components/ui/{Button,Switch}.tsx')] })])
      .process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })
    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(path.join(output, 'ui.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>body{padding:24px;background:rgb(var(--background));color:rgb(var(--text-primary))}#root{width:auto;height:auto}</style><div id="root"></div><script src="ui.js"></script>')
    const env = { ...process.env, ADNIFY_DIAGNOSTICS_SMOKE: output }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(electron, [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 60000 })
    console.log(`Artifacts: ${output}`)
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
} else {
  const { app, BrowserWindow, dialog, shell } = electron
  const output = process.env.ADNIFY_DIAGNOSTICS_SMOKE
  app.setPath('userData', path.join(output, 'profile'))
  app.on('window-all-closed', () => {})
  const { applicationDiagnostics, processDiagnostics } = require(path.join(output, 'services.cjs'))
  const timeout = setTimeout(() => { console.error('Electron diagnostics smoke timed out'); app.exit(1) }, 45000)
  const windows = []
  const waitForText = async (window, text) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await window.webContents.executeJavaScript('document.body.innerText')).includes(text)) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Settings did not render: ${text}`)
  }
  app.whenReady().then(async () => {
    const reportRoot = path.join(output, 'reports')
    fs.mkdirSync(reportRoot)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [reportRoot] })
    shell.showItemInFolder = () => {}
    const options = { show: false, skipTaskbar: true, width: 640, height: 430,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }
    const first = new BrowserWindow(options)
    const second = new BrowserWindow(options)
    windows.push(first, second)
    await first.loadFile(path.join(output, 'ui.html'))
    await second.loadFile(path.join(output, 'ui.html'), { query: { language: 'en' } })
    await waitForText(first, '性能诊断')
    await waitForText(second, 'Performance diagnostics')
    // Offscreen rendering keeps screenshot capture independent of desktop occlusion.
    await first.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await second.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    fs.writeFileSync(path.join(output, 'diagnostics-zh.png'), (await first.webContents.capturePage()).toPNG())
    fs.writeFileSync(path.join(output, 'diagnostics-en.png'), (await second.webContents.capturePage()).toPNG())
    console.log('PASS: Chinese and English settings render')
    processDiagnostics.start()
    const memory = await applicationDiagnostics.capture(first, { kind: 'memory' }, 'zh')
    assert.equal(memory.success, true)
    const report = JSON.parse(fs.readFileSync(path.join(memory.directory, 'process-memory.json'), 'utf8'))
    const latest = report.recentSamples.at(-1)
    assert(!latest.unavailable)
    const mapped = latest.processes.flatMap(process => process.contents.map(contents => contents.webContentsId))
    assert(mapped.includes(first.webContents.id))
    assert(mapped.includes(second.webContents.id))
    assert(latest.processes.some(process => process.type === 'GPU'))
    console.log('PASS: real process metrics identify both windows and the GPU')
    const tracing = await applicationDiagnostics.capture(first, { kind: 'trace', includeHeapProfiling: true }, 'zh')
    assert.equal(tracing.success, true)
    const tracePath = path.join(tracing.directory, 'trace.json')
    const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'))
    assert(trace.traceEvents.length > 0)
    assert(trace.traceEvents.some(event => String(event.cat).includes('memory-infra')))
    const tracedMemory = JSON.parse(fs.readFileSync(path.join(tracing.directory, 'process-memory.json'), 'utf8'))
    assert.equal(tracedMemory.recordingSamples.length, 10)
    console.log(`PASS: 10-second native trace with allocation data (${fs.statSync(tracePath).size} bytes)`)
    processDiagnostics.stop()
    await applicationDiagnostics.stop()
    windows.forEach(window => window.destroy())
    clearTimeout(timeout)
    app.exit(0)
  }).catch(error => { console.error(error); processDiagnostics.stop(); windows.forEach(window => window.destroy()); clearTimeout(timeout); app.exit(1) })
}
