// Start with: node node_modules/vite/bin/vite.js --config tests/browser/vite.window-focus.config.mjs
// Then: node tests/browser/run-window-focus.mjs (supports PLAYWRIGHT_MODULE_PATH).
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const browser = await chromium.launch({ channel: process.env.MOTION_BROWSER_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
const geometry = () => page.locator('[data-virtuoso-scroller]').evaluate(node => ({
  top: node.scrollTop, bottom: node.scrollHeight - node.clientHeight,
}))
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
try {
  await page.goto(process.env.WINDOW_FOCUS_URL || 'http://127.0.0.1:5214/tests/browser/window-focus.html')
  await page.waitForFunction(() => {
    const scroller = document.querySelector('[data-virtuoso-scroller]')
    return scroller && scroller.scrollTop > 0 && Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 2
  })
  // Simulate each window activation deterministically, including environments
  // where headless Chromium does not update document.hasFocus() for OS windows.
  const focus = async active => {
    await page.evaluate(active => {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => active })
      window.dispatchEvent(new Event(active ? 'focus' : 'blur'))
    }, active)
    await page.locator(`output[data-animations="${active}"]`).waitFor()
    await settle()
  }
  await focus(true)
  const original = await page.locator('[data-virtuoso-scroller]').elementHandle()
  const assertUnchanged = async expected => {
    assert(await original.evaluate(node => node.isConnected && node === document.querySelector('[data-virtuoso-scroller]')), 'window focus must not remount the chat scroller')
    assert(Math.abs((await geometry()).top - expected) <= 2, 'window focus must preserve the reading position')
  }
  const bottom = (await geometry()).top
  for (let cycle = 0; cycle < 3; cycle++) {
    await focus(false)
    await assertUnchanged(bottom)
    await focus(true)
    await assertUnchanged(bottom)
  }
  // Following the latest reply survives a background update and reactivation.
  await focus(false)
  await page.getByRole('button', { name: 'Grow reply' }).click()
  await page.waitForFunction(previous => {
    const node = document.querySelector('[data-virtuoso-scroller]')
    return node.scrollTop > previous && Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 2
  }, bottom)
  await focus(true)
  await assertUnchanged((await geometry()).bottom)

  // Real wheel input opts out of following; neither focus nor new output may
  // drag a user reading older messages to the tail.
  await page.locator('[data-virtuoso-scroller]').hover()
  await page.mouse.wheel(0, -800)
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-virtuoso-scroller]')
    return node.scrollHeight - node.clientHeight - node.scrollTop > 400
  })
  await settle()
  const history = (await geometry()).top
  await focus(false)
  await assertUnchanged(history)
  await page.getByRole('button', { name: 'Grow reply' }).click()
  await settle()
  await focus(true)
  await assertUnchanged(history)
  assert.deepEqual(errors, [])
  console.log('Passed: focus cycles preserve DOM/position, background replies follow, history reading stays put')
} catch (error) {
  console.error(await page.evaluate(() => ({
    animations: document.querySelector('output')?.textContent,
    scrollers: [...document.querySelectorAll('[data-virtuoso-scroller]')].map(node => ({
      top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight, rows: node.querySelectorAll('[data-message]').length,
    })),
  })))
  throw error
} finally {
  await browser.close()
}
