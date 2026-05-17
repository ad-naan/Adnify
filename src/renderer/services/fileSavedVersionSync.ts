import { useStore } from '@store'
import { monaco } from '@renderer/monacoWorker'

export function scheduleSavedVersionSync(filePath: string, expectedContent: string): void {
  let attempts = 0
  const maxAttempts = 20

  const sync = () => {
    const model = monaco.editor.getModel(monaco.Uri.file(filePath))
    if (!model) {
      // Model 不存在（文件不是当前活跃文件），不需要同步版本号。
      // reloadFileFromDisk 已经重置了 savedVersionId，
      // 当文件变为活跃时 handleEditorMount 会重新初始化。
      return
    }

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
