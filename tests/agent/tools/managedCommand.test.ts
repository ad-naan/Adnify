import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionSnapshot } from '@shared/types/execution'

const mocks = vi.hoisted(() => ({
  submit: vi.fn(), wait: vi.fn(), applyExecutionSnapshot: vi.fn(), setActiveTerminal: vi.fn(),
  getManagedJob: vi.fn(), hasTerminal: vi.fn(), getOutputBuffer: vi.fn(),
  getState: vi.fn(() => ({ terminals: [{ id: 'available-terminal' }] })),
}))
vi.mock('@renderer/services/electronAPI', () => ({ api: { execution: mocks } }))
vi.mock('@renderer/services/TerminalManager', () => ({ terminalManager: mocks }))
vi.mock('@renderer/shell/services/shellRegistryService', () => ({
  shellRegistryService: { load: async () => ({ defaultShell: 'powershell.exe' }) },
}))
import { runManagedCommand } from '@renderer/agent/tools/managedCommand'
import { readTerminalOutput } from '@renderer/agent/tools/readTerminalOutput'

const job: ExecutionSnapshot = {
  jobId: 'build-job', requestKey: 'request', threadId: 'thread', command: 'pnpm build',
  cwd: '/project', shell: 'powershell.exe', mode: 'command', status: 'failed',
  submittedAt: 1, exitCode: 2, output: 'building\nTS2430 incompatible interface', truncated: false, revision: 3,
}

beforeEach(() => { vi.clearAllMocks(); mocks.getManagedJob.mockReturnValue(undefined); mocks.hasTerminal.mockReturnValue(false) })

describe('managed command results', () => {
  it('returns final diagnostics and metadata after a failed build', async () => {
    mocks.submit.mockResolvedValue({ success: true, job: { ...job, status: 'running', exitCode: null, output: '', revision: 2 } })
    mocks.wait.mockResolvedValue({ success: true, job })
    const result = await runManagedCommand({ command: job.command, mode: 'command' }, { workspacePath: job.cwd })
    expect(result.success).toBe(false)
    expect(result.result).toContain('Exit code: 2')
    expect(result.result).toContain(job.output)
    expect(result.meta).toMatchObject({ output: job.output, exitCode: 2, finalStatus: 'failed', truncated: false })
    expect(mocks.applyExecutionSnapshot).toHaveBeenLastCalledWith(job)
  })

  it('reports discarded output even when no text remains', async () => {
    mocks.submit.mockResolvedValue({ success: true, job: { ...job, output: '', truncated: true } })
    const result = await runManagedCommand({ command: job.command, mode: 'command' }, { workspacePath: job.cwd })
    expect(result.result).toContain('[Earlier output truncated]')
    expect(result.meta?.truncated).toBe(true)
  })
})

describe('reading terminal output', () => {
  it.each(['last', 'recent', 'missing-id'])('reports an unknown ID (%s) with available IDs', async id => {
    const result = await readTerminalOutput(id)
    expect(result.success).toBe(false)
    expect(result.error).toContain(`Unknown terminal ID "${id}"`)
    expect(result.error).toContain('available-terminal')
    expect(mocks.getOutputBuffer).not.toHaveBeenCalled()
  })

  it('distinguishes an existing empty terminal from an unknown ID', async () => {
    mocks.hasTerminal.mockReturnValue(true)
    mocks.getOutputBuffer.mockReturnValue([])
    const result = await readTerminalOutput('available-terminal')
    expect(result.success).toBe(true)
    expect(result.result).toContain('has not produced output yet')
  })

  it('reads a failed managed job even if its terminal view was closed', async () => {
    mocks.getManagedJob.mockReturnValue(job)
    mocks.wait.mockResolvedValue({ success: true, job: { ...job, truncated: true } })
    const result = await readTerminalOutput(job.jobId, 1)
    expect(result.success).toBe(true)
    expect(result.result).toContain('TS2430')
    expect(result.result).not.toContain('building')
    expect(result.meta).toMatchObject({ exitCode: 2, truncated: true })
  })
})
