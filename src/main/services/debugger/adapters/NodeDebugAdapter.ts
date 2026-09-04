/**
 * Node.js 调试适配器
 * 
 * Node.js 使用 Chrome DevTools Protocol (CDP)，不是标准 DAP。
 * 这个适配器将 CDP 转换为 DAP 风格的接口。
 * 
 * 工作流程：
 * 1. 启动 Node.js 进程（带 --inspect-brk 参数）
 * 2. 通过 HTTP 获取 WebSocket URL
 * 3. 通过 WebSocket 连接到 CDP
 * 4. 将 CDP 事件/响应转换为 DAP 格式
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import http from 'http'
import { randomBytes } from 'crypto'
import { Socket } from 'net'
import { logger } from '@shared/utils/Logger'
import type {
  DebugConfig,
  DebugEvent,
  DebugCapabilities,
  Breakpoint,
  SourceBreakpoint,
  StackFrame,
  Thread,
  Scope,
  Variable,
  Source,
} from '../types'

/** CDP 消息 */
interface CDPMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** CDP 调用帧 */
interface CDPCallFrame {
  callFrameId: string
  functionName: string
  location: { scriptId: string; lineNumber: number; columnNumber: number }
  url: string
  scopeChain: Array<{
    type: string
    object: { objectId: string }
    name?: string
  }>
  this: { objectId: string }
}

/** 脚本信息 */
interface ScriptInfo {
  scriptId: string
  url: string
  sourceMapURL?: string
}

/**
 * 简单的 WebSocket 客户端（用于 Node.js 主进程）
 * 实现 RFC 6455 协议的最小子集
 */
class SimpleWebSocket extends EventEmitter {
  private socket: Socket | null = null
  private buffer = Buffer.alloc(0)
  private connected = false

  async connect(url: string): Promise<void> {
    const parsed = new URL(url)
    const host = parsed.hostname
    const port = parseInt(parsed.port) || 80
    const path = parsed.pathname + parsed.search

    return new Promise((resolve, reject) => {
      this.socket = new Socket()
      
      this.socket.on('connect', () => {
        // 发送 WebSocket 握手
        const key = randomBytes(16).toString('base64')
        const request = [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          ''
        ].join('\r\n')
        
        this.socket!.write(request)
      })

      this.socket.on('data', (data) => {
        if (!this.connected) {
          // 处理握手响应
          const response = data.toString()
          if (response.includes('101 Switching Protocols')) {
            this.connected = true
            // 找到头部结束位置
            const headerEnd = data.indexOf('\r\n\r\n')
            if (headerEnd !== -1 && headerEnd + 4 < data.length) {
              // 有剩余数据
              this.buffer = Buffer.concat([this.buffer, data.slice(headerEnd + 4)])
              this.processFrames()
            }
            resolve()
          } else {
            reject(new Error('WebSocket handshake failed'))
          }
        } else {
          this.buffer = Buffer.concat([this.buffer, data])
          this.processFrames()
        }
      })

      this.socket.on('error', (err) => {
        this.emit('error', err)
        if (!this.connected) reject(err)
      })

      this.socket.on('close', () => {
        this.connected = false
        this.emit('close')
      })

      this.socket.connect(port, host)
    })
  }

  send(data: string): void {
    if (!this.socket || !this.connected) return
    
    const payload = Buffer.from(data, 'utf8')
    const frame = this.createFrame(payload)
    this.socket.write(frame)
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  private createFrame(payload: Buffer): Buffer {
    const length = payload.length
    let header: Buffer

    if (length < 126) {
      header = Buffer.alloc(6)
      header[0] = 0x81 // FIN + text frame
      header[1] = 0x80 | length // Masked + length
    } else if (length < 65536) {
      header = Buffer.alloc(8)
      header[0] = 0x81
      header[1] = 0x80 | 126
      header.writeUInt16BE(length, 2)
    } else {
      header = Buffer.alloc(14)
      header[0] = 0x81
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(length), 2)
    }

    // 生成掩码
    const mask = randomBytes(4)
    const maskOffset = header.length - 4
    mask.copy(header, maskOffset)

    // 应用掩码到 payload
    const masked = Buffer.alloc(payload.length)
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ mask[i % 4]
    }

