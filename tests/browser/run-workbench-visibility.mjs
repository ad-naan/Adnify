import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const browser = await chromium.launch({ channel: process.env.MOTION_BROWSER_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const base = process.env.MOTION_TEST_URL || 'http://127.0.0.1:5199/tests/browser/'
const assertHidden = async panel => {
  const result = await page.locator(`[data-panel-probe="${panel}"]`).evaluate(node => {
    const rect = node.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + 4, rect.y + 4)
    return { painted: node.checkVisibility(), hit: hit && node.contains(hit), focusable: (() => {
      const input = node.querySelector('textarea')
      input.focus()
      return document.activeElement === input
    })() }
  })
  assert.equal(result.painted, false, `${panel}: child visibility must not leave painted remnants`)
  assert.equal(result.hit, false, `${panel}: hidden children must not intercept clicks`)
  assert.equal(result.focusable, false, `${panel}: hidden children must not receive focus`)
}
try {
  await page.goto(`${base}workbench-visibility.html`)
  await page.locator('[data-dock-workbench]').waitFor()
  await page.waitForFunction(() => document.querySelector('[data-dock-panel="editor"]').clientWidth > 0)
  for (const panel of ['sidebar', 'editor', 'agent']) {
    const input = page.getByRole('textbox', { name: `${panel} draft` })
    await input.fill(`${panel} unsent draft`)
    const original = await input.elementHandle()
    await page.locator(`[data-scroll="${panel}"]`).evaluate(node => { node.scrollTop = 240 })
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole('button', { name: `Toggle ${panel}`, exact: true }).click()
      await assertHidden(panel)
      await page.getByRole('button', { name: `Toggle ${panel}`, exact: true }).click()
      assert(await original.evaluate(node => node.isConnected && node === document.querySelector(`[aria-label="${node.getAttribute('aria-label')}"]`)), `${panel}: reopening must preserve the mounted input`)
      assert.equal(await input.inputValue(), `${panel} unsent draft`)
      assert.equal(await page.locator(`[data-scroll="${panel}"]`).evaluate(node => node.scrollTop), 240)
    }
  }
  await page.getByRole('button', { name: 'Focus agent', exact: true }).click()
  await assertHidden('editor')
  await assertHidden('sidebar')
  await assertHidden('terminal')
  await page.getByRole('button', { name: 'Focus agent', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle terminal', exact: true }).click()
  await assertHidden('terminal')
  assert.deepEqual(errors, [])
  console.log('Passed: closed/focused panels leave no remnants or focus targets; reopen preserves DOM, drafts and scroll')
} finally {
  await browser.close()
}
