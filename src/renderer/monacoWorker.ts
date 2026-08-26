/**
 * Monaco Editor Worker 配置
 * 配置 Monaco 使用 Web Worker 来处理语言服务
 */

import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
// Monaco 0.55+ 需要单独导入 TypeScript 语言服务
import {
  typescriptDefaults,
  javascriptDefaults,
} from 'monaco-editor/esm/vs/language/typescript/monaco.contribution'

// 配置 Monaco 环境
// 使用 globalThis 替代 self，确保在浏览器和 Worker 环境中都能正常工作
// Monaco 已经定义了 Environment 类型，我们直接使用
globalThis.MonacoEnvironment = {
  getWorker(_: unknown, label: string): Worker {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  }
}

// Adnify uses its project-aware LSP bridge for language intelligence. Keeping
// Monaco's separate TypeScript service enabled duplicates every open model in
// an 8 MB worker and performs the same completion/diagnostic work a second time.
// Syntax highlighting does not depend on these providers.
typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true, // 也禁用语法检查，避免路径解析错误
  noSuggestionDiagnostics: true,
})

javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
})

typescriptDefaults.setEagerModelSync(false)
javascriptDefaults.setEagerModelSync(false)

const externalLspMode = {
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  diagnostics: false,
  documentRangeFormattingEdits: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
}

typescriptDefaults.setModeConfiguration(externalLspMode)
javascriptDefaults.setModeConfiguration(externalLspMode)

export { monaco }
