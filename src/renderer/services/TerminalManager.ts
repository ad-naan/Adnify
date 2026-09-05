/**
 * 终端管理服务
 *
 * 职责：
 * - 管理用户交互式终端的生命周期（创建、销毁）
 * - 管理 xterm 实例和 PTY 进程
 * - 提供统一 API 给 UI 层
 *
 * 注意：普通短命令使用 shell:executeBackground；Agent 长命令会通过此服务创建交互会话。
 */

import { api } from "@/renderer/services/electronAPI";
import { Terminal as XTerminal, type IDisposable, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { getEditorConfig } from "@renderer/settings";
import { logger } from "@utils/Logger";
import { toAppError } from "@shared/utils/errorHandler";
import { isMac } from "@services/keybindingService";
import { getInteractiveTerminalBackend } from "@/renderer/agent/tools/commandRuntime";
import { readClipboardText, writeClipboardText } from "@/renderer/services/clipboardService";
import { detectTerminalShellFamily } from "@/renderer/services/terminalShell";
import { shellRegistryService } from "@/renderer/shell/services/shellRegistryService";
import {
  createShellIntegrationOscParser,
  parseShellIntegrationPayload,
  SHELL_INTEGRATION_OSC_ID,
  type ShellIntegrationEvent,
} from "@/renderer/services/terminalShellIntegration";

// ===== 类型定义 =====

import { isExecutionFinished, type ExecutionSnapshot } from '@shared/types/execution'

export interface TerminalInstance {
  id: string;
  name: string;
  cwd: string;
  shell: string;
  createdAt: number;
  /** 是否为 Agent 专属终端 */
  isAgent?: boolean;
  managedJob?: boolean;
  /** 远程 SSH 连接信息 */
  remote?: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string };
  /** 远程主机地址（用于显示） */
  remoteHost?: string;
}

export interface RunningCommandInfo {
  terminalId: string;
  command: string;
  startedAt: number;
}

export type TerminalCommandStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted'
  | 'detached'
  | 'shell_exited';

export type TerminalCommandTerminationReason =
  | 'sentinel_matched'
  | 'sentinel_missing_prompt'
  | 'shell_integration_missing'
  | 'terminal_exit'
  | 'terminal_error'
  | 'timeout'
  | 'user_closed_terminal'
  | 'cleanup'
  | 'detached';

export interface TerminalCommandSession {
  commandSessionId: string;
  terminalId: string;
  command: string;
  cwd?: string;
  startedAt: number;
  endedAt?: number;
  status: TerminalCommandStatus;
  exitCode: number | null;
  signal?: number;
  timedOut: boolean;
  terminationReason?: TerminalCommandTerminationReason;
  captureStartSeq?: number;
  captureEndSeq?: number;
  output: string;
  partialOutput: string;
  sentinelMatched: boolean;
  isBackground: boolean;
  source: 'agent' | 'shell_ui' | 'user';
}

export interface TerminalCommandInfo {
  current: TerminalCommandSession | null;
  last: TerminalCommandSession | null;
}

export interface TerminalManagerState {
  terminals: TerminalInstance[];
  activeId: string | null;
  /** 兼容字段：由 command session 状态派生，不再作为事实来源 */
  runningCommand: RunningCommandInfo | null;
  commandInfoByTerminal: Record<string, TerminalCommandInfo>;
}

export interface CommandResult {
  success: boolean;
  finalStatus: TerminalCommandStatus;
  output: string;
  partialOutput: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  terminalId: string;
  commandSessionId: string;
  terminationReason: TerminalCommandTerminationReason;
  sentinelMatched: boolean;
  signal?: number;
}

export interface AgentTerminalLease {
  terminalId: string;
  reused: boolean;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
  seq: number;
  occurredAt: number;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
  signal?: number;
  seq: number;
  occurredAt: number;
  reason: 'process_exit' | 'killed_by_user' | 'remote_close';
}

export interface TerminalErrorEvent {
  id: string;
  error: string;
  seq: number;
  occurredAt: number;
  fatal?: boolean;
  reason: 'process_error' | 'spawn_error' | 'unknown';
}

export type TerminalBackend = 'pty' | 'pipe';

interface XTermInstance {
  terminal: XTerminal;
  fitAddon: FitAddon;
  webglAddon?: WebglAddon;
  container: HTMLDivElement | null;
  shellIntegrationDisposable?: IDisposable;
  shellIntegrationFallbackDisposable?: IDisposable;
  shellIntegrationReady?: boolean;
}

interface ActiveCommandExecution {
  commandSessionId: string;
  finalize: (
    reason: TerminalCommandTerminationReason,
    override?: Partial<Pick<CommandResult, 'finalStatus' | 'exitCode' | 'signal' | 'timedOut' | 'output' | 'partialOutput' | 'sentinelMatched'>>,
  ) => void;
}

type StateListener = (state: TerminalManagerState) => void;
type ShellIntegrationListener = (event: ShellIntegrationEvent & { terminalId: string; seq: number }) => void;

// ===== 终端管理器 =====

// 获取终端缓冲配置（从 editorConfig 读取）
function getOutputBufferConfig() {
  const config = getEditorConfig();
  const maxLines = config.performance.terminalBufferSize || 1000;
  return {
    maxLines,
    // 使用行数 * 平均行长度估算，避免频繁计算字节
    maxTotalChars: maxLines * 200,
  };
}

const MAX_COMMAND_OUTPUT_CHARS = 120_000

function trimRetainedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  return value.slice(value.length - maxChars)
}

/**
 * 环形缓冲区 — O(1) 写入和裁剪
 * 替代原来的 array.splice O(n) 方案
 */
class RingBuffer {
  private buf: string[]
  private head = 0    // 最旧元素的索引
  private count = 0   // 当前元素数
  private capacity: number
  totalChars = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buf = new Array(capacity)
  }

  push(data: string): void {
    if (this.count < this.capacity) {
      this.buf[(this.head + this.count) % this.capacity] = data
      this.count++
    } else {
      // 满了，覆盖最旧的
      this.totalChars -= this.buf[this.head].length
      this.buf[this.head] = data
      this.head = (this.head + 1) % this.capacity
    }
    this.totalChars += data.length
  }

  /** 按写入顺序返回所有元素 */
  toArray(): string[] {
    const result: string[] = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity]
    }
    return result
  }

  get length(): number { return this.count }

  clear(): void {
    this.buf.fill('')
    this.head = 0
    this.count = 0
    this.totalChars = 0
  }

  trimToMaxChars(maxChars: number): void {
    while (this.count > 0 && this.totalChars > maxChars) {
      this.totalChars -= this.buf[this.head].length
      this.buf[this.head] = ''
      this.head = (this.head + 1) % this.capacity
      this.count--
    }
  }
}

function escapePosixSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`)
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Extract terminal-visible text between two markers. Wrapped lines are joined
 * because a command line may be hard-wrapped arbitrarily by ConPTY.
 */
function extractTerminalOutput(terminal: XTerminal, start: IMarker, end: IMarker): string {
  // The C marker follows the submitted command line, while D is emitted just
  // before the next prompt. Use the first line after C through the line at D;
  // extraction is tolerant of hard-wrapped command echoes.
  const startLine = Math.min(start.line + 1, terminal.buffer.active.length - 1)
  const endLine = Math.max(startLine, Math.min(end.line, terminal.buffer.active.length - 1))
  if (endLine < startLine) return ''

  const lines: string[] = []
  const buffer = terminal.buffer.active
  for (let line = startLine; line <= endLine; line++) {
    const bufferLine = buffer.getLine(line)
    if (!bufferLine) continue
    const text = bufferLine.translateToString(true)
    if (bufferLine.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text
    } else {
      lines.push(text)
    }
  }
  return lines.join('\n').trim()
}

function cloneCommandSession(session: TerminalCommandSession | null): TerminalCommandSession | null {
  if (!session) return null
  return { ...session }
}

export { parseShellIntegrationPayload, SHELL_INTEGRATION_OSC_ID } from "@/renderer/services/terminalShellIntegration";

class TerminalManagerClass {
  private managedJobs = new Map<string, ExecutionSnapshot>()
  private hiddenJobs = new Set<string>()
  private closingJobs = new Set<string>()
  private unknownTerminals = new Set<string>()
  private reservedTerminals = new Set<string>()
  private agentLeases = new Map<string, string>()
  private state = {
    terminals: [] as TerminalInstance[],
    activeId: null as string | null,
  };

  /** Agent 专属终端 ID（跨 tool call 复用） */
  private agentTerminalId: string | null = null;
  private agentRemoteTerminalIds = new Map<string, string>();
  private agentRemoteTerminalCreating = new Map<string, Promise<string>>();

  // xterm 实例管理
  private xtermInstances = new Map<string, XTermInstance>();
  // 环形缓冲区：O(1) 写入和裁剪
  private outputBuffers = new Map<string, RingBuffer>();

  // 命令会话状态
  private currentCommandSessions = new Map<string, TerminalCommandSession>();
  private lastCommandSessions = new Map<string, TerminalCommandSession>();
  private activeExecutions = new Map<string, ActiveCommandExecution>();
  private shellIntegrationListeners = new Set<ShellIntegrationListener>();
  private shellIntegrationDisposables = new Map<string, IDisposable>();
  private shellIntegrationFallbacks = new Map<string, IDisposable>();
  private shellIntegrationRawParsers = new Map<string, ReturnType<typeof createShellIntegrationOscParser>>();

  // PTY 状态
  private ptyReady = new Map<string, boolean>();
  private pendingPtyCreation = new Map<string, Promise<boolean>>();
  private terminalCreateErrors = new Map<string, string>();

  // 监听器
  private stateListeners = new Set<StateListener>();
  private dataListeners = new Set<(id: string, data: string) => void>();
  private rawDataListeners = new Set<(event: TerminalDataEvent) => void>();

  // 主题配置
  private currentTheme: Record<string, string> = {};

  // IPC 监听器清理函数
  private ipcCleanup: (() => void) | null = null;

  private canFitTerminal(instance: XTermInstance | undefined): instance is XTermInstance {
    const container = instance?.container
    if (!instance || !container || !container.isConnected) {
      return false
    }

    return container.clientWidth > 0 && container.clientHeight > 0
  }

  private resizeTerminalIfReady(id: string, instance: XTermInstance | undefined): void {
    if (!this.canFitTerminal(instance)) {
      return
    }

    try {
      instance.fitAddon.fit()
      const dims = instance.fitAddon.proposeDimensions?.()
      if (this.managedJobs.has(id)) return
      if (dims && dims.cols > 0 && dims.rows > 0) {
        api.terminal.resize(id, dims.cols, dims.rows)
      }
    } catch (error) {
      logger.system.warn(`[TerminalManager] Skipped terminal resize for ${id}`, error)
    }
  }

  constructor() {
    this.setupIpcListeners();
  }

  private emitShellIntegration(id: string, payload: string): boolean {
    const parsed = parseShellIntegrationPayload(payload)
    if (!parsed) return false
    if (parsed.phase === 'command-end') {
      this.unknownTerminals.delete(id)
      const detached = this.currentCommandSessions.get(id)
      if (detached?.status === 'detached') this.finalizeCommandSession(id, {
        ...detached, status: parsed.exitCode === 0 ? 'completed' : 'failed',
        endedAt: Date.now(), exitCode: parsed.exitCode ?? null, sentinelMatched: true,
      })
    }

    const instance = this.xtermInstances.get(id)
    if (instance && parsed.phase === 'prompt') instance.shellIntegrationReady = true
    this.shellIntegrationListeners.forEach(listener => listener({
      ...parsed,
      terminalId: id,
      seq: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
    }))
    return true
  }

  private registerShellIntegrationHandler(id: string, terminal: XTerminal): void {
    const emit = (payload: string): boolean => this.emitShellIntegration(id, payload)
    const parserTerminal = terminal as unknown as {
      registerOscHandler?: (id: number, handler: (payload: string) => boolean | Promise<boolean>) => IDisposable
      onWriteParsed?: (listener: (data: string) => void) => IDisposable
    }

    // Some long-lived installations can still have an older bundled xterm in
    // Vite's dependency cache while the rest of the renderer has reloaded.
    // Shell integration is important, but it must never take the terminal UI
    // down. Prefer the modern xterm parser and fall back to OSC parsing on
    // writeParsed when that API is unavailable.
    if (typeof parserTerminal.registerOscHandler === 'function') {
      try {
        const disposable = parserTerminal.registerOscHandler(SHELL_INTEGRATION_OSC_ID, emit)
        this.shellIntegrationDisposables.set(id, disposable)
        return
      } catch (error) {
        logger.system.warn(`[TerminalManager] Failed to register xterm OSC handler for ${id}:`, error)
      }
    }

    const onWriteParsed = parserTerminal.onWriteParsed
    if (typeof onWriteParsed !== 'function') {
      logger.system.warn(
        `[TerminalManager] Shell integration is unavailable for ${id}: xterm lacks an OSC parser API`,
      )
      return
    }

    const parser = createShellIntegrationOscParser()
    const disposable = onWriteParsed.call(terminal, data => {
      for (const payload of parser.push(data)) emit(payload)
    })
    this.shellIntegrationFallbacks.set(id, disposable)
  }

  private disposeShellIntegrationHandler(id: string): void {
    this.shellIntegrationDisposables.get(id)?.dispose()
    this.shellIntegrationDisposables.delete(id)
    this.shellIntegrationFallbacks.get(id)?.dispose()
    this.shellIntegrationFallbacks.delete(id)
  }

  private hasShellIntegrationHandler(id: string): boolean {
    return this.shellIntegrationDisposables.has(id) || this.shellIntegrationFallbacks.has(id)
  }

  private setupIpcListeners() {
    const onExecutionChanged = api.execution?.onChanged(job => this.applyExecutionSnapshot(job))
    void api.execution?.list().then(result => {
      for (const job of result.jobs || []) this.applyExecutionSnapshot(job)
    }).catch(error => logger.system.warn('[TerminalManager] Failed to restore executions:', error))
    void api.terminal.list?.().then(result => {
      for (const session of result.sessions || []) {
        if (this.hasTerminal(session.id)) continue
        this.state.terminals.push({ id: session.id, name: session.isAgent ? 'Agent' : 'Terminal',
          cwd: session.cwd, shell: session.shell, isAgent: session.isAgent,
          remoteHost: session.remoteHost, createdAt: Date.now() })
        this.ptyReady.set(session.id, session.state !== 'exited')
        if (session.state !== 'ready' || session.userControlled) this.unknownTerminals.add(session.id)
        this.outputBuffers.delete(session.id)
        this.appendToBuffer(session.id, session.output)
        this.ensureXtermInstance(session.id)
        this.state.activeId ||= session.id
      }
      this.notify()
    }).catch(error => logger.system.warn('[TerminalManager] Failed to restore terminals:', error))
      const onData = api.terminal.onData(
        (event: TerminalDataEvent) => {
      const { id, data } = event;
          // Parse lifecycle OSC directly from the renderer's terminal stream.
          // xterm normally parses OSC 633 as well, but the raw path makes ready
          // state independent of the installed xterm version and UI mounting.
          const lifecyclePayloads = data ? (() => {
            let parser = this.shellIntegrationRawParsers.get(id)
            if (!parser) {
              parser = createShellIntegrationOscParser()
              this.shellIntegrationRawParsers.set(id, parser)
            }
            return parser.push(data)
          })() : []

          const xterm = this.xtermInstances.get(id) ?? this.ensureXtermInstance(id);
          const consumeLifecyclePayloads = () => {
            for (const payload of lifecyclePayloads) {
              this.emitShellIntegration(id, payload)
            }
          }
          if (xterm?.terminal && data) {
            // The PTY frequently delivers short command output and its D/A
            // markers in one chunk. Let xterm consume that chunk first, then
            // emit lifecycle events so markers point at the real output.
            try {
              xterm.terminal.write(data)
            } catch {
              // Command framing comes from the raw stream, so continue even
              // if a detached xterm instance rejects one display chunk.
            }
            consumeLifecyclePayloads()
          } else {
            consumeLifecyclePayloads()
          }

        // UI 展示缓冲（ring buffer）
        if (data) {
          this.appendToBuffer(id, data);
        }

        // 命令级缓冲由 active command session 单独维护
        this.rawDataListeners.forEach(listener => listener(event));
        if (data) {
          this.dataListeners.forEach(listener => listener(id, data));
        }
      },
    );

    const onExit = api.terminal.onExit(
      (event: TerminalExitEvent) => {
        const { id, exitCode, signal } = event;
        logger.system.info(
          `[TerminalManager] Terminal ${id} exited with code ${exitCode}, signal ${signal}`,
        );

        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(
            `\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
          );
        }

        const activeExecution = this.activeExecutions.get(id);
        if (activeExecution) {
          activeExecution.finalize('terminal_exit', {
            finalStatus: 'shell_exited',
            exitCode,
            signal,
          })
        } else {
          const current = this.currentCommandSessions.get(id)
          if (current) {
            this.finalizeCommandSession(id, {
              ...current,
              status: 'shell_exited',
              endedAt: Date.now(),
              exitCode,
              signal,
              timedOut: false,
              terminationReason: 'terminal_exit',
            })
          }
        }

        // 清理 PTY 状态
        this.ptyReady.delete(id);
        this.reservedTerminals.delete(id)
        this.agentLeases.delete(id)
        this.removeAgentTerminalReference(id)
        this.shellIntegrationRawParsers.delete(id);
      },
    );

    const onError = api.terminal.onError?.(
      (event: TerminalErrorEvent) => {
        const { id, error } = event;
        logger.system.error(`[TerminalManager] Terminal ${id} error:`, error);

        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(
            `\r\n\x1b[31m[Terminal Error: ${error}]\x1b[0m\r\n`,
          );
        }

        const activeExecution = this.activeExecutions.get(id)
        if (activeExecution) {
          activeExecution.finalize('terminal_error', {
            finalStatus: 'failed',
          })
        }
      },
    );

    this.ipcCleanup = () => {
      onExecutionChanged?.()
      onData();
      onExit();
      onError?.();
    };
  }

  applyExecutionSnapshot(job: ExecutionSnapshot): void {
    const previous = this.managedJobs.get(job.jobId)
    if (previous && previous.revision >= job.revision) return
    this.managedJobs.set(job.jobId, job)
    if (this.hiddenJobs.has(job.jobId)) {
      this.managedJobs.set(job.jobId, { ...job, output: '' })
      return
    }
    if (job.status === 'unknown') this.closingJobs.delete(job.jobId)
    if (isExecutionFinished(job.status) && this.closingJobs.delete(job.jobId)) {
      this.removeTerminalView(job.jobId)
      return
    }
    let terminal = this.state.terminals.find(item => item.id === job.jobId)
    if (!terminal) {
      terminal = { id: job.jobId, name: job.command.replace(/\s+/g, ' ').slice(0, 48),
        cwd: job.cwd, shell: job.shell, createdAt: job.submittedAt, isAgent: true, managedJob: true }
      this.state.terminals.push(terminal)
      this.state.activeId ||= job.jobId
    }
    const xterm = this.ensureXtermInstance(job.jobId)
    const oldOutput = previous?.output || ''
    if (job.output !== oldOutput) {
      if (job.output.startsWith(oldOutput)) {
        const added = job.output.slice(oldOutput.length)
        xterm?.terminal.write(added.replace(/\r?\n/g, '\r\n'))
        this.appendToBuffer(job.jobId, added)
        this.dataListeners.forEach(listener => listener(job.jobId, added))
      } else {
        xterm?.terminal.clear()
        xterm?.terminal.write(job.output.replace(/\r?\n/g, '\r\n'))
        this.outputBuffers.delete(job.jobId)
        this.appendToBuffer(job.jobId, job.output)
      }
    }
    const finished = isExecutionFinished(job.status)
    const status: TerminalCommandStatus = job.status === 'expired' ? 'failed'
      : job.status === 'unknown' ? 'detached'
      : job.status === 'starting' || job.status === 'stopping' ? 'running' : job.status
    const session: TerminalCommandSession = {
      commandSessionId: job.jobId, terminalId: job.jobId, command: job.command, cwd: job.cwd,
      startedAt: job.startedAt || job.submittedAt, endedAt: job.endedAt, status,
      exitCode: job.exitCode, timedOut: job.reason === 'execution_timeout',
      output: job.output, partialOutput: job.output, sentinelMatched: finished && job.exitCode !== null,
      isBackground: job.mode === 'background', source: 'agent',
    }
    if (finished) {
      this.currentCommandSessions.delete(job.jobId)
      this.lastCommandSessions.set(job.jobId, session)
    } else this.currentCommandSessions.set(job.jobId, session)
    // Completed views are a bounded history, not persistent shells.
    const history = this.state.terminals.filter(item => item.managedJob
      && isExecutionFinished(this.managedJobs.get(item.id)?.status || 'running'))
    for (const old of history.slice(0, Math.max(0, history.length - 64))) {
      if (old.id !== this.state.activeId) this.removeTerminalView(old.id)
    }
    this.notify()
  }

  getManagedJob(id: string): ExecutionSnapshot | undefined { return this.managedJobs.get(id) }

  /**
   * 追加数据到输出缓冲区
   */
  private appendToBuffer(id: string, data: string): void {
    let buffer = this.outputBuffers.get(id);
    if (!buffer) {
      const config = getOutputBufferConfig();
      buffer = new RingBuffer(config.maxLines);
      this.outputBuffers.set(id, buffer);
    }

    // RingBuffer 自动处理容量溢出（O(1) 覆盖最旧数据）
    buffer.push(data);
    buffer.trimToMaxChars(getOutputBufferConfig().maxTotalChars);
  }

  private getDerivedRunningCommand(): RunningCommandInfo | null {
    const running = Array.from(this.currentCommandSessions.values())
      .filter(session => session.status === 'queued' || session.status === 'running')
      .sort((a, b) => b.startedAt - a.startedAt)

    if (running.length === 0) return null

    const session = running[0]
    return {
      terminalId: session.terminalId,
      command: session.command,
      startedAt: session.startedAt,
    }
  }

  private getCommandInfoSnapshot(): Record<string, TerminalCommandInfo> {
    const snapshot: Record<string, TerminalCommandInfo> = {}
    for (const terminal of this.state.terminals) {
      snapshot[terminal.id] = {
        current: cloneCommandSession(this.currentCommandSessions.get(terminal.id) || null),
        last: cloneCommandSession(this.lastCommandSessions.get(terminal.id) || null),
      }
    }
    return snapshot
  }

  private setCurrentCommandSession(terminalId: string, session: TerminalCommandSession | null): void {
    if (session) {
      this.currentCommandSessions.set(terminalId, session)
    } else {
      this.currentCommandSessions.delete(terminalId)
    }
    this.notify()
  }

  private updateCurrentCommandSession(
    terminalId: string,
    updater: (session: TerminalCommandSession) => TerminalCommandSession,
  ): void {
    const current = this.currentCommandSessions.get(terminalId)
    if (!current) return
    this.currentCommandSessions.set(terminalId, updater(current))
    this.notify()
  }

  private finalizeCommandSession(terminalId: string, session: TerminalCommandSession): void {
    this.currentCommandSessions.delete(terminalId)
    this.lastCommandSessions.set(terminalId, session)
    this.notify()
  }

  private clearCommandState(terminalId: string): void {
    this.activeExecutions.delete(terminalId)
    this.currentCommandSessions.delete(terminalId)
    this.lastCommandSessions.delete(terminalId)
  }

  /**
   * 获取缓冲区统计信息
   */
  getBufferStats(id: string): { lines: number; chars: number } | null {
    const buffer = this.outputBuffers.get(id);
    if (!buffer) return null;
    return { lines: buffer.length, chars: buffer.totalChars };
  }

  // ===== 状态订阅 =====

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => this.stateListeners.delete(listener);
  }

  onData(listener: (id: string, data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  private onShellIntegration(listener: ShellIntegrationListener): () => void {
    this.shellIntegrationListeners.add(listener)
    return () => this.shellIntegrationListeners.delete(listener)
  }

  private notify() {
    const state = this.getState();
    this.stateListeners.forEach((listener) => listener(state));
  }

  getState(): TerminalManagerState {
    return {
      terminals: [...this.state.terminals],
      activeId: this.state.activeId,
      runningCommand: this.getDerivedRunningCommand(),
      commandInfoByTerminal: this.getCommandInfoSnapshot(),
    };
  }

  getTerminalCommandState(terminalId: string): TerminalCommandInfo {
    return {
      current: cloneCommandSession(this.currentCommandSessions.get(terminalId) || null),
      last: cloneCommandSession(this.lastCommandSessions.get(terminalId) || null),
    }
  }

  // ===== 主题管理 =====

  setTheme(theme: Record<string, string>) {
    this.currentTheme = theme;
    this.xtermInstances.forEach(({ terminal }) => {
      terminal.options.theme = theme;
    });
  }

  /**
   * Apply the current terminal typography settings to already-open terminals.
   *
   * xterm reads font options at construction, so without this a font change
   * would only affect terminals opened afterwards. Changing the font alters
   * cell metrics, so each terminal is refit and the PTY told its new size.
   */
  applyFontSettings(): void {
    const { fontFamily, fontSize, lineHeight } = getEditorConfig().terminal;

    this.xtermInstances.forEach((instance, id) => {
      const { terminal } = instance;
      if (
        terminal.options.fontFamily === fontFamily &&
        terminal.options.fontSize === fontSize &&
        terminal.options.lineHeight === lineHeight
      ) {
        return;
      }

      try {
        terminal.options.fontFamily = fontFamily;
        terminal.options.fontSize = fontSize;
        terminal.options.lineHeight = lineHeight;
        this.resizeTerminalIfReady(id, instance);
      } catch (error) {
        logger.system.warn(`[TerminalManager] Failed to apply font settings to ${id}`, error);
      }
    });
  }

  // ===== 终端生命周期 =====

  async createTerminal(options: {
    name?: string;
    cwd: string;
    shell?: string;
    backend?: TerminalBackend;
    isAgent?: boolean;
    remote?: TerminalInstance['remote'];
  }): Promise<string> {
    const id = crypto.randomUUID();
    const backend =
      options.backend ??
      getInteractiveTerminalBackend();

    const instance: TerminalInstance = {
      id,
      name: options.name || "Terminal",
      cwd: options.cwd,
      shell: options.shell || "",
      createdAt: Date.now(),
      isAgent: options.isAgent,
      remote: options.remote,
      remoteHost: options.remote?.host,
    };

    this.state.terminals.push(instance);
    this.state.activeId = id;
    this.notify();

    // xterm owns OSC parsing and output markers. Construct it before starting
    // the PTY so integration events emitted during shell startup are never
    // lost, including Agent terminals whose tab is mounted lazily.
    this.createXtermInstance(id)

    // 创建 PTY
    const ptyPromise = this.createPty(id, options.cwd, options.shell, backend, options.remote, options.isAgent);
    this.pendingPtyCreation.set(id, ptyPromise);

    try {
      const success = await ptyPromise;
      this.ptyReady.set(id, success);
      if (!success && !this.terminalCreateErrors.has(id)) {
        this.terminalCreateErrors.set(id, 'Failed to create terminal session')
      }
    } catch {
      this.ptyReady.set(id, false);
      if (!this.terminalCreateErrors.has(id)) {
        this.terminalCreateErrors.set(id, 'Failed to create terminal session')
      }
    } finally {
      this.pendingPtyCreation.delete(id);
    }

    return id;
  }

  private async createPty(
    id: string,
    cwd: string,
    shell?: string,
    backend: TerminalBackend = 'pty',
    remote?: TerminalInstance['remote'],
    isAgent?: boolean,
  ): Promise<boolean> {
    try {
      const result = await api.terminal.create({ id, cwd, shell, backend, remote, isAgent });
      if (!result?.success) {
        const errorMsg = result?.error || "Unknown error";
        this.terminalCreateErrors.set(id, errorMsg)
        logger.system.error(
          `[TerminalManager] Failed to create PTY for ${id}:`,
          errorMsg,
        );

        // 显示错误信息到终端
        const xterm = this.xtermInstances.get(id);
        if (xterm?.terminal) {
          xterm.terminal.write(`\r\n\x1b[31m[Error: ${errorMsg}]\x1b[0m\r\n`);
          if (errorMsg.includes("rebuild")) {
            xterm.terminal.write(
              `\x1b[33mPlease run: npm run rebuild\x1b[0m\r\n`,
            );
          }
        }
        return false;
      }
      return true;
    } catch (err) {
      const error = toAppError(err);
      this.terminalCreateErrors.set(id, error.message)
      logger.system.error(
        `[TerminalManager] Exception creating PTY for ${id}: ${error.code}`,
        error,
      );

      // 显示错误信息到终端
      const xterm = this.xtermInstances.get(id);
      if (xterm?.terminal) {
        xterm.terminal.write(
          `\r\n\x1b[31m[Error: ${error.message}]\x1b[0m\r\n`,
        );
      }
      return false;
    }
  }

  private attachWebglAddon(id: string, instance: XTermInstance): void {
    if (instance.webglAddon) return
    try {
      const webglAddon = new WebglAddon();
      instance.terminal.loadAddon(webglAddon);
      instance.webglAddon = webglAddon;
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        if (this.xtermInstances.get(id) === instance) {
          instance.webglAddon = undefined;
        }
      });
    } catch { /* Keep the default renderer when WebGL is unavailable. */ }
  }

  private createWebLinksAddon(): WebLinksAddon {
    const modifierLabel = isMac ? 'Cmd' : 'Ctrl'
    let hoverTarget: HTMLElement | null = null
    return new WebLinksAddon(
      (event, uri) => {
        const hasOpenModifier = isMac ? event.metaKey : event.ctrlKey
        if (!hasOpenModifier) return
        event.preventDefault()
        void api.terminal.openExternal(uri)
          .then(opened => {
            if (!opened) logger.system.warn('[Terminal] URL was not opened:', uri)
          })
          .catch(error => {
            logger.system.warn('[Terminal] Failed to open URL:', error)
          })
      },
      {
        hover: (event) => {
          hoverTarget = event.target instanceof HTMLElement ? event.target : null
          hoverTarget?.setAttribute('title', `${modifierLabel}+Click to open in browser`)
        },
        leave: () => {
          hoverTarget?.removeAttribute('title')
          hoverTarget = null
        },
      },
    )
  }

  private createXtermInstance(id: string): XTermInstance {
    const termConfig = getEditorConfig().terminal;
    const terminal = new XTerminal({
      cursorBlink: termConfig.cursorBlink,
      fontFamily: termConfig.fontFamily,
      fontSize: termConfig.fontSize,
      lineHeight: termConfig.lineHeight,
      scrollback: termConfig.scrollback,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 4.5,
      theme: this.currentTheme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(this.createWebLinksAddon());
    this.registerShellIntegrationHandler(id, terminal);

    // 处理终端输入
    terminal.onData((data) => {
      this.writeToTerminal(id, data);
    });

    const mod = (e: KeyboardEvent) => isMac ? e.metaKey : e.ctrlKey;

    terminal.attachCustomKeyEventHandler((event) => {
      // Cmd/Ctrl+C 复制（有选中内容时）
      if (mod(event) && event.key === "c" && event.type === "keydown") {
        const selection = terminal.getSelection();
        if (selection) {
          void writeClipboardText(selection);
          return false;
        }
        // macOS 上 Cmd+C 没有选中内容时不发送中断信号
        // 但 Ctrl+C（非 Cmd）应该发送中断信号
        if (isMac && event.metaKey) return false;
        return true;
      }

      if (event.type !== "keydown") return true;

      // Cmd/Ctrl+V for paste
      if (mod(event) && !event.shiftKey && event.key === "v") {
        event.preventDefault();
        readClipboardText()
          .then((text) => {
            if (text) {
              api.terminal.write(id, text);
            }
          })
          .catch(() => { });
        return false;
      }

      // Ctrl+Shift+C 复制（备用，非 macOS）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "C" &&
        event.type === "keydown"
      ) {
        const selection = terminal.getSelection();
        if (selection) {
          void writeClipboardText(selection);
        }
        return false;
      }

      // Ctrl+Shift+V 粘贴（备用，非 macOS）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "V" &&
        event.type === "keydown"
      ) {
        readClipboardText()
          .then((text) => {
            if (text) {
              api.terminal.write(id, text);
            }
          })
          .catch(() => { });
        return false;
      }

      return true; // 其他按键正常行为
    });

    const instance: XTermInstance = {
      terminal,
      fitAddon,
      container: null,
      shellIntegrationReady: false,
    };
    this.xtermInstances.set(id, instance);
    return instance;
  }

  private replayOutputBuffer(id: string, terminal: XTerminal): void {
    const existingBuffer = this.outputBuffers.get(id);
    if (!existingBuffer || existingBuffer.length === 0) return;
    for (const chunk of existingBuffer.toArray()) {
      terminal.write(chunk);
    }
  }

  /**
   * Ensure a logical terminal has an xterm parser even while its UI is not
   * mounted. Agent execution must not depend on React panel lifetime; the PTY
   * and its output buffer can outlive the currently visible terminal view.
   */
  private ensureXtermInstance(id: string): XTermInstance | null {
    const existing = this.xtermInstances.get(id)
    if (existing) return existing
    if (!this.hasTerminal(id)) return null

    const instance = this.createXtermInstance(id)
    this.replayOutputBuffer(id, instance.terminal)
    return instance
  }

  mountTerminal(id: string, container: HTMLDivElement): boolean {
    if (this.xtermInstances.has(id)) {
      const existing = this.xtermInstances.get(id)!;
      existing.container = container;

      // A non-null element means xterm was opened before and can only be
      // opened once. Move that DOM node into its new parent so an Agent
      // terminal can be remounted while a command is still running.
      if (!existing.terminal.element) {
        existing.terminal.open(container);
        // This parser already consumed live output (or replayed it in
        // ensureXtermInstance). Opening its UI must not duplicate that history.
      } else if (existing.terminal.element.parentElement !== container) {
        container.appendChild(existing.terminal.element);
      }

      if (container.isConnected) {
        this.attachWebglAddon(id, existing);
        this.resizeTerminalIfReady(id, existing);
      }
      return true;
    }

    const termConfig = getEditorConfig().terminal;
    const terminal = new XTerminal({
      cursorBlink: termConfig.cursorBlink,
      fontFamily: termConfig.fontFamily,
      fontSize: termConfig.fontSize,
      lineHeight: termConfig.lineHeight,
      scrollback: termConfig.scrollback,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 4.5,
      theme: this.currentTheme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(this.createWebLinksAddon());
    this.registerShellIntegrationHandler(id, terminal);
    terminal.open(container);

    let webglAddon: WebglAddon | undefined;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = undefined;
        if (this.xtermInstances.has(id)) {
          this.xtermInstances.get(id)!.webglAddon = undefined;
        }
      });
    } catch { /* Keep the default renderer when WebGL is unavailable. */ }

    // 处理终端输入
    terminal.onData((data) => {
      this.writeToTerminal(id, data);
    });
    // 处理粘贴文本
    const handlePasteText = (text: string) => {
      api.terminal.write(id, text);
    };

    const mod = (e: KeyboardEvent) => isMac ? e.metaKey : e.ctrlKey;

    terminal.attachCustomKeyEventHandler((event) => {
      // Cmd/Ctrl+C 复制（有选中内容时）
      if (mod(event) && event.key === "c" && event.type === "keydown") {
        const selection = terminal.getSelection();
        if (selection) {
          void writeClipboardText(selection);
          return false;
        }
        // macOS 上 Cmd+C 没有选中内容时不发送中断信号
        // 但 Ctrl+C（非 Cmd）应该发送中断信号
        if (isMac && event.metaKey) return false;
        return true;
      }

      if (event.type !== "keydown") return true;

      // Cmd/Ctrl+V for paste
      if (mod(event) && !event.shiftKey && event.key === "v") {
        event.preventDefault();
        readClipboardText().then((text) => {
          handlePasteText(text);
        }).catch(() => { });
        return false;
      }

      // Ctrl+Shift+C 复制（备用，非 macOS）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "C" &&
        event.type === "keydown"
      ) {
        const selection = terminal.getSelection();
        if (selection) {
          void writeClipboardText(selection);
        }
        return false;
      }

      // Ctrl+Shift+V 粘贴（备用，非 macOS）
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "V" &&
        event.type === "keydown"
      ) {
        readClipboardText()
          .then((text) => {
            if (text) {
              api.terminal.write(id, text);
            }
          })
          .catch(() => { });
        return false;
      }

      return true; // 其他按键正常处理
    });

    this.xtermInstances.set(id, {
      terminal,
      fitAddon,
      webglAddon,
      container,
      shellIntegrationReady: false,
    });

    // 回放已有 buffer —— 解决 xterm 挂载前 PTY 已产生输出导致终端显示为空的问题
    this.replayOutputBuffer(id, terminal);

    this.resizeTerminalIfReady(id, this.xtermInstances.get(id));

    return true;
  }

  /**
   * 卸载 xterm UI 实例以释放 DOM/WebGL 内存，但 PTY 进程和 outputBuffer 完整保留。
   * 下次 mountTerminal 时会新建 xterm 并将 buffer 全量回放，用户看到完整历史。
   */
  unmountTerminal(id: string) {
    const existing = this.xtermInstances.get(id);
    if (!existing) return;
    existing.container = null;

    if (existing.webglAddon) {
      try { existing.webglAddon.dispose(); } catch { /* Continue terminal disposal if the WebGL context is already lost. */ }
      existing.webglAddon = undefined;
    }

    // Keep the xterm parser alive for an executing Agent command. Otherwise
    // closing/reopening the panel would lose OSC 633 markers even though the
    // PTY is still alive. Idle terminals are recreated from outputBuffer on
    // their next execution or data event.
    if (this.activeExecutions.has(id)) return

    try { existing.terminal.dispose(); } catch { /* Release bookkeeping even when the terminal has already been disposed. */ }

    // 从 map 中移除，确保下次 mountTerminal 走"新建实例 + buffer replay"分支
    // 而不是尝试在已销毁的 terminal 上调用 open()（会静默失败导致空白）
    this.disposeShellIntegrationHandler(id)
    this.xtermInstances.delete(id);
  }

  fitTerminal(id: string) {
    const instance = this.xtermInstances.get(id);
    this.resizeTerminalIfReady(id, instance);
  }

  async closeTerminal(id: string): Promise<void> {
    const job = this.managedJobs.get(id)
    if (job) {
      if (!isExecutionFinished(job.status)) {
        this.closingJobs.add(id)
        const response = await api.execution.cancel(id)
        if (!response.success) throw new Error(response.error)
        this.applyExecutionSnapshot(response.job)
        // Keep a visible stopping/unknown process until the backend confirms its exit.
        if (!isExecutionFinished(response.job.status)) return
      }
      this.removeTerminalView(id)
      return
    }
    const stopped = await api.terminal.kill(id)
    if (stopped && !stopped.success) throw new Error(stopped.error || 'Terminal stop is not confirmed')
    this.removeTerminalView(id)
  }

  private removeTerminalView(id: string) {
    const activeExecution = this.activeExecutions.get(id)
    if (activeExecution) {
      activeExecution.finalize('user_closed_terminal', {
        finalStatus: 'cancelled',
      })
    } else {
      const current = this.currentCommandSessions.get(id)
      if (current) {
        this.finalizeCommandSession(id, {
          ...current,
          status: 'cancelled',
          endedAt: Date.now(),
          terminationReason: 'user_closed_terminal',
        })
      }
    }

    const xterm = this.xtermInstances.get(id);
    if (xterm) {
      xterm.container = null;
      this.disposeShellIntegrationHandler(id)
      xterm.terminal.dispose();
      this.xtermInstances.delete(id);
    }

    this.removeAgentTerminalReference(id)

    this.outputBuffers.delete(id);
    this.ptyReady.delete(id);
    this.shellIntegrationRawParsers.delete(id);
    this.terminalCreateErrors.delete(id);
    this.clearCommandState(id)
    const job = this.managedJobs.get(id)
    if (job) {
      this.hiddenJobs.add(id)
      this.managedJobs.set(id, { ...job, output: '' })
    }
    this.unknownTerminals.delete(id)
    this.reservedTerminals.delete(id)
    this.agentLeases.delete(id)

    const index = this.state.terminals.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.state.terminals.splice(index, 1);
    }

    if (this.state.activeId === id) {
      this.state.activeId = this.state.terminals[0]?.id || null;
    }

    this.notify();
  }

  hasTerminal(id: string): boolean {
    return this.state.terminals.some(t => t.id === id);
  }

  setActiveTerminal(id: string | null) {
    // 验证终端是否存在，不存在则静默忽略（终端可能已被手动关闭）
    if (id !== null && !this.state.terminals.find(t => t.id === id)) {
      return;
    }
    if (this.state.activeId !== id) {
      this.state.activeId = id;
      this.notify();
    }
  }

  // ===== 工具方法 =====

  writeToTerminal(id: string, data: string) {
    const request = this.managedJobs.has(id) ? api.execution.input(id, data) : api.terminal.write(id, data)
    void request?.catch(error => logger.system.warn('[TerminalManager] Input failed:', error))
  }

  private submitAgentInput(id: string, data: string): Promise<void> {
    const leaseId = this.agentLeases.get(id)
    const request = leaseId ? api.terminal.write(id, data, leaseId) : api.terminal.write(id, data)
    return Promise.resolve(request).then(result => {
      if (result && !result.success) throw new Error(result.error || 'Terminal input failed')
    })
  }

  pasteToTerminal(id: string, data: string) {
    const terminal = this.xtermInstances.get(id)?.terminal;
    if (!data) return;

    // Match the working keyboard shortcut: send clipboard text directly to the
    // PTY. xterm.paste() is not guaranteed to emit onData in every Electron build.
    this.writeToTerminal(id, data);
    terminal?.focus();
  }

  /** Start a long-running Agent command in the existing interactive shell. */
  executeDetachedCommand(termId: string, command: string, cwd?: string): void {
    this.reservedTerminals.delete(termId)
    const terminal = this.state.terminals.find((item) => item.id === termId)
    const shellFamily = terminal?.remote ? 'posix' : detectTerminalShellFamily(terminal?.shell)
    const isPowerShell = shellFamily === 'powershell'
    const runnable = cwd
      ? (isPowerShell
        ? `Push-Location '${escapePowerShellSingleQuoted(cwd)}'; ${command}`
        : `cd '${escapePosixSingleQuoted(cwd)}' && ${command}`)
      : command
    void this.submitAgentInput(termId, isPowerShell ? `${runnable}\r` : `${runnable}\n`).catch(error => {
      this.unknownTerminals.add(termId)
      logger.system.warn('[TerminalManager] Background input result is unknown:', error)
    })
  }

  getOutputBuffer(id: string): string[] {
    return this.outputBuffers.get(id)?.toArray() || [];
  }

  getOutputPreview(id: string, lineCount = 12, maxChars = 4000): string {
    const entries = this.outputBuffers.get(id)?.toArray() || []
    if (entries.length === 0) {
      return ''
    }

    const chunks: string[] = []
    let chars = 0
    let lines = 0

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      chunks.push(entry)
      chars += entry.length

      for (let j = 0; j < entry.length; j++) {
        if (entry.charCodeAt(j) === 10) {
          lines++
        }
      }

      if (chars >= maxChars || lines >= lineCount + 1) {
        break
      }
    }

    return chunks.reverse().join('').trim().split('\n').slice(-lineCount).join('\n').trim()
  }

  getXterm(id: string): XTerminal | null {
    return this.xtermInstances.get(id)?.terminal || null;
  }

  getTerminalCreateError(id: string): string | null {
    return this.terminalCreateErrors.get(id) || null
  }

  isTerminalReady(id: string): boolean {
    return this.ptyReady.get(id) === true
  }

  focusTerminal(id: string) {
    const xterm = this.xtermInstances.get(id);
    if (xterm) {
      xterm.terminal.focus();
    }
  }

  // ===== Agent 专属终端 =====

  private isReusableAgentTerminal(terminalId: string): boolean {
    const exists = this.state.terminals.find(t => t.id === terminalId)
    if (!exists || exists.managedJob || !this.isTerminalReady(terminalId)
      || this.unknownTerminals.has(terminalId) || this.reservedTerminals.has(terminalId)) return false

    const commandInfo = this.getTerminalCommandState(terminalId)
    const occupiedByDetachedWork =
      commandInfo.current?.status === 'detached' ||
      commandInfo.last?.status === 'detached'
    const occupiedByActiveCommand =
      commandInfo.current?.status === 'queued' ||
      commandInfo.current?.status === 'running'

    return !occupiedByDetachedWork && !occupiedByActiveCommand
  }

  private removeAgentTerminalReference(id: string): void {
    if (this.agentTerminalId === id) {
      this.agentTerminalId = null
    }

    for (const [key, value] of this.agentRemoteTerminalIds.entries()) {
      if (value === id) {
        this.agentRemoteTerminalIds.delete(key)
      }
    }
  }

  async getOrCreateAgentTerminalLease(cwd: string, options?: {
    background?: boolean
    timeoutMs?: number
    shell?: string
    remote?: TerminalInstance['remote']
    agentTerminalKey?: string
    name?: string
  }): Promise<AgentTerminalLease> {
    const shell = options?.shell || (options?.remote ? undefined : (await shellRegistryService.load()).defaultShell)
    const key = JSON.stringify([options?.agentTerminalKey || 'default', cwd, shell,
      options?.remote?.host, options?.remote?.port, options?.remote?.username])
    const reserve = async (terminalId: string, reused: boolean): Promise<AgentTerminalLease> => {
      if (!this.isReusableAgentTerminal(terminalId)) throw new Error('Terminal is already leased or unavailable')
      this.reservedTerminals.add(terminalId)
      try {
        const response = await api.terminal.claim?.(terminalId, options?.background, options?.agentTerminalKey, options?.timeoutMs)
        if (response && (!response.success || !response.leaseId)) throw new Error(response.error || 'Terminal lease was rejected')
        if (response?.leaseId) this.agentLeases.set(terminalId, response.leaseId)
      } catch (error) {
        this.reservedTerminals.delete(terminalId)
        throw error
      }
      return { terminalId, reused }
    }
    const existing = this.agentRemoteTerminalIds.get(key)
    if (existing && this.isReusableAgentTerminal(existing)) return reserve(existing, true)
    const pending = this.agentRemoteTerminalCreating.get(key)
    if (pending) {
      const id = await pending
      if (this.isReusableAgentTerminal(id)) return reserve(id, true)
      // Another caller owns the creation result. It must never receive our input too.
      throw new Error('Terminal is already leased; wait for the current command to finish')
    }
    const creation = this.createTerminal({ name: options?.name || 'Agent', cwd, shell,
      isAgent: true, remote: options?.remote }).then(id => {
      if (!this.isTerminalReady(id)) {
        const error = this.getTerminalCreateError(id) || 'Failed to create terminal'
        this.removeTerminalView(id)
        throw new Error(error)
      }
      this.agentRemoteTerminalIds.set(key, id)
      return id
    })
    this.agentRemoteTerminalCreating.set(key, creation)
    try { return reserve(await creation, false) }
    finally { this.agentRemoteTerminalCreating.delete(key) }
  }

  async getOrCreateAgentTerminal(cwd: string, options?: {
    background?: boolean
    shell?: string
    remote?: TerminalInstance['remote']
    agentTerminalKey?: string
    name?: string
  }): Promise<string> {
    const lease = await this.getOrCreateAgentTerminalLease(cwd, options)
    return lease.terminalId
  }

  /**
   * 释放当前 Agent 终端绑定（不关闭终端）。
   * 长进程占用终端后调用，使下一次 getOrCreateAgentTerminal() 创建新终端。
   */
  releaseAgentTerminal(terminalId?: string) {
    if (!terminalId) {
      this.agentTerminalId = null
      return
    }

    this.removeAgentTerminalReference(terminalId)
    this.reservedTerminals.delete(terminalId)
  }

  async releaseUnsubmittedLease(terminalId: string): Promise<void> {
    const leaseId = this.agentLeases.get(terminalId)
    if (leaseId) await api.terminal.release(terminalId, leaseId)
    this.reservedTerminals.delete(terminalId)
  }

  recordDetachedCommand(
    termId: string,
    command: string,
    cwd?: string,
    source: TerminalCommandSession['source'] = 'agent',
  ): TerminalCommandSession {
    const startedAt = Date.now()
    const session: TerminalCommandSession = {
      commandSessionId: crypto.randomUUID(),
      terminalId: termId,
      command,
      cwd,
      startedAt,
      status: 'detached',
      exitCode: null,
      timedOut: false,
      terminationReason: 'detached',
      output: '',
      partialOutput: '',
      sentinelMatched: false,
      isBackground: true,
      source,
    }

    this.currentCommandSessions.set(termId, session)
    this.notify()
    return cloneCommandSession(session)!
  }

  /**
   * 在指定终端执行命令，通过 sentinel 标记精确捕获本次命令的输出。
   * 命令过程对用户可见（在终端面板里显示），同时将 stdout 作为字符串返回给 AI。
   *
   * @param cwd 可选工作目录。若提供，用 Push-Location/popd（PS）或子 shell（Unix）临时切换目录。
   */
  executeCommandWithOutput(termId: string, command: string, timeoutMs: number, cwd?: string, signal?: AbortSignal): Promise<CommandResult> {
    if (this.activeExecutions.has(termId) || this.unknownTerminals.has(termId)) {
      return Promise.reject(new Error('Terminal is busy or its previous command has not been confirmed finished'))
    }
    this.reservedTerminals.delete(termId)
    if (signal?.aborted) {
      void this.closeTerminal(termId).catch(error => logger.system.warn('[TerminalManager] Cancel stop failed:', error))
      return Promise.reject(new Error('Command cancelled before submission'))
    }
    const commandSessionId = crypto.randomUUID()
    const startedAt = Date.now()
    const terminal = this.state.terminals.find(item => item.id === termId)
    const shellFamily = terminal?.remote ? 'posix' : detectTerminalShellFamily(terminal?.shell)
    const isCmd = shellFamily === 'cmd'
    const initialXterm = this.ensureXtermInstance(termId)

    if (isCmd) {
      return Promise.resolve({
        success: false,
        finalStatus: 'failed',
        output: 'Shell integration is not available in cmd.exe. Use PowerShell or a POSIX shell.',
        partialOutput: 'Shell integration is not available in cmd.exe. Use PowerShell or a POSIX shell.',
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        terminalId: termId,
        commandSessionId,
        terminationReason: 'shell_integration_missing',
        sentinelMatched: false,
      })
    }

    if (!terminal || !initialXterm) {
      return Promise.resolve({
        success: false,
        finalStatus: 'failed',
        output: 'Terminal is no longer available.',
        partialOutput: 'Terminal is no longer available.',
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        terminalId: termId,
        commandSessionId,
        terminationReason: 'shell_integration_missing',
        sentinelMatched: false,
      })
    }

    if (!initialXterm.shellIntegrationReady && !this.hasShellIntegrationHandler(termId)) {
      return Promise.resolve({
        success: false,
        finalStatus: 'failed',
        output: 'Terminal shell integration is unavailable. Create a new terminal and try again.',
        partialOutput: 'Terminal shell integration is unavailable. Create a new terminal and try again.',
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        terminalId: termId,
        commandSessionId,
        terminationReason: 'shell_integration_missing',
        sentinelMatched: false,
      })
    }

    const initialSession: TerminalCommandSession = {
      commandSessionId,
      terminalId: termId,
      command,
      cwd,
      startedAt,
      status: 'queued',
      exitCode: null,
      timedOut: false,
      output: '',
      partialOutput: '',
      sentinelMatched: false,
      isBackground: false,
      source: 'agent',
    }

    this.setCurrentCommandSession(termId, initialSession)

    return new Promise<CommandResult>((resolve) => {
      const getXterm = () => this.xtermInstances.get(termId)
      let startMarker: IMarker | null = null
      let settled = false
      let sentinelMatched = false
      let commandSubmitted = false

      const getVisibleOutput = () => {
        const xterm = getXterm()
        if (!xterm) return ''
        if (!startMarker) return ''
        const endMarker = xterm.terminal.registerMarker()
        try {
          return trimRetainedText(
            extractTerminalOutput(xterm.terminal, startMarker, endMarker),
            MAX_COMMAND_OUTPUT_CHARS,
          )
        } finally {
          endMarker.dispose()
        }
      }

      const updatePartialOutput = (partialOutput: string, captureStartSeq?: number) => {
        this.updateCurrentCommandSession(termId, (session) => ({
          ...session,
          status: session.status === 'queued' ? 'running' : session.status,
          partialOutput,
          captureStartSeq: captureStartSeq ?? session.captureStartSeq,
        }))
      }

      const settle = (
        reason: TerminalCommandTerminationReason,
        override?: Partial<Pick<CommandResult, 'finalStatus' | 'exitCode' | 'signal' | 'timedOut' | 'output' | 'partialOutput' | 'sentinelMatched'>>,
      ) => {
        if (settled) return
        settled = true
        unsubShellIntegration()
        clearTimeout(timer)
        clearTimeout(handshakeTimer)
        signal?.removeEventListener('abort', abort)
        this.activeExecutions.delete(termId)

        const partialOutput = trimRetainedText(
          override?.partialOutput ?? getVisibleOutput(),
          MAX_COMMAND_OUTPUT_CHARS,
        )
        startMarker?.dispose()
        startMarker = null
        const output = trimRetainedText(
          override?.output ?? partialOutput,
          MAX_COMMAND_OUTPUT_CHARS,
        )
        const finalStatus = override?.finalStatus ?? 'failed'
        const exitCode = override?.exitCode ?? null
        const timedOut = override?.timedOut ?? finalStatus === 'timed_out'
        const result: CommandResult = {
          success: finalStatus === 'completed' && exitCode === 0,
          finalStatus,
          output,
          partialOutput,
          exitCode,
          timedOut,
          durationMs: Date.now() - startedAt,
          terminalId: termId,
          commandSessionId,
          terminationReason: reason,
          sentinelMatched: override?.sentinelMatched ?? sentinelMatched,
          signal: override?.signal,
        }

        this.finalizeCommandSession(termId, {
          ...(this.currentCommandSessions.get(termId) || initialSession),
          status: finalStatus,
          endedAt: Date.now(),
          exitCode,
          signal: result.signal,
          timedOut,
          terminationReason: reason,
          output,
          partialOutput,
          sentinelMatched: result.sentinelMatched,
          captureStartSeq: this.currentCommandSessions.get(termId)?.captureStartSeq,
          captureEndSeq: result.sentinelMatched ? this.currentCommandSessions.get(termId)?.captureEndSeq : this.currentCommandSessions.get(termId)?.captureEndSeq,
        })

        resolve(result)
      }

      const timer = setTimeout(() => {
        this.unknownTerminals.add(termId)
        settle('timeout', {
          finalStatus: 'timed_out',
          timedOut: true,
          partialOutput: getVisibleOutput(),
          output: getVisibleOutput(),
        })
      }, timeoutMs)

      const abort = () => {
        this.unknownTerminals.add(termId)
        void this.closeTerminal(termId).catch(error => {
          settle('terminal_error', { finalStatus: 'failed', output: `Cancellation could not be confirmed: ${String(error)}` })
        })
      }
      signal?.addEventListener('abort', abort, { once: true })

      const handshakeTimer = setTimeout(() => {
        const xterm = getXterm()
        if (!xterm?.shellIntegrationReady) {
          settle('shell_integration_missing', {
            finalStatus: 'failed',
            output: 'Terminal shell integration did not become ready. Reopen the terminal and try again.',
            partialOutput: 'Terminal shell integration did not become ready. Reopen the terminal and try again.',
          })
        }
      }, Math.min(5000, Math.max(0, timeoutMs - 1)))

      const unsubShellIntegration = this.onShellIntegration((event) => {
        if (event.terminalId !== termId || settled) return
        const framed = { started: event.phase === 'command-start', ended: event.phase === 'command-end', exitCode: event.exitCode ?? null }
        if (framed.started) {
          const xterm = getXterm()
          if (!xterm) return
          startMarker?.dispose()
          startMarker = xterm.terminal.registerMarker()
          this.updateCurrentCommandSession(termId, (session) => ({
            ...session,
            status: 'running',
            captureStartSeq: event.seq,
          }))
        }

        if (framed.ended) {
          const xterm = getXterm()
          if (!xterm) return
          const endMarker = xterm.terminal.registerMarker()
          const capturedOutput = startMarker
            ? trimRetainedText(extractTerminalOutput(xterm.terminal, startMarker, endMarker), MAX_COMMAND_OUTPUT_CHARS)
            : ''
          sentinelMatched = true
          const exitCode = framed.exitCode ?? 0
          this.updateCurrentCommandSession(termId, (session) => ({
            ...session,
            captureEndSeq: event.seq,
            sentinelMatched: true,
          }))
          settle('sentinel_matched', {
            finalStatus: exitCode === 0 ? 'completed' : 'failed',
            exitCode,
            output: capturedOutput,
            partialOutput: capturedOutput,
            sentinelMatched: true,
          })
          endMarker.dispose()
          return
        }

        if (event.phase === 'prompt' && commandSubmitted) {
          // A prompt after submission means the shell is interactive and
          // usable again even if a command replaced our hooks before C/D could
          // be emitted. Finish promptly with an unknown exit code; never
          // invent a successful result.
          settle('sentinel_missing_prompt', {
            finalStatus: 'failed',
            exitCode: null,
            partialOutput: getVisibleOutput(),
            output: getVisibleOutput(),
          })
          return
        }

        if (event.phase === 'command-line' || event.phase === 'prompt') {
          updatePartialOutput(getVisibleOutput())
        }
      })

      this.activeExecutions.set(termId, {
        commandSessionId,
        finalize: settle,
      })

      const shellFamilyForCommand = terminal.remote ? 'posix' : detectTerminalShellFamily(terminal.shell)
      const isPowerShellForCommand = shellFamilyForCommand === 'powershell'
      const runnable = cwd
        ? (isPowerShellForCommand
          ? `Push-Location '${escapePowerShellSingleQuoted(cwd)}'; ${command}; Pop-Location`
          : `cd '${escapePosixSingleQuoted(cwd)}' && ${command}`)
        : command
      const input = isPowerShellForCommand ? `${runnable}\r` : `${runnable}\n`

      const submitWhenReady = () => {
        if (settled) return
        const currentXterm = getXterm()
        if (!currentXterm) {
          settle('terminal_error', {
            finalStatus: 'failed',
            output: 'Terminal is no longer available.',
            partialOutput: 'Terminal is no longer available.',
          })
          return
        }
        if (!currentXterm.shellIntegrationReady) {
          setTimeout(submitWhenReady, 50)
          return
        }

        clearTimeout(handshakeTimer)
        // Submit exactly what the user asked for. The shell integration script
        // emits OSC 633 command boundaries and the real process exit code, so no
        // per-command wrapper can corrupt stdin, stdout, or shell state.
        this.updateCurrentCommandSession(termId, (session) => ({
          ...session,
          status: 'running',
        }))
        commandSubmitted = true
        void this.submitAgentInput(termId, input).catch(error => {
          this.unknownTerminals.add(termId)
          settle('terminal_error', { finalStatus: 'failed', output: String(error), exitCode: null })
        })
      }

      submitWhenReady()
    })
  }

  cleanup() {
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }

    for (const terminal of [...this.state.terminals]) {
      const activeExecution = this.activeExecutions.get(terminal.id)
      if (activeExecution) {
        activeExecution.finalize('cleanup', {
          finalStatus: 'cancelled',
        })
      }
      void this.closeTerminal(terminal.id).catch(error => logger.system.warn('[TerminalManager] Cleanup stop failed:', error));
    }

    this.agentTerminalId = null
    this.agentRemoteTerminalIds.clear()
    this.agentRemoteTerminalCreating.clear()
    this.currentCommandSessions.clear()
    this.lastCommandSessions.clear()
    this.activeExecutions.clear()
    this.shellIntegrationRawParsers.clear()
    this.state = {
      terminals: [],
      activeId: null,
    };
    this.notify();
  }
}

export const terminalManager = new TerminalManagerClass();
