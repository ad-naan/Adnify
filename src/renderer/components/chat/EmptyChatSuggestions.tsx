import { motion } from 'framer-motion'
import { Sparkles, Code, FileText, Bug, ArrowRight, GitBranch, FolderOpen, FileCode, Clock, RefreshCw, Zap, Box, AlertCircle, Layers, Wand2 } from 'lucide-react'
import { useStore } from '@store'
import { getFileName } from '@shared/utils/pathUtils'
import { ScrollShadow } from '../ui/ScrollShadow'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'

interface EmptyChatSuggestionsProps {
    onSelectSuggestion: (text: string) => void
}

export default function EmptyChatSuggestions({ onSelectSuggestion }: EmptyChatSuggestionsProps) {
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
                {/* 1. Header Card */}
                <div className="flex items-center gap-4 bg-gradient-to-r from-[rgb(var(--accent)/0.08)] to-[rgb(var(--accent)/0.02)] p-5 rounded-2xl mb-8 border border-[rgb(var(--accent)/0.1)]">
                    <OtterAsset asset="working" alt="AI" className="h-16 w-16 object-contain drop-shadow-md" />
                    <div>
                        <h2 className="text-[15px] font-semibold text-[rgb(var(--text-primary))] mb-1.5 tracking-tight">
                            {language === 'zh' ? '今天准备推进哪一块？' : 'What are we pushing forward today?'}
                        </h2>
                        <p className="text-[12px] text-[rgb(var(--text-secondary))] leading-relaxed max-w-[240px]">
                            {language === 'zh'
                                ? '我已就绪，随时帮你拆解任务、生成代码、定位问题，让推进更高效。'
                                : 'I am ready to help you break down tasks, generate code, and locate issues to make your work more efficient.'}
                        </p>
                    </div>
                </div>

                {/* 2. Project Insights */}
                <div className="mb-8">
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

                {/* 3. Command Center */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-3 px-1">
                        <h3 className="text-[13px] font-bold text-[rgb(var(--text-primary))]">{language === 'zh' ? '命令中心' : 'Command Center'}</h3>
                        <div className="text-[11px] text-[rgb(var(--text-muted))] flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {language === 'zh' ? '快捷执行' : 'Quick Execute'}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        <button onClick={() => onSelectSuggestion('/explain')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-[rgb(var(--accent)/0.1)] hover:border-[rgb(var(--accent)/0.3)] transition-colors group">
                            <div className="text-[rgb(var(--accent))] text-[12px] font-bold mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> /explain</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{language === 'zh' ? '解释这段代码' : 'Explain code'}</div>
                        </button>
                        <button onClick={() => onSelectSuggestion('/generate')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-[rgb(var(--accent)/0.1)] hover:border-[rgb(var(--accent)/0.3)] transition-colors group">
                            <div className="text-[rgb(var(--accent))] text-[12px] font-bold mb-1 flex items-center gap-1"><Code className="w-3 h-3" /> /generate</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{language === 'zh' ? '生成代码' : 'Generate'}</div>
                        </button>
                        <button onClick={() => onSelectSuggestion('/refactor')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-colors group">
                            <div className="text-emerald-500 text-[12px] font-bold mb-1 flex items-center gap-1"><Wand2 className="w-3 h-3" /> /refactor</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{language === 'zh' ? '重构代码' : 'Refactor'}</div>
                        </button>
                        <button onClick={() => onSelectSuggestion('/fix')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-orange-500/10 hover:border-orange-500/30 transition-colors group">
                            <div className="text-orange-500 text-[12px] font-bold mb-1 flex items-center gap-1"><Bug className="w-3 h-3" /> /fix</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{language === 'zh' ? '修复问题' : 'Fix bugs'}</div>
                        </button>
                    </div>
                </div>

                {/* 4. Start From Here */}
                <div className="flex flex-col flex-1 min-h-0">
                    <h3 className="text-[13px] font-bold text-[rgb(var(--text-primary))] mb-3 px-1 shrink-0">{language === 'zh' ? '从这里开始' : 'Start from here'}</h3>
                    <ScrollShadow className="flex-1 min-h-0" maxHeight="100%">
                        <div className="flex flex-col gap-2 pb-6 px-1">
                            {[
                            {
                                icon: <Layers className="w-4 h-4 text-[rgb(var(--accent))]" />, iconBg: 'bg-[rgb(var(--accent)/0.1)]',
                                title: language === 'zh' ? '梳理当前项目' : 'Analyze current project',
                                desc: language === 'zh' ? '分析结构与依赖，快速掌握项目全貌' : 'Analyze structure and dependencies to master the project',
                                prompt: language === 'zh' ? '请帮我梳理当前项目，分析目录结构与核心依赖，让我快速掌握项目全貌。' : 'Please analyze the current project structure and dependencies.'
                            },
                            {
                                icon: <Box className="w-4 h-4 text-emerald-500" />, iconBg: 'bg-emerald-500/10',
                                title: language === 'zh' ? '为这个模块生成方案' : 'Generate module plan',
                                desc: language === 'zh' ? '基于当前目录，生成实施方案与模块设计' : 'Generate implementation plan based on current directory',
                                prompt: language === 'zh' ? '请基于当前激活的目录或文件，为这个模块生成一份实施方案与模块设计。' : 'Please generate an implementation plan and module design.'
                            },
                            {
                                icon: <FileText className="w-4 h-4 text-emerald-500" />, iconBg: 'bg-emerald-500/10',
                                title: language === 'zh' ? '为选中文件补充注释' : 'Add comments to file',
                                desc: language === 'zh' ? '自动生成注释与类型说明，提升可读性' : 'Auto-generate comments to improve readability',
                                prompt: language === 'zh' ? '请为我当前选中的文件补充完整的注释与类型说明，提升代码可读性。' : 'Please add comprehensive comments and type declarations to the active file.'
                            },
                            {
                                icon: <AlertCircle className="w-4 h-4 text-orange-500" />, iconBg: 'bg-orange-500/10',
                                title: language === 'zh' ? '定位隐藏问题' : 'Find hidden issues',
                                desc: language === 'zh' ? '扫描潜在风险与缺陷，给出修复建议' : 'Scan for potential risks and suggest fixes',
                                prompt: language === 'zh' ? '请帮我扫描当前项目或激活文件的潜在风险、性能缺陷与安全隐患，并给出修复建议。' : 'Please scan the current project for potential bugs, security risks, and provide fixes.'
                            }
                        ].map((item, idx) => (
                            <button key={idx} onClick={() => onSelectSuggestion(item.prompt)} className="flex items-center gap-4 p-3.5 rounded-xl border border-transparent bg-[rgb(var(--surface)/0.3)] hover:bg-[rgb(var(--surface))] hover:border-[rgb(var(--border)/0.6)] transition-all text-left group">
                                <div className={`p-2.5 rounded-xl ${item.iconBg}`}>
                                    {item.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-semibold text-[rgb(var(--text-primary))] mb-0.5">{item.title}</div>
                                    <div className="text-[11px] text-[rgb(var(--text-muted))] truncate">{item.desc}</div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-[rgb(var(--text-muted))] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            </button>
                        ))}
                        </div>
                    </ScrollShadow>
                </div>
            </motion.div>
        </div>
    )
}
