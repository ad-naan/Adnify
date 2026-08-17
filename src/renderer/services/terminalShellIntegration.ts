export const SHELL_INTEGRATION_OSC_ID = 633

export type ShellIntegrationPhase = 'prompt' | 'command-line' | 'command-start' | 'command-end'

export interface ShellIntegrationEvent {
  phase: ShellIntegrationPhase
  exitCode?: number
  commandLine?: string
  metadata?: string
}

/**
 * Parse the payload part of VS Code-compatible OSC 633 sequences.
 *
 * xterm.js invokes registerOscHandler only after it has assembled a complete
 * OSC sequence, even when the PTY splits it across arbitrary chunk boundaries.
 */
export function parseShellIntegrationPayload(payload: string): ShellIntegrationEvent | null {
  const separator = payload.indexOf(';')
  const phase = separator < 0 ? payload : payload.slice(0, separator)
  const rest = separator < 0 ? '' : payload.slice(separator + 1)

  switch (phase) {
    case 'A':
    case 'P':
      return { phase: 'prompt', metadata: rest }
    case 'E':
      return { phase: 'command-line', commandLine: rest }
    case 'C':
      return { phase: 'command-start' }
    case 'D': {
      // VS Code also allows properties after the exit code. Adnify only needs
      // the numeric exit status.
      const rawExitCode = rest.split(';', 1)[0]
      if (!/^-?\d+$/.test(rawExitCode)) return null
      return { phase: 'command-end', exitCode: Number.parseInt(rawExitCode, 10) }
    }
    default:
      return null
  }
}

/**
 * Fallback parser for renderers that still run an older xterm without
 * registerOscHandler. It accepts BEL and ST terminators and keeps a partial
 * sequence across arbitrary PTY chunk boundaries.
 */
export function createShellIntegrationOscParser(): {
  push(chunk: string): string[]
} {
  let pending = ''

  return {
      push(chunk: string): string[] {
        pending += chunk
        const payloads: string[] = []
        const prefix = `\x1b]${SHELL_INTEGRATION_OSC_ID};`
        const retainPrefixTail = () => {
          const tailLength = Math.min(pending.length, prefix.length - 1)
          const tail = tailLength > 0 ? pending.slice(-tailLength) : ''
          let retained = 0
          for (let length = tailLength; length > 0; length -= 1) {
            if (prefix.startsWith(tail.slice(tail.length - length))) {
              retained = length
              break
            }
          }
          pending = retained > 0 ? pending.slice(-retained) : ''
        }

        // A valid lifecycle OSC is tiny. Refuse to accumulate malformed or
        // unterminated data before attempting another payload extraction.
        if (pending.length > 16_384) {
          retainPrefixTail()
          return payloads
        }

        while (true) {
          const start = pending.indexOf(prefix)
          if (start < 0) {
            // Retain only a possible prefix of a split start sequence.
            retainPrefixTail()
            return payloads
          }
        if (start > 0) pending = pending.slice(start)

        let end = pending.indexOf('\x07', prefix.length)
        let terminatorLength = 1
        const escapedEnd = pending.indexOf('\x1b\\', prefix.length)
        if (escapedEnd >= 0 && (end < 0 || escapedEnd < end)) {
          end = escapedEnd
          terminatorLength = 2
        }

        if (end < 0) {
          // PTY output commonly splits an OSC sequence across IPC chunks. Keep
          // this partial sequence until its terminator arrives. If another OSC
          // starts first, the earlier sequence is malformed and can be dropped;
          // bounded retention prevents unbounded memory growth.
          const next = pending.indexOf(prefix, prefix.length)
          if (next >= 0) {
            pending = pending.slice(next)
            continue
          }
          if (pending.length > 16_384) pending = ''
          return payloads
        }

          const payload = pending.slice(prefix.length, end)
          if (payload) payloads.push(payload)
          pending = pending.slice(end + terminatorLength)
      }
    },
  }
}
