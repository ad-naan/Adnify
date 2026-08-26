const { Worker } = require('node:worker_threads')
const { mkdtemp, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { randomUUID } = require('node:crypto')

function createClient(workerPath) {
  const worker = new Worker(workerPath)
  const pending = new Map()
  worker.on('message', response => {
    const request = pending.get(response.requestId)
    if (!request) return
    pending.delete(response.requestId)
    if (response.ok) request.resolve(response.result)
    else request.reject(new Error(response.error))
  })
  worker.on('error', error => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  })
  return {
    request(operation) {
      const requestId = randomUUID()
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        worker.postMessage({ requestId, operation })
      })
    },
    terminate: () => worker.terminate(),
  }
}

async function fileBytes(filePath) {
  return stat(filePath).then(value => value.size).catch(() => 0)
}

async function benchmarkStructural(root) {
  const workerPath = path.resolve('dist/main/structuralIndexStore.worker.js')
  const databasePath = path.join(root, 'structural.sqlite')
  const client = createClient(workerPath)
  const generation = randomUUID()
  const fileCount = 2_000
  const chunkCount = 10_000
  const chunks = Array.from({ length: chunkCount }, (_, index) => {
    const fileIndex = Math.floor(index / 5)
    const relativePath = `src/file-${fileIndex}.ts`
    return {
      id: `chunk-${index}`,
      filePath: path.join(root, relativePath),
      relativePath,
      fileHash: `hash-${fileIndex}`,
      content: `export function symbol${index}() { return ${index} }`,
      startLine: index % 5,
      endLine: index % 5,
      type: 'function',
      language: 'typescript',
      symbols: [`symbol${index}`],
    }
  })

  const writeStart = performance.now()
  await client.request({ type: 'beginReplace', databasePath, generation })
  for (let offset = 0; offset < chunks.length; offset += 512) {
    await client.request({
      type: 'appendReplace', databasePath, generation,
      chunks: chunks.slice(offset, offset + 512),
    })
  }
  await client.request({
    type: 'commitReplace', databasePath, generation,
    metadata: { totalFiles: fileCount, totalChunks: chunkCount, savedAt: Date.now() },
  })
  const writeMs = performance.now() - writeStart

  const readStart = performance.now()
  let cursor
  let loaded = 0
  let pages = 0
  do {
    const result = await client.request({ type: 'loadPage', databasePath, cursor })
    loaded += result.chunks.length
    pages += 1
    cursor = result.nextCursor || undefined
  } while (cursor)
  const readMs = performance.now() - readStart
  await client.request({ type: 'close', databasePath })
  await client.terminate()

  return {
    files: fileCount,
    chunks: loaded,
    pages,
    writeMs: Math.round(writeMs),
    readMs: Math.round(readMs),
    databaseBytes: await fileBytes(databasePath),
  }
}

async function benchmarkSessions(root) {
  const workerPath = path.resolve('dist/main/sessionStorage.worker.js')
  const databasePath = path.join(root, 'sessions.sqlite3')
  const client = createClient(workerPath)
  const threadCount = 100
  const messagesPerThread = 100
  const payloadText = 'session-payload-'.repeat(32)
  const threads = Array.from({ length: threadCount }, (_, threadIndex) => ({
    metadata: {
      id: `thread-${threadIndex}`,
      createdAt: threadIndex,
      lastModified: threadIndex,
      title: `Thread ${threadIndex}`,
      messageCount: messagesPerThread,
      data: {},
    },
    replaceFrom: 0,
    messages: Array.from({ length: messagesPerThread }, (_, ordinal) => ({
      ordinal,
      id: `message-${threadIndex}-${ordinal}`,
      role: ordinal % 2 === 0 ? 'user' : 'assistant',
      timestamp: ordinal,
      payload: { id: `message-${threadIndex}-${ordinal}`, content: payloadText },
    })),
  }))

  await client.request({ type: 'open', databasePath })
  const writeStart = performance.now()
  await client.request({
    type: 'applyPatch', databasePath,
    patch: { threads, deletedThreadIds: [], branchThreads: [] },
  })
  const writeMs = performance.now() - writeStart

  const catalogStart = performance.now()
  await client.request({ type: 'loadCatalog', databasePath })
  const catalogMs = performance.now() - catalogStart
  const threadStart = performance.now()
  await client.request({ type: 'loadMessages', databasePath, threadId: 'thread-50' })
  const threadMs = performance.now() - threadStart

  const tailStart = performance.now()
  await client.request({
    type: 'applyPatch', databasePath,
    patch: {
      deletedThreadIds: [], branchThreads: [],
      threads: [{
        metadata: { ...threads[50].metadata, lastModified: Date.now() },
        replaceFrom: 99,
        messages: [{ ...threads[50].messages[99], payload: { id: 'tail', content: 'updated' } }],
      }],
    },
  })
  const tailWriteMs = performance.now() - tailStart
  const stats = await client.request({ type: 'getStats', databasePath })
  await client.request({ type: 'closeAll' })
  await client.terminate()

  return {
    threads: threadCount,
    messages: threadCount * messagesPerThread,
    writeMs: Math.round(writeMs),
    catalogMs: Math.round(catalogMs),
    activeThreadMs: Math.round(threadMs),
    tailWriteMs: Math.round(tailWriteMs),
    databaseBytes: stats.stats.databaseBytes,
    walBytesBeforeClose: stats.stats.walBytes,
  }
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'adnify-sqlite-benchmark-'))
  try {
    const structural = await benchmarkStructural(root)
    const sessions = await benchmarkSessions(root)
    process.stdout.write(`${JSON.stringify({ structural, sessions }, null, 2)}\n`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
