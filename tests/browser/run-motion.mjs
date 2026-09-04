import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const artifactDir = path.resolve(process.env.MOTION_ARTIFACT_DIR || 'tmp/conversation-motion')
const browser = await chromium.launch({ channel: process.env.MOTION_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, recordVideo: { dir: artifactDir } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.exposeFunction('__motionReportError', message => errors.push(message))
await page.addInitScript(() => window.addEventListener('error', event => window.__motionReportError(event.message)))
const url = 'http://127.0.0.1:5199/tests/browser/conversation-motion.html'
try {
  await page.goto(url)
  await page.waitForFunction(() => !!window.motionTest)
  await page.evaluate(() => {
    window.motionTest.publish([{ type: 'tool_call', toolCall: { id: 'first', name: 'read_file', arguments: {}, status: 'running' } }], true)
  })
  await page.waitForTimeout(900)
  const entrance = await page.evaluate(() => window.motionTest.samples.filter(sample => sample.headerY !== undefined))
  const downwardEntryJump = Math.max(0, ...entrance.slice(1).map((sample, index) => sample.headerY - entrance[index].headerY))
  assert(downwardEntryJump <= 2, `entry jumped down ${downwardEntryJump}px`)
  await page.evaluate(() => {
    window.motionTest.samples.length = 0
    window.motionTest.publish([
      { type: 'tool_call', toolCall: { id: 'first', name: 'read_file', arguments: {}, status: 'success' } },
      { type: 'text', content: 'The final answer now streams after the result has settled. '.repeat(8) },
    ], false)
  })
  await page.waitForFunction(() => window.motionTest.samples.some(sample => sample.phase === 'complete'), null, { timeout: 15000 })
  const samples = await page.evaluate(() => window.motionTest.samples)
  const collapse = samples.filter(sample => sample.phase === 'handoff' && sample.headerY !== undefined)
  const drift = Math.max(...collapse.map(sample => sample.headerY)) - Math.min(...collapse.map(sample => sample.headerY))
  await page.screenshot({ path: path.join(artifactDir, 'motion-result.png') })
  assert(collapse.length > 5, 'must observe actual collapse animation frames')
  assert(drift <= 2, `header drifted ${drift}px during collapse`)
  const bodyLengths = samples.map(sample => sample.body?.length || 0)
  assert(bodyLengths.some(length => length > 0 && length < 100), 'body must stream rather than flush')
  assert(bodyLengths.every((length, index) => index === 0 || length >= bodyLengths[index - 1]), 'body must never rewind')
  await page.waitForTimeout(600)
  const afterDock = await page.locator('[data-tool="first"] button').evaluate(node => node.getBoundingClientRect().top)
  assert(Math.abs(afterDock - samples.at(-1).headerY) <= 2, 'dock collapse moved the reading anchor')
  await page.reload()
  await page.waitForFunction(() => !!window.motionTest)
  await page.evaluate(() => window.motionTest.publish([
    { type: 'text', content: 'Approval context needs to be read first. '.repeat(5) },
    { type: 'tool_call', toolCall: { id: 'first', name: 'run_command', arguments: {}, status: 'awaiting' } },
  ], true))
  await page.waitForSelector('[data-approval]', { timeout: 15000 })
  const approvalSamples = await page.evaluate(() => window.motionTest.samples)
  assert(!approvalSamples.some(sample => sample.approval && sample.toolCount === 0), 'dock preceded its tool row')
  assert(!approvalSamples.some(sample => sample.approval && sample.body?.length !== 'Approval context needs to be read first. '.repeat(5).length), 'approval preceded its complete context')
  await page.reload()
  await page.waitForFunction(() => !!window.motionTest)
  await page.evaluate(() => {
    window.motionTest.publish([], true)
    window.motionTest.publish([
      { type: 'tool_call', toolCall: { id: 'first', name: 'read_file', arguments: {}, status: 'success' } },
      { type: 'tool_call', toolCall: { id: 'second', name: 'read_file', arguments: {}, status: 'success' } },
      { type: 'text', content: 'Both tools are complete.' },
    ], false)
  })
  await page.waitForFunction(() => window.motionTest.samples.some(sample => sample.phase === 'complete'), null, { timeout: 15000 })
  const toolSamples = await page.evaluate(() => window.motionTest.samples)
  const firstTool = toolSamples.find(sample => sample.toolCount === 1)
  const secondTool = toolSamples.find(sample => sample.toolCount === 2)
  assert(firstTool && secondTool && secondTool.time - firstTool.time >= 1200, 'tools entered together or skipped the reading dwell')
  await page.waitForTimeout(600)
  await page.locator('[data-tool="first"] button').scrollIntoViewIfNeeded()
  const manualAnchor = await page.locator('[data-tool="first"] button').evaluate(node => node.getBoundingClientRect().top)
  await page.locator('[data-tool="first"] button').click()
  await page.waitForFunction(() => document.querySelector('[data-tool="first"] .agent-disclosure')?.classList.contains('is-open'))
  await page.waitForTimeout(600)
  assert(await page.locator('[data-tool="first"] .agent-disclosure.is-open').count(), 'manual expansion was overridden')
  const afterManual = await page.locator('[data-tool="first"] button').evaluate(node => node.getBoundingClientRect().top)
  assert(Math.abs(afterManual - manualAnchor) <= 2, `manual expansion moved the clicked header from ${manualAnchor} to ${afterManual}`)
  // Exercise the production process disclosure hook with both ordinary and
  // browser tools. Transport completion must not cut off presentation draining.
  for (const name of ['read_file', 'browser_inspect']) {
    await page.goto(`${url}?processFold=1`)
    await page.waitForFunction(() => !!window.motionTest)
    await page.evaluate(name => window.motionTest.publish([
      { type: 'tool_call', toolCall: { id: 'first', name, arguments: {}, status: 'running' } },
    ], true), name)
    await page.waitForSelector('[data-process][aria-expanded="true"]')
    await page.evaluate(name => window.motionTest.publish([
      { type: 'tool_call', toolCall: { id: 'first', name, arguments: {}, status: 'success',
        richContent: [{ type: 'image', data: 'fixture' }, { type: 'markdown', text: 'Screenshot analysis' }] } },
      { type: 'text', content: 'Verified final answer.' },
    ], false), name)
    assert.equal(await page.locator('[data-process]').getAttribute('aria-expanded'), 'true', 'keep process open while presentation drains')
    await page.waitForSelector('[data-process][aria-expanded="false"]', { timeout: 15000 })
    await page.waitForFunction(() => !document.querySelector('[data-tool]'))
    assert.equal(await page.locator('[data-text="text"]').textContent(), 'Verified final answer.')
    assert.equal(await page.locator('[data-rich]').count(), 0, 'rich results must not escape the process fold')
    await page.locator('[data-process]').click()
    await page.waitForSelector('[data-tool="first"] button')
    assert.equal(await page.locator('[data-process]').getAttribute('aria-expanded'), 'true')
    await page.locator('[data-tool="first"] button').click()
    await page.waitForSelector('[data-rich="image"]')
  }
  await page.goto(`${url}?processFold=1`)
  await page.waitForFunction(() => !!window.motionTest)
  await page.evaluate(() => window.motionTest.publish([
    { type: 'tool_call', toolCall: { id: 'first', name: 'browser_action', arguments: {}, status: 'running' } },
  ], true))
  await page.waitForSelector('[data-process][aria-expanded="true"]')
  await page.locator('[data-process]').click()
  await page.locator('[data-process]').click() // Explicitly pin the process open.
  await page.evaluate(() => window.motionTest.publish([
    { type: 'tool_call', toolCall: { id: 'first', name: 'browser_action', arguments: {}, status: 'error' } },
    { type: 'text', content: 'Reported failure.' },
  ], false))
  await page.waitForFunction(() => window.motionTest.samples.some(sample => sample.phase === 'complete'), null, { timeout: 15000 })
  assert.equal(await page.locator('[data-process]').getAttribute('aria-expanded'), 'true', 'preserve an explicit manual expansion')
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(JSON.stringify({ collapseFrames: collapse.length, collapseHeaderDriftPx: drift, downwardEntryJumpPx: downwardEntryJump, streamedBodySamples: new Set(bodyLengths).size, approvalSynchronized: true, toolsEnteredSequentially: true, pageErrors: errors, artifactDir }, null, 2))
} finally {
  await context.close()
  await browser.close()
}
