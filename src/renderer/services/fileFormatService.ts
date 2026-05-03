import { monaco } from '@renderer/monacoWorker'
import { useStore } from '@store'

export type FileEol = 'LF' | 'CRLF'

export function detectEolFromContent(content: string): FileEol {
  return content.includes('\r\n') ? 'CRLF' : 'LF'
}

export function getModelEol(filePath: string): FileEol | null {
  const model = monaco.editor.getModel(monaco.Uri.file(filePath))
  if (!model) return null

  return model.getEndOfLineSequence() === monaco.editor.EndOfLineSequence.CRLF
    ? 'CRLF'
    : 'LF'
}

export function syncFileEolFromModel(filePath: string): void {
  const eol = getModelEol(filePath)
  if (!eol) return

  const { setFileEol } = useStore.getState()
  setFileEol(filePath, eol)
}

export function applyFileEol(filePath: string, eol: FileEol): boolean {
  const model = monaco.editor.getModel(monaco.Uri.file(filePath))
  if (!model) return false

  const nextSequence = eol === 'CRLF'
    ? monaco.editor.EndOfLineSequence.CRLF
    : monaco.editor.EndOfLineSequence.LF

  model.pushEOL(nextSequence)
  const { setFileEol, updateFileContent } = useStore.getState()
  setFileEol(filePath, eol)
  updateFileContent(filePath, model.getValue())
  return true
}
