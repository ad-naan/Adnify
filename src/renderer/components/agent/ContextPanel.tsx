import { useState, useMemo } from 'react'
import {
    File,
    Code,
    Folder,
    Database,
    GitBranch,
    Terminal,
    X,
    Plus,
    ChevronDown,
    ChevronRight,
    Cpu
} from 'lucide-react'
import {
    ContextItem,
    FileContext,
} from '@/renderer/agent/types'
import { getFileName } from '@shared/utils/pathUtils'
import { useStore } from '@store'

interface ContextPanelProps {
    contextItems: ContextItem[]
    activeFilePath: string | null
    onRemove: (index: number) => void
    onClear: () => void
    onAddCurrentFile: () => void
}

export default function ContextPanel({
    contextItems,
    activeFilePath,
    onRemove,
    onClear,
    onAddCurrentFile
}: ContextPanelProps) {
    const expandAgentBlocksByDefault = useStore(s => s.agentConfig.expandAgentBlocksByDefault ?? false)
    const [isExpanded, setIsExpanded] = useState(expandAgentBlocksByDefault)

    // 简单的 Token 估算 (字符数 / 4)
    const estimatedTokens = useMemo(() => {
        return contextItems.length * 100 // 假设每个引用平均 100 tokens
    }, [contextItems])

    const getIconAndLabel = (item: ContextItem) => {
        switch (item.type) {
            case 'File': return { icon: <File className="w-3 h-3 text-accent" />, label: getFileName((item as FileContext).uri) || 'File' }
            case 'CodeSelection': return { icon: <Code className="w-3 h-3 text-blue-400" />, label: 'Selection' }
            case 'Folder': return { icon: <Folder className="w-3 h-3 text-yellow-400" />, label: 'Folder' }
            case 'Codebase': return { icon: <Database className="w-3 h-3 text-purple-400" />, label: '@codebase' }
            case 'Git': return { icon: <GitBranch className="w-3 h-3 text-orange-400" />, label: '@git' }
            case 'Terminal': return { icon: <Terminal className="w-3 h-3 text-green-400" />, label: '@terminal' }
            case 'Symbols': return { icon: <Code className="w-3 h-3 text-blue-400" />, label: '@symbols' }
            default: return { icon: <File className="w-3 h-3" />, label: 'Unknown' }
        }
    }
    const isCurrentFileAdded = activeFilePath && contextItems.some(
        (s: ContextItem) => s.type === 'File' && (s as FileContext).uri === activeFilePath
    )

    if (contextItems.length === 0 && !activeFilePath) return null

    return (
        <div className="bg-surface/5 transition-all duration-300 animate-fade-in">
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-surface/20 transition-colors group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2.5 text-[11px] text-text-muted">
                    <div className="flex items-center gap-1.5">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <span className="font-semibold uppercase tracking-wider">Context</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface/20 rounded-full border border-border-subtle">
                        <span className="text-accent font-bold">{contextItems.length}</span>
                        <span className="opacity-40">items</span>
                    </div>
                    {contextItems.length > 0 && (
                        <div className="flex items-center gap-1.5 ml-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <Cpu className="w-3 h-3" />
                            <span className="font-medium">~{estimatedTokens} tokens</span>
                        </div>
                    )}
                </div>

                {contextItems.length > 0 && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onClear() }}
                        className="text-[10px] font-medium text-text-muted hover:text-red-400 transition-colors uppercase tracking-tight"
                    >
                        Clear all
                    </button>
                )}
            </div>

            {/* Content */}
            {isExpanded && (
                <div className="px-4 pb-3 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Quick Add Current File */}
                        {activeFilePath && !isCurrentFileAdded && (
                            <button
                                onClick={onAddCurrentFile}
                                className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 rounded-lg border border-accent/20 text-[11px] text-accent transition-all group shadow-sm shadow-accent/5"
                                title="Add active file to context"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                <span className="truncate max-w-[150px] font-semibold">{getFileName(activeFilePath)}</span>
                            </button>
                        )}

                        {/* Context Items */}
                        {contextItems.map((item: ContextItem, index: number) => {
                            const { icon, label } = getIconAndLabel(item)
                            return (
                                <div
                                    key={`${item.type}-${index}`}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-surface/40 rounded-lg border border-border-subtle text-[11px] group hover:border-border hover:bg-surface/60 transition-all shadow-sm"
                                >
                                    <div className="opacity-80 group-hover:opacity-100 transition-opacity">
                                        {icon}
                                    </div>
                                    <span className="text-text-secondary truncate max-w-[180px] font-medium group-hover:text-text-primary transition-colors">{label}</span>
                                    <button
                                        onClick={() => onRemove(index)}
                                        className="p-0.5 rounded-md hover:bg-red-500/20 text-text-muted hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
