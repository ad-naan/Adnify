/**
 * Web Worker 服务
 * 管理计算密集型任务的 Worker 池
 */

import { logger } from '@utils/Logger'
import { getEditorConfig } from '@renderer/settings'
import type { WorkerRequest, WorkerResponse, WorkerMessageType } from '../workers/computeWorker'
import { calculateWorkerPoolSize } from './workerPoolPolicy'

export { calculateWorkerPoolSize } from './workerPoolPolicy'

interface PendingTask {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export class WorkerService {
  private workers: Worker[] = []
  private pendingTasks = new Map<string, PendingTask>()
  private taskQueue: WorkerRequest[] = []
  private workerTasks = new Map<Worker, string>()
  private initialized = false
  private taskIdCounter = 0

  constructor(private readonly poolSize = calculateWorkerPoolSize(
    typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
  )) {}

  /**
   * 初始化 Worker 池
   */
  init(): void {
    if (this.initialized) return

    try {
      for (let i = 0; i < this.poolSize; i++) {
        this.createWorker()
      }

      this.initialized = true
      logger.system.info(`[WorkerService] Initialized with ${this.poolSize} workers`)
    } catch (e) {
      for (const worker of [...this.workers]) this.removeWorker(worker)
      logger.system.error('[WorkerService] Failed to initialize:', e)
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(
      new URL('../workers/computeWorker.ts', import.meta.url),
      { type: 'module' }
    )
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleWorkerResponse(worker, e.data)
    worker.onerror = (e) => this.handleWorkerError(worker, new Error(e.message))
    worker.onmessageerror = () => this.handleWorkerError(worker, new Error('Unable to deserialize worker response'))
    this.workers.push(worker)
    return worker
  }

  private removeWorker(worker: Worker): void {
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    this.workerTasks.delete(worker)
    this.workers = this.workers.filter(item => item !== worker)
  }

  /**
   * 执行任务
   */
  async execute<T>(type: WorkerMessageType, payload: unknown): Promise<T> {
    if (!this.initialized) {
      this.init()
    }

    // 如果没有可用的 Worker，在主线程执行（降级）
    if (this.workers.length === 0 && (!this.initialized || this.poolSize <= 0)) {
      return this.executeFallback<T>(type, payload)
    }

    const id = `task-${++this.taskIdCounter}`
    const request: WorkerRequest = { id, type, payload }

    return new Promise<T>((resolve, reject) => {
      const taskTimeout = getEditorConfig().performance.workerTimeoutMs
      const timeout = setTimeout(() => {
        this.pendingTasks.delete(id)
        // Release queued payloads, and stop synchronous work that cannot observe
        // cancellation (for example a pathological regular expression).
        this.taskQueue = this.taskQueue.filter(task => task.id !== id)
        const worker = this.workers.find(item => this.workerTasks.get(item) === id)
        if (worker) this.removeWorker(worker)
        reject(new Error(`Task ${type} timed out after ${taskTimeout}ms`))
        this.processQueue()
      }, taskTimeout)

      this.pendingTasks.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      })

      this.taskQueue.push(request)
      this.processQueue()
    })
  }

  /**
   * 计算 diff
   */
  async computeDiff(
    oldText: string,
    newText: string,
    options?: { ignoreWhitespace?: boolean; contextLines?: number }
  ): Promise<Array<{ type: 'add' | 'remove' | 'unchanged'; content: string; oldLineNumber?: number; newLineNumber?: number }>> {
    return this.execute('diff', { oldText, newText, options })
  }

  /**
   * 搜索文本
   */
  async searchText(
    text: string,
    pattern: string,
    options?: { isRegex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; maxResults?: number }
  ): Promise<Array<{ line: number; column: number; length: number; text: string }>> {
    return this.execute('search', { text, pattern, options })
  }

  /**
   * 处理 Worker 响应
   */
  private handleWorkerResponse(worker: Worker, response: WorkerResponse): void {
    if (this.workerTasks.get(worker) !== response.id) return
    this.workerTasks.delete(worker)

    const task = this.pendingTasks.get(response.id)
    if (task) {
      clearTimeout(task.timeout)
      this.pendingTasks.delete(response.id)

      if (response.success) {
        task.resolve(response.result)
      } else {
        task.reject(new Error(response.error || 'Unknown error'))
      }
    }

    // 处理队列中的下一个任务
    this.processQueue()
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(worker: Worker, error: Error): void {
    if (!this.workers.includes(worker)) return
    const id = this.workerTasks.get(worker)
    this.removeWorker(worker)
    const task = id ? this.pendingTasks.get(id) : undefined
    if (task && id) {
      clearTimeout(task.timeout)
      this.pendingTasks.delete(id)
      task.reject(error)
    }
    logger.system.error('[WorkerService] Worker error:', error)

    // 处理队列中的下一个任务
    this.processQueue()
  }

  /**
   * 处理任务队列
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      let availableWorker = this.workers.find(w => !this.workerTasks.has(w))
      if (!availableWorker && this.workers.length < this.poolSize) {
        try {
          availableWorker = this.createWorker()
        } catch (error) {
          // Reject queued work rather than retaining its payloads until timeout.
          for (const request of this.taskQueue.splice(0)) {
            const pending = this.pendingTasks.get(request.id)
            if (!pending) continue
            clearTimeout(pending.timeout)
            this.pendingTasks.delete(request.id)
            pending.reject(error instanceof Error ? error : new Error(String(error)))
          }
          break
        }
      }
      if (!availableWorker) break

      const task = this.taskQueue.shift()
      if (task && this.pendingTasks.has(task.id)) {
        this.workerTasks.set(availableWorker, task.id)
        try {
          availableWorker.postMessage(task)
        } catch (error) {
          this.handleWorkerError(availableWorker, error instanceof Error ? error : new Error(String(error)))
        }
      }
    }
  }

  /**
   * 降级：在主线程执行
   */
  private async executeFallback<T>(type: WorkerMessageType, payload: unknown): Promise<T> {
    logger.system.warn('[WorkerService] Falling back to main thread execution')

    switch (type) {
      case 'diff':
        // 简单的 diff 降级实现
        const { oldText, newText } = payload as { oldText: string; newText: string }
        const oldLines = oldText.split('\n')
        const newLines = newText.split('\n')
        const result: Array<{ type: 'add' | 'remove' | 'unchanged'; content: string }> = []
        
        const maxLen = Math.max(oldLines.length, newLines.length)
        for (let i = 0; i < maxLen; i++) {
          if (i >= oldLines.length) {
            result.push({ type: 'add', content: newLines[i] })
          } else if (i >= newLines.length) {
            result.push({ type: 'remove', content: oldLines[i] })
          } else if (oldLines[i] === newLines[i]) {
            result.push({ type: 'unchanged', content: newLines[i] })
          } else {
            result.push({ type: 'remove', content: oldLines[i] })
            result.push({ type: 'add', content: newLines[i] })
          }
        }
        return result as T

      default:
        throw new Error(`Unsupported fallback for type: ${type}`)
    }
  }

  /**
   * 销毁所有 Worker
   */
  destroy(): void {
    for (const worker of [...this.workers]) this.removeWorker(worker)
    
    // 拒绝所有待处理的任务
    for (const [, task] of this.pendingTasks) {
      clearTimeout(task.timeout)
      task.reject(new Error('Worker service destroyed'))
    }
    this.pendingTasks.clear()
    this.taskQueue = []
    this.initialized = false

    logger.system.info('[WorkerService] Destroyed')
  }
}

export const workerService = new WorkerService()
