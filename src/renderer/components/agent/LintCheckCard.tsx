/**
 * 编辑完文件后的 lint 结果。
 *
 * 它长得跟工具行一样：同一条左边界（箭头 → 状态点 → 类型图标 → 文案）、同一条右边界
 * （统计 chip → 行尾操作位占位）。以前是一张 `my-3 px-3` 的独立卡片，夹在工具行之间像是
 * 另一个系统冒出来的东西。
 *
 * 也不自动展开：结果落定后这一行就是一行，摘要（多少个错、几个文件）已经在行里，292 条
 * 明细不该顶开整条时间轴 —— 而且自动展开完还得收，那一涨一缩就是内容上下摆动的来源。
 */

import { memo } from 'react'
import { ChevronDown, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { LintCheckPart } from '@/renderer/agent/types'
import { getFileName } from '@shared/utils/pathUtils'
import { useStore } from '@store'
import { t } from '@shared/i18n'
import SmoothCollapse from './SmoothCollapse'
import ToolActivityIndicator, { TOOL_ROW_ACTION_SLOT_CLASS } from './ToolActivityIndicator'
import { useDisclosureState } from '@renderer/hooks'

interface LintCheckCardProps {
    part: LintCheckPart
}

export const LintCheckCard = memo(({ part }: LintCheckCardProps) => {
    const language = useStore(s => s.language)
    const totalErrors = part.files.reduce((sum, f) => sum + f.errors.filter(e => e.severity === 'error').length, 0)
    const totalWarnings = part.files.reduce((sum, f) => sum + f.errors.filter(e => e.severity === 'warning').length, 0)
    const filesWithErrors = part.files.filter(f => f.errors.length > 0)
    const isChecking = part.status === 'checking'
    const hasFailed = part.status === 'failed'
    const hasDetails = filesWithErrors.length > 0
    const { isOpen: isExpanded, toggle: toggleExpanded } = useDisclosureState({})

    const handleFileClick = (filePath: string, line?: number) => {
        window.dispatchEvent(new CustomEvent('editor:open-file', { detail: { path: filePath, line } }))
    }

    const summary = isChecking
        ? t('lintCheckCard.checking', language)
        : !hasDetails
            ? t('lintCheckCard.allPassed', language)
            : filesWithErrors.length === 1
                ? getFileName(filesWithErrors[0].filePath)
                : t('lintCheckCard.filesAffected', language, { count: filesWithErrors.length })

    const rowStyle = isChecking
        ? 'bg-accent/[0.035]'
        : hasFailed
            ? 'bg-red-500/5'
            : hasDetails
                ? 'hover:bg-text-primary/[0.02]'
                : ''

    // 行尾只有色点和数字，读屏软件读不出含义，所以 chip 自带一句话；顺便当 hover 提示。
    const issueLabel = [
        totalErrors > 0 ? t('lintCheckCard.errorCount', language, { count: totalErrors }) : '',
        totalWarnings > 0 ? t('lintCheckCard.warningCount', language, { count: totalWarnings }) : '',
    ].filter(Boolean).join(' · ')

    return (
        <div className={`group relative my-0.5 overflow-hidden rounded-lg transition-colors animate-fade-in motion-reduce:transition-none ${rowStyle}`}>
            <button
                type="button"
                onClick={toggleExpanded}
                aria-expanded={hasDetails ? isExpanded : undefined}
                disabled={!hasDetails}
                className="relative z-10 flex min-h-9 w-full items-center gap-2 py-1.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:cursor-default"
            >
                {/* 箭头位常驻：没有明细时留空，行首图标才不会跟上下的工具行错开半个字符。 */}
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {hasDetails && (
                        <ChevronDown className={`h-3.5 w-3.5 text-text-muted/40 transition-transform duration-300 group-hover:text-text-muted motion-reduce:transition-none ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                    )}
                </span>

                <ToolActivityIndicator state={isChecking ? 'running' : hasFailed ? 'error' : 'success'} />
                {hasFailed
                    ? <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-text-muted/55" aria-hidden="true" />
                    : <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-text-muted/55" aria-hidden="true" />}

                <span className={`min-w-0 flex-1 truncate text-[12px] ${isChecking ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary'}`}>
                    <span className="text-text-muted">Lint</span>
                    <span className="px-1.5 text-text-muted/35">·</span>
                    {summary}
                </span>

                {/* 行尾：错误/警告数走跟增删统计同一个 chip，右边界靠操作位占位对齐。 */}
                {(totalErrors > 0 || totalWarnings > 0) && (
                    <span
                        role="img"
                        aria-label={issueLabel}
                        title={issueLabel}
                        className="flex shrink-0 select-none items-center gap-2 rounded border border-border/50 bg-text-primary/[0.03] px-1.5 py-0.5 font-mono text-[10px] opacity-80 shadow-sm backdrop-blur-sm"
                    >
                        {totalErrors > 0 && <span className="font-semibold text-red-400">● {totalErrors}</span>}
                        {totalWarnings > 0 && <span className="font-semibold text-yellow-400">▲ {totalWarnings}</span>}
                    </span>
                )}
                <span className={TOOL_ROW_ACTION_SLOT_CLASS} aria-hidden="true" />
            </button>

            {hasDetails && (
                <SmoothCollapse open={isExpanded}>
                    <div className="relative pb-3 pl-[26px] pr-3 pt-0">
                        <div className="absolute bottom-4 left-[13.5px] top-0 w-[1.5px] rounded-full bg-border/40" />
                        <div className="relative z-10 max-h-[260px] space-y-2 overflow-y-auto custom-scrollbar pt-1">
                            {filesWithErrors.map((file, fi) => (
                                <div key={fi} className="space-y-0.5">
                                    <button
                                        type="button"
                                        onClick={() => handleFileClick(file.filePath)}
                                        className="cursor-pointer text-[10px] font-medium text-accent hover:underline"
                                    >
                                        {getFileName(file.filePath)}
                                    </button>
                                    {file.errors.map((err, ei) => (
                                        <button
                                            type="button"
                                            key={ei}
                                            onClick={() => handleFileClick(file.filePath, err.line)}
                                            className="flex w-full items-start gap-1.5 rounded py-0.5 pl-2 text-left transition-colors hover:bg-surface-hover/50"
                                        >
                                            <span className={`mt-px flex-shrink-0 text-[10px] ${err.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                                                {err.severity === 'error' ? '●' : '▲'}
                                            </span>
                                            <span className="text-[10px] leading-relaxed text-text-muted">
                                                <span className="text-text-secondary/60">L{err.line}</span>
                                                {' '}{err.message}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </SmoothCollapse>
            )}
        </div>
    )
})
LintCheckCard.displayName = 'LintCheckCard'
