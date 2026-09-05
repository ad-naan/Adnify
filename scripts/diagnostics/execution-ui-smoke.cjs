// Hidden Electron UI fixture: isolated settings and logs, no user processes or credentials.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')
const root = path.resolve(__dirname, '../..')
if (typeof electron === 'string') {
  ;(async () => {
    const parent = path.join(root, '.tmp/execution-ui-smoke')
    fs.mkdirSync(parent, { recursive: true })
    const output = fs.mkdtempSync(path.join(parent, 'run-'))
    const esbuild = require('esbuild')
    await esbuild.build({ stdin: { contents: `export { ExecutionService } from './src/main/services/execution/ExecutionService'; export { ExecutionLogStore } from './src/main/services/execution/ExecutionLogStore'; export { normalizeExecutionSettings } from './src/shared/config/executionSettings';`, resolveDir: root },
      outfile: path.join(output, 'services.cjs'), bundle: true, platform: 'node', format: 'cjs', tsconfig: path.join(root, 'tsconfig.main.json') })
    await esbuild.build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { ExecutionManager } from './src/renderer/components/panels/ExecutionManager';
      const query = new URLSearchParams(location.search); createRoot(document.getElementById('root')).render(<ExecutionManager language={query.get('language') === 'en' ? 'en' : 'zh'} initialTab={query.get('tab') || 'running'} onClose={() => {}} />);`, loader: 'tsx', resolveDir: root },
      outfile: path.join(output, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' } })
    const tailwind = require(path.join(root, 'tailwind.config.js'))
    const css = await require('postcss')([require('tailwindcss')({ ...(tailwind.default || tailwind), content: [path.join(root, 'src/renderer/components/panels/ExecutionManager.tsx'), path.join(root, 'src/renderer/components/ui/Modal.tsx')] })])
      .process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })
    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(path.join(output, 'ui.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>body{background:rgb(var(--background));color:rgb(var(--text-primary))}</style><div id="root"></div><script src="ui.js"></script>')
    const env = { ...process.env, ADNIFY_EXECUTION_UI_SMOKE: output }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(electron, [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 60000 })
    console.log(`Artifacts: ${output}`)
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
  const { app, BrowserWindow, ipcMain, Tray } = electron
  const output = process.env.ADNIFY_EXECUTION_UI_SMOKE
  app.setPath('userData', path.join(output, 'profile'))
  app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu')
  app.on('window-all-closed', () => {})
  const { ExecutionService, ExecutionLogStore, normalizeExecutionSettings } = require(path.join(output, 'services.cjs'))
  const logs = new ExecutionLogStore(path.join(output, 'logs'))
  let settings = normalizeExecutionSettings(undefined)
  const pending = new Map(), windows = [], errors = []
  const service = new ExecutionService(undefined, undefined, (spec, output) => {
    let finish
    const done = new Promise(resolve => { finish = resolve })
    pending.set(spec.command, finish)
    output('READY · fixture terminal output\n')
    return { done, stop: () => finish({ exitCode: 0 }), input: () => {} }
  }, logs)
  const waitFor = async (predicate, name) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
    throw new Error(`Timed out: ${name}`)
  }
  const body = win => win.webContents.executeJavaScript('document.body.innerText')
  const click = async (win, label) => {
    await waitFor(() => win.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.innerText === ${JSON.stringify(label)}); return Boolean(button && !button.disabled) })()`), `enabled button ${label}`)
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => b.innerText === ${JSON.stringify(label)}).click()`)
  }
  const screenshot = async (win, name) => {
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  const timeout = setTimeout(() => { service.shutdown(); app.exit(1) }, 45000)
  app.whenReady().then(async () => {
    ipcMain.handle('execution:overview', async event => ({ success: true, ownerId: event.sender.id, settings, usage: service.scheduler.usage(), jobs: service.listAll(), archives: await logs.list(), sessions: [] }))
    ipcMain.handle('settings:set', (_event, key, value) => {
      assert.equal(key, 'executionSettings'); settings = normalizeExecutionSettings(value); service.configure(settings)
      fs.writeFileSync(path.join(output, 'settings.json'), JSON.stringify(settings)); return true
    })
    ipcMain.handle('execution:manage', async (event, { id, action }) => {
      if (['host', 'unhost', 'stop'].includes(action)) service.manage(event.sender.id, id, action)
      else if (action === 'log') return { success: true, ...await logs.read(id) }
      else if (action === 'pin' || action === 'unpin') await logs.pin(id, action === 'pin')
      else if (action === 'export') await logs.export(id, path.join(output, 'export.log'))
      else if (action === 'delete') await logs.delete(id)
      return { success: true }
    })
    const create = async (language, tab) => {
      const win = new BrowserWindow({ show: false, skipTaskbar: true, width: 1120, height: 930,
        webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(root, 'dist/preload/preload.js') } })
      windows.push(win)
      win.webContents.on('console-message', details => { if (details.level === 'error') { errors.push(details.message); console.error('Renderer:', details.message) } })
      const owner = win.webContents.id
      win.on('closed', () => service.closeOwner(owner))
      const url = require('node:url').pathToFileURL(path.join(output, 'ui.html'))
      url.search = new URLSearchParams({ language, tab }).toString()
      await win.loadURL(url.href)
      await waitFor(async () => (await body(win)).includes(language === 'zh' ? '执行管理' : 'Execution manager'), 'manager mount')
      return win
    }
    const first = await create('zh', 'running'), second = await create('en', 'settings')
    const bg = service.submit(first.webContents.id, { command: 'pnpm dev', cwd: 'E:/fixture/workspace', workspaceId: 'E:/fixture/workspace', shell: 'cmd.exe', mode: 'background', threadId: 'development', requestKey: `${Date.now()}:dev` })
    await waitFor(async () => (await body(first)).includes('pnpm dev'), 'live service')
    await click(first, '关闭窗口后继续运行')
    await waitFor(() => service.hosted().length === 1, 'hosted ownership')
    // Native tray availability is required before the production host action succeeds.
    const tray = new Tray(path.join(root, 'public/brand/icons/app.ico')); assert(!tray.isDestroyed()); tray.destroy()
    await click(first, '查看日志')
    await waitFor(async () => (await body(first)).includes('fixture terminal output'), 'terminal log')
    await screenshot(first, 'execution-running-zh')
    await click(first, '容量设置')
    await first.webContents.executeJavaScript(`(() => { const input = document.querySelector('input[type=number]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '12'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await click(first, '保存并应用')
    await waitFor(() => settings.commands === 12, 'saved capacity')
    await waitFor(async () => (await second.webContents.executeJavaScript('document.querySelector("input[type=number]").value')) === '12', 'cross-window capacity')
    await screenshot(second, 'execution-settings-en')
    await click(first, '运行与会话'); await click(first, '停止')
    await waitFor(() => service.hosted().length === 0, 'confirmed stop')
    await click(first, '终端输出归档')
    await waitFor(async () => (await body(first)).includes('pnpm dev'), 'archived output')
    await click(first, '保留日志'); await click(first, '导出')
    await waitFor(() => fs.existsSync(path.join(output, 'export.log')), 'exported terminal log')
    assert.match(fs.readFileSync(path.join(output, 'export.log'), 'utf8'), /fixture terminal output/)
    await screenshot(first, 'execution-archive-zh')
    await click(first, '取消保留'); await click(first, '删除归档')
    await waitFor(async () => !(await logs.list()).some(row => row.jobId === bg.jobId), 'deleted archive')
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ languages: ['zh', 'en'], capacitySaved: true, crossWindowSettings: true, hostingControl: true, nativeTray: true, logReadPinExportDelete: true, rendererErrors: errors }, null, 2))
    console.log('PASS: bilingual execution manager, shared settings, hosting, terminal log actions, native tray')
    await logs.flush(); clearTimeout(timeout); windows.forEach(win => win.destroy()); app.exit(0)
  }).catch(async error => {
    console.error(error, errors); service.shutdown(); await logs.flush(); clearTimeout(timeout)
    windows.filter(win => !win.isDestroyed()).forEach(win => win.destroy()); app.exit(1)
  })
}
