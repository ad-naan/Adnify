// Hidden Electron integration check using production components, preload and notification IPC.
// Run after pnpm build: node scripts/diagnostics/message-center-smoke.cjs
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const electron = require('electron')

if (typeof electron === 'string') {
  (async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp/message-center-smoke')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
    const esbuild = require('esbuild')
    await esbuild.build({ stdin: { contents: "export { registerNotificationHandlers, cleanupNotificationHandlers } from './src/main/ipc/notifications';", resolveDir: root },
      outfile: path.join(output, 'services.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], tsconfig: path.join(root, 'tsconfig.main.json') })
    await esbuild.build({ stdin: { contents: `
      import React, { useEffect, useState } from 'react'; import { createRoot } from 'react-dom/client';
      import NotificationCenterIndicator from './src/renderer/components/layout/NotificationCenterIndicator';
      import InlineToastAnchor from './src/renderer/components/common/InlineToastAnchor';
      import GlobalToastContainer from './src/renderer/components/common/GlobalToastContainer';
      import { InlineToastProvider, useInlineToast } from './src/renderer/components/common/InlineToast';
      import { useNotificationBridge } from './src/renderer/notifications/useNotificationBridge';
      import { Modal } from './src/renderer/components/ui/Modal';
      import { useStore } from './src/renderer/store';
      const query = new URLSearchParams(location.search), scope = query.get('scope');
      const language = query.get('language') || 'zh';
      useStore.setState({ language, workspacePath: scope, workspace: { id: scope, roots: [{ path: scope, name: scope }] } });
      function Fixture() {
        const toasts = useInlineToast();
        const [dialogs, setDialogs] = useState(0);
        useNotificationBridge(true);
        useEffect(() => { window.smoke = { toasts, setDialogs }; }, [toasts]);
        return <>
          <main className="p-8"><h1 className="text-lg">Adnify · Message center regression</h1><p className="mt-2 text-text-muted">{scope}</p></main>
          <span id="toast-count" hidden>{toasts.toasts.length}</span>
          <footer className="fixed inset-x-0 bottom-0 flex h-7 items-center justify-end border-t border-border bg-background-secondary pr-1">
            <NotificationCenterIndicator language={language} scope={scope} /><InlineToastAnchor />
          </footer>
          <GlobalToastContainer />
          <Modal isOpen={dialogs > 0} onClose={() => setDialogs(0)} title="设置弹窗"><p>胶囊应保持在右下角。</p></Modal>
          <Modal isOpen={dialogs > 1} onClose={() => setDialogs(1)} title="第二层弹窗"><p>关闭这一层后，胶囊仍留在右下角。</p></Modal>
        </>;
      }
      createRoot(document.getElementById('root')).render(<InlineToastProvider><Fixture /></InlineToastProvider>);
    `, loader: 'tsx', resolveDir: root }, outfile: path.join(output, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic',
      tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"./"' }, loader: { '.ttf': 'dataurl' },
      plugins: [{ name: 'no-editor', setup(build) { build.onResolve({ filter: /monacoWorker$/ }, args => ({ path: args.path, namespace: 'no-editor' })); build.onLoad({ filter: /.*/, namespace: 'no-editor' }, () => ({ contents: 'export const monaco = {}' })) } }] })
    const tailwind = require(path.join(root, 'tailwind.config.js'))
    const css = await require('postcss')([require('tailwindcss')({ ...(tailwind.default ?? tailwind), content: [path.join(root, 'src/renderer/components/**/*.{ts,tsx}'), { raw: 'p-8 text-lg mt-2 fixed inset-x-0 bottom-0 flex h-7 items-center justify-end border-t border-border bg-background-secondary pr-1' }] })])
      .process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })
    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(path.join(output, 'ui.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>')
    const env = { ...process.env, ADNIFY_MESSAGE_CENTER_SMOKE: output }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(electron, [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 90000 })
    console.log(`Artifacts: ${output}`)
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
} else {
  const { app, BrowserWindow } = electron
  const output = process.env.ADNIFY_MESSAGE_CENTER_SMOKE
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('in-process-gpu')
  app.setPath('userData', path.join(output, 'profile'))
  app.on('window-all-closed', () => {})
  const { registerNotificationHandlers, cleanupNotificationHandlers } = require(path.join(output, 'services.cjs'))
  const windows = [], errors = [], scopes = new Map()
  const timeout = setTimeout(() => { console.error('Message center smoke timed out'); app.exit(1) }, 75000)
  const waitUntil = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await predicate()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Condition did not settle')
  }
  const js = (window, code) => window.webContents.executeJavaScript(code)
  const click = (window, label) => js(window, `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)} || button.title === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)}).click()`)
  const frame = window => js(window, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const screenshot = async (window, name) => { await frame(window); fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG()) }
  const sampleMotion = (window, action) => js(window, `(async () => {
    const node = document.querySelector('[data-inline-toast]'), samples = [];
    ${action};
    for (let i = 0; i < 28; i++) {
      await new Promise(requestAnimationFrame);
      const nodes = document.querySelectorAll('[data-inline-toast]');
      const bounds = nodes[0]?.getBoundingClientRect();
      samples.push({ count: nodes.length, same: nodes[0] === node, x: bounds?.x, y: bounds?.y, width: bounds?.width, right: bounds?.right, bottom: bounds?.bottom, vw: innerWidth, vh: innerHeight, placement: nodes[0]?.dataset.toastPlacement });
    }
    return samples;
  })()`)
  const assertMotion = samples => {
    for (const value of samples) {
      assert.equal(value.count, 1, 'Only one capsule may be rendered')
      assert(value.same, 'Relocation must reuse the same capsule')
      assert(value.x >= value.vw - 400 && value.right <= value.vw + 1, JSON.stringify(value))
      assert(value.y >= value.vh - 240 && value.bottom <= value.vh + 1, JSON.stringify(value))
    }
  }
  app.whenReady().then(async () => {
    registerNotificationHandlers({ getWindowWorkspace: id => [scopes.get(id)], getLanguage: () => 'zh' })
    for (const [scope, language] of [['workspace-a', 'zh'], ['workspace-b', 'en']]) {
      const window = new BrowserWindow({ show: false, skipTaskbar: true, width: 1000, height: 760,
        webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.resolve(__dirname, '../../dist/preload/preload.js') } })
      windows.push(window); scopes.set(window.id, scope)
      window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message) })
      const url = pathToFileURL(path.join(output, 'ui.html')); url.search = new URLSearchParams({ scope, language }).toString()
      await window.loadURL(url.href)
      await waitUntil(() => js(window, 'Boolean(window.smoke)'))
    }
    const [first, second] = windows
    await js(first, '(async () => { const settings = await window.electronAPI.notifications.settings(); settings.system.enabled = false; settings.webhooks = []; await window.electronAPI.notifications.saveSettings(settings); })()')
    assert(await js(first, 'Boolean(document.querySelector("button[title=消息中心]"))'))
    await js(first, "window.smoke.toasts.info('自动消失后仍可回看的消息', 250)")
    await waitUntil(() => js(first, '!document.querySelector("[data-inline-toast]")'))
    await click(first, '消息中心')
    await waitUntil(() => js(first, 'Boolean(document.querySelector("section article"))'))
    assert((await js(first, 'document.querySelector("section").innerText')).includes('自动消失后仍可回看的消息'))
    await screenshot(first, 'local-history')
    await click(first, '清空当前列表')
    await waitUntil(() => js(first, 'document.querySelectorAll("section article").length === 0'))
    await click(first, '消息中心')
    console.log('PASS: permanent message icon and retained local history after automatic dismissal')

    await js(first, "window.electronAPI.notifications.publish([{type:'agent.loop.completed',level:'success',title:'任务已完成',message:'工作区 A 的任务事件',attention:true,correlationId:'first-task'}])")
    await waitUntil(() => js(first, '[...document.querySelectorAll("[aria-label]")].some(node => node.getAttribute("aria-label") === "消息中心，1 条未读")'))
    assert.equal(await js(first, 'document.querySelector("#toast-count").textContent'), '0')
    assert.equal((await js(second, 'window.electronAPI.notifications.history()')).records.length, 0)
    await click(first, '消息中心'); await click(first, '任务事件')
    await waitUntil(() => js(first, 'document.querySelectorAll("section article").length === 1'))
    await screenshot(first, 'task-history')
    await click(first, '全部标记已读')
    await waitUntil(async () => (await js(first, 'window.electronAPI.notifications.history()')).records.every(record => record.read))
    await js(first, "window.electronAPI.notifications.publish([{type:'agent.loop.failed',level:'error',title:'任务失败',message:'点击查看任务',attention:true,correlationId:'second-task'}])")
    await waitUntil(() => js(first, 'document.querySelectorAll("section article").length === 2'))
    // Activation normally focuses the owner. Stub focus/show to keep the integration fixture hidden.
    first.show = () => {}; first.focus = () => {}
    await click(first, '任务失败点击查看任务')
    await waitUntil(async () => (await js(first, 'window.electronAPI.notifications.history()')).records.every(record => record.read))
    await click(first, '清空当前列表')
    await waitUntil(() => js(first, 'document.querySelectorAll("section article").length === 0'))
    await click(first, '消息中心')
    await click(second, 'Message center'); await screenshot(second, 'message-center-en')
    console.log('PASS: scoped task events, live unread updates, activation, mark-read and clear; no automatic in-app cards')

    await js(first, "window.smoke.toasts.info('弹窗开关时消息胶囊保持在右下角', 0)")
    await waitUntil(() => js(first, 'document.querySelector("[data-inline-toast]")?.dataset.toastPlacement === "docked"'))
    await new Promise(resolve => setTimeout(resolve, 250))
    const trajectory = []
    for (const dialogs of [1, 2, 1, 0]) {
      const samples = await sampleMotion(first, `window.smoke.setDialogs(${dialogs})`)
      assertMotion(samples); trajectory.push(...samples)
      assert.equal(samples.at(-1).placement, dialogs ? 'floating' : 'docked')
      if (dialogs) assert(Math.abs(samples.at(-1).bottom - (samples.at(-1).vh - 36)) < 1)
    }
    const rapid = await sampleMotion(first, `window.smoke.setDialogs(1); setTimeout(() => window.smoke.setDialogs(0), 35); setTimeout(() => { window.smoke.setDialogs(1); window.smoke.toasts.info('连续提示更新后的消息', 0); }, 70)`)
    assertMotion(rapid); trajectory.push(...rapid)
    assert.equal(rapid.at(-1).placement, 'floating')
    await screenshot(first, 'floating-capsule')
    const card = await js(first, "window.smoke.toasts.showCard({record:false,title:'已有操作提示',message:'胶囊与操作卡片应互不遮挡',duration:0})")
    await sampleMotion(first, 'void 0')
    const gap = await js(first, `(() => { const capsule = document.querySelector('[data-inline-toast]').getBoundingClientRect(); const card = [...document.querySelectorAll('h3')].find(node => node.textContent === '已有操作提示').closest('.pointer-events-auto').getBoundingClientRect(); return card.top - capsule.bottom; })()`)
    assert(gap >= 7, `Capsule overlapped card: ${gap}`)
    await screenshot(first, 'capsule-with-card')
    await js(first, `window.smoke.toasts.dismissToast(${JSON.stringify(card)}); window.smoke.setDialogs(0)`)
    await sampleMotion(first, 'void 0')
    const dockError = await js(first, `(() => { const capsule = document.querySelector('[data-inline-toast]').getBoundingClientRect(), anchor = document.querySelector('[data-toast-anchor]').getBoundingClientRect(); return Math.max(Math.abs(capsule.right-anchor.right), Math.abs(capsule.bottom-anchor.bottom), Math.abs(capsule.width-anchor.width)); })()`)
    assert(dockError < 1, `Dock mismatch: ${dockError}`)
    first.setSize(640, 520)
    assertMotion(await sampleMotion(first, 'window.smoke.setDialogs(1)'))
    await screenshot(first, 'small-window')
    fs.writeFileSync(path.join(output, 'trajectory.json'), JSON.stringify(trajectory, null, 2))
    assert.deepEqual(errors, [])
    console.log('PASS: single capsule, bounded animation, nested dialogs, rapid toggles/new messages, card collision and viewport resize')
    await cleanupNotificationHandlers()
    windows.forEach(window => window.destroy())
    clearTimeout(timeout); app.exit(0)
  }).catch(async error => {
    console.error(error.stack || error.message)
    for (const window of windows) if (!window.isDestroyed()) {
      console.error((await js(window, 'document.body.innerText').catch(() => '')).slice(0, 1500))
      await screenshot(window, `failure-${window.id}`).catch(() => {})
      window.destroy()
    }
    if (errors.length) console.error(errors)
    clearTimeout(timeout); app.exit(1)
  })
}
