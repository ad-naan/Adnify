import { api } from '@renderer/services/electronAPI'
import type { ToolExecutionResult } from '@shared/types/llm'

export async function readTerminalOutput(terminalId: string, linesCount = 100): Promise<ToolExecutionResult> {
  try {
    const { terminalManager } = await import('@renderer/services/TerminalManager')
    const job = terminalManager.getManagedJob(terminalId)
    if (job) {
      const response = await api.execution.wait(terminalId, 0, 0)
      if (!response.success) throw new Error(response.error)
      terminalManager.applyExecutionSnapshot(response.job)
      return {
        success: true,
        result: `Job/Terminal ID: ${terminalId}\nStatus: ${response.job.status}${response.job.reason ? ` (${response.job.reason})` : ''}\nExit code: ${response.job.exitCode ?? 'unknown'}\n${response.job.truncated ? '[Earlier output truncated]\n' : ''}${response.job.output.split('\n').slice(-linesCount).join('\n')}`,
        meta: { terminalId, jobId: terminalId, finalStatus: response.job.status, exitCode: response.job.exitCode, truncated: response.job.truncated },
      }
    }
    if (!terminalManager.hasTerminal(terminalId)) {
      const ids = terminalManager.getState().terminals.map(terminal => terminal.id)
      throw new Error(`Unknown terminal ID "${terminalId}"; it is not an available terminal (it may have been closed). Use the exact Terminal ID returned by run_command; aliases such as "last" and "recent" are not supported. Available terminal IDs: ${ids.join(', ') || '(none)'}`)
    }
    const lines = terminalManager.getOutputBuffer(terminalId)
    if (!lines?.length) {
      return { success: true, result: '[Terminal exists but has not produced output yet]', meta: { terminalId } }
    }
    const cleanOutput = lines.slice(-linesCount).join('')
      // eslint-disable-next-line no-control-regex -- Strip terminal display controls.
      .replace(/\x1b\[[0-9;]*[mGK]/g, '')
      .replace(/\r\n/g, '\n')
      .trim()
    return { success: true, result: cleanOutput || '[Terminal produced no printable output]', meta: { terminalId } }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { success: false, result: `Failed to read terminal output: ${errorMsg}`, error: errorMsg }
  }
}
