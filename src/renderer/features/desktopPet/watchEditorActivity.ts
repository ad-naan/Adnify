import type { editor } from 'monaco-editor'
import { api } from '@services/electronAPI'
import type { PetActivity } from '@shared/desktopPet'
import type { EditorSyntaxInput } from './editorSyntax'

const MAX_SYNTAX_FILE_LENGTH = 250_000
let worker: Worker | undefined
let requestId = 0

type EditActivity = Extract<PetActivity, { type: 'editor.edit' }>

export function watchEditorActivity(instance: editor.ICodeEditor, model: editor.ITextModel): { dispose: () => void } {
  const pet = api.desktopPet
  if (!pet) return { dispose() {} }
  const language = model.getLanguageId()
  const extension = model.uri.path.match(/\.(tsx|jsx)$/i)?.[1].toLowerCase() ?? (language === 'typescript' ? 'ts' : 'js')
  const canSummarizeSyntax = language === 'javascript' || language === 'typescript'
  let watching = false
  let disposed = false
  let notified = false
  let previous: string | undefined
  let insertedCharacters = 0
  let removedCharacters = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let listener: ((event: MessageEvent<{ id: number; syntax?: EditActivity['syntax'] }>) => void) | undefined

  const cancel = () => {
    clearTimeout(timer)
    if (listener) worker?.removeEventListener('message', listener)
    listener = undefined
  }
  const snapshot = () => canSummarizeSyntax && model.getValueLength() <= MAX_SYNTAX_FILE_LENGTH ? model.getValue() : undefined
  const reset = () => {
    cancel()
    insertedCharacters = removedCharacters = 0
    previous = watching ? snapshot() : undefined
  }
  const setWatching = (value: boolean) => {
    if (disposed || watching === value) return
    watching = value
    reset()
  }
  const unsubscribe = pet.onWatching(value => {
    notified = true
    setWatching(value)
  })
  void pet.isWatching().then(value => {
    if (!notified) setWatching(value)
  }).catch(() => {})

  const subscription = model.onDidChangeContent(event => {
    if (!watching) return
    if (event.isFlush || !instance.hasTextFocus()) {
      reset()
      return
    }
    cancel()
    for (const change of event.changes) {
      insertedCharacters += change.text.length
      removedCharacters += change.rangeLength
    }
    timer = setTimeout(() => {
      const before = previous
      const after = snapshot()
      if (before !== undefined && before === after) {
        reset()
        return
      }
      const activity: EditActivity = { type: 'editor.edit', language, insertedCharacters, removedCharacters }
      const send = (syntax?: EditActivity['syntax']) => {
        cancel()
        previous = after
        insertedCharacters = removedCharacters = 0
        pet.notifyActivity({ ...activity, syntax })
      }
      if (before === undefined || after === undefined) {
        send()
        return
      }
      try {
        worker ??= new Worker(new URL('./editorSyntax.worker.ts', import.meta.url), { type: 'module' })
        const id = ++requestId
        listener = ({ data }) => { if (data.id === id) send(data.syntax) }
        worker.addEventListener('message', listener)
        worker.postMessage({ id, before, after, extension } satisfies EditorSyntaxInput & { id: number })
        timer = setTimeout(() => send(), 1600)
      } catch {
        send()
      }
    }, 1800)
  })

  return {
    dispose: () => {
      disposed = true
      cancel()
      unsubscribe()
      subscription.dispose()
    },
  }
}
