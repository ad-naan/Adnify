import { motion } from 'framer-motion'
import { Sparkles, Code, FileText, Bug, ArrowRight, GitBranch, FolderOpen, FileCode, Clock, RefreshCw, Zap, Box, AlertCircle, Layers, Wand2 } from 'lucide-react'
import { useStore } from '@store'
import { getFileName } from '@shared/utils/pathUtils'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { t } from '@shared/i18n'

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
    const latestCommitMsg = latestCommit?.message || (t('emptyChatSuggestions.noCommits', language))

    return (
        <div className="flex flex-col p-6 select-none z-10 w-full max-w-[500px] mx-auto h-full overflow-y-auto custom-scrollbar">
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col"
            >
                {/* 1. Header Card */}
                <div className="flex items-center gap-4 bg-gradient-to-r from-[rgb(var(--accent)/0.08)] to-[rgb(var(--accent)/0.02)] p-5 rounded-2xl mb-8 border border-[rgb(var(--accent)/0.1)]">
                    <OtterAsset asset="working" alt="AI" className="h-16 w-16 object-contain drop-shadow-md" />
                    <div>
                        <h2 className="text-[15px] font-semibold text-[rgb(var(--text-primary))] mb-1.5 tracking-tight">
                            {t('emptyChatSuggestions.whatAreWePushing', language)}
                        </h2>
                        <p className="text-[12px] text-[rgb(var(--text-secondary))] leading-relaxed max-w-[240px]">
                            {t('emptyChatSuggestions.iAmReadyTo', language)}
                        </p>
                    </div>
                </div>

                {/* 2. Project Insights */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-3 px-1">
                        <h3 className="text-[13px] font-bold text-[rgb(var(--text-primary))]">{t('emptyChatSuggestions.projectInsights', language)}</h3>
                        <button className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] transition-colors">
                            <RefreshCw className="w-3 h-3" />
                            <span>{t('refresh', language)}</span>
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {/* Branch */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-[rgb(var(--accent)/0.1)] rounded-lg text-[rgb(var(--accent))] shrink-0">
                                <GitBranch className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{t('emptyChatSuggestions.branch', language)}</div>
                                <div className="text-[13px] font-medium text-[rgb(var(--text-primary))] truncate">{currentBranch}</div>
                            </div>
                        </div>
                        {/* Directory */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-[rgb(var(--accent-subtle)/0.1)] rounded-lg text-[rgb(var(--accent-subtle))] shrink-0">
                                <FolderOpen className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{t('emptyChatSuggestions.workspace', language)}</div>
                                <div className="text-[13px] font-medium text-[rgb(var(--text-primary))] truncate">
                                    /{workspacePath ? getFileName(workspacePath) : (t('emptyChatSuggestions.none', language))}
                                </div>
                            </div>
                        </div>
                        {/* Changes */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 shrink-0">
                                <FileCode className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{t('emptyChatSuggestions.changes', language)}</div>
                                <div className="text-[13px] font-medium text-emerald-500">{changedFilesCount} {t('emptyChatSuggestions.files', language)}</div>
                            </div>
                        </div>
                        {/* Commits */}
                        <div className="bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl p-3 flex items-start gap-3 hover:bg-[rgb(var(--surface))] transition-colors">
                            <div className="p-2 bg-[rgb(var(--accent)/0.1)] rounded-lg text-[rgb(var(--accent))] shrink-0">
                                <Clock className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-[rgb(var(--text-muted))] mb-0.5">{t('emptyChatSuggestions.latestCommit', language)}</div>
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
                        <h3 className="text-[13px] font-bold text-[rgb(var(--text-primary))]">{t('emptyChatSuggestions.commandCenter', language)}</h3>
                        <div className="text-[11px] text-[rgb(var(--text-muted))] flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {t('emptyChatSuggestions.quickExecute', language)}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        <button onClick={() => onSelectSuggestion('/explain')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-[rgb(var(--accent)/0.1)] hover:border-[rgb(var(--accent)/0.3)] transition-colors group">
                            <div className="text-[rgb(var(--accent))] text-[12px] font-bold mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> /explain</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{t('emptyChatSuggestions.explainCode', language)}</div>
                        </button>
                        <button onClick={() => onSelectSuggestion('/generate')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-[rgb(var(--accent)/0.1)] hover:border-[rgb(var(--accent)/0.3)] transition-colors group">
                            <div className="text-[rgb(var(--accent))] text-[12px] font-bold mb-1 flex items-center gap-1"><Code className="w-3 h-3" /> /generate</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{t('emptyChatSuggestions.generate', language)}</div>
                        </button>
                        <button onClick={() => onSelectSuggestion('/refactor')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-colors group">
                            <div className="text-emerald-500 text-[12px] font-bold mb-1 flex items-center gap-1"><Wand2 className="w-3 h-3" /> /refactor</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{t('emptyChatSuggestions.refactor', language)}</div>
                        </button>
                        <button onClick={() => onSelectSuggestion('/fix')} className="flex flex-col items-center justify-center py-3 px-1 bg-[rgb(var(--surface)/0.6)] border border-[rgb(var(--border)/0.5)] rounded-xl hover:bg-orange-500/10 hover:border-orange-500/30 transition-colors group">
                            <div className="text-orange-500 text-[12px] font-bold mb-1 flex items-center gap-1"><Bug className="w-3 h-3" /> /fix</div>
                            <div className="text-[10px] text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))]">{t('emptyChatSuggestions.fixBugs', language)}</div>
                        </button>
                    </div>
                </div>

                {/* 4. Start From Here */}
                <div className="flex flex-col">
                    <h3 className="text-[13px] font-bold text-[rgb(var(--text-primary))] mb-3 px-1 shrink-0">{t('emptyChatSuggestions.startFromHere', language)}</h3>
                    <div className="flex flex-col gap-2 pb-6 px-1">
                        {[
                        {
                            icon: <Layers className="w-4 h-4 text-[rgb(var(--accent))]" />, iconBg: 'bg-[rgb(var(--accent)/0.1)]',
                            title: t('emptyChatSuggestions.analyzeCurrentProject', language),
                            desc: t('emptyChatSuggestions.analyzeStructureAndDependencies', language),
                            prompt: t('emptyChatSuggestions.pleaseAnalyzeTheCurrent', language)
                        },
                        {
                            icon: <Box className="w-4 h-4 text-emerald-500" />, iconBg: 'bg-emerald-500/10',
                            title: t('emptyChatSuggestions.generateModulePlan', language),
                            desc: t('emptyChatSuggestions.generateImplementationPlanBased', language),
                            prompt: t('emptyChatSuggestions.pleaseGenerateAnImplementation', language)
                        },
                        {
                            icon: <FileText className="w-4 h-4 text-emerald-500" />, iconBg: 'bg-emerald-500/10',
                            title: t('emptyChatSuggestions.addCommentsToFile', language),
                            desc: t('emptyChatSuggestions.autoGenerateCommentsTo', language),
                            prompt: t('emptyChatSuggestions.pleaseAddComprehensiveComments', language)
                        },
                        {
                            icon: <AlertCircle className="w-4 h-4 text-orange-500" />, iconBg: 'bg-orange-500/10',
                            title: t('emptyChatSuggestions.findHiddenIssues', language),
                            desc: t('emptyChatSuggestions.scanForPotentialRisks', language),
                            prompt: t('emptyChatSuggestions.pleaseScanTheCurrent', language)
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
                </div>
            </motion.div>
        </div>
    )
}
