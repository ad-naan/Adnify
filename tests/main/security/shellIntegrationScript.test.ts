import { spawnSync } from 'child_process'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Drives the real shell-integration script through a real interactive bash and
 * reads back the OSC 633 sequences it emitted.
 *
 * This file exists because the script was silently broken: the DEBUG trap and
 * `preexec` both checked the same "already reported" latch, so they interlocked
 * and only ever emitted `A` (prompt). Every agent command then fell through to
 * the prompt-recovery path and was reported as failed with a null exit code,
 * even when it had run fine. Nothing in the suite covered the script, so it
 * stayed broken. Assert on the marker stream, not on internals.
 */

const SCRIPT = path.resolve(__dirname, '../../../resources/shell-integration/shellIntegration.sh')
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

function hasBash(): boolean {
  const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' })
  return probe.status === 0
}

function toPosixPath(localPath: string): string {
  if (process.platform !== 'win32') return localPath
  const normalized = localPath.replace(/\\/g, '/')
  const converted = spawnSync('bash', ['-c', `wslpath -u "${normalized}" 2>/dev/null || cygpath -u "${normalized}" 2>/dev/null || echo "${normalized}"`], { encoding: 'utf8' })
  const result = converted.stdout?.trim()
  if (result) return result
  return normalized
}

const SCRIPT_PATH = toPosixPath(SCRIPT)

/** Run lines in an interactive bash with the integration loaded; return OSC payloads. */
function collectMarkers(lines: string[]): string[] {
  const input = [`export PS1='$ '`, `. '${SCRIPT_PATH}'`, ...lines, 'exit'].join('\n') + '\n'
  const result = spawnSync('bash', ['--norc', '--noprofile', '-i'], {
    input,
    encoding: 'latin1',
    timeout: 20_000,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const pattern = new RegExp(`${ESC}\\]633;([^${BEL}]*)${BEL}`, 'g')
  return [...output.matchAll(pattern)].map(match => match[1])
}

describe.runIf(hasBash())('bash shell integration', () => {
  it('emits a full command lifecycle with the real exit code', () => {
    const markers = collectMarkers(['echo MARK_A'])

    // E (command line) → C (start) → D;<code> (end) is what the terminal needs
    // to frame a command and read its result.
    const cycle = markers.slice(markers.indexOf('E;echo MARK_A'))
    expect(cycle[0]).toBe('E;echo MARK_A')
    expect(cycle[1]).toBe('C')
    expect(cycle[2]).toBe('D;0')
  })

  it('reports a non-zero exit code rather than swallowing it', () => {
    const markers = collectMarkers(['false'])
    expect(markers).toContain('D;1')
  })

  it('emits exactly one lifecycle per command, not one per nested call', () => {
    // DEBUG fires for every nested command in bash, so a function whose body
    // runs two commands must still produce a single boundary pair.
    const markers = collectMarkers(['myfn() { echo one; echo two; }', 'myfn'])
    const callIndex = markers.indexOf('E;myfn')
    expect(callIndex).toBeGreaterThan(-1)

    // Exactly one start and one end between the call and the next prompt.
    const untilPrompt = markers.slice(callIndex, markers.indexOf('A', callIndex))
    expect(untilPrompt.filter(marker => marker === 'C')).toHaveLength(1)
    expect(untilPrompt.filter(marker => marker.startsWith('D;'))).toHaveLength(1)
  })

  it('emits one lifecycle for a loop rather than one per iteration', () => {
    const markers = collectMarkers(['for i in 1 2 3; do echo "n=$i"; done'])
    const startIndex = markers.findIndex(marker => marker.startsWith('E;for'))
    expect(startIndex).toBeGreaterThan(-1)

    const untilPrompt = markers.slice(startIndex, markers.indexOf('A', startIndex))
    expect(untilPrompt.filter(marker => marker === 'C')).toHaveLength(1)
    expect(untilPrompt.filter(marker => marker.startsWith('D;'))).toHaveLength(1)
  })

  it('does not report sourcing itself as a user command', () => {
    // The script must be loaded with the latch engaged; otherwise its own
    // bootstrap statements are reported as if the user had typed them.
    const markers = collectMarkers([])
    const beforeFirstPrompt = markers.slice(0, markers.indexOf('A') + 1)
    expect(beforeFirstPrompt.some(marker => marker.startsWith('E;'))).toBe(false)
    expect(beforeFirstPrompt.some(marker => marker === 'C')).toBe(false)
  })

  it('keeps framing commands after one fails', () => {
    const markers = collectMarkers(['false', 'echo AFTER'])
    const afterIndex = markers.indexOf('E;echo AFTER')
    expect(afterIndex).toBeGreaterThan(-1)
    expect(markers[afterIndex + 1]).toBe('C')
    expect(markers[afterIndex + 2]).toBe('D;0')
  })
})
