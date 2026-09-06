// node scripts/diagnostics/decorative-motion-smoke.cjs
// Optional MOTION_BASELINE_REF compares the old CSS on the same fixture.
// PLAYWRIGHT_MODULE_PATH can point to an existing Playwright installation.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')

async function main() {
  const root = path.resolve(__dirname, '../..')
  const outputRoot = path.join(root, '.tmp/decorative-motion')
  fs.mkdirSync(outputRoot, { recursive: true })
  const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
  await require('esbuild').build({
    entryPoints: [path.join(root, 'tests/browser/decorative-motion.tsx')],
    outfile: path.join(output, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'fixture-preferences', setup(build) {
      build.onResolve({ filter: /\/(emotion\/panelSettings|services\/electronAPI)$/ }, () => ({ path: path.join(root, 'tests/browser/decorative-motion-settings.ts') }))
    } }],
  })
  const tailwindModule = await import(pathToFileURL(path.join(root, 'tailwind.config.js')).href)
  const compileCSS = async source => (await require('postcss')([
    require('tailwindcss')({ ...tailwindModule.default, content: [
      path.join(root, 'tests/browser/decorative-motion.tsx'),
      path.join(root, 'src/renderer/components/ui/Modal.tsx'),
    ] }),
  ]).process(source, { from: path.join(root, 'src/renderer/styles/globals.css') })).css
  fs.writeFileSync(path.join(output, 'current.css'), await compileCSS(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8')))
  if (process.env.MOTION_BASELINE_REF) {
    const baseline = execFileSync('git', ['show', `${process.env.MOTION_BASELINE_REF}:src/renderer/styles/globals.css`], { cwd: root, encoding: 'utf8' })
    fs.writeFileSync(path.join(output, 'legacy.css'), await compileCSS(baseline))
  }
  for (const variant of ['current', ...(process.env.MOTION_BASELINE_REF ? ['legacy'] : [])]) {
    fs.writeFileSync(path.join(output, `${variant}.html`), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${variant}.css"><div id="root"></div><script src="ui.js"></script>`)
  }
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
  const browser = await chromium.launch({ channel: process.env.MOTION_BROWSER_CHANNEL || 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 780 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true }))
    const navigate = variant => page.goto(pathToFileURL(path.join(output, `${variant}.html`)).href + (variant === 'legacy' ? '?legacy' : ''))
    const client = await page.context().newCDPSession(page)
    await client.send('Performance.enable')
    const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
    const measure = async variant => {
      await page.waitForTimeout(700)
      const before = await metrics()
      await client.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,cc', transferMode: 'ReturnAsStream' })
      await page.waitForTimeout(3000)
      const finished = new Promise(resolve => client.once('Tracing.tracingComplete', resolve))
      await client.send('Tracing.end')
      const { stream } = await finished
      let trace = ''
      while (true) {
        const chunk = await client.send('IO.read', { handle: stream })
        trace += chunk.data
        if (chunk.eof) break
      }
      await client.send('IO.close', { handle: stream })
      const after = await metrics()
      fs.writeFileSync(path.join(output, `${variant}-trace.json`), trace)
      const events = JSON.parse(trace).traceEvents
      const summary = { sampleSeconds: 3 }
      for (const name of ['Paint', 'PaintImage', 'UpdateLayoutTree', 'Layout']) {
        const matches = events.filter(event => event.name === name && event.ph === 'X')
        summary[name] = { count: matches.length, ms: matches.reduce((sum, event) => sum + (event.dur || 0), 0) / 1000 }
      }
      summary.mainThreadTaskMs = (after.TaskDuration - before.TaskDuration) * 1000
      return summary
    }
    const report = { fixture: 'Static Agent conversation; isolates decoration from streaming/network work.', samples: {} }
    if (process.env.MOTION_BASELINE_REF) {
      await navigate('legacy')
      report.samples.legacy = await measure('legacy')
      await page.screenshot({ path: path.join(output, 'legacy-dark.png') })
    }
    await navigate('current')
    await page.locator('output[data-hook-motion="true"]').waitFor()
    report.samples.current = await measure('current')
    await page.screenshot({ path: path.join(output, 'current-dark.png') })
    await page.getByText('切换主题', { exact: true }).click()
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim()), '255 255 255')
    await page.screenshot({ path: path.join(output, 'current-light.png') })
    await page.getByText('切换主题', { exact: true }).click()
    const original = await page.getByRole('textbox').elementHandle()
    await page.getByRole('textbox').fill('未发送的草稿')
    const activeDecorations = () => page.evaluate(() => [...document.querySelector('[data-workspace]').getAnimations({ subtree: true })]
      .filter(animation => animation.playState === 'running' && ['status-breathe', 'process-border-breathe'].includes(animation.animationName)).length)
    assert(await activeDecorations() > 0, 'decorative animations run while visible')
    await page.getByText('打开设置', { exact: true }).click()
    await page.locator('output[data-hook-motion="false"]').waitFor()
    assert.equal(await activeDecorations(), 0)
    assert.equal(await page.locator('[data-workspace]').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'covered CSS spinners also pause')
    assert.notEqual(await page.locator('[data-modal-motion]').evaluate(node => getComputedStyle(node).animationName), 'none', 'portal inherits the outer motion policy, not the covered workspace')
    await page.locator('[data-task-step]').evaluate(node => node.click())
    assert.equal(await page.locator('output').textContent(), '4', 'background state updates still work')
    report.samples.covered = await measure('covered')
    await page.screenshot({ path: path.join(output, 'settings-open.png') })
    await page.getByText('返回工作区', { exact: true }).click()
    await page.locator('output[data-hook-motion="true"]').waitFor()
    assert(await original.evaluate(node => node.isConnected), 'opening settings must not remount the conversation')
    assert.equal(await page.getByRole('textbox').inputValue(), '未发送的草稿')
    await page.getByText('切换装饰动画', { exact: true }).click()
    await page.locator('output[data-hook-motion="false"]').waitFor()
    assert.equal(await activeDecorations(), 0)
    assert.equal(await page.locator('.tool-activity-mark').evaluate(node => getComputedStyle(node).animationName), 'tool-activity-spin', 'essential loading feedback remains available')
    await page.getByText('打开设置', { exact: true }).click()
    assert.equal(await page.locator('[data-modal-motion]').evaluate(node => getComputedStyle(node).animationName), 'none', 'preference reaches portaled content')
    await page.getByText('返回工作区', { exact: true }).click()
    await page.getByText('切换装饰动画', { exact: true }).click()
    for (const focused of [false, true]) {
      await page.evaluate(value => {
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => value })
        window.dispatchEvent(new Event(value ? 'focus' : 'blur'))
      }, focused)
      await page.locator(`output[data-hook-motion="${focused}"]`).waitFor()
      assert.equal((await activeDecorations()) > 0, focused)
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('output[data-hook-motion="false"]').waitFor()
    assert.equal(await activeDecorations(), 0)
    assert.equal(await page.locator('.tool-activity-mark').evaluate(node => getComputedStyle(node).animationName), 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.locator('output[data-hook-motion="true"]').waitFor()
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (report.samples.legacy) {
      assert(report.samples.current.Paint.count < report.samples.legacy.Paint.count * 0.25 + 3, 'decoration should no longer repaint at refresh rate')
    }
    console.log(`PASS: motion policy, modal continuity, reduced motion, dark/light rendering. Artifacts: ${output}`)
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
