import { randomUUID } from 'node:crypto'

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const port = Number(argument('port', '9333'))
const windowCount = Number(argument('windows', '3'))
const durationSeconds = Number(argument('duration', '120'))
const outputKbps = Number(argument('output-kbps', '128'))
const memoryMb = Number(argument('memory-mb', '64'))
const workspace = argument('workspace', process.cwd())
const loadScript = argument('load-script', new URL('./shell-load.mjs', import.meta.url).pathname)

if (!Number.isInteger(windowCount) || windowCount < 1 || windowCount > 6) {
  throw new Error('--windows must be an integer between 1 and 6')
}

let requestId = 0

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`CDP target query failed: HTTP ${response.status}`)
  return (await response.json()).filter(target => target.type === 'page' && target.webSocketDebuggerUrl)
}

async function waitForTargets(count, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = await targets().catch(() => [])
    if (current.length >= count) return current
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${count} renderer targets`)
}

async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  const id = ++requestId
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), 30_000)
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id !== id) return
      clearTimeout(timeout)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    })
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }))
  })
  socket.close()

  const exception = result.exceptionDetails?.exception?.description || result.exceptionDetails?.text
  if (exception) throw new Error(exception)
  return result.result?.value
}

const initialTargets = await waitForTargets(1)
const firstTarget = initialTargets[0]
await evaluate(firstTarget, `window.electronAPI?.getAppVersion?.()`)

for (let index = initialTargets.length; index < windowCount; index += 1) {
  await evaluate(firstTarget, `window.electronAPI.newWindow()`)
}

const rendererTargets = (await waitForTargets(windowCount)).slice(0, windowCount)
const terminals = []

for (const [index, target] of rendererTargets.entries()) {
  const id = `diagnostic-${randomUUID()}`
  const createResult = await evaluate(target, `window.electronAPI.createTerminal(${JSON.stringify({
    id,
    cwd: workspace,
    shell: 'powershell.exe',
    backend: 'pty',
    isAgent: true,
  })})`)
  if (!createResult?.success) {
    throw new Error(`Window ${index + 1} failed to create terminal: ${createResult?.error || 'unknown error'}`)
  }
  terminals.push({ target, id })
}

await new Promise(resolve => setTimeout(resolve, 2_000))

const command = `node "${loadScript}" --duration ${durationSeconds} --output-kbps ${outputKbps} --memory-mb ${memoryMb}\r`
for (const { target, id } of terminals) {
  await evaluate(target, `window.electronAPI.writeTerminal(${JSON.stringify(id)}, ${JSON.stringify(command)})`)
}

console.log(JSON.stringify({
  type: 'adnify-cdp-multiwindow-test-started',
  windowCount,
  terminalIds: terminals.map(item => item.id),
  durationSeconds,
  outputKbps,
  memoryMb,
}))

await new Promise(resolve => setTimeout(resolve, (durationSeconds + 10) * 1000))

for (const { target, id } of terminals) {
  await evaluate(target, `window.electronAPI.killTerminal(${JSON.stringify(id)})`).catch(() => undefined)
}

console.log(JSON.stringify({ type: 'adnify-cdp-multiwindow-test-finished' }))
