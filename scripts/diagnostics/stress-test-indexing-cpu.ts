import { TreeSitterChunker } from '../../src/main/indexing/treeSitterChunker'
import { ChunkerService } from '../../src/main/indexing/chunker'
import { DEFAULT_INDEX_CONFIG } from '../../src/main/indexing/types'
import * as fs from 'fs'
import * as path from 'path'
import { performance } from 'perf_hooks'

async function runIndexingStressTest() {
  console.log('=====================================================')
  console.log('  Agent Incremental Indexing CPU Stress Benchmark')
  console.log('=====================================================\n')

  const chunker = new TreeSitterChunker(DEFAULT_INDEX_CONFIG)
  await chunker.init()

  // Collect real source files from the project to test with realistic AST complexity
  const sampleFiles: Array<{ filePath: string; content: string }> = []
  const searchDirs = ['src/main/indexing', 'src/renderer/agent', 'src/shared/utils']

  for (const dir of searchDirs) {
    const fullDir = path.resolve(dir)
    if (fs.existsSync(fullDir)) {
      const entries = fs.readdirSync(fullDir)
      for (const entry of entries) {
        if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          const filePath = path.join(fullDir, entry)
          const content = fs.readFileSync(filePath, 'utf-8')
          sampleFiles.push({ filePath, content })
          if (sampleFiles.length >= 30) break
        }
      }
    }
  }

  console.log(`Loaded ${sampleFiles.length} real project source files for benchmark.`)
  const totalLines = sampleFiles.reduce((acc, f) => acc + f.content.split('\n').length, 0)
  const totalBytes = sampleFiles.reduce((acc, f) => acc + f.content.length, 0)
  console.log(`Total code size: ${(totalBytes / 1024).toFixed(1)} KB, total lines: ${totalLines}\n`)

  // Warmup run
  for (let i = 0; i < 3; i++) {
    await chunker.chunkFile(sampleFiles[i].filePath, sampleFiles[i].content, process.cwd())
  }

  // --- Benchmark 1: TreeSitter AST Parsing & Chunking ---
  console.log('--- Test 1: Simulating Agent modifying 30 files in sequence ---')
  const startCpu = process.cpuUsage()
  const startMem = process.memoryUsage()
  const startTime = performance.now()

  let totalChunks = 0
  for (const file of sampleFiles) {
    const chunks = await chunker.chunkFile(file.filePath, file.content, process.cwd())
    totalChunks += chunks.length
  }

  const durationMs = performance.now() - startTime
  const cpuDelta = process.cpuUsage(startCpu)
  const endMem = process.memoryUsage()

  const totalCpuTimeMs = (cpuDelta.user + cpuDelta.system) / 1000
  const cpuUtilizationPct = ((totalCpuTimeMs / durationMs) * 100).toFixed(1)

  console.log(`Time elapsed:         ${durationMs.toFixed(1)} ms`)
  console.log(`CPU User Time:        ${(cpuDelta.user / 1000).toFixed(1)} ms`)
  console.log(`CPU System Time:      ${(cpuDelta.system / 1000).toFixed(1)} ms`)
  console.log(`Total CPU Time:       ${totalCpuTimeMs.toFixed(1)} ms`)
  console.log(`CPU Core Load:        ${cpuUtilizationPct}% (equivalent to full single core saturation)`)
  console.log(`Generated Chunks:     ${totalChunks}`)
  console.log(`Throughput:           ${(sampleFiles.length / (durationMs / 1000)).toFixed(1)} files/s`)
  console.log(`Heap Delta:           ${((endMem.heapUsed - startMem.heapUsed) / 1024 / 1024).toFixed(2)} MB\n`)

  // --- Benchmark 2: Simulating high-frequency edits (100 rapid file updates) ---
  console.log('--- Test 2: Rapid file edits stress test (100 iterations on 10 files) ---')
  const rapidStartCpu = process.cpuUsage()
  const rapidStartTime = performance.now()

  const testSubset = sampleFiles.slice(0, 10)
  let rapidChunks = 0

  for (let round = 0; round < 10; round++) {
    for (const file of testSubset) {
      // Simulate small modification on each iteration
      const modified = file.content + `\n// modified timestamp ${Date.now()}\n`
      const chunks = await chunker.chunkFile(file.filePath, modified, process.cwd())
      rapidChunks += chunks.length
    }
  }

  const rapidDurationMs = performance.now() - rapidStartTime
  const rapidCpuDelta = process.cpuUsage(rapidStartCpu)
  const rapidCpuTimeMs = (rapidCpuDelta.user + rapidCpuDelta.system) / 1000
  const rapidCpuUtilizationPct = ((rapidCpuTimeMs / rapidDurationMs) * 100).toFixed(1)

  console.log(`Time elapsed:         ${rapidDurationMs.toFixed(1)} ms`)
  console.log(`Total CPU Time:       ${rapidCpuTimeMs.toFixed(1)} ms`)
  console.log(`CPU Core Load:        ${rapidCpuUtilizationPct}%`)
  console.log(`Total chunks parsed:  ${rapidChunks}`)
  console.log(`Throughput:           ${(100 / (rapidDurationMs / 1000)).toFixed(1)} parse operations/s\n`)

  // Summary
  console.log('--- Benchmark Results Analysis ---')
  console.log(`AST Parsing consumes ~${(totalCpuTimeMs / sampleFiles.length).toFixed(1)} ms of raw CPU time PER FILE.`)
  console.log(`When an Agent modifies 10 files rapidly, it generates ${((totalCpuTimeMs / sampleFiles.length) * 10).toFixed(0)} ms of CPU work.`)
}

runIndexingStressTest().catch(console.error)
