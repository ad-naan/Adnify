import { once } from 'node:events'

function readNumber(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a number`)
  }
  return value
}

function bounded(value, min, max, name) {
  if (value < min || value > max) {
    throw new Error(`--${name} must be between ${min} and ${max}`)
  }
  return value
}

const durationSeconds = bounded(readNumber('duration', 180), 5, 900, 'duration')
const outputKbps = bounded(readNumber('output-kbps', 128), 1, 4096, 'output-kbps')
const memoryMb = bounded(readNumber('memory-mb', 64), 0, 1024, 'memory-mb')
const tickMs = 100
const bytesPerTick = Math.max(1, Math.round(outputKbps * 1024 * tickMs / 1000))
const retainedMemory = memoryMb > 0 ? Buffer.alloc(memoryMb * 1024 * 1024, 0x5a) : null
const startedAt = Date.now()
let stopping = false
let sequence = 0

process.on('SIGINT', () => {
  stopping = true
})

async function write(text) {
  if (!process.stdout.write(text)) {
    await once(process.stdout, 'drain')
  }
}

await write(`${JSON.stringify({
  type: 'adnify-shell-load-start',
  pid: process.pid,
  durationSeconds,
  outputKbps,
  memoryMb,
  startedAt: new Date(startedAt).toISOString(),
})}\n`)

while (!stopping && Date.now() - startedAt < durationSeconds * 1000) {
  const prefix = `[adnify-load pid=${process.pid} seq=${sequence++}] `
  const payloadLength = Math.max(1, bytesPerTick - prefix.length - 1)
  await write(`${prefix}${'x'.repeat(payloadLength)}\n`)
  await new Promise(resolve => setTimeout(resolve, tickMs))
}

// Keep the allocation observably live until the run has finished.
const checksum = retainedMemory ? retainedMemory[0] + retainedMemory[retainedMemory.length - 1] : 0
await write(`${JSON.stringify({
  type: 'adnify-shell-load-end',
  pid: process.pid,
  elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
  checksum,
  stoppedBySignal: stopping,
  endedAt: new Date().toISOString(),
})}\n`)
