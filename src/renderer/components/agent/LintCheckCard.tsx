/**
 * Lint 自动检查结果卡片
 * 在 Agent 编辑文件后自动展示 lint 检查结果
 */

import { memo } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import type { LintCheckPart } from '@/renderer/agent/types'
import { getFileName } from '@shared/utils/pathUtils'
import SmoothCollapse from './SmoothCollapse'
import ToolActivityIndicator from './ToolActivityIndicator'
import { useDisclosureState } from '@renderer/hooks'
interface LintCheckCardProps {
    part: LintCheckPart
}

export const LintCheckCard = memo(({ part }: LintCheckCardProps) => {
    const totalErrors = part.files.reduce((sum, f) => sum + f.errors.filter(e => e.severity === 'error').length, 0)
    const totalWarnings = part.files.reduce((sum, f) => sum + f.errors.filter(e => e.severity === 'warning').length, 0)
    const filesWithErrors = part.files.filter(f => f.errors.length > 0)
    const isChecking = part.status === 'checking'
    const hasFailed = part.status === 'failed'
    const { isOpen: isExpanded, toggle: toggleExpanded } = useDisclosureState({
        openWhile: isChecking || hasFailed,
    })

    const handleFileClick = (filePath: string, line?: number) => {
        window.dispatchEvent(new CustomEvent('editor:open-file', { detail: { path: filePath, line } }))
    }

    return (
        <div className="my-3 animate-fade-in">
            <div className={`rounded-lg transition-colors ${
                isChecking ? 'bg-accent/5' :
                hasFailed ? 'bg-red-500/5' :
                'bg-green-500/5'
            }`}>
                {/* Header */}
                <button
                    onClick={toggleExpanded}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
                >
                    {/* Status icon */}
                    <ToolActivityIndicator state={isChecking ? 'running' : hasFailed ? 'error' : 'success'} />

                    {/* Title */}
                    <span className="text-[11px] font-medium text-text-secondary flex-1">
                        {isChecking ? (
                            'Checking for lint errors...'
                        ) : hasFailed ? (
                            <span className="text-red-400">
                                Found {totalErrors} error{totalErrors !== 1 ? 's' : ''}
                                {totalWarnings > 0 && `, ${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}`}
                                {' '}in {filesWithErrors.length} file{filesWithErrors.length !== 1 ? 's' : ''}
                            </span>
                        ) : (
                            <span className="text-green-400 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" />
                                All checks passed
                            </span>
                        )}
                    </span>

                    {/* Expand toggle */}
                    {filesWithErrors.length > 0 && (
                        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    )}
                </button>

                {/* Error details */}
                {filesWithErrors.length > 0 && (
                    <SmoothCollapse open={isExpanded}>
                            <div className="max-h-[260px] overflow-y-auto custom-scrollbar px-3 pb-2.5 space-y-2">
                                {filesWithErrors.map((file, fi) => (
                                    <div key={fi} className="space-y-0.5">
                                        {/* File name */}
                                        <button
                                            onClick={() => handleFileClick(file.filePath)}
                                            className="text-[10px] font-medium text-accent hover:underline cursor-pointer"
                                        >
                                            {getFileName(file.filePath)}
                                        </button>
                                        {/* Errors */}
                                        {file.errors.map((err, ei) => (
                                            <button
                                                key={ei}
                                                onClick={() => handleFileClick(file.filePath, err.line)}
                                                className="w-full flex items-start gap-1.5 pl-2 text-left hover:bg-surface-hover/50 rounded py-0.5 transition-colors"
                                            >
                                                <span className={`text-[10px] flex-shrink-0 mt-px ${
                                                    err.severity === 'error' ? 'text-red-400' : 'text-yellow-400'
                                                }`}>
                                                    {err.severity === 'error' ? '●' : '▲'}
                                                </span>
                                                <span className="text-[10px] text-text-muted leading-relaxed">
                                                    <span className="text-text-secondary/60">L{err.line}</span>
                                                    {' '}{err.message}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                    </SmoothCollapse>
                )}
            </div>
        </div>
    )
})
LintCheckCard.displayName = 'LintCheckCard'
