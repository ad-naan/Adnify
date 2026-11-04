import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: process.env.MOTION_BROWSER_CHANNEL || 'chromium', headless: true })
const page = await browser.newPage({ viewport: { width: 800, height: 760 } })
page.setDefaultTimeout(10000)
page.setDefaultNavigationTimeout(60000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(process.env.GIT_TEST_URL || 'http://127.0.0.1:5199/tests/browser/git-list.html')
  const first = page.locator('[data-git-file="src/features/feature-0/component.tsx"]')
  await first.waitFor()
  const count = await page.locator('[data-git-file]').count()
  assert(count < 100, `5000 files must not mount together: mounted ${count}`)
  await first.focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('output').textContent(), 'src/features/feature-0/component.tsx')

  await page.getByRole('button', { name: 'Toggle staged', exact: true }).click()
  await page.locator('[data-git-file="src/features/feature-1000/component.tsx"]').waitFor()
  const scroller = page.locator('[data-git-scroll]')
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight })
  const last = page.locator('[data-git-file="src/features/feature-4999/component.tsx"]')
  await last.waitFor()
  await last.scrollIntoViewIfNeeded()
  await last.click()
  assert.equal(await page.locator('output').textContent(), 'src/features/feature-4999/component.tsx')
  await last.getByTitle('Stage').click()
  await last.waitFor({ state: 'detached' })
  await page.locator('[data-git-file="src/features/feature-4998/component.tsx"]').waitFor()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.locator('output[data-generation="1"]').waitFor()
  assert(await page.locator('[data-git-file]').count() < 100)

  await page.getByRole('button', { name: 'Small repository', exact: true }).click()
  await scroller.evaluate(node => { node.scrollTop = 0 })
  await page.locator('[data-git-file="src/features/feature-2/component.tsx"]').waitFor()
  assert.equal(await page.locator('[data-git-file]').count(), 3)
  if (process.env.BROWSER_TEST_ARTIFACTS) {
    await mkdir(process.env.BROWSER_TEST_ARTIFACTS, { recursive: true })
    await page.screenshot({ path: path.join(process.env.BROWSER_TEST_ARTIFACTS, 'git-list.png') })
  }
  assert.deepEqual(errors, [])
  console.log(`Git list regression passed; initial mounted rows: ${count}/5000`)
} finally {
  await browser.close()
}
