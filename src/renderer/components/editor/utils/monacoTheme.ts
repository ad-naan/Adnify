/**
 * Monaco theme definition.
 */
import { themeManager } from '@/renderer/config/themeConfig'
import type { ThemeName } from '@store/slices/themeSlice'

const rgbToHex = (rgbStr: string) => {
  if (typeof rgbStr !== 'string' || !rgbStr) return '#000000'
  const parts = rgbStr.split(' ').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return '#000000'
  const [r, g, b] = parts
  return `#${[r, g, b]
    .map(value => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0'))
    .join('')}`
}

export function defineMonacoTheme(
  monacoInstance: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api'),
  themeName: ThemeName
) {
  const theme = themeManager.getThemeById(themeName) || themeManager.getThemeById('adnify-dark')!
  const colors = theme.colors
  const isLight = theme.type === 'light'

  const bg = rgbToHex(colors.background)
  const surface = rgbToHex(colors.surface)
  const text = rgbToHex(colors.textPrimary)
  const textSecondary = rgbToHex(colors.textSecondary)
  const textMuted = rgbToHex(colors.textMuted)
  const border = rgbToHex(colors.border)
  const accent = rgbToHex(colors.accent)

  const selection = isLight ? `${accent}33` : `${accent}55`
  const inactiveSelection = isLight ? `${accent}1f` : `${accent}30`
  const lineHighlight = isLight ? surface : `${accent}16`
  const lineHighlightBorder = isLight ? border : `${accent}24`
  const selectionMatch = isLight ? `${accent}1f` : `${accent}20`

  monacoInstance.editor.defineTheme('adnify-dynamic', {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: textSecondary.slice(1), fontStyle: 'italic' },
      { token: 'comment.doc', foreground: textSecondary.slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: accent.slice(1) },
      { token: 'keyword.control', foreground: accent.slice(1) },
      { token: 'keyword.operator', foreground: isLight ? 'd63384' : 'ff7b72' },
      { token: 'string', foreground: isLight ? '036a07' : 'a5d6ff' },
      { token: 'string.escape', foreground: isLight ? '9a6700' : 'f0c674' },
      { token: 'regexp', foreground: isLight ? '953800' : 'f97583' },
      { token: 'number', foreground: isLight ? '098658' : 'ffc600' },
      { token: 'constant', foreground: isLight ? '0550ae' : '79c0ff' },
      { token: 'type', foreground: isLight ? '267f99' : '4ec9b0' },
      { token: 'type.identifier', foreground: isLight ? '267f99' : '4ec9b0' },
      { token: 'class', foreground: isLight ? '953800' : 'ffa657' },
      { token: 'interface', foreground: isLight ? '267f99' : '4ec9b0' },
      { token: 'enum', foreground: isLight ? '267f99' : '4ec9b0' },
      { token: 'function', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'function.declaration', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'method', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'identifier', foreground: text.slice(1) },
      { token: 'variable', foreground: text.slice(1) },
      { token: 'variable.predefined', foreground: isLight ? '0550ae' : '79c0ff' },
      { token: 'parameter', foreground: isLight ? '953800' : 'ffa657' },
      { token: 'annotation', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'decorator', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'tag', foreground: isLight ? '116329' : '7ee787' },
      { token: 'attribute.name', foreground: isLight ? '0550ae' : '79c0ff' },
      { token: 'attribute.value', foreground: isLight ? '036a07' : 'a5d6ff' },
      { token: 'delimiter', foreground: textMuted.slice(1) },
      { token: 'delimiter.bracket', foreground: text.slice(1) },
      { token: 'meta', foreground: textMuted.slice(1) },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': text,
      'editor.lineHighlightBackground': lineHighlight,
      'editor.lineHighlightBorder': lineHighlightBorder,
      'editorCursor.foreground': accent,
      'editorWhitespace.foreground': border,
      'editorIndentGuide.background': border,
      'editorIndentGuide.activeBackground': textSecondary,
      'editor.selectionBackground': selection,
      'editor.inactiveSelectionBackground': inactiveSelection,
      'editor.selectionHighlightBackground': selectionMatch,
      'editor.selectionHighlightBorder': `${accent}2b`,
      'editor.wordHighlightBackground': selectionMatch,
      'editor.wordHighlightStrongBackground': `${accent}2b`,
      'editor.rangeHighlightBackground': selectionMatch,
      'editorLineNumber.foreground': textMuted,
      'editorLineNumber.activeForeground': text,
      'editorWidget.background': surface,
      'editorWidget.border': border,
      'editorSuggestWidget.background': surface,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': isLight ? `${accent}18` : `${accent}26`,
      'editorSuggestWidget.highlightForeground': accent,
      'editorHoverWidget.background': surface,
      'editorHoverWidget.border': border,
      'editor.findMatchBackground': isLight ? '#ffd33d66' : '#e3b34155',
      'editor.findMatchHighlightBackground': isLight ? '#ffd33d33' : '#e3b3412f',
      'editorBracketMatch.background': `${accent}18`,
      'editorBracketMatch.border': `${accent}55`,
      'diffEditor.insertedTextBackground': isLight ? '#28a74520' : '#23863620',
      'diffEditor.removedTextBackground': isLight ? '#d7343420' : '#da363620',
      'diffEditor.insertedLineBackground': isLight ? '#28a74515' : '#23863615',
      'diffEditor.removedLineBackground': isLight ? '#d7343415' : '#da363615',
      'diffEditor.border': border,
      'diffEditorGutter.insertedLineBackground': isLight ? '#28a74520' : '#23863620',
      'diffEditorGutter.removedLineBackground': isLight ? '#d7343420' : '#da363620',
    }
  })
}
