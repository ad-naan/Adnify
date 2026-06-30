import { motion } from 'framer-motion'
import { GitBranch, FolderOpen, FileCode, Clock, RefreshCw } from 'lucide-react'
import { useStore } from '@store'
import { getFileName } from '@shared/utils/pathUtils'

interface EmptyChatSuggestionsProps {
    onSelectSuggestion: (text: string) => void
}

export default function EmptyChatSuggestions({ onSelectSuggestion: _onSelectSuggestion }: EmptyChatSuggestionsProps) {
    const language = useStore(s => s.language)
    const workspacePath = useStore(s => s.workspacePath)
    const gitStatus = useStore(s => s.gitStatus)
    const gitRecentCommits = useStore(s => s.gitRecentCommits)

    // Derived values
    const currentBranch = gitStatus?.branch || 'main'
    const changedFilesCount = gitStatus ? (gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length) : 0
    const latestCommit = gitRecentCommits?.[0]
    const latestCommitHash = latestCommit?.hash?.substring(0, 7) || '---'
    const latestCommitMsg = latestCommit?.message || (language === 'zh' ? '暂无提交记录' : 'No commits')

    return (
        <div className="flex flex-col p-6 select-none z-10 w-full max-w-[500px] mx-auto h-full overflow-hidden">
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col h-full"
            >
                {/* Project Insights */}
                <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                        <h3 className="text-[13px] font-bold text-[rgb(var(--text-primary))]">{language === 'zh' ? '项目洞察' : 'Project Insights'}</h3>
                        <button className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] transition-colors">
                            <RefreshCw className="w-3 h-3" />
                            <span>{language === 'zh' ? '刷新' : 'Refresh'}</span>
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {/* Branch */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-[rgb(var(--accent)/0.1)] rounded-lg text-[rgb(var(--accent))] shrink-0">
                                <GitBranch className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{language === 'zh' ? '当前分支' : 'Branch'}</div>
                                <div className="text-[13px] font-medium text-[rgb(var(--text-primary))] truncate">{currentBranch}</div>
                            </div>
                        </div>
                        {/* Directory */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-[rgb(var(--accent-subtle)/0.1)] rounded-lg text-[rgb(var(--accent-subtle))] shrink-0">
                                <FolderOpen className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{language === 'zh' ? '打开目录' : 'Workspace'}</div>
                                <div className="text-[13px] font-medium text-[rgb(var(--text-primary))] truncate">
                                    /{workspacePath ? getFileName(workspacePath) : (language === 'zh' ? '未打开' : 'None')}
                                </div>
                            </div>
                        </div>
                        {/* Changes */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 shrink-0">
                                <FileCode className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{language === 'zh' ? '变更文件' : 'Changes'}</div>
                                <div className="text-[13px] font-medium text-emerald-500">{changedFilesCount} {language === 'zh' ? '个' : 'files'}</div>
                            </div>
                        </div>
                        {/* Commits */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-[rgb(var(--accent)/0.1)] rounded-lg text-[rgb(var(--accent))] shrink-0">
                                <Clock className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{language === 'zh' ? '最新提交' : 'Latest Commit'}</div>
                                <div className="text-[13px] font-medium text-[rgb(var(--text-primary))] truncate">
                                    <span className="text-[rgb(var(--accent))] mr-1.5">{latestCommitHash}</span>
                                    {latestCommitMsg}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    )
}
