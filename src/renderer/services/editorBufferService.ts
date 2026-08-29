import { monaco } from '@renderer/monacoWorker'
import { useStore } from '@store'
import type { EditorDocumentKind } from '@shared/types/editorDocument'

const SNAPSHOT_DELAY_MS = 100
const pendingSnapshots = new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>()

function cancelPendingSnapshot(filePath: string): void {
  const pending = pendingSnapshots.get(filePath)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingSnapshots.delete(filePath)
}

/**
 * 只读预览文档不得参与任何写盘路径。
 *
 * `large-preview` 只把首个分页载入 store，并由 LargeFileViewer(readOnly) 渲染 ——
 * 它从不为该路径注册 `file://` model。因此一旦它进入保存流程：
 * getEditorBufferContent 回退到 store 里的首页内容（把 GB 级文件截成 2MB），
 * 或者 Editor 里那个已 dispose 的 editorRef 返回 ''（Monaco 在 _modelData 为空时
 * 返回空串而非抛错），file:write 只挡 undefined/null，于是整个文件被截成 0 字节。
 *
 * 因此写盘的判定放在这里，而不是各个调用点 —— 新增保存入口时默认就是安全的。
 */
export function isWritableDocumentKind(kind: EditorDocumentKind | undefined): boolean {
  return kind !== 'large-preview'
}

export function getEditorBufferContent(filePath: string, fallback: string): string {
  return monaco.editor.getModel(monaco.Uri.file(filePath))?.getValue() ?? fallback
}

/** Persist a low-frequency React/store snapshot of Monaco's live buffer. */
export function scheduleEditorBufferSnapshot(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  const timer = setTimeout(() => {
    pendingSnapshots.delete(filePath)
    useStore.getState().updateFileContent(filePath, content)
  }, SNAPSHOT_DELAY_MS)
  pendingSnapshots.set(filePath, { content, timer })
}

export function commitEditorBufferSnapshot(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  useStore.getState().updateFileContent(filePath, content)
}

/** Apply an intentional programmatic edit to both the Monaco model and store. */
export function replaceEditorBufferContent(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  const model = monaco.editor.getModel(monaco.Uri.file(filePath))
  if (model && model.getValue() !== content) model.setValue(content)
  cancelPendingSnapshot(filePath)
  useStore.getState().updateFileContent(filePath, content)
}

/** Apply authoritative disk content and reset the model's saved version. */
export function applySavedEditorBufferContent(filePath: string, content: string): void {
  cancelPendingSnapshot(filePath)
  const { reloadFileFromDisk, markFileSaved } = useStore.getState()
  reloadFileFromDisk(filePath, content)

  const model = monaco.editor.getModel(monaco.Uri.file(filePath))
  if (!model) return
  if (model.getValue() !== content) model.setValue(content)
  cancelPendingSnapshot(filePath)
  markFileSaved(filePath, model.getAlternativeVersionId())
}

export function flushEditorBufferSnapshots(): void {
  for (const [filePath, pending] of pendingSnapshots) {
    clearTimeout(pending.timer)
    useStore.getState().updateFileContent(filePath, pending.content)
  }
  pendingSnapshots.clear()
}
