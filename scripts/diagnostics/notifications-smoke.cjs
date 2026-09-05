// Uses hidden Electron windows, an isolated profile and a loopback-only receiver.
// Run after pnpm build: node scripts/diagnostics/notifications-smoke.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')

if (typeof electron === 'string') {
  (async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp/notifications-smoke')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
    const esbuild = require('esbuild')
    await esbuild.build({ stdin: { contents: "export { NotificationRuntime } from './src/main/services/notifications/runtime'; export { registerNotificationHandlers, cleanupNotificationHandlers } from './src/main/ipc/notifications'; export { DEFAULT_WEBHOOK_BODY } from './src/shared/types/notifications';", resolveDir: root },
      outfile: path.join(output, 'services.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], tsconfig: path.join(root, 'tsconfig.main.json') })
    await esbuild.build({ stdin: { contents: `
      import React, { useEffect } from 'react'; import { createRoot } from 'react-dom/client';
      import SettingsModal from './src/renderer/components/settings/SettingsModal';
      import { NotificationSettings } from './src/renderer/components/settings/tabs/NotificationSettings';
      import NotificationCenterContent from './src/renderer/components/panels/NotificationCenterContent';
      import { useNotificationBridge } from './src/renderer/notifications/useNotificationBridge';
      import { InlineToastProvider, useInlineToast, setGlobalInlineToast } from './src/renderer/components/common/InlineToast';
      import { EventBus } from './src/renderer/agent/core/EventBus';
      import { useStore } from './src/renderer/store';
      const query = new URLSearchParams(location.search), language = query.get('language') === 'en' ? 'en' : 'zh';
      useStore.setState({ language });
      function Center() {
        const toasts = useInlineToast();
        useEffect(() => { setGlobalInlineToast(toasts) }, [toasts]);
        useNotificationBridge(true);
        return <><button onClick={() => EventBus.emit({ type: 'loop:end', reason: 'complete', requestId: 'fixture-run' })}>Publish fixture completion</button><NotificationCenterContent language={language} /></>;
      }
      createRoot(document.getElementById('root')).render(query.has('center') ? <InlineToastProvider><Center /></InlineToastProvider> : query.has('modal') ? <SettingsModal /> : <NotificationSettings language={language} />);
    `, loader: 'tsx', resolveDir: root },
      outfile: path.join(output, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"./"' }, loader: { '.ttf': 'dataurl' },
      // No editor is mounted by this settings fixture; Vite owns Monaco worker bundling.
      plugins: [{ name: 'settings-only', setup(build) { build.onResolve({ filter: /monacoWorker$/ }, args => ({ path: args.path, namespace: 'settings-only' })); build.onLoad({ filter: /.*/, namespace: 'settings-only' }, () => ({ contents: 'export const monaco = {}' })) } }] })
    const tailwind = require(path.join(root, 'tailwind.config.js'))
    const css = await require('postcss')([require('tailwindcss')({ ...(tailwind.default ?? tailwind), content: [path.join(root, 'src/renderer/components/**/*.{ts,tsx}')] })])
      .process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })
    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(path.join(output, 'ui.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>body{padding:24px;background:rgb(var(--background));color:rgb(var(--text-primary))}#root{width:auto;height:auto}</style><div id="root"></div><script src="ui.js"></script>')
    const env = { ...process.env, ADNIFY_NOTIFICATIONS_SMOKE: output }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(electron, [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 90000 })
    console.log(`Artifacts: ${output}`)
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
} else {
  const { app, BrowserWindow, ipcMain, safeStorage } = electron
  const output = process.env.ADNIFY_NOTIFICATIONS_SMOKE
  app.setPath('userData', path.join(output, 'profile'))
  app.on('window-all-closed', () => {})
  const { NotificationRuntime, registerNotificationHandlers, cleanupNotificationHandlers, DEFAULT_WEBHOOK_BODY } = require(path.join(output, 'services.cjs'))
  const timeout = setTimeout(() => { console.error('Notification smoke timed out'); app.exit(1) }, 75000)
  const waitUntil = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await predicate()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Condition did not settle')
  }
  const windows = [], received = [], rendererErrors = []
  let server
  app.whenReady().then(async () => {
    server = require('node:http').createServer((request, response) => {
      let body = ''
      request.on('data', chunk => { body += chunk })
      request.on('end', () => { received.push({ body: JSON.parse(body), auth: request.headers.authorization }); response.writeHead(204); response.end() })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/test-only`
    const options = { show: false, skipTaskbar: true, width: 1160, height: 950,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.resolve(__dirname, '../../dist/preload/preload.js') } }
    const first = new BrowserWindow(options), second = new BrowserWindow(options)
    windows.push(first, second)
    for (const window of windows) window.webContents.on('console-message', details => {
      if (details.level === 'error') { rendererErrors.push(details.message); console.error(`Renderer: ${details.message}`) }
    })
    const context = { getWindowWorkspace: id => [id === first.id ? 'workspace-a' : 'workspace-b'], getLanguage: () => 'zh' }
    const runtime = new NotificationRuntime(context)
    await runtime.initialize()
    const settings = runtime.settings()
    settings.system.enabled = false
    settings.webhooks = [{ id: 'loopback', name: 'Local receiver', enabled: true, url, headers: { Authorization: 'Bearer smoke-only-secret' }, bodyTemplate: DEFAULT_WEBHOOK_BODY, events: ['agent.*'], levels: ['success'], includePassive: false }]
    assert(safeStorage.isEncryptionAvailable())
    runtime.saveSettings(settings)
    const stored = fs.readFileSync(path.join(output, 'profile/notifications.json'), 'utf8')
    assert(!stored.includes(url)); assert(!stored.includes('smoke-only-secret'))
    runtime.service.publish({ type: 'agent.loop.completed', title: 'Completed', message: 'Open editor', level: 'success', attention: true }, { workspace: 'workspace-a', windowId: first.id })
    await waitUntil(() => received.length === 1 && runtime.history(first).records[0].deliveries.loopback.state === 'delivered')
    assert.equal(received[0].auth, 'Bearer smoke-only-secret')
    assert.equal(received[0].body.event, 'agent.loop.completed')
    assert(!JSON.stringify(received[0].body).includes('workspace-a'))
    assert.equal(runtime.history(second).records.length, 0)
    await runtime.stop()
    console.log('PASS: Electron net.fetch, encrypted destinations, scoped history and persistence')

    // Recreate the production IPC runtime and use the production preload bridge.
    registerNotificationHandlers(context)
    const placeholderHandlers = {
      'settings:getConfigPath': () => path.join(output, 'profile'), 'settings:getUserDataPath': () => path.join(output, 'profile'),
      'settings:get': () => undefined, 'settings:set': () => true, 'app:getVersion': () => 'test', 'index:getConfig': () => ({}), 'credentials:oauth:status': () => ({}), 'mcp:setAutoConnect': () => ({ success: true }),
      'credentials:api-keys:replace': () => ({ success: true }),
    }
    for (const [name, handler] of Object.entries(placeholderHandlers)) ipcMain.handle(name, handler)
    await first.loadFile(path.join(output, 'ui.html'))
    await waitUntil(async () => (await first.webContents.executeJavaScript("Array.from(document.querySelectorAll('input')).map(input => input.value)")).includes('Local receiver'))
    const restored = await first.webContents.executeJavaScript('window.electronAPI.notifications.history()')
    assert.equal(restored.records.length, 1)
    assert.equal(restored.records[0].deliveries.loopback.state, 'delivered')
    await first.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent.includes('保存并发送测试消息')).click()")
    await waitUntil(async () => (await first.webContents.executeJavaScript('document.body.innerText')).includes('测试消息已发送'))
    assert.equal(received.length, 2)
    console.log('Checking invalid IPC input (expected rejection below)')
    const rejected = await first.webContents.executeJavaScript("window.electronAPI.notifications.publish([{ type: 'test', title: 'bad', message: '', level: 'info', windowId: 999 }]).then(() => false, () => true)")
    assert.equal(rejected, true)
    const systemResult = await first.webContents.executeJavaScript("window.electronAPI.notifications.test('system')")
    console.log(`Native notification result: ${JSON.stringify(systemResult)}`)
    await first.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    fs.writeFileSync(path.join(output, 'notifications-zh.png'), (await first.webContents.capturePage()).toPNG())
    await second.loadFile(path.join(output, 'ui.html'), { query: { language: 'en' } })
    await waitUntil(async () => (await second.webContents.executeJavaScript("Array.from(document.querySelectorAll('input')).map(input => input.value)")).includes('Local receiver'))
    fs.writeFileSync(path.join(output, 'notifications-en.png'), (await second.webContents.capturePage()).toPNG())
    console.log('PASS: production preload, restored settings, Chinese/English UI and Webhook test action')

    await first.loadFile(path.join(output, 'ui.html'), { query: { modal: '1' } })
    await waitUntil(async () => (await first.webContents.executeJavaScript('document.body.innerText')).includes('通知与外部推送'))
    await first.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('通知与外部推送')).click()")
    await waitUntil(async () => (await first.webContents.executeJavaScript("Array.from(document.querySelectorAll('input')).map(input => input.value)")).includes('Local receiver'))
    await first.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('通知与外部推送')).scrollIntoView({block:'center'}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    fs.writeFileSync(path.join(output, 'settings-categories.png'), (await first.webContents.capturePage()).toPNG())
    await first.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('input[type="number"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '27');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      [...document.querySelectorAll('nav button')].find(button => button.textContent.includes('网络与服务')).click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      [...document.querySelectorAll('nav button')].find(button => button.textContent.includes('通知与外部推送')).click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`)
    assert.equal(await first.webContents.executeJavaScript("document.querySelector('input[type=number]').value"), '27')
    await first.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent.includes('保存更改')).click()")
    await waitUntil(async () => (await first.webContents.executeJavaScript('window.electronAPI.notifications.settings()')).cooldownSeconds === 27)
    await waitUntil(async () => (await first.webContents.executeJavaScript('document.body.innerText')).includes('所有更改已保存'))
    console.log('PASS: switching settings categories preserves drafts and the shared Save action persists notifications')
    for (const label of ['网络与服务', '数据与备份', '日志与诊断', '后台任务']) {
      const labels = await first.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].map(button => button.textContent)")
      assert(labels.some(value => value.includes(label)))
    }
    const panels = await first.webContents.executeJavaScript(`(async () => {
      const panels = [];
      for (const label of ['网络与服务', '数据与备份', '日志与诊断', '后台任务', '版本记录']) {
        [...document.querySelectorAll('nav button')].find(button => button.textContent.includes(label)).click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        panels.push(document.querySelector('.settings-tab-panel').innerText);
      }
      const search = document.querySelector('nav input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'proxy');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      panels.push(document.querySelector('nav').innerText);
      return panels;
    })()`)
    for (const [index, expected] of ['GitHub', '配置', '性能诊断', '任务栏', '更新日志', '网络与服务'].entries()) assert(panels[index].includes(expected), `Unexpected panel ${index}: ${panels[index]}`)
    console.log('PASS: actual settings modal categories, page contents and search routing')
    await first.loadFile(path.join(output, 'ui.html'), { query: { center: '1' } })
    await waitUntil(async () => (await first.webContents.executeJavaScript('document.body.innerText')).includes('Completed'))
    await first.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent === 'Publish fixture completion').click()")
    await waitUntil(async () => (await first.webContents.executeJavaScript('document.body.innerText')).includes('Agent 任务已完成'))
    await waitUntil(() => received.length === 3)
    fs.writeFileSync(path.join(output, 'notification-center.png'), (await first.webContents.capturePage()).toPNG())
    await first.webContents.executeJavaScript("document.querySelector('button[aria-label=全部标为已读]').click()")
    await waitUntil(async () => (await first.webContents.executeJavaScript('window.electronAPI.notifications.history()')).records.every(record => record.read))
    await second.webContents.executeJavaScript("window.electronAPI.notifications.publish([{type:'fixture.warning', title:'Other workspace', message:'', level:'warning', attention:true}])")
    await first.webContents.executeJavaScript("document.querySelector('button[aria-label=清空记录]').click()")
    await waitUntil(async () => (await first.webContents.executeJavaScript('window.electronAPI.notifications.history()')).records.length === 0)
    assert.equal((await second.webContents.executeJavaScript('window.electronAPI.notifications.history()')).records.length, 1)
    console.log('PASS: Agent event bridge, notification center, read/clear actions and cross-workspace isolation')
    assert.deepEqual(rendererErrors, [])
    await cleanupNotificationHandlers()
    windows.forEach(window => window.destroy())
    await new Promise(resolve => server.close(resolve))
    clearTimeout(timeout); app.exit(0)
  }).catch(async error => {
    console.error(error.stack || error.message)
    for (const window of windows) if (!window.isDestroyed()) {
      console.log((await window.webContents.executeJavaScript('document.body.innerText').catch(() => '')).slice(0, 2000))
      if (window.webContents.getURL()) fs.writeFileSync(path.join(output, `failure-${window.id}.png`), (await window.webContents.capturePage()).toPNG())
      window.destroy()
    }
    server?.close(); clearTimeout(timeout); app.exit(1)
  })
}
