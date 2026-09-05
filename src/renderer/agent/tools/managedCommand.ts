import { api } from '@renderer/services/electronAPI'
import { shellRegistryService } from '@renderer/shell/services/shellRegistryService'
import { isExecutionFinished, type ExecutionRequest, type ExecutionSnapshot } from '@shared/types/execution'
import type { ToolExecutionContext, ToolExecutionResult } from '@shared/types/llm'

function resultFor(job: ExecutionSnapshot): ToolExecutionResult {
  const finished = isExecutionFinished(job.status)
  const successful = job.status === 'completed' && job.exitCode === 0
  const status = job.reason === 'execution_timeout' ? 'Execution timed out; process exit confirmed'
    : job.status === 'expired' ? `Not started: ${job.reason}`
    : `${job.status}${job.reason ? `: ${job.reason}` : ''}`
  const header = `Job/Terminal ID: ${job.jobId}\nStatus: ${status}`
  const continuation = !finished
    ? '\nThe process is still tracked. Use read_terminal_output to inspect status/logs, send_terminal_input for input, or stop_terminal to stop it. Do not start the same command again.' : ''
  return {
    success: successful || (!finished && job.status !== 'unknown'),
    result: `${header}${continuation}${job.output ? `\n${job.truncated ? '[Earlier output truncated]\n' : ''}${job.output}` : ''}`,
    error: finished && !successful || job.status === 'unknown' ? status : undefined,
    meta: { command: job.command, cwd: job.cwd, jobId: job.jobId, terminalId: job.jobId,
      finalStatus: job.status, exitCode: job.exitCode, timedOut: job.reason === 'execution_timeout',
      isBackground: job.mode === 'background', executionMode: 'managed', truncated: job.truncated },
  }
}

export async function runManagedCommand(
  spec: Omit<ExecutionRequest, 'requestKey' | 'threadId' | 'shell'>,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const { terminalManager } = await import('@renderer/services/TerminalManager')
  ctx.abortSignal?.throwIfAborted()
  const requestKey = `${Date.now()}:${ctx.toolCallId || crypto.randomUUID()}`
  const shell = (await shellRegistryService.load()).defaultShell
  const response = await api.execution.submit({ ...spec, shell, requestKey, threadId: ctx.threadId || 'default' })
  if (!response.success) throw new Error(response.error)
  let job = response.job
  terminalManager.applyExecutionSnapshot(job)
  terminalManager.setActiveTerminal(job.jobId)
  let cancelling: Promise<unknown> | undefined
  const cancel = () => { cancelling ||= api.execution.cancel(job.jobId).catch(() => undefined) }
  ctx.abortSignal?.addEventListener('abort', cancel, { once: true })
  if (ctx.abortSignal?.aborted) cancel()
  try {
    while (!isExecutionFinished(job.status) && job.status !== 'unknown') {
      ctx.onProgress?.({ meta: { terminalId: job.jobId, jobId: job.jobId,
        finalStatus: job.status, command: job.command, cwd: job.cwd,
        output: job.output.slice(-4000), waitingForCapacity: job.status === 'queued' } })
      if (spec.mode === 'background' && job.status === 'running' && !ctx.abortSignal?.aborted) break
      const next = await api.execution.wait(job.jobId, job.revision, 30_000)
      if (!next.success) throw new Error(`Unable to query job ${job.jobId}: ${next.error}. Do not repeat the command.`)
      job = next.job
      terminalManager.applyExecutionSnapshot(job)
    }
    return resultFor(job)
  } finally {
    ctx.abortSignal?.removeEventListener('abort', cancel)
    await cancelling
  }
}
