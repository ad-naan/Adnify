import { memo, useCallback } from 'react'
import { Plus, Minus, Undo2 } from 'lucide-react'
import { useStore } from '@store'
import { t, type TranslationKey } from '@shared/i18n'
import { getFileName } from '@shared/utils/pathUtils'

// 文件状态图标
const FileStatusBadge = memo(function FileStatusBadge({ status }: { status: string }) {
    const config: Record<string, { color: string; label: string }> = {
        added: { color: 'text-green-400', label: 'A' },
        modified: { color: 'text-yellow-400', label: 'M' },
        deleted: { color: 'text-red-400', label: 'D' },
        renamed: { color: 'text-blue-400', label: 'R' },
        copied: { color: 'text-purple-400', label: 'C' },
        unmerged: { color: 'text-orange-400', label: 'U' },
        untracked: { color: 'text-green-400', label: 'U' },
    }
    const c = config[status] || { color: 'text-text-muted', label: '?' }
    return <span className={`text-[10px] font-mono ${c.color} w-4 text-center flex-shrink-0`}>{c.label}</span>
})

// 文件项组件
export const GitFileItem = memo(function FileItem({
    path,
    status,
    staged,
    onStage,
    onUnstage,
    onDiscard,
    onClick,
}: {
    path: string
    status: string
    staged: boolean
    onStage?: () => void
    onUnstage?: () => void
    onDiscard?: () => void
    onClick: () => void
}) {
    const fileName = getFileName(path)
    const dirPath = path.replace(fileName, '').replace(/[/\\]$/, '')
    const language = useStore(s => s.language)
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])

    return (
        <div
            data-git-file={path}
            role="button"
            tabIndex={0}
            onKeyDown={event => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    onClick()
                }
            }}
            className="group focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent flex items-center px-2 py-1.5 mx-2 my-0.5 rounded-md hover:bg-surface-hover cursor-pointer transition-colors border border-transparent hover:border-border-subtle"
            onClick={onClick}
        >
            <FileStatusBadge status={status} />
            <div className="flex-1 min-w-0 ml-2">
                <span className="text-xs text-text-primary truncate block">{fileName}</span>
                {dirPath && <span className="text-[10px] text-text-muted truncate block opacity-60">{dirPath}</span>}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                {staged ? (
                    onUnstage && <button
                        onClick={(e) => { e.stopPropagation(); onUnstage() }}
                        className="p-1 hover:bg-surface-active rounded"
                        title={tt('git.unstage')}
                    >
                        <Minus className="w-3 h-3 text-text-muted" />
                    </button>
                ) : (
                    <>
                        {onDiscard && <button
                            onClick={(e) => { e.stopPropagation(); onDiscard() }}
                            className="p-1 hover:bg-surface-active rounded"
                            title={tt('git.discard')}
                        >
                            <Undo2 className="w-3 h-3 text-text-muted hover:text-red-400" />
                        </button>}
                        {onStage && <button
                            onClick={(e) => { e.stopPropagation(); onStage() }}
                            className="p-1 hover:bg-surface-active rounded"
                            title={tt('git.stage')}
                        >
                            <Plus className="w-3 h-3 text-text-muted" />
                        </button>}
                    </>
                )}
            </div>
        </div>
    )
})

