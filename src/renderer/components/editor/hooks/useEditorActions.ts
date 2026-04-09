/**
 * 编辑器快捷键和动作 Hook
 */
import { useCallback } from 'react'
import type { editor } from 'monaco-editor'
import { goToDefinition } from '@services/lspService'
import { lspUriToPath } from '@shared/utils/uriUtils'
import { safeOpenFile } from '@renderer/utils/fileUtils'
import { setPendingNavigation } from '@services/editorNavigation'

interface InlineEditState {
  show: boolean
  position: { x: number; y: number }
  selectedCode: string
  lineRange: [number, number]
}

/** 路径规范化（统一斜杠、去掉 Windows 前缀斜杠） */
function normPath(p: string) {
  return p.replace(/\\/g, '/').replace(/^\/([A-Za-z]):/, '$1:').toLowerCase()
}

/** 执行 Go-to-Definition 导航（同文件 / 跨文件均处理） */
async function navigateToDefinition(
  editorInstance: editor.IStandaloneCodeEditor,
  filePath: string,
  line: number,   // LSP 0-indexed
  col: number     // LSP 0-indexed
) {
  const locations = await goToDefinition(filePath, line, col)
  if (!locations || locations.length === 0) return

  const loc = locations[0]
  const targetPath = lspUriToPath(loc.uri)
  const targetLine = loc.range.start.line + 1       // Monaco 1-indexed
  const targetCol  = loc.range.start.character + 1

  if (normPath(targetPath) === normPath(filePath)) {
    // ── 同文件：直接移动光标 ──
    editorInstance.setPosition({ lineNumber: targetLine, column: targetCol })
    editorInstance.revealPositionInCenter({ lineNumber: targetLine, column: targetCol })
  } else {
    // ── 跨文件：先 setPendingNavigation，再 safeOpenFile ──
    // stdlib / 工作区外文件会被安全模块拦截，safeOpenFile 返回 { success: false }，静默失败
    setPendingNavigation({ filePath: targetPath, line: targetLine, col: targetCol })
    const result = await safeOpenFile(targetPath, { showWarning: false, confirmLargeFile: false })
    if (!result.success) {
      // 目标文件无法打开（stdlib、工作区外），清除挂起导航
      setPendingNavigation({ filePath: '', line: 0, col: 0 })
    }
  }
}

export function useEditorActions(
  setInlineEditState: (state: InlineEditState | null) => void
) {
  const registerActions = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api')
  ) => {
    // Ctrl+D: 选择下一个匹配
    editorInstance.addAction({
      id: 'select-next-occurrence',
      label: 'Select Next Occurrence',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
      run: (ed) => ed.getAction('editor.action.addSelectionToNextFindMatch')?.run()
    })

    // Ctrl+/: 切换注释
    editorInstance.addAction({
      id: 'toggle-comment',
      label: 'Toggle Line Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: (ed) => ed.getAction('editor.action.commentLine')?.run()
    })

    // Ctrl+Shift+K: 删除行
    editorInstance.addAction({
      id: 'delete-line',
      label: 'Delete Line',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
      run: (ed) => ed.getAction('editor.action.deleteLines')?.run()
    })

    // Cmd+K / Ctrl+K: 内联编辑
    editorInstance.addAction({
      id: 'inline-edit',
      label: 'Inline Edit with AI',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: (ed) => {
        const selection = ed.getSelection()
        if (!selection || selection.isEmpty()) {
          const position = ed.getPosition()
          if (position) {
            ed.setSelection({
              startLineNumber: position.lineNumber,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: ed.getModel()?.getLineMaxColumn(position.lineNumber) || 1
            })
          }
        }

        const newSelection = ed.getSelection()
        if (newSelection && !newSelection.isEmpty()) {
          const model = ed.getModel()
          if (model) {
            const selectedText = model.getValueInRange(newSelection)
            const editorDomNode = ed.getDomNode()
            const coords = ed.getScrolledVisiblePosition(newSelection.getStartPosition())

            if (editorDomNode && coords) {
              const rect = editorDomNode.getBoundingClientRect()
              setInlineEditState({
                show: true,
                position: {
                  x: rect.left + Math.max(0, coords.left - 20),
                  y: rect.top + Math.max(0, coords.top - 36)
                },
                selectedCode: selectedText,
                lineRange: [newSelection.startLineNumber, newSelection.endLineNumber]
              })
            }
          }
        }
      }
    })

    // ── F12: Go to Definition（覆盖 Monaco 内置 revealDefinition）──────────
    // 使用 addCommand 的优先级高于 Monaco 内置 F12 绑定
    editorInstance.addCommand(monaco.KeyCode.F12, async () => {
      const model = editorInstance.getModel()
      const position = editorInstance.getPosition()
      if (!model || !position) return
      const filePath = lspUriToPath(model.uri.toString())
      try {
        await navigateToDefinition(
          editorInstance, filePath,
          position.lineNumber - 1, position.column - 1
        )
      } catch { /* 静默忽略，如 stdlib 等不可访问路径 */ }
    })

    // ── Ctrl+Click: Go to Definition ─────────────────────────────────────────
    // multiCursorModifier:'alt' 时 Ctrl+Click 触发定义跳转
    // 我们接管整个 Ctrl+Click 流程（包括同文件），防止 Monaco standalone 尝试跨文件打开
    editorInstance.onMouseDown(async (e) => {
      if (!e.event.ctrlKey && !e.event.metaKey) return
      if (!e.target.position) return

      // 立即拦截，防止 Monaco 内部的 Ctrl+Click 导航逻辑触发
      e.event.preventDefault()

      const model = editorInstance.getModel()
      if (!model) return
      const filePath = lspUriToPath(model.uri.toString())
      try {
        await navigateToDefinition(
          editorInstance, filePath,
          e.target.position.lineNumber - 1, e.target.position.column - 1
        )
      } catch { /* 静默忽略 */ }
    })
  }, [setInlineEditState])

  return { registerActions }
}
