import { FileCode2 } from 'lucide-react'
import { useStore } from '@store'
import BottomBarPopover from '../ui/BottomBarPopover'
import { applyFileEol } from '@services/fileFormatService'
import { toast } from '../common/ToastProvider'
import { globalConfirm } from '../common/ConfirmDialog'
import { t, type Language, type TranslationKey } from '@shared/i18n'
import { getFileName } from '@shared/utils/pathUtils'
import { api } from '@renderer/services/electronAPI'
import { applySavedEditorBufferContent } from '@renderer/services/editorBufferService'

// 换行符的说明是平台名，两种语言逐字相同（和 `label` 一样），所以是字面量而不是文案键 ——
// 进 locale 表只会多出两个 en/zh 相同的键要在平价棘轮里豁免。
const EOL_OPTIONS = [
  { id: 'LF', label: 'LF', description: 'Unix / macOS' },
  { id: 'CRLF', label: 'CRLF', description: 'Windows' },
] as const

const ENCODING_OPTIONS: ReadonlyArray<{ id: string, label: string, descriptionKey: TranslationKey }> = [
  { id: 'utf-8', label: 'UTF-8', descriptionKey: 'fileFormatControls.encoding.utf8' },
  { id: 'utf-8-bom', label: 'UTF-8 BOM', descriptionKey: 'fileFormatControls.encoding.utf8Bom' },
  { id: 'gbk', label: 'GBK', descriptionKey: 'fileFormatControls.encoding.gbk' },
  { id: 'gb18030', label: 'GB18030', descriptionKey: 'fileFormatControls.encoding.gb18030' },
]

function MenuListButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
        active
          ? 'bg-accent/10 text-accent'
          : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
      }`}
    >
      <div className="text-sm font-semibold leading-5">{title}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-text-muted">{description}</div>
    </button>
  )
}

export default function FileFormatControls() {
  const activeFile = useStore(state => state.openFiles.find(file => file.path === state.activeFilePath))
  const language = useStore(state => state.language)
  const setFileEncoding = useStore(state => state.setFileEncoding)

  if (!activeFile || activeFile.kind === 'preview') {
    return null
  }

  const currentEol = activeFile.eol ?? 'LF'
  const currentEncoding = activeFile.encoding ?? 'utf-8'

  const handleEolChange = (nextEol: 'LF' | 'CRLF') => {
    if (nextEol === currentEol) return

    const changed = applyFileEol(activeFile.path, nextEol)
    if (changed) {
      toast.success(
        t('fileFormatControls.lineEndingUpdated', language),
        nextEol,
      )
    }
  }

  const handleEncodingChange = async (nextEncoding: string) => {
    if (nextEncoding === currentEncoding) return

    // 切换编码必须按新编码重新解码磁盘内容，因此会丢弃编辑器里未保存的修改。
    // 与外部修改重载（useFileWatcher）保持一致：脏文件先征得用户同意。
    if (activeFile.isDirty) {
      const confirmed = await globalConfirm({
        title: getFileName(activeFile.path),
        message: t('file.reencodeDiscardChanges', language as Language, { name: getFileName(activeFile.path) }),
        confirmText: t('git.continue', language),
        cancelText: t('cancel', language as Language),
        variant: 'warning',
      })
      if (!confirmed) return
    }

    const nextContent = await api.file.readFull(activeFile.path, nextEncoding)
    if (nextContent === null) {
      toast.error(
        t('fileFormatControls.failedToSwitchEncoding', language),
        nextEncoding.toUpperCase(),
      )
      return
    }

    applySavedEditorBufferContent(activeFile.path, nextContent)
    setFileEncoding(activeFile.path, nextEncoding)
    toast.success(
      t('fileFormatControls.fileEncodingUpdated', language),
      nextEncoding.toUpperCase(),
    )
  }

  return (
    <div className="flex items-center gap-1">
      <BottomBarPopover
        icon={<span className="px-1 text-[10px] font-semibold">{currentEol}</span>}
        tooltip={t('fileFormatControls.lineEnding', language)}
        title={t('fileFormatControls.lineEnding', language)}
        width={196}
        scrollable={false}
      >
        <div className="p-1.5 space-y-1">
          {EOL_OPTIONS.map(option => (
            <MenuListButton
              key={option.id}
              active={currentEol === option.id}
              onClick={() => handleEolChange(option.id)}
              title={option.label}
              description={option.description}
            />
          ))}
        </div>
      </BottomBarPopover>

      <BottomBarPopover
        icon={
          <div className="flex items-center gap-1 px-1">
            <FileCode2 className="w-3 h-3" />
            <span className="text-[10px] font-semibold uppercase">{currentEncoding}</span>
          </div>
        }
        tooltip={t('fileFormatControls.fileEncoding', language)}
        title={t('fileFormatControls.fileEncoding', language)}
        width={220}
        scrollable={false}
      >
        <div className="p-1.5 space-y-1">
          {ENCODING_OPTIONS.map(option => (
            <MenuListButton
              key={option.id}
              active={currentEncoding === option.id}
              onClick={() => handleEncodingChange(option.id)}
              title={option.label}
              description={t(option.descriptionKey, language)}
            />
          ))}
        </div>
      </BottomBarPopover>
    </div>
  )
}