    return Buffer.concat([header, masked])
  }

  private processFrames(): void {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0]
      const secondByte = this.buffer[1]
      
      const opcode = firstByte & 0x0f
      const masked = (secondByte & 0x80) !== 0
      let payloadLength = secondByte & 0x7f
      let offset = 2

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return
        payloadLength = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return
        payloadLength = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }

      if (masked) offset += 4

      const totalLength = offset + payloadLength
      if (this.buffer.length < totalLength) return

      const payload = this.buffer.slice(offset, totalLength)
      
      if (masked) {
        const mask = this.buffer.slice(offset - 4, offset)
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i % 4]
        }
      }

      this.buffer = this.buffer.slice(totalLength)

      // 处理帧
      if (opcode === 0x01) {
        // 文本帧
        this.emit('message', payload.toString('utf8'))
      } else if (opcode === 0x08) {
        // 关闭帧
        this.close()
      } else if (opcode === 0x09) {
        // Ping - 发送 Pong
        // 简化处理，忽略
      }
    }
  }
}

export class NodeDebugAdapter extends EventEmitter {
  private process: ChildProcess | null = null
  private ws: SimpleWebSocket | null = null
  private messageId = 0
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  
  // 状态
  private isConnected = false
  private scripts = new Map<string, ScriptInfo>()
  private scriptsByUrl = new Map<string, string>() // url -> scriptId
  private breakpoints = new Map<string, Breakpoint[]>() // file -> breakpoints
  private pendingBreakpoints = new Map<string, SourceBreakpoint[]>() // 连接前缓存的断点
  private currentCallFrames: CDPCallFrame[] = []
  private currentThreadId = 1

  /**
   * 获取调试器能力
   */
  getCapabilities(): DebugCapabilities {
    return {
      supportsConfigurationDoneRequest: true,
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: false,
      supportsRestartFrame: false,
      supportsStepBack: false,
      supportsCompletionsRequest: false,
      supportsModulesRequest: false,
      supportsRestartRequest: false,
      supportsExceptionOptions: true,
      supportsValueFormattingOptions: false,
      supportsExceptionInfoRequest: true,
      supportTerminateDebuggee: true,
      supportsDelayedStackTraceLoading: true,
      supportsLoadedSourcesRequest: true,
      supportsLogPoints: true,
      supportsTerminateThreadsRequest: false,
      supportsSetExpression: false,
      supportsTerminateRequest: true,
      supportsDataBreakpoints: false,
      supportsReadMemoryRequest: false,
      supportsDisassembleRequest: false,
      supportsCancelRequest: false,
      supportsBreakpointLocationsRequest: false,
      supportsClipboardContext: false,
      supportsSteppingGranularity: false,
      supportsInstructionBreakpoints: false,
      supportsExceptionFilterOptions: false,
    }
  }

