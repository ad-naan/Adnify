import type { Theme } from '@renderer/config/themeConfig'

interface ThemeWorkbenchPreviewProps {
  theme: Theme
  className?: string
}

export default function ThemeWorkbenchPreview({
  theme,
  className = 'h-[92px]',
}: ThemeWorkbenchPreviewProps) {
  const { colors } = theme

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${className}`}
      style={{
        backgroundColor: `rgb(${colors.background})`,
        borderColor: `rgb(${colors.border})`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[12px] border-b"
        style={{
          backgroundColor: `rgb(${colors.surface})`,
          borderColor: `rgb(${colors.borderSubtle})`,
        }}
      >
        <div className="flex h-full items-center gap-1.5 px-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `rgb(${colors.statusError})` }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `rgb(${colors.statusWarning})` }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `rgb(${colors.statusSuccess})` }} />
          <div className="ml-2 h-1.5 w-10 rounded-full" style={{ backgroundColor: `rgb(${colors.surfaceMuted})`, opacity: 0.8 }} />
          <div className="ml-auto h-1.5 w-6 rounded-full" style={{ backgroundColor: `rgb(${colors.accent})`, opacity: 0.85 }} />
        </div>
      </div>

      <div
        className="absolute left-0 top-[12px] bottom-[8px] w-[12px] border-r"
        style={{
          backgroundColor: `rgb(${colors.surface})`,
          borderColor: `rgb(${colors.borderSubtle})`,
        }}
      >
        <div className="flex h-full flex-col items-center gap-1.5 pt-2">
          <span className="h-2.5 w-2.5 rounded-[4px]" style={{ backgroundColor: `rgb(${colors.accent})` }} />
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.65 }} />
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.4 }} />
          <span className="mt-auto mb-2 h-2 w-2 rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.3 }} />
        </div>
      </div>

      <div
        className="absolute left-[12px] top-[12px] bottom-[8px] w-[28px] border-r"
        style={{
          backgroundColor: `rgb(${colors.backgroundSecondary})`,
          borderColor: `rgb(${colors.borderSubtle})`,
        }}
      >
        <div className="space-y-1 px-2 pt-2">
          <div className="h-1.5 w-4 rounded-full" style={{ backgroundColor: `rgb(${colors.textSecondary})`, opacity: 0.75 }} />
          <div className="h-1.5 w-5 rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.48 }} />
          <div className="h-1.5 w-3 rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.36 }} />
          <div className="h-4 rounded-md" style={{ backgroundColor: `rgb(${colors.surface})`, opacity: 0.95 }} />
        </div>
      </div>

      <div
        className="absolute right-0 top-[12px] bottom-[8px] w-[30px] border-l"
        style={{
          backgroundColor: `rgb(${colors.backgroundSecondary})`,
          borderColor: `rgb(${colors.borderSubtle})`,
        }}
      >
        <div className="space-y-1.5 px-2 pt-2">
          <div className="h-1.5 w-4 rounded-full" style={{ backgroundColor: `rgb(${colors.textSecondary})`, opacity: 0.72 }} />
          <div className="h-1 w-5 rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.42 }} />
          <div className="h-4 rounded-md" style={{ backgroundColor: `rgb(${colors.surface})` }} />
          <div className="h-1 w-4 rounded-full" style={{ backgroundColor: `rgb(${colors.accent})`, opacity: 0.82 }} />
        </div>
      </div>

      <div className="absolute left-[40px] right-[30px] top-[12px] bottom-[8px]" style={{ backgroundColor: `rgb(${colors.background})` }}>
        <div
          className="mx-2 mt-2 h-3 rounded-md border"
          style={{
            backgroundColor: `rgb(${colors.surface})`,
            borderColor: `rgb(${colors.borderSubtle})`,
          }}
        >
          <div className="flex h-full items-center gap-1 px-2">
            <div className="h-1 w-6 rounded-full" style={{ backgroundColor: `rgb(${colors.textSecondary})`, opacity: 0.82 }} />
            <div className="h-1 w-4 rounded-full" style={{ backgroundColor: `rgb(${colors.accent})`, opacity: 0.9 }} />
          </div>
        </div>

        <div className="space-y-1.5 px-3 pt-2">
          <div className="h-1.5 w-16 rounded-full" style={{ backgroundColor: `rgb(${colors.textPrimary})`, opacity: 0.92 }} />
          <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: `rgb(${colors.accent})`, opacity: 0.92 }} />
          <div className="h-1.5 w-[72%] rounded-full" style={{ backgroundColor: `rgb(${colors.textSecondary})`, opacity: 0.72 }} />
          <div className="h-1.5 w-[58%] rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.55 }} />
          <div className="grid grid-cols-[1fr_0.8fr] gap-2 pt-1">
            <div className="h-6 rounded-md" style={{ backgroundColor: `rgb(${colors.surface})` }} />
            <div className="h-6 rounded-md" style={{ backgroundColor: `rgb(${colors.accent})`, opacity: 0.18 }} />
          </div>
        </div>
      </div>

      <div
        className="absolute inset-x-0 bottom-0 h-[8px] border-t"
        style={{
          backgroundColor: `rgb(${colors.surface})`,
          borderColor: `rgb(${colors.borderSubtle})`,
        }}
      >
        <div className="flex h-full items-center justify-between px-2">
          <div className="h-1 w-8 rounded-full" style={{ backgroundColor: `rgb(${colors.textMuted})`, opacity: 0.55 }} />
          <div className="h-1 w-5 rounded-full" style={{ backgroundColor: `rgb(${colors.accent})` }} />
        </div>
      </div>
    </div>
  )
}
