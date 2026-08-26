/**
 * Monaco Editor Worker 类型声明
 */

declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/css/css.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/html/html.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution' {
  export interface ModeConfiguration {
    completionItems?: boolean
    hovers?: boolean
    documentSymbols?: boolean
    definitions?: boolean
    references?: boolean
    documentHighlights?: boolean
    rename?: boolean
    diagnostics?: boolean
    documentRangeFormattingEdits?: boolean
    signatureHelp?: boolean
    onTypeFormattingEdits?: boolean
    codeActions?: boolean
    inlayHints?: boolean
  }

  export interface LanguageServiceDefaults {
    setDiagnosticsOptions(options: {
      noSemanticValidation?: boolean
      noSyntaxValidation?: boolean
      noSuggestionDiagnostics?: boolean
    }): void
    setEagerModelSync(value: boolean): void
    setModeConfiguration(configuration: ModeConfiguration): void
  }

  export const typescriptDefaults: LanguageServiceDefaults
  export const javascriptDefaults: LanguageServiceDefaults
}
