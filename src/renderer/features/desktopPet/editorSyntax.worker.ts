import { summarizeSyntax, type EditorSyntaxInput } from './editorSyntax'

self.onmessage = ({ data }: MessageEvent<EditorSyntaxInput & { id: number }>) => {
  try {
    self.postMessage({ id: data.id, syntax: summarizeSyntax(data) })
  } catch {
    self.postMessage({ id: data.id })
  }
}