  /**
   * 启动调试
   */
  async launch(config: DebugConfig): Promise<void> {
    if (!config.program) {
      throw new Error('Program path is required')
    }

    const args = [
      config.stopOnEntry !== false ? '--inspect-brk=0' : '--inspect=0',
      config.program,
      ...(config.args || []),
    ]

    logger.system.info('[NodeDebugAdapter] Launching:', 'node', args.join(' '))

    this.process = spawn('node', args, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // 监听输出获取调试端口
    const wsUrl = await this.waitForDebuggerUrl()
    await this.connectWebSocket(wsUrl)
    await this.initializeDebugger()
  }

  /**
   * 附加到进程
   */
  async attach(config: DebugConfig): Promise<void> {
    const port = config.port || 9229
    const host = config.host || '127.0.0.1'
    
    const wsUrl = await this.getWebSocketUrl(host, port)
    await this.connectWebSocket(wsUrl)
    await this.initializeDebugger()
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.isConnected = false

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    if (this.process) {
      this.process.kill()
      this.process = null
    }

    this.cleanup()
    this.emitEvent({ type: 'terminated' })
  }

  /**
   * 配置完成
   */
  async configurationDone(): Promise<void> {
    // 应用待设置的断点
    await this.applyPendingBreakpoints()
    
    // 如果是 --inspect-brk 启动的，继续执行
    await this.sendCDP('Debugger.resume')
  }

  /**
   * 设置断点
   */
  async setBreakpoints(source: Source, breakpoints: SourceBreakpoint[]): Promise<Breakpoint[]> {
    const file = source.path || ''
    
    if (!this.isConnected) {
      // 缓存断点
      this.pendingBreakpoints.set(file, breakpoints)
      return breakpoints.map((bp, i) => ({
        id: `pending_${i}`,
        file,
        line: bp.line,
        column: bp.column,
        verified: false,
      }))
    }

    return this.doSetBreakpoints(file, breakpoints)
  }

  /**
   * 继续执行
   */
  async continue(_threadId: number): Promise<boolean> {
    await this.sendCDP('Debugger.resume')
    this.emitEvent({ type: 'continued', threadId: this.currentThreadId })
    return true
  }

  /**
   * 暂停
   */
  async pause(_threadId: number): Promise<void> {
    await this.sendCDP('Debugger.pause')
  }

  /**
   * 单步跳过
   */
  async next(_threadId: number): Promise<void> {
    await this.sendCDP('Debugger.stepOver')
  }

  /**
   * 单步进入
   */
  async stepIn(_threadId: number): Promise<void> {
    await this.sendCDP('Debugger.stepInto')
  }

  /**
   * 单步跳出
   */
  async stepOut(_threadId: number): Promise<void> {
    await this.sendCDP('Debugger.stepOut')
  }

  /**
   * 获取线程列表
   */
  async threads(): Promise<Thread[]> {
    // Node.js 单线程
    return [{ id: this.currentThreadId, name: 'Main Thread' }]
  }

  /**
   * 获取堆栈帧
   */
  async stackTrace(_threadId: number): Promise<{ stackFrames: StackFrame[]; totalFrames: number }> {
    const frames = this.currentCallFrames.map((frame, i) => {
      const script = this.scripts.get(frame.location.scriptId)
      return {
        id: i,
        name: frame.functionName || '(anonymous)',
        source: script ? { path: this.urlToPath(script.url), name: this.getFileName(script.url) } : undefined,
        line: frame.location.lineNumber + 1,
        column: frame.location.columnNumber + 1,
      }
    })

    return { stackFrames: frames, totalFrames: frames.length }
  }

  /**
   * 获取作用域
   */
  async scopes(frameId: number): Promise<Scope[]> {
    const frame = this.currentCallFrames[frameId]
    if (!frame) return []

    return frame.scopeChain.map((scope, i) => ({
      name: this.getScopeName(scope.type),
      variablesReference: this.encodeVariablesRef(frameId, i, scope.object.objectId),
      expensive: scope.type === 'global',
    }))
  }

  /**
   * 获取变量
   */
  async variables(variablesReference: number): Promise<Variable[]> {
    const objectId = this.decodeVariablesRef(variablesReference)
    if (!objectId) return []

    try {
      const result = await this.sendCDP('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        generatePreview: true,
      }) as { result: Array<{ name: string; value?: { type: string; value?: unknown; description?: string; objectId?: string } }> }

      return result.result
        .filter(prop => prop.value)
        .map(prop => ({
          name: prop.name,
          value: this.formatValue(prop.value!),
          type: prop.value!.type,
          variablesReference: prop.value!.objectId ? this.encodeObjectRef(prop.value!.objectId) : 0,
        }))
    } catch (e) {
      logger.system.error('[NodeDebugAdapter] Failed to get variables:', e)
      return []
    }
  }

  /**
   * 求值表达式
   */
  async evaluate(expression: string, frameId?: number): Promise<{ result: string; type?: string; variablesReference: number }> {
    try {
      let result: { result: { type: string; value?: unknown; description?: string; objectId?: string } }

      if (frameId !== undefined && this.currentCallFrames[frameId]) {
        const frame = this.currentCallFrames[frameId]
        result = await this.sendCDP('Debugger.evaluateOnCallFrame', {
          callFrameId: frame.callFrameId,
          expression,
          generatePreview: true,
        }) as typeof result
      } else {
        result = await this.sendCDP('Runtime.evaluate', {
          expression,
          generatePreview: true,
        }) as typeof result
      }

      return {
        result: this.formatValue(result.result),
        type: result.result.type,
        variablesReference: result.result.objectId ? this.encodeObjectRef(result.result.objectId) : 0,
      }
    } catch (e) {
      return { result: String(e), variablesReference: 0 }
    }
  }

  // ========== 私有方法 ==========

