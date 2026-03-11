export function normalizePipeTerminalInput(data: string): string {
  if (data === String.fromCharCode(3)) {
    return data
  }

  return data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
