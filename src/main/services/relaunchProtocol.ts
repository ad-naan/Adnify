import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TOKEN_ARG = '--adnify-relaunch-token='
const PARENT_ARG = '--adnify-relaunch-parent='
const HANDSHAKE_ARG = '--adnify-relaunch-handshake='
const HANDSHAKE_PREFIX = 'adnify-relaunch-'

export interface RelaunchContext {
  token: string
  parentPid: number
  handshakePath: string
}

export interface RelaunchTicket extends RelaunchContext {
  args: string[]
}

function readArgument(argv: string[], prefix: string): string | null {
  const value = argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
  return value || null
}

export function createRelaunchTicket(): RelaunchTicket {
  const token = randomUUID()
  const handshakePath = path.join(os.tmpdir(), `${HANDSHAKE_PREFIX}${token}.ready`)
  return {
    token,
    parentPid: process.pid,
    handshakePath,
    args: [
      `${TOKEN_ARG}${token}`,
      `${PARENT_ARG}${process.pid}`,
      `${HANDSHAKE_ARG}${Buffer.from(handshakePath, 'utf8').toString('base64url')}`,
    ],
  }
}

export function buildWindowsLaunchScript(
  executablePath: string,
  launchArgs: string[],
  elevated: boolean,
): string {
  const executableBase64 = Buffer.from(executablePath, 'utf8').toString('base64')
  const decodedArgs = launchArgs.map((value, index) => (
    `$arg${index} = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value, 'utf8').toString('base64')}'))`
  ))
  const quotedArgs = launchArgs
    .map((_, index) => `('"' + $arg${index}.Replace('"', '\\"') + '"')`)
    .join(' + \' \' + ')
  return [
    `$exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableBase64}'))`,
    ...decodedArgs,
    `$argumentString = ${quotedArgs || "''"}`,
    elevated
      ? 'Start-Process -FilePath $exe -ArgumentList $argumentString -Verb RunAs'
      : '(New-Object -ComObject Shell.Application).ShellExecute($exe, $argumentString, "", "open", 1)',
  ].join('; ')
}

export function parseRelaunchContext(argv: string[]): RelaunchContext | null {
  const token = readArgument(argv, TOKEN_ARG)
  const parentValue = readArgument(argv, PARENT_ARG)
  const encodedHandshake = readArgument(argv, HANDSHAKE_ARG)
  if (!token || !parentValue || !encodedHandshake || !/^[0-9a-f-]{36}$/i.test(token)) return null

  const parentPid = Number(parentValue)
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return null

  try {
    const handshakePath = path.resolve(Buffer.from(encodedHandshake, 'base64url').toString('utf8'))
    const expectedPath = path.resolve(os.tmpdir(), `${HANDSHAKE_PREFIX}${token}.ready`)
    if (handshakePath !== expectedPath) return null
    return { token, parentPid, handshakePath }
  } catch {
    return null
  }
}

export function signalRelaunchReady(context: RelaunchContext): void {
  fs.writeFileSync(context.handshakePath, JSON.stringify({
    token: context.token,
    pid: process.pid,
    readyAt: Date.now(),
  }), { encoding: 'utf8', flag: 'wx' })
}

export async function waitForRelaunchReady(ticket: RelaunchTicket, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const payload = JSON.parse(await fs.promises.readFile(ticket.handshakePath, 'utf8')) as { token?: string }
      if (payload.token === ticket.token) return true
    } catch {
      // The replacement has not reached its entry point yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

export async function waitForParentExit(context: RelaunchContext, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(context.parentPid, 0)
    } catch {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

export function cleanupRelaunchHandshake(context: RelaunchContext): void {
  try { fs.unlinkSync(context.handshakePath) } catch { /* best-effort cleanup */ }
}
