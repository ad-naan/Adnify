import { Monitor, RotateCw, ShieldCheck, Smartphone, Tablet } from 'lucide-react'
import { t, type Language } from '@shared/i18n'
import type { PreviewDevice, PreviewOrientation } from '@shared/preview/device'
import { Button } from '../ui'

interface Props {
  language: Language
  device: PreviewDevice
  orientation: PreviewOrientation
  size: { width: number; height: number } | null
  scale: number
  workspaceScoped: boolean
  onChange: (device: PreviewDevice) => void
  onRotate: () => void
}

export function PreviewDeviceToolbar({ language, device, orientation, size, scale, workspaceScoped, onChange, onRotate }: Props) {
  return <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-surface/20 px-3 py-1.5 shrink-0">
    <div role="group" aria-label={t('preview.device.label', language)} className="flex items-center gap-0.5 rounded-lg border border-border/50 p-0.5">
      {([['desktop', Monitor, 'preview.device.desktop'], ['phone', Smartphone, 'preview.device.phone'], ['tablet', Tablet, 'preview.device.tablet']] as const).map(([value, Icon, label]) => (
        <button key={value} type="button" aria-pressed={device === value} onClick={() => onChange(value)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${device === value ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface/50'}`}>
          <Icon className="h-3.5 w-3.5" />{t(label, language)}
        </button>
      ))}
    </div>
    {size && <>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRotate}
        aria-label={t('preview.device.rotate', language)} title={t('preview.device.rotate', language)}>
        <RotateCw className={`h-3.5 w-3.5 ${orientation === 'landscape' ? 'rotate-90' : ''}`} />
      </Button>
      <span className="text-[11px] font-mono tabular-nums text-text-secondary">{size.width} × {size.height}</span>
      <span className="text-[10px] text-text-muted">{t('preview.device.fit', language, { percent: Math.round(scale * 100) })}</span>
    </>}
    <span className="ml-auto flex items-center gap-1 text-[10px] text-text-muted" title={t('preview.session.hint', language)}>
      <ShieldCheck className="h-3 w-3" />
      {t(workspaceScoped ? 'preview.session.workspace' : 'preview.session.window', language)}
    </span>
  </div>
}
