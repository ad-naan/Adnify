import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const browser = await chromium.launch({ channel: process.env.MOTION_BROWSER_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
const url = process.env.FIRST_MESSAGE_URL || 'http://127.0.0.1:5199/tests/browser/first-message.html'
try {
  await page.goto(url)
  const checkFirstSend = async () => {
    await page.getByText('Start a conversation').waitFor()
    assert.equal(await page.locator('[data-virtuoso-scroller]').count(), 0, 'welcome screen must not initialize the virtual list')
    await page.getByRole('button', { name: 'Send first message' }).click()
    // No wheel, incoming response, or follow-up state update may be needed.
    await page.waitForFunction(() => {
      const scroller = document.querySelector('[data-virtuoso-scroller]')
      if (!scroller) return false
      const bounds = scroller.getBoundingClientRect()
      return [0, 1].every(index => {
        const row = document.querySelector(`[data-message="${index}"]`)
        if (!row || getComputedStyle(row).visibility !== 'visible') return false
        const rect = row.getBoundingClientRect()
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom
      }) && scroller.scrollTop === 0
    }, null, { timeout: 2000 })
    assert.equal(await page.locator('[data-chat-scroll-tail]').count(), 0)
  }
  await checkFirstSend()
  await page.getByRole('button', { name: 'Open history' }).click()
  await page.waitForFunction(() => {
    const scroller = document.querySelector('[data-virtuoso-scroller]')
    return scroller && scroller.scrollTop > 0 && Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 2
      && !!document.querySelector('[data-message="29"]')
  }, null, { timeout: 3000 })
  await page.getByRole('button', { name: 'New conversation' }).click()
  await checkFirstSend()
  assert.deepEqual(errors, [])
  console.log('Passed: first send without scroll/output, history bottom, new conversation, no browser errors')
} finally {
  await browser.close()
}
