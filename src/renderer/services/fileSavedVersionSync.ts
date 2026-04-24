import { useStore } from '@store'
import { monaco } from '@renderer/monacoWorker'

export function scheduleSavedVersionSync(filePath: string, expectedContent: string): void {
  let attempts = 0
  const maxAttempts = 8

  const sync = () => {
    const model = monaco.editor.getModel(monaco.Uri.file(filePath))
    if (!model) return

    if (model.getValue() !== expectedContent) {
      attempts += 1
      if (attempts < maxAttempts) {
        requestAnimationFrame(sync)
      }
      return
    }

    const { markFileSaved } = useStore.getState()
    markFileSaved(filePath, model.getAlternativeVersionId())
  }

  requestAnimationFrame(sync)
}
