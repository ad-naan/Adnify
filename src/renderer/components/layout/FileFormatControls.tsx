import { FileCode2 } from 'lucide-react'
import { useStore } from '@store'
import BottomBarPopover from '../ui/BottomBarPopover'
import { applyFileEol } from '@services/fileFormatService'
import { toast } from '../common/ToastProvider'

const EOL_OPTIONS = [
  { id: 'LF', label: 'LF', descriptionZh: 'Unix / macOS', descriptionEn: 'Unix / macOS' },
  { id: 'CRLF', label: 'CRLF', descriptionZh: 'Windows', descriptionEn: 'Windows' },
] as const

const ENCODING_OPTIONS = [
  { id: 'utf-8', label: 'UTF-8', descriptionZh: '默认 Unicode 编码', descriptionEn: 'Default Unicode encoding' },
  { id: 'utf-8-bom', label: 'UTF-8 BOM', descriptionZh: '带 BOM 的 UTF-8', descriptionEn: 'UTF-8 with BOM' },
  { id: 'gbk', label: 'GBK', descriptionZh: '简体中文常用编码', descriptionEn: 'Common Simplified Chinese encoding' },
  { id: 'gb18030', label: 'GB18030', descriptionZh: '完整中文字符集编码', descriptionEn: 'Full Chinese character set encoding' },
] as const

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
  const updateFileContent = useStore(state => state.updateFileContent)

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
        language === 'zh' ? '换行符已切换' : 'Line ending updated',
        nextEol,
      )
    }
  }

  const handleEncodingChange = async (nextEncoding: string) => {
    if (nextEncoding === currentEncoding) return

    const nextContent = await window.electronAPI.readFile(activeFile.path, nextEncoding)
    if (nextContent === null) {
      toast.error(
        language === 'zh' ? '切换编码失败' : 'Failed to switch encoding',
        nextEncoding.toUpperCase(),
      )
      return
    }

    updateFileContent(activeFile.path, nextContent)
    setFileEncoding(activeFile.path, nextEncoding)
    toast.success(
      language === 'zh' ? '文件编码已更新' : 'File encoding updated',
      nextEncoding.toUpperCase(),
    )
  }

  return (
    <div className="flex items-center gap-1">
      <BottomBarPopover
        icon={<span className="px-1 text-[10px] font-semibold">{currentEol}</span>}
        tooltip={language === 'zh' ? '换行符' : 'Line Ending'}
        title={language === 'zh' ? '换行符' : 'Line Ending'}
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
              description={language === 'zh' ? option.descriptionZh : option.descriptionEn}
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
        tooltip={language === 'zh' ? '文件编码' : 'File Encoding'}
        title={language === 'zh' ? '文件编码' : 'File Encoding'}
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
              description={language === 'zh' ? option.descriptionZh : option.descriptionEn}
            />
          ))}
        </div>
      </BottomBarPopover>
    </div>
  )
}
