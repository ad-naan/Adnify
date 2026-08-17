export const TERMINAL_OSC_PREFIX = '\x1b]9001;'
export const TERMINAL_OSC_END = '\x07'

export interface TerminalCommandFrameState {
  startSequence: string
  endPrefix: string
  phase: 'waiting-start' | 'capturing' | 'done'
  pending: string
  startSeen: boolean
  exitCode: number | null
}

export interface TerminalCommandFrameChunk {
  output: string
  trailing: string
  started: boolean
  ended: boolean
  exitCode: number | null
}

export function createTerminalCommandFrameState(sentinelId: string): TerminalCommandFrameState {
  return {
    startSequence: `${TERMINAL_OSC_PREFIX}ADNIFY_CMD_START_${sentinelId}${TERMINAL_OSC_END}`,
    endPrefix: `${TERMINAL_OSC_PREFIX}ADNIFY_CMD_END_${sentinelId}_`,
    phase: 'waiting-start',
    pending: '',
    startSeen: false,
    exitCode: null,
  }
}

function retainPossiblePrefix(value: string, marker: string): { safe: string; pending: string } {
  const max = Math.min(value.length, marker.length - 1)
  for (let length = max; length > 0; length--) {
    if (marker.startsWith(value.slice(-length))) {
      return { safe: value.slice(0, -length), pending: value.slice(-length) }
    }
  }
  return { safe: value, pending: '' }
}

/** Parse the private OSC frame before ANSI stripping, at arbitrary PTY boundaries. */
export function pushTerminalCommandFrame(
  state: TerminalCommandFrameState,
  chunk: string,
): TerminalCommandFrameChunk {
  if (state.phase === 'done') {
    return { output: '', trailing: chunk, started: false, ended: false, exitCode: state.exitCode }
  }

  let input = state.pending + chunk
  state.pending = ''
  let started = false

  if (state.phase === 'waiting-start') {
    const startIndex = input.indexOf(state.startSequence)
    if (startIndex < 0) {
      state.pending = retainPossiblePrefix(input, state.startSequence).pending
      return { output: '', trailing: '', started: false, ended: false, exitCode: null }
    }
    input = input.slice(startIndex + state.startSequence.length)
    state.phase = 'capturing'
    state.startSeen = true
    started = true
  }

  const endIndex = input.indexOf(state.endPrefix)
  if (endIndex < 0) {
    const retained = retainPossiblePrefix(input, state.endPrefix)
    state.pending = retained.pending
    return { output: retained.safe, trailing: '', started, ended: false, exitCode: null }
  }

  const output = input.slice(0, endIndex)
  const payload = input.slice(endIndex + state.endPrefix.length)
  const terminatorIndex = payload.indexOf(TERMINAL_OSC_END)
  if (terminatorIndex < 0) {
    state.pending = input.slice(endIndex)
    return { output, trailing: '', started, ended: false, exitCode: null }
  }

  const rawExitCode = payload.slice(0, terminatorIndex).trim()
  state.exitCode = /^-?\d+$/.test(rawExitCode) ? Number.parseInt(rawExitCode, 10) : 0
  state.phase = 'done'
  state.pending = ''
  return {
    output,
    trailing: payload.slice(terminatorIndex + TERMINAL_OSC_END.length),
    started,
    ended: true,
    exitCode: state.exitCode,
  }
}

export interface CommandDisplayFilterState {
  startSequence: string
  displayLine: string
  pending: string
  started: boolean
  frame?: TerminalCommandFrameState
}

export function filterCommandDisplayChunk(filter: CommandDisplayFilterState, data: string): string {
  if (filter.frame) {
    const framed = pushTerminalCommandFrame(filter.frame, data)
    const header = framed.started
      ? `\r\x1b[2K${filter.displayLine}\r\n`
      : ''
    return `${header}${framed.output}${framed.trailing}`
  }
  if (filter.started) return data
  const combined = filter.pending + data
  const markerIndex = combined.indexOf(filter.startSequence)
  if (markerIndex < 0) {
    filter.pending = retainPossiblePrefix(combined, filter.startSequence).pending
    return ''
  }
  filter.started = true
  filter.pending = ''
  return `\r\x1b[2K${filter.displayLine}\r\n${combined.slice(markerIndex + filter.startSequence.length)}`
}
