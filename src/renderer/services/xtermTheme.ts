/**
 * xterm theme helpers.
 */
import { themeManager } from '@/renderer/config/themeConfig'

export const XTERM_STYLE = `
.xterm { font-feature-settings: "liga" 0; position: relative; user-select: none; -ms-user-select: none; -webkit-user-select: none; padding: 4px; }
.xterm.focus, .xterm:focus { outline: none; }
.xterm .xterm-helpers { position: absolute; z-index: 5; }
.xterm .xterm-helper-textarea { padding: 0; border: 0; margin: 0; position: absolute; opacity: 0; left: -9999em; top: 0; width: 0; height: 0; z-index: -5; overflow: hidden; white-space: nowrap; }
.xterm .composition-view {
  background: rgb(var(--surface));
  color: rgb(var(--text-primary));
  border: 1px solid rgb(var(--border));
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  display: none;
  position: absolute;
  white-space: pre;
  z-index: 12;
}
.xterm .composition-view.active { display: block; }
.xterm .xterm-viewport { background-color: rgb(var(--background)); overflow-y: scroll; cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0; }
.xterm .xterm-screen { position: relative; }
.xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
.xterm .xterm-scroll-area { visibility: hidden; }
.xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; left: -9999em; top: 0; }
.xterm.enable-mouse-events { cursor: default; }
.xterm.xterm-cursor-pointer { cursor: pointer; }
.xterm.xterm-cursor-crosshair { cursor: crosshair; }
.xterm .xterm-accessibility, .xterm .xterm-message-overlay { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; }
.xterm-live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.xterm-dim { opacity: 0.58; }
.xterm-underline { text-decoration: underline; }
.xterm-selection-layer { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
.xterm-cursor-layer { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
.xterm-link-layer { position: absolute; top: 0; left: 0; z-index: 11; pointer-events: none; }
.xterm-link-layer a { cursor: pointer; color: rgb(var(--accent)); text-decoration: underline; }
`

function rgbToHex(rgb: string): string {
  if (!rgb || typeof rgb !== 'string') return '#000000'
  const [r, g, b] = rgb.split(' ').map(Number)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function mix(rgb: string, target: string, ratio: number): string {
  const [r1, g1, b1] = rgb.split(' ').map(Number)
  const [r2, g2, b2] = target.split(' ').map(Number)
  const t = Math.max(0, Math.min(1, ratio))
  return `${clamp(r1 + (r2 - r1) * t)} ${clamp(g1 + (g2 - g1) * t)} ${clamp(b1 + (b2 - b1) * t)}`
}

function lighten(rgb: string, ratio: number): string {
  return mix(rgb, '255 255 255', ratio)
}

function darken(rgb: string, ratio: number): string {
  return mix(rgb, '0 0 0', ratio)
}

export function getTerminalTheme(themeName: string): Record<string, string> {
  const theme = themeManager.getThemeById(themeName) ?? themeManager.getThemeById('adnify-dark')!
  const c = theme.colors
  const isLight = theme.type === 'light'

  const baseBlack = isLight ? darken(c.surfaceMuted, 0.78) : darken(c.surface, 0.18)
  const baseWhite = isLight ? lighten(c.surface, 0.02) : lighten(c.textPrimary, 0.08)
  const cursor = isLight ? darken(c.accent, 0.08) : lighten(c.accentSubtle, 0.08)
  const cursorAccent = isLight ? c.textInverted : c.background
  const selectionBackground = isLight ? lighten(c.accent, 0.58) : darken(c.accent, 0.08)
  const selectionInactiveBackground = isLight ? c.surfaceActive : c.surfaceHover

  const brightRed = isLight ? darken(c.statusError, 0.08) : lighten(c.statusError, 0.16)
  const brightGreen = isLight ? darken(c.statusSuccess, 0.06) : lighten(c.statusSuccess, 0.16)
  const brightYellow = isLight ? darken(c.statusWarning, 0.08) : lighten(c.statusWarning, 0.14)
  const brightBlue = isLight ? darken(c.statusInfo, 0.06) : lighten(c.statusInfo, 0.14)
  const brightMagenta = isLight ? darken(c.accentSubtle, 0.18) : lighten(c.accentSubtle, 0.16)
  const brightCyan = isLight ? darken(c.accent, 0.02) : lighten(c.accent, 0.16)
  const brightBlack = isLight ? darken(c.textMuted, 0.12) : lighten(c.surfaceMuted, 0.12)
  const brightWhite = isLight ? darken(c.textPrimary, 0.02) : lighten(c.textPrimary, 0.18)

  return {
    background: rgbToHex(c.background),
    foreground: rgbToHex(c.textPrimary),
    cursor: rgbToHex(cursor),
    cursorAccent: rgbToHex(cursorAccent),
    selectionBackground: rgbToHex(selectionBackground),
    selectionInactiveBackground: rgbToHex(selectionInactiveBackground),
    selectionForeground: rgbToHex(c.textPrimary),
    black: rgbToHex(baseBlack),
    red: rgbToHex(c.statusError),
    green: rgbToHex(c.statusSuccess),
    yellow: rgbToHex(c.statusWarning),
    blue: rgbToHex(c.statusInfo),
    magenta: rgbToHex(c.accentSubtle),
    cyan: rgbToHex(c.accent),
    white: rgbToHex(baseWhite),
    brightBlack: rgbToHex(brightBlack),
    brightRed: rgbToHex(brightRed),
    brightGreen: rgbToHex(brightGreen),
    brightYellow: rgbToHex(brightYellow),
    brightBlue: rgbToHex(brightBlue),
    brightMagenta: rgbToHex(brightMagenta),
    brightCyan: rgbToHex(brightCyan),
    brightWhite: rgbToHex(brightWhite),
  }
}
