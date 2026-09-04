import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const browser = await chromium.launch({ channel: process.env.MOTION_BROWSER_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const base = 'http://127.0.0.1:5199/tests/browser/'
try {
  await page.goto(`${base}thread-switch.html`)
  await page.getByRole('button', { name: 'Start live reply' }).click()
  assert.equal(await page.locator('output').textContent(), 'Visible parts: 3')
  assert.equal(await page.getByText('Already received answer.', { exact: true }).count(), 1)
  assert.equal(await page.getByText('browser_inspect: success', { exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Switch away' }).click()
  await page.getByRole('button', { name: 'Return to reply' }).click()
  assert.equal(await page.locator('output').textContent(), 'Visible parts: 3')
  assert.equal(await page.getByText('Already received answer.', { exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Switch away' }).click()
  await page.getByRole('button', { name: 'Finish reply' }).click()
  await page.getByRole('button', { name: 'Return to reply' }).click()
  assert.equal(await page.locator('[role="status"]').textContent(), 'Idle')
  assert.equal(await page.getByText('Already received answer. Final answer.', { exact: true }).count(), 1)
  for (const variant of ['', '?dock']) {
  await page.goto(`${base}scroll-tail.html${variant}`)
  await page.getByRole('button', { name: 'Finish with a short reply' }).click()
  await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('tailVisible'))
  const geometry = JSON.parse(await page.locator('output').textContent())
  assert.equal(geometry.tailVisible, 'none')
  assert.equal(geometry.tail, '0px')
  assert.equal(geometry.top, geometry.scrollHeight - geometry.viewport)
  assert(geometry.frames > 10, 'sample the collapse itself, not just its final state')
  assert.equal(geometry.maxTail, 0, 'never insert a compensation tail')
  assert(geometry.maxGap <= 2, `reply moved away from the viewport bottom by ${geometry.maxGap}px`)
  }
  await page.goto(`${base}scroll-tail.html?short`)
  await page.getByRole('button', { name: 'Toggle tool result' }).click()
  await page.waitForFunction(() => !document.querySelector('.agent-disclosure.is-open'))
  await page.getByRole('button', { name: 'Inspect geometry' }).click()
  const short = JSON.parse(await page.locator('output').textContent())
  assert.equal(short.top, 0)
  assert.equal(short.tailVisible, 'none')
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('Thread rendering and scroll tail regressions passed')
} finally {
  await browser.close()
}
