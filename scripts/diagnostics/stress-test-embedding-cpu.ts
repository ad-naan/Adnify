import { EmbeddingService } from '../../src/main/indexing/embedder'
import { performance } from 'perf_hooks'

async function runEmbeddingStressTest() {
  console.log('=====================================================')
  console.log('  Local Transformers Embedding CPU Stress Benchmark')
  console.log('=====================================================\n')

  const service = new EmbeddingService({
    provider: 'transformers',
    model: 'Xenova/all-MiniLM-L6-v2'
  })

  console.log('Testing local transformer model embedding...')
  const sampleTexts = [
    'export async function executeTools(toolCalls: ToolCall[], context: ToolExecutionContext): Promise<ToolExecutionResult[]>',
    'const { terminalManager } = await import("@/renderer/services/TerminalManager")',
    'export class StreamingEditPreviewCoordinator { private sessions = new Map<string, StreamingEditPreviewSession>() }',
    'function calculateLineChanges(oldContent: string, newContent: string): { added: number; removed: number }',
    'export function useDecorativeAnimations(): boolean { const enabled = useSyncExternalStore(subscribe, resolve) }',
  ]

  // Warmup (will trigger model load)
  console.log('Loading model and warming up...')
  const warmStart = performance.now()
  try {
    await service.embed(sampleTexts[0])
    console.log(`Model loaded and warmup complete in ${(performance.now() - warmStart).toFixed(0)} ms\n`)
  } catch (err) {
    console.log('Notice: Local Xenova model download or load failed (requires HF network access or cached model):', (err as Error).message)
    console.log('Skipping local transformer benchmark if weights not cached.\n')
    return
  }

  // Measure batch embedding CPU utilization
  const batchSizes = [10, 30]
  for (const size of batchSizes) {
    const texts = Array.from({ length: size }, (_, i) => sampleTexts[i % sampleTexts.length] + ` /* variant ${i} */`)
    console.log(`--- Running batch embedding of ${size} chunks ---`)
    const startCpu = process.cpuUsage()
    const startTime = performance.now()

    await service.embedBatch(texts)

    const durationMs = performance.now() - startTime
    const cpuDelta = process.cpuUsage(startCpu)
    const totalCpuTimeMs = (cpuDelta.user + cpuDelta.system) / 1000
    const cpuUtilizationPct = ((totalCpuTimeMs / durationMs) * 100).toFixed(1)

    console.log(`Batch size:           ${size}`)
    console.log(`Time elapsed:         ${durationMs.toFixed(1)} ms`)
    console.log(`Total CPU Time:       ${totalCpuTimeMs.toFixed(1)} ms`)
    console.log(`CPU Utilization:      ${cpuUtilizationPct}% across CPU cores`)
    console.log(`Latency per chunk:    ${(durationMs / size).toFixed(1)} ms/chunk\n`)
  }

  await EmbeddingService.releaseLocalModel()
}

runEmbeddingStressTest().catch(console.error)