  private async waitForDebuggerUrl(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for debugger')), 15000)

      const handleData = (data: Buffer) => {
        const output = data.toString()
        this.emitEvent({ type: 'output', category: 'stderr', output })

        // 解析: Debugger listening on ws://127.0.0.1:9229/xxx
        const match = output.match(/ws:\/\/[\d.]+:\d+\/[a-f0-9-]+/i)
        if (match) {
          clearTimeout(timeout)
          this.process?.stderr?.off('data', handleData)
          resolve(match[0])
        }
      }

      this.process?.stderr?.on('data', handleData)
      this.process?.stdout?.on('data', (data: Buffer) => {
        this.emitEvent({ type: 'output', category: 'stdout', output: data.toString() })
      })

      this.process?.on('exit', (code) => {
        clearTimeout(timeout)
        this.emitEvent({ type: 'exited', exitCode: code || 0 })
        this.cleanup()
      })

      this.process?.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  private async getWebSocketUrl(host: string, port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://${host}:${port}/json`, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const targets = JSON.parse(data) as Array<{ webSocketDebuggerUrl: string }>
            if (targets.length > 0) {
              resolve(targets[0].webSocketDebuggerUrl)
            } else {
              reject(new Error('No debug targets found'))
            }
          } catch (e) {
            reject(e)
          }
        })
      })
      req.on('error', reject)
      req.setTimeout(5000, () => {
        req.destroy()
        reject(new Error('Connection timeout'))
      })
    })
  }

  private async connectWebSocket(url: string): Promise<void> {
    logger.system.info('[NodeDebugAdapter] Connecting to:', url)
    
    this.ws = new SimpleWebSocket()

    this.ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data) as CDPMessage
        this.handleCDPMessage(message)
      } catch (e) {
        logger.system.error('[NodeDebugAdapter] Failed to parse message:', e)
      }
    })

    this.ws.on('error', (err) => {
      logger.system.error('[NodeDebugAdapter] WebSocket error:', err)
    })

    this.ws.on('close', () => {
      logger.system.info('[NodeDebugAdapter] WebSocket closed')
      this.isConnected = false
    })

    await this.ws.connect(url)
    logger.system.info('[NodeDebugAdapter] WebSocket connected')
    this.isConnected = true
  }

  private async initializeDebugger(): Promise<void> {
    // 启用调试域
    await this.sendCDP('Debugger.enable')
    await this.sendCDP('Runtime.enable')
    await this.sendCDP('Runtime.runIfWaitingForDebugger')

    this.emitEvent({ type: 'initialized' })
  }

  private handleCDPMessage(message: CDPMessage): void {
    // 处理响应
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        this.pendingRequests.delete(message.id)
        if (message.error) {
          pending.reject(new Error(message.error.message))
        } else {
          pending.resolve(message.result)
        }
      }
      return
    }

    // 处理事件
    if (message.method) {
      this.handleCDPEvent(message.method, message.params || {})
    }
  }

  private handleCDPEvent(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'Debugger.scriptParsed': {
        const scriptId = params.scriptId as string
        const url = params.url as string
        if (url) {
          this.scripts.set(scriptId, { scriptId, url, sourceMapURL: params.sourceMapURL as string })
          this.scriptsByUrl.set(url, scriptId)
        }
        break
      }

      case 'Debugger.paused': {
        this.currentCallFrames = (params.callFrames as CDPCallFrame[]) || []
        const reason = params.reason as string
        this.emitEvent({
          type: 'stopped',
          reason: this.mapStopReason(reason),
          threadId: this.currentThreadId,
          allThreadsStopped: true,
        })
        break
      }

      case 'Debugger.resumed': {
        this.currentCallFrames = []
        this.emitEvent({ type: 'continued', threadId: this.currentThreadId })
        break
      }

      case 'Runtime.consoleAPICalled': {
        const args = (params.args as Array<{ value?: unknown; description?: string }>) || []
        const output = args.map(a => a.description ?? String(a.value)).join(' ')
        this.emitEvent({ type: 'output', category: 'console', output: output + '\n' })
        break
      }

      case 'Runtime.exceptionThrown': {
        const details = params.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined
        const message = details?.exception?.description || details?.text || 'Unknown error'
        this.emitEvent({ type: 'output', category: 'stderr', output: `Exception: ${message}\n` })
        break
      }
    }
  }

  private async sendCDP(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || !this.ws.isConnected()) {
      throw new Error('WebSocket not connected')
    }

    const id = ++this.messageId
    const message = { id, method, params }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.ws!.send(JSON.stringify(message))

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 10000)
    })
  }

  private async doSetBreakpoints(file: string, breakpoints: SourceBreakpoint[]): Promise<Breakpoint[]> {
    // 移除旧断点
    const existing = this.breakpoints.get(file) || []
    for (const bp of existing) {
      if (!bp.id.startsWith('pending_')) {
        try {
          await this.sendCDP('Debugger.removeBreakpoint', { breakpointId: bp.id })
        } catch { /* ignore */ }
      }
    }

    // 设置新断点
    const results: Breakpoint[] = []
    const url = this.pathToUrl(file)

    for (const bp of breakpoints) {
      try {
        const result = await this.sendCDP('Debugger.setBreakpointByUrl', {
          lineNumber: bp.line - 1,
          url,
          columnNumber: bp.column ? bp.column - 1 : undefined,
          condition: bp.condition,
        }) as { breakpointId: string; locations: Array<{ lineNumber: number; columnNumber: number }> }

        const loc = result.locations[0]
        results.push({
          id: result.breakpointId,
          file,
          line: loc ? loc.lineNumber + 1 : bp.line,
          column: loc ? loc.columnNumber + 1 : bp.column,
          verified: result.locations.length > 0,
          condition: bp.condition,
        })
      } catch (e) {
        logger.system.error('[NodeDebugAdapter] Failed to set breakpoint:', e)
        results.push({
          id: `failed_${bp.line}`,
          file,
          line: bp.line,
          column: bp.column,
          verified: false,
        })
      }
    }

    this.breakpoints.set(file, results)
    return results
  }

  private async applyPendingBreakpoints(): Promise<void> {
    for (const [file, bps] of this.pendingBreakpoints) {
      await this.doSetBreakpoints(file, bps)
    }
    this.pendingBreakpoints.clear()
  }

  private emitEvent(event: DebugEvent): void {
    this.emit('event', event)
  }

  private cleanup(): void {
    this.pendingRequests.clear()
    this.scripts.clear()
    this.scriptsByUrl.clear()
    this.breakpoints.clear()
    this.pendingBreakpoints.clear()
    this.currentCallFrames = []
  }

  // ========== 工具方法 ==========

  private pathToUrl(path: string): string {
    // Windows 路径转 file:// URL
    const normalized = path.replace(/\\/g, '/')
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
  }

  private urlToPath(url: string): string {
    if (url.startsWith('file:///')) {
      // Windows: file:///C:/path -> C:/path
      return url.slice(8).replace(/\//g, '\\')
    }
    if (url.startsWith('file://')) {
      return url.slice(7)
    }
    return url
  }

  private getFileName(url: string): string {
    const path = this.urlToPath(url)
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  private getScopeName(type: string): string {
    switch (type) {
      case 'local': return 'Local'
      case 'closure': return 'Closure'
      case 'catch': return 'Catch'
      case 'block': return 'Block'
      case 'script': return 'Script'
      case 'with': return 'With'
      case 'global': return 'Global'
      case 'module': return 'Module'
      default: return type
    }
  }

  private mapStopReason(cdpReason: string): string {
    switch (cdpReason) {
      case 'Break on start':
      case 'debugCommand': return 'entry'
      case 'breakpoint': return 'breakpoint'
      case 'exception': return 'exception'
      case 'assert': return 'exception'
      case 'other':
      case 'ambiguous': return 'pause'
      default: return cdpReason
    }
  }

  private formatValue(value: { type: string; value?: unknown; description?: string }): string {
    if (value.description) return value.description
    if (value.value !== undefined) return String(value.value)
    return value.type
  }

  // 变量引用编码（简化版）
  private objectIdMap = new Map<number, string>()
  private nextRefId = 1

  private encodeVariablesRef(_frameId: number, _scopeIndex: number, objectId: string): number {
    const refId = this.nextRefId++
    this.objectIdMap.set(refId, objectId)
    return refId
  }

  private encodeObjectRef(objectId: string): number {
    const refId = this.nextRefId++
    this.objectIdMap.set(refId, objectId)
    return refId
  }

  private decodeVariablesRef(ref: number): string | undefined {
    return this.objectIdMap.get(ref)
  }
}
